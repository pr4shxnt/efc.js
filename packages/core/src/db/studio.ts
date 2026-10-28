import crypto from 'node:crypto';
import http from 'node:http';
import type { Connection } from 'mongoose';
import type { Pool } from 'pg';
import type { DatabaseEngine } from '../types.js';
import type { RegisteredModel, StudioWriter } from './engine.js';

// `efc db studio`: a data browser on 127.0.0.1 only. Read-only by default — it lists
// tables/collections and pages through their rows. With `--write`, rows can be inserted,
// edited and deleted, but only through the app's models (so validation, defaults and
// casting apply) and only by the page the studio served: every write must carry the
// random token embedded in that page and come from the studio's own origin.

interface Structure {
  /** PostgreSQL: the real columns. MongoDB: fields seen in a sample of documents. */
  columns: { name: string; type: string; nullable?: boolean }[];
  indexes: { name: string; definition: string }[];
}

interface Source {
  collections(): Promise<{ name: string; count: number }[]>;
  rows(name: string, skip: number, limit: number): Promise<{ rows: unknown[]; total: number }>;
  structure(name: string): Promise<Structure>;
}

function mongoSource(conn: Connection): Source {
  const db = conn.db!;
  return {
    async collections() {
      const cols = (await db.listCollections({}, { nameOnly: true }).toArray())
        .map((c) => c.name)
        .filter((n) => !n.startsWith('system.'))
        .sort();
      const counted = await Promise.all(
        cols.map(async (name) => {
          try {
            return { name, count: await db.collection(name).estimatedDocumentCount() };
          } catch {
            return undefined; // dropped meanwhile
          }
        }),
      );
      return counted.filter((c): c is { name: string; count: number } => c !== undefined);
    },
    async rows(name, skip, limit) {
      const col = db.collection(name);
      const [rows, total] = await Promise.all([
        col.find({}).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
        col.countDocuments(),
      ]);
      return { rows, total };
    },
    async structure(name) {
      const col = db.collection(name);
      const sample = await col.find({}).limit(200).toArray();
      const types = new Map<string, Set<string>>();
      for (const doc of sample) {
        for (const [k, v] of Object.entries(doc)) {
          const t =
            v === null
              ? 'null'
              : Array.isArray(v)
                ? 'array'
                : v instanceof Date
                  ? 'date'
                  : typeof v === 'object' && v.constructor?.name === 'ObjectId'
                    ? 'objectId'
                    : typeof v;
          (types.get(k) ?? types.set(k, new Set()).get(k)!).add(t);
        }
      }
      const indexes = await col.indexes().catch(() => []);
      return {
        columns: [...types].map(([n, t]) => ({ name: n, type: [...t].sort().join(' | ') })),
        indexes: indexes.map((i) => ({
          name: String(i.name),
          definition: `${i.unique ? 'unique ' : ''}${JSON.stringify(i.key)}${i.expireAfterSeconds !== undefined ? ` ttl ${i.expireAfterSeconds}s` : ''}`,
        })),
      };
    },
  };
}

