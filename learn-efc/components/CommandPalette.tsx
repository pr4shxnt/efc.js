'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CornerDownLeft, FileText, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TUTORIALS } from '../lib/tutorials';
import { GLOSSARY_ITEM, NAV_ITEMS, chapterHref } from './Navbar';

type Item = {
  kind: 'chapter' | 'tool';
  href: string;
  id: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  haystack: string;
};

const ITEMS: Item[] = [
  ...TUTORIALS.map((q, index) => ({
    kind: 'chapter' as const,
    href: chapterHref(q.id),
    id: q.id,
    icon: FileText,
    title: q.title,
    detail: `${index + 1} · ${q.track}`,
    haystack:
      `${q.title} ${q.summary} ${q.category} ${q.track} ${q.sections.map((s) => s.title).join(' ')} ${(q.terms ?? []).map((t) => t.term).join(' ')}`.toLowerCase(),
  })),
  ...[...NAV_ITEMS.slice(1), GLOSSARY_ITEM].map((n) => ({
    kind: 'tool' as const,
    href: n.href,
    id: n.href,
    icon: n.icon,
    title:
      n.label === 'Reference'
        ? 'API reference'
        : n.label === 'Glossary'
          ? 'Glossary'
          : `${n.label} playground`,
    detail: n.description,
    haystack: `${n.label} ${n.description} playground tool glossary terms`.toLowerCase(),
  })),
];

export function CommandPalette({
  open,
  onClose,
  completedQuests,
}: {
  open: boolean;
  onClose: () => void;
  completedQuests: string[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return ITEMS.filter((item) => terms.every((t) => item.haystack.includes(t)));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    input.current?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [open]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  function choose(item: Item | undefined) {
    if (!item) return;
    setQuery('');
    setActive(0);
    onClose();
    router.push(item.href);
  }

  return (
    <div className="palette-layer" role="presentation" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <label className="palette-input">
          <Search size={17} />
          <input
            ref={input}
            value={query}
            placeholder="Search chapters, concepts, and playgrounds"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${active}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') choose(results[active]);
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <ul className="palette-results" id="palette-results" role="listbox" ref={list}>
          {results.length === 0 && (
            <li className="palette-empty">
              Nothing matches “{query}”. Try “cors” or “middleware”.
            </li>
          )}
          {results.map((item, i) => {
            const Icon = item.icon;
            const done = item.kind === 'chapter' && completedQuests.includes(item.id);
            return (
              <li
                key={item.href}
                id={`palette-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(item)}
              >
                <span className="palette-icon">
                  {done ? <Check size={15} /> : <Icon size={15} />}
                </span>
                <span className="palette-text">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                {i === active && <CornerDownLeft size={14} className="palette-enter" />}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
