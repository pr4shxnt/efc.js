import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  context,
  trace,
  ROOT_CONTEXT,
  defaultTextMapSetter,
  defaultTextMapGetter,
  SpanKind,
  SpanStatusCode,
  isSpanContextValid,
  type Context,
  type TextMapPropagator,
} from '@opentelemetry/api';
import type { RequestHandler, ErrorRequestHandler } from 'express';
import type { Telemetry } from 'bullmq';
import { getRequestContext, runWithContext } from './context.js';
import { processState } from './process-state.js';

export interface TracingOptions {
  /** Instrument HTTP, including upgrade handshakes. Default true. */
  http?: boolean;
  /** Instrument the queue backends and propagate context to tasks. Default true. */
  tasks?: boolean;
  /** App-owned SDK shutdown/flush, called after HTTP and tasks drain. */
  shutdown?: () => Promise<void>;
}
export type TraceCarrier = Record<string, string>;
const lifecycle = processState('tracing-lifecycle', () => ({
  shutdown: undefined as (() => Promise<void>) | undefined,
  pending: undefined as Promise<void> | undefined,
}));
export function configureTracing(options: boolean | TracingOptions | undefined): void {
  lifecycle.shutdown = typeof options === 'object' ? options.shutdown : undefined;
  lifecycle.pending = undefined;
}
export function shutdownTracing(): Promise<void> {
  const shutdown = lifecycle.shutdown;
  return (lifecycle.pending ??= Promise.resolve().then(() => shutdown?.()));
}
export function activeTracingContext(): Context {
  const current = context.active();
  const span = trace.getSpanContext(current);
  return span && isSpanContextValid(span) ? current : (getRequestContext()?.otelContext ?? current);
}
const keys = ['traceparent', 'tracestate'] as const;
const w3c = new W3CTraceContextPropagator();
function carrierOnly(carrier: unknown): TraceCarrier {
  const input = carrier && typeof carrier === 'object' ? (carrier as Record<string, unknown>) : {};
  const result: TraceCarrier = {};
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.length <= 512) result[key] = value;
  }
  return result;
}
/** W3C trace fields only: never persist baggage, credentials or task payloads. */
export function injectTrace(ctx = activeTracingContext()): TraceCarrier {
  const carrier: TraceCarrier = {};
  w3c.inject(ctx, carrier, defaultTextMapSetter);
  return carrierOnly(carrier);
}
export function extractTrace(carrier: unknown): Context {
  return w3c.extract(ROOT_CONTEXT, carrierOnly(carrier), defaultTextMapGetter);
}
export const tracePropagator: TextMapPropagator = {
  inject(ctx, carrier, setter) {
    for (const [key, value] of Object.entries(injectTrace(ctx))) setter.set(carrier, key, value);
  },
  extract(_ctx, carrier, getter) {
    return extractTrace(Object.fromEntries(keys.map((key) => [key, getter.get(carrier, key)])));
  },
  fields: () => [...keys],
};
export function traceLogFields(): Record<string, string> {
  const span = trace.getSpanContext(activeTracingContext());
  return span && isSpanContextValid(span) ? { trace_id: span.traceId, span_id: span.spanId } : {};
}
export function httpTracing(): RequestHandler {
  return (req, res, next) => {
    const method = [
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'DELETE',
      'CONNECT',
      'OPTIONS',
      'TRACE',
      'PATCH',
    ].includes(req.method)
      ? req.method
      : '_OTHER';
    const span = trace.getTracer('express-file-cluster').startSpan(
      method,
      {
        kind: SpanKind.SERVER,
        attributes: { 'http.request.method': method },
      },
      extractTrace(req.headers),
    );
    const ctx = trace.setSpan(ROOT_CONTEXT, span);
    const store = getRequestContext();
    if (store) {
      store.otelContext = ctx;
      store.httpSpan = span;
    }
    let ended = false;
    const end = (aborted: boolean) => {
      if (ended) return;
      ended = true;
      res.removeListener('finish', finished);
      res.removeListener('close', closed);
      if (!aborted || res.headersSent)
        span.setAttribute('http.response.status_code', res.statusCode);
      if (aborted || res.statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute('error.type', aborted ? 'connection_closed' : String(res.statusCode));
      }
      span.end();
    };
    const finished = () => end(false);
    const closed = () => end(!res.writableFinished);
    res.once('finish', finished);
    res.once('close', closed);
    context.with(ctx, next);
  };
}
export function traceRoute(urlPath: string): RequestHandler {
  return (req, _res, next) => {
    const span = getRequestContext()?.httpSpan;
    if (span) {
      const route = req.baseUrl + (urlPath === '/' ? '' : urlPath) || '/';
      span.setAttribute('http.route', route);
      span.updateName(`${req.method} ${route}`);
    }
    next();
  };
}
export const traceHttpError: ErrorRequestHandler = (error, _req, _res, next) => {
  const status = error?.statusCode ?? error?.status ?? 500;
  if (typeof status !== 'number' || status >= 500) {
    const span = getRequestContext()?.httpSpan;
    if (error instanceof Error) span?.recordException(error);
    span?.setStatus({ code: SpanStatusCode.ERROR });
  }
  next(error);
};
/** Native BullMQ metadata keeps the application job data unchanged. */
export function bullMQTelemetry(): Telemetry<Context> {
  return {
    contextManager: {
      active: activeTracingContext,
      with: (ctx, fn) => context.with(ctx, fn),
      getMetadata: (ctx: Context) => JSON.stringify(injectTrace(ctx)),
      fromMetadata(_active: Context, metadata: string) {
        try {
          return extractTrace(JSON.parse(metadata) as TraceCarrier);
        } catch {
          return ROOT_CONTEXT;
        }
      },
    },
    tracer: {
      startSpan(name, options, parent) {
        const span = trace
          .getTracer('express-file-cluster.bullmq')
          .startSpan(
            name,
            { kind: options?.kind ?? SpanKind.INTERNAL },
            parent ?? activeTracingContext(),
          );
        return {
          setSpanOnContext: (ctx: Context) => trace.setSpan(ctx, span),
          setAttribute: (key, value) => {
            span.setAttribute(key, value);
          },
          setAttributes: (attributes) => {
            span.setAttributes(attributes);
          },
          addEvent: (name, attributes) => {
            span.addEvent(name, attributes);
          },
          recordException: (error, time) => {
            span.recordException(error, time);
            span.setStatus({ code: SpanStatusCode.ERROR });
          },
          end: () => span.end(),
        };
      },
    },
  };
}
/** Job handlers start with a clean EFC auth/request scope, under the native task span. */
export async function taskContext<T>(fn: () => Promise<T>, recordErrors = false): Promise<T> {
  const ctx = activeTracingContext();
  return runWithContext({ otelContext: ctx }, async () => {
    try {
      return await fn();
    } catch (error) {
      // BullMQ settles failures inside its span callback instead of rethrowing
      // them; mark that attempt here. pg-boss records its own failure status.
      if (recordErrors) {
        const span = trace.getSpan(ctx);
        if (error instanceof Error) span?.recordException(error);
        span?.setStatus({ code: SpanStatusCode.ERROR });
      }
      throw error;
    }
  });
}