function pgSource(pool: Pool): Source {
  const tables = async () =>
    (
      await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
      )
    ).rows.map((r) => r.table_name);
  const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
  return {
    async collections() {
      // A table dropped between listing and counting (a migration, another process) is
      // left out instead of failing the whole list.
      const counted = await Promise.all(
        (await tables()).map(async (name) => {
          try {
            const { rows } = await pool.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM ${q(name)}`,
            );
            return { name, count: rows[0]!.n };
          } catch {
            return undefined;
          }
        }),
      );
      return counted.filter((c): c is { name: string; count: number } => c !== undefined);
    },
    async rows(name, skip, limit) {
      // Only names that exist in information_schema are ever interpolated.
      if (!(await tables()).includes(name))
        throw Object.assign(new Error('Unknown table'), { status: 404 });
      const [rows, total] = await Promise.all([
        pool.query(`SELECT * FROM ${q(name)} LIMIT $1 OFFSET $2`, [limit, skip]),
        pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${q(name)}`),
      ]);
      return { rows: rows.rows, total: total.rows[0]!.n };
    },
    async structure(name) {
      if (!(await tables()).includes(name))
        throw Object.assign(new Error('Unknown table'), { status: 404 });
      const [columns, indexes] = await Promise.all([
        pool.query<{ name: string; type: string; nullable: boolean }>(
          `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = $1 AND n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
          [name],
        ),
        pool.query<{ name: string; definition: string }>(
          `SELECT indexname AS name, indexdef AS definition FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname`,
          [name],
        ),
      ]);
      return { columns: columns.rows, indexes: indexes.rows };
    },
  };
}

import { STUDIO_HTML } from './studio-page.js';

/** Reads a JSON body (at most 1 MB). */
function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1_048_576) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
        if (!v || typeof v !== 'object' || Array.isArray(v))
          throw new Error('Expected a JSON object');
        resolve(v as Record<string, unknown>);
      } catch (err) {
        reject(Object.assign(new Error((err as Error).message), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Fields the database or the model own; never sent through a write. */
const SERVER_FIELDS = ['_id', 'id', '__v', 'createdAt', 'updatedAt'];

export function startStudio(
  engine: DatabaseEngine,
  client: unknown,
  port: number,
  options: { write?: boolean; models?: RegisteredModel[] } = {},
): Promise<{ server: http.Server; url: string }> {
  const source =
    engine === 'postgresql' ? pgSource(client as Pool) : mongoSource(client as Connection);
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));
  };
  const token = crypto.randomBytes(32).toString('hex');
  const page = STUDIO_HTML.replace('__EFC_TOKEN__', JSON.stringify(options.write ? token : ''));

  // Table/collection name → the model that stores there (write mode only).
  let writers: Promise<Map<string, StudioWriter>> | undefined;
  const writerFor = async (name: string): Promise<StudioWriter | undefined> => {
    if (!options.write) return undefined;
    writers ??= (async () => {
      const map = new Map<string, StudioWriter>();
      for (const m of options.models ?? []) {
        if (!m.studio) continue;
        try {
          map.set(await m.studio.storage(), m.studio);
        } catch {
          /* a model for the other engine — not writable here */
        }
      }
      return map;
    })();
    return (await writers).get(name);
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Loopback binding alone doesn't stop DNS rebinding (a web page re-pointing its own
      // hostname at 127.0.0.1), so only answer requests addressed to a loopback host.
      const rawHost = req.headers.host ?? '';
      const host = rawHost.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
        return json(res, 403, { error: 'Studio only answers on localhost' });
      }
      if (req.method !== 'GET') {
        if (!options.write)
          return json(res, 405, { error: 'Studio is read-only (start it with --write)' });
        // CSRF: only the page this studio served knows the token, and a cross-site page
        // can't send the custom header without a CORS preflight this server never approves.
        const sent = String(req.headers['x-efc-studio-token'] ?? '');
        const ok =
          sent.length === token.length &&
          crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token)) &&
          req.headers.origin === `http://${rawHost}` &&
          String(req.headers['content-type'] ?? '').startsWith('application/json');
        if (!ok) return json(res, 403, { error: 'Missing or invalid studio token' });
      }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
        });
        return res.end(page);
      }
      if (req.method === 'GET' && url.pathname === '/api/collections') {
        const collections = await source.collections();
        return json(res, 200, {
          engine,
          write: !!options.write,
          collections: await Promise.all(
            collections.map(async (c) => ({ ...c, writable: !!(await writerFor(c.name)) })),
          ),
        });
      }
      const st = /^\/api\/collections\/([^/]+)\/structure$/.exec(url.pathname);
      if (req.method === 'GET' && st)
        return json(res, 200, await source.structure(decodeURIComponent(st[1]!)));
      const m = /^\/api\/collections\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const skip = Math.max(0, Number(url.searchParams.get('skip')) || 0);
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        return json(res, 200, await source.rows(decodeURIComponent(m[1]!), skip, limit));
      }

      // Writes — through the model only.
      const w = /^\/api\/collections\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if (w && req.method !== 'GET') {
        const name = decodeURIComponent(w[1]!);
        const id = w[2] !== undefined ? decodeURIComponent(w[2]) : undefined;
        const writer = await writerFor(name);
        if (!writer) {
          return json(res, 409, {
            error: `No model stores in "${name}" — studio writes go through your models (src/model)`,
          });
        }
        const body = req.method === 'DELETE' ? {} : await readJson(req);
        for (const k of SERVER_FIELDS) delete body[k];
        if (req.method === 'POST' && id === undefined)
          return json(res, 201, { record: await writer.create(body) });
        if (req.method === 'PATCH' && id !== undefined) {
          const record = await writer.update(id, body);
          return record ? json(res, 200, { record }) : json(res, 404, { error: 'Not found' });
        }
        if (req.method === 'DELETE' && id !== undefined) {
          const record = await writer.delete(id);
          return record ? json(res, 200, { record }) : json(res, 404, { error: 'Not found' });
        }
        return json(res, 405, { error: 'Method not allowed' });
      }
      json(res, 404, { error: 'Not found' });
    })().catch((err: Error & { status?: number; statusCode?: number; issues?: unknown }) =>
      json(res, err.status ?? err.statusCode ?? 500, {
        error: err.message,
        ...(err.issues !== undefined && { issues: err.issues }),
      }),
    );
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}
