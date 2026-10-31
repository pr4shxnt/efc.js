'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Search, X } from 'lucide-react';
import { TUTORIALS } from '../lib/tutorials';
import { chapterHref } from './Navbar';
import { PageHeader } from './ui';

const ENTRIES = TUTORIALS.flatMap((chapter, index) =>
  (chapter.terms ?? []).map((t) => ({ ...t, chapter, number: index + 1 })),
)
  .filter((e, i, all) => all.findIndex((x) => x.term === e.term) === i)
  .sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));

const letterOf = (term: string) => {
  const c = term.replace(/^[^a-z0-9]+/i, '')[0]?.toUpperCase() ?? '#';
  return /[A-Z]/.test(c) ? c : '#';
};

export function Glossary() {
  const [query, setQuery] = useState('');
  const q = query.toLowerCase();
  const visible = ENTRIES.filter((e) => `${e.term} ${e.meaning}`.toLowerCase().includes(q));
  const letters = [...new Set(visible.map((e) => letterOf(e.term)))];
  return (
    <>
      <PageHeader title="Glossary">
        Every term the handbook introduces, in plain words. Each one links to the chapter where it
        first comes up.
      </PageHeader>
      <div className="reference-controls">
        <label className="filter-input">
          <Search size={15} />
          <input
            aria-label="Search terms"
            placeholder="Search terms, e.g. port, middleware"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </label>
        <span className="reference-count">
          {visible.length} of {ENTRIES.length} terms
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="empty-state large">
          <p>No term matches “{query}”.</p>
        </div>
      ) : (
        <div className="glossary">
          {letters.map((letter) => (
            <section key={letter} className="glossary-group" aria-label={letter}>
              <h2>{letter}</h2>
              <dl>
                {visible
                  .filter((e) => letterOf(e.term) === letter)
                  .map((e) => (
                    <div key={e.term}>
                      <dt>{e.term}</dt>
                      <dd>
                        {e.meaning}{' '}
                        <Link href={chapterHref(e.chapter.id)}>
                          Chapter {e.number}: {e.chapter.title}
                        </Link>
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
