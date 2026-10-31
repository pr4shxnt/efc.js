'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { CommandPalette } from './CommandPalette';
import { Brand, DOCS_URL, GLOSSARY_ITEM, NAV_ITEMS, SiteHeader, chapterHref } from './Navbar';
import { TRACKS, TUTORIALS } from '../lib/tutorials';

const STORAGE_KEY = 'efc_completed_quests';

interface Progress {
  completed: string[];
  complete: (id: string) => void;
  reset: () => void;
}
const ProgressContext = createContext<Progress>({
  completed: [],
  complete: () => {},
  reset: () => {},
});
export const useProgress = () => useContext(ProgressContext);

function ReadingProgress() {
  const [scrolled, setScrolled] = useState(0);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrolled(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    const frame = requestAnimationFrame(update);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return (
    <div className="read-progress" aria-hidden="true">
      <span style={{ transform: `scaleX(${scrolled})` }} />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [completed, setCompleted] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        if (Array.isArray(saved))
          setCompleted([
            ...new Set(
              saved.filter(
                (id): id is string => typeof id === 'string' && TUTORIALS.some((q) => q.id === id),
              ),
            ),
          ]);
      } catch {
        /* Progress is optional when storage is unavailable. */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Links from the old single-page version used #learn/<id> and #<tool>.
  useEffect(() => {
    const redirect = () => {
      if (window.location.pathname !== '/') return;
      const hash = window.location.hash.slice(1);
      if (hash.startsWith('learn/') && TUTORIALS.some((t) => t.id === hash.slice(6)))
        router.replace(chapterHref(hash.slice(6)));
      else {
        const tool = NAV_ITEMS.find((n) => n.id === hash && n.href !== '/');
        if (tool) router.replace(tool.href);
      }
    };
    redirect();
    window.addEventListener('hashchange', redirect);
    return () => window.removeEventListener('hashchange', redirect);
  }, [router]);

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);

  const save = (next: string[]) => {
    try {
      if (next.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* optional */
    }
  };
  const progress: Progress = {
    completed,
    complete: (id) =>
      setCompleted((prev) => {
        const next = [...new Set([...prev, id])];
        save(next);
        return next;
      }),
    reset: () => {
      setCompleted([]);
      save([]);
    },
  };

  return (
    <ProgressContext.Provider value={progress}>
      <div className="app">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader completedQuests={completed} onOpenSearch={() => setSearchOpen(true)} />
        {pathname.startsWith('/learn/') && <ReadingProgress key={pathname} />}
        <CommandPalette
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          completedQuests={completed}
        />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          <div className="site-footer-inner">
            <div className="footer-brand">
              <Link className="brand" href="/">
                <Brand />
              </Link>
              <p>
                Backend fundamentals first, then Express, then EFC. Written for people who want to
                know what the framework is doing for them.
              </p>
            </div>
            <div className="footer-col">
              <h2>Handbook</h2>
              {TRACKS.map((track) => (
                <Link key={track} href={chapterHref(TUTORIALS.find((q) => q.track === track)!.id)}>
                  {track}
                </Link>
              ))}
              <Link href={GLOSSARY_ITEM.href}>Glossary</Link>
            </div>
            <div className="footer-col">
              <h2>Practice</h2>
              {NAV_ITEMS.slice(1).map((item) => (
                <Link key={item.id} href={item.href}>
                  {item.label === 'Reference' ? 'API reference' : item.label}
                </Link>
              ))}
            </div>
            <div className="footer-col">
              <h2>Project</h2>
              <a href={DOCS_URL} target="_blank" rel="noreferrer">
                Documentation <ArrowUpRight size={12} />
              </a>
              <a
                href="https://github.com/siggold/express-file-cluster"
                target="_blank"
                rel="noreferrer"
              >
                GitHub <ArrowUpRight size={12} />
              </a>
              <a
                href="https://www.npmjs.com/package/express-file-cluster"
                target="_blank"
                rel="noreferrer"
              >
                npm <ArrowUpRight size={12} />
              </a>
            </div>
          </div>
          <div className="site-footer-base">
            <span>Covers express-file-cluster 0.12.0 and Express 5.</span>
            <span>Progress is stored in this browser only.</span>
          </div>
        </footer>
      </div>
    </ProgressContext.Provider>
  );
}
