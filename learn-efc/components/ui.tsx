'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, Copy } from 'lucide-react';
import { TUTORIALS } from '../lib/tutorials';
import { highlight, type Lang } from '../lib/highlight';

export function useCopy(timeout = 1800) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), timeout);
    } catch {
      setState('failed');
    }
  }
  return { state, copy };
}

export function CopyButton({ text, label = 'code' }: { text: string; label?: string }) {
  const { state, copy } = useCopy();
  return (
    <button className="copy-button" aria-label={`Copy ${label}`} onClick={() => copy(text)}>
      {state === 'copied' ? <Check size={13} /> : <Copy size={13} />}
      <span>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Select to copy' : 'Copy'}</span>
    </button>
  );
}

export function CodeBlock({
  code,
  label,
  lang = 'code',
  footer,
  maxHeight,
  plain,
}: {
  code: string;
  label?: ReactNode;
  lang?: Lang;
  footer?: ReactNode;
  maxHeight?: number;
  plain?: boolean;
}) {
  return (
    <div className="code-block">
      {label !== undefined && (
        <div className="code-block-head">
          <span className="code-block-label">{label}</span>
          <CopyButton text={code} label={typeof label === 'string' ? label : 'code'} />
        </div>
      )}
      <pre style={maxHeight ? { maxHeight } : undefined} tabIndex={0}>
        <code>{plain ? code : highlight(code, lang)}</code>
      </pre>
      {footer && <div className="code-block-foot">{footer}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  meta,
  actions,
  children,
  flush,
  className = '',
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions || meta) && (
        <div className="panel-head">
          <div className="panel-title">
            {title}
            {meta && <span className="panel-meta">{meta}</span>}
          </div>
          {actions}
        </div>
      )}
      <div className={flush ? 'panel-body flush' : 'panel-body'}>{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          aria-pressed={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MethodTag({ method }: { method: string }) {
  return <span className={`method method-${method.toLowerCase()}`}>{method}</span>;
}

export function ToolIntro({
  steps,
  chapterIds = [],
  children,
}: {
  steps: ReactNode[];
  chapterIds?: string[];
  children?: ReactNode;
}) {
  const chapters = chapterIds
    .map((id) => ({ id, index: TUTORIALS.findIndex((t) => t.id === id) }))
    .filter((c) => c.index >= 0);
  return (
    <details className="tool-intro" open>
      <summary>New here? How to use this page</summary>
      <div className="tool-intro-body">
        {children && <p>{children}</p>}
        <ol>
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {chapters.length > 0 && (
          <p className="tool-intro-read">
            Learn the idea first:{' '}
            {chapters.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ', '}
                <Link href={`/learn/${c.id}`}>
                  chapter {c.index + 1}, {TUTORIALS[c.index].title}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>
    </details>
  );
}
