'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowUpRight,
  BookA,
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  Database,
  Menu,
  Moon,
  Route,
  Search,
  ShieldCheck,
  Sun,
  Workflow,
  X,
} from 'lucide-react';
import { TRACKS, TUTORIALS } from '../lib/tutorials';
import { toolPage } from '../lib/pages';

export type ActiveTab = 'quests' | 'router' | 'database' | 'tasks' | 'guard' | 'cheatsheet';
const ICONS = {
  router: Route,
  database: Database,
  tasks: Workflow,
  guard: ShieldCheck,
  cheatsheet: Braces,
};
const withIcon = <T extends keyof typeof ICONS>(id: T) => {
  const page = toolPage(id);
  return { ...page, id, icon: ICONS[id] };
};
export const NAV_ITEMS = [
  {
    id: 'quests' as const,
    href: '/',
    label: 'Handbook',
    icon: BookOpen,
    description: 'Twenty-four chapters, from installing Node to deployment.',
  },
  withIcon('router'),
  withIcon('database'),
  withIcon('tasks'),
  withIcon('guard'),
  withIcon('cheatsheet'),
];
export const GLOSSARY_ITEM = { ...toolPage('glossary'), icon: BookA };
export const DOCS_URL = 'https://efc.prashantadhikari7.com.np/docs.html';
export const hrefFor = (tab: ActiveTab) => NAV_ITEMS.find((n) => n.id === tab)!.href;
export const chapterHref = (id: string) => `/learn/${id}`;

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/' || pathname.startsWith('/learn');
  return pathname === href;
}

export function Logo() {
  return (
    // Same mark as the EFC favicon: long, short, long.
    <svg className="logo-mark" viewBox="5 6 22 20" aria-hidden="true">
      <rect x="6" y="7" width="20" height="3.4" rx="1.7" />
      <rect x="6" y="14.3" width="14" height="3.4" rx="1.7" />
      <rect x="6" y="21.6" width="20" height="3.4" rx="1.7" />
    </svg>
  );
}

export function Brand() {
  return (
    <>
      <Logo />
      <span>
        learn<span className="brand-dot">.</span>efc
      </span>
    </>
  );
}

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const set = document.documentElement.dataset.theme;
      setTheme(
        set === 'light' || set === 'dark'
          ? set
          : matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark',
      );
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem('efc_theme', next);
    } catch {
      /* The choice still applies for this visit. */
    }
  }
  return { theme, toggle };
}

export function ChapterList({
  completedQuests,
  onNavigate,
}: {
  completedQuests: string[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const currentId = pathname.startsWith('/learn/') ? pathname.slice(7) : null;
  const currentTrack = TUTORIALS.find((t) => t.id === currentId)?.track ?? null;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <nav className="chapter-list" aria-label="Chapters">
      {TRACKS.map((track, ti) => {
        const expanded = open[track] ?? (currentTrack === null ? ti === 0 : currentTrack === track);
        const lessons = TUTORIALS.map((q, i) => ({ q, i })).filter(({ q }) => q.track === track);
        const read = lessons.filter(({ q }) => completedQuests.includes(q.id)).length;
        return (
          <div className="chapter-list-part" key={track}>
            <button
              className="chapter-list-toggle"
              aria-expanded={expanded}
              aria-controls={`part-${ti}`}
              onClick={() => setOpen((prev) => ({ ...prev, [track]: !expanded }))}
            >
              <span>
                <span className="part-number">{ti + 1}</span>
                {track}
              </span>
              <span className="chapter-list-count">
                {read}/{lessons.length}
                <ChevronDown size={14} />
              </span>
            </button>
            {expanded && (
              <ol id={`part-${ti}`}>
                {lessons.map(({ q, i }) => {
                  const active = currentId === q.id;
                  const done = completedQuests.includes(q.id);
                  return (
                    <li key={q.id}>
                      <Link
                        href={chapterHref(q.id)}
                        className={active ? 'active' : ''}
                        aria-current={active ? 'page' : undefined}
                        onClick={onNavigate}
                      >
                        <span className={`chapter-index ${done ? 'done' : ''}`}>
                          {done ? <Check size={11} strokeWidth={3} /> : i + 1}
                        </span>
                        <span>{q.title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function SiteHeader({
  completedQuests,
  onOpenSearch,
}: {
  completedQuests: string[];
  onOpenSearch: () => void;
}) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const drawer = useRef<HTMLDivElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsMac(/Mac|iPhone|iPad/.test(navigator.platform)));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawer.current?.querySelector<HTMLButtonElement>('.drawer-close')?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
      if (e.key !== 'Tab') return;
      const items = Array.from(
        drawer.current?.querySelectorAll<HTMLElement>('button, a[href]') || [],
      ).filter((el) => el.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [mobileOpen]);
  const close = () => setMobileOpen(false);
  const themeLabel = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  const links = [...NAV_ITEMS, GLOSSARY_ITEM];
  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <Link className="brand" href="/" aria-label="learn.efc home">
            <Brand />
          </Link>
          <nav className="primary-nav" aria-label="Primary">
            {links.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={active ? 'active' : ''}
                  aria-current={active ? 'page' : undefined}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="header-actions">
            <button
              className="search-trigger"
              onClick={onOpenSearch}
              aria-label="Search chapters and tools"
            >
              <Search size={15} />
              <span className="search-trigger-text">Search</span>
              <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
            </button>
            <button
              className="icon-button"
              onClick={toggle}
              aria-label={themeLabel}
              title={themeLabel}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <a className="header-docs" href={DOCS_URL} target="_blank" rel="noreferrer">
              Docs <ArrowUpRight size={14} />
            </a>
            <button
              className="icon-button menu-button"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={18} />
            </button>
          </div>
        </div>
      </header>
      {mobileOpen && (
        <div className="drawer-layer">
          <button className="drawer-scrim" aria-label="Close navigation" onClick={close} />
          <div
            className="drawer"
            id="mobile-navigation"
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="drawer-head">
              <span className="brand">
                <Brand />
              </span>
              <button
                className="icon-button drawer-close"
                onClick={close}
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="drawer-nav" aria-label="Primary">
              {links.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={pathname === href ? 'active' : ''}
                  onClick={close}
                >
                  <Icon size={16} /> {label}
                </Link>
              ))}
              <a href={DOCS_URL} target="_blank" rel="noreferrer">
                <ArrowUpRight size={16} /> EFC documentation
              </a>
            </nav>
            <div className="drawer-section-title">Chapters</div>
            <ChapterList completedQuests={completedQuests} onNavigate={close} />
          </div>
        </div>
      )}
    </>
  );
}
