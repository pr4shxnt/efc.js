'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, Search, X } from 'lucide-react';
import { CHEAT_SHEET_ITEMS } from '../lib/efc-data';
import { DOCS_URL } from './Navbar';
import { PageHeader, Segmented, useCopy } from './ui';

const MODULES = [
  'express-file-cluster',
  'express-file-cluster/auth',
  'express-file-cluster/tasks',
  'express-file-cluster/testing',
];
type Kind = 'all' | 'function' | 'value' | 'class';

function CopyImport({ name, module }: { name: string; module: string }) {
  const { state, copy } = useCopy();
  const identifier = name.split('(')[0];
  return (
    <button
      className="copy-button"
      aria-label={`Copy import for ${identifier}`}
      onClick={() => copy(`import { ${identifier} } from '${module}';`)}
    >
      {state === 'copied' ? <Check size={13} /> : <Copy size={13} />}
      <span>{state === 'copied' ? 'Copied' : 'Import'}</span>
    </button>
  );
}

export function CheatsheetSection() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return CHEAT_SHEET_ITEMS.filter(
      (item) =>
        (kind === 'all' || item.type === kind) &&
        `${item.name} ${item.description} ${item.module}`.toLowerCase().includes(q),
    );
  }, [query, kind]);

  return (
    <>
      <PageHeader title="API reference">
        The exports you&apos;ll reach for most, grouped by import path. EFC has exactly these four
        paths; there is no <code>/db</code>, <code>/router</code> or <code>/models</code>. For full
        signatures, see the{' '}
        <a className="link-button" href={DOCS_URL} target="_blank" rel="noreferrer">
          documentation
        </a>
        .
      </PageHeader>

      <div className="reference-controls">
        <label className="filter-input">
          <Search size={15} />
          <input
            aria-label="Search exports"
            placeholder="Search exports, e.g. defineTable, cache"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </label>
        <Segmented
          label="Export kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'function', label: 'Functions' },
            { value: 'value', label: 'Values' },
            { value: 'class', label: 'Classes' },
          ]}
        />
        <span className="reference-count">
          {filtered.length} of {CHEAT_SHEET_ITEMS.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="reference-table">
          <div className="empty-state large">
            <Search size={22} />
            <p>No export matches “{query}”.</p>
            <button
              className="button button-quiet button-small"
              onClick={() => {
                setQuery('');
                setKind('all');
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
      ) : (
        <div className="reference-table">
          {MODULES.map((module) => {
            const items = filtered.filter((i) => i.module === module);
            if (!items.length) return null;
            return (
              <section className="reference-group" key={module}>
                <h2>{module}</h2>
                {items.map((item) => (
                  <div className="reference-row" key={item.name}>
                    <div>
                      <code>{item.name}</code>
                      <span className="reference-kind">{item.type}</span>
                    </div>
                    <p>{item.description}</p>
                    <CopyImport name={item.name} module={item.module} />
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
