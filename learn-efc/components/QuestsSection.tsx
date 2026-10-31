'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Lightbulb, Search, X } from 'lucide-react';
import { TRACKS, TUTORIALS, type Comparison, type Tutorial } from '../lib/tutorials';
import { useProgress } from './AppShell';
import { ConceptDiagram, RequestLab } from './LearningVisuals';
import {
  ChapterList,
  GLOSSARY_ITEM,
  NAV_ITEMS,
  chapterHref,
  hrefFor,
  type ActiveTab,
} from './Navbar';
import { CodeBlock, Segmented } from './ui';

export const PART_NAMES = ['Part one', 'Part two', 'Part three', 'Part four'];
const PART_COPY = [
  'Set up your computer, then learn the vocabulary every backend shares: clients, servers, ports, HTTP and JSON.',
  'Run JavaScript on a server, build routes and middleware by hand in Express, and keep secrets out of your code.',
  'Move to EFC: generate a real project, validate input, connect PostgreSQL and read and write data through models.',
  'Log in users, run background work, test your API, lock down the common holes, and put it on the internet.',
];
const PLAYGROUND_PROMPTS: Partial<Record<ActiveTab, string>> = {
  router: 'Try GET /users/42, then switch to POST. Can you explain why the status changes?',
  database: 'Change the role filter and the include option. Watch how the query and result change.',
  tasks: 'Run a task that fails, follow the retries, then replay the dead letter.',
  guard: 'Load the examples and read why each import or option does not exist.',
};

const minutes = (d: string) => parseInt(d, 10) || 0;
const isShell = (code: string) => /^(#|curl|mkdir|npm|npx|node|docker)/.test(code);

function FrameworkComparison({ data }: { data: Comparison }) {
  const [view, setView] = useState<'both' | 'express' | 'efc'>('both');
  return (
    <section className="article-block" id="framework-comparison">
      <h2>Express and EFC, side by side</h2>
      <p>{data.explanation}</p>
      <Segmented
        label="Code comparison view"
        value={view}
        onChange={setView}
        options={[
          { value: 'both', label: 'Both' },
          { value: 'express', label: 'Express' },
          { value: 'efc', label: 'EFC' },
        ]}
      />
      <div className="comparison">
        {view !== 'efc' && (
          <CodeBlock code={data.express} label={data.expressLabel || 'Express · explicit setup'} />
        )}
        {view !== 'express' && (
          <CodeBlock code={data.efc} label={data.efcLabel || 'EFC · file conventions'} />
        )}
      </div>
      <aside className="callout">
        <strong>What stays the same</strong>
        <p>{data.same}</p>
      </aside>
    </section>
  );
}

export function Library() {
  const { completed, reset } = useProgress();
  const [search, setSearch] = useState('');
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = TUTORIALS.filter((q) => {
    const hay =
      `${q.title} ${q.summary} ${q.category} ${q.track} ${(q.terms ?? []).map((t) => t.term).join(' ')}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const totalMinutes = TUTORIALS.reduce((sum, q) => sum + minutes(q.duration), 0);
  return (
    <>
      <section className="how-it-works" aria-labelledby="how-title">
        <h2 id="how-title" className="visually-hidden">
          How the handbook works
        </h2>
        <ol>
          <li>
            <span>1</span>
            <strong>Read a short chapter</strong>
            <p>
              About ten minutes each, in plain language. New words are explained as they appear.
            </p>
          </li>
          <li>
            <span>2</span>
            <strong>Try it on your machine</strong>
            <p>Every chapter ends with an exercise and the result you should see.</p>
          </li>
          <li>
            <span>3</span>
            <strong>Check yourself</strong>
            <p>A quick question confirms the idea stuck before you move on.</p>
          </li>
        </ol>
      </section>
      <section className="curriculum" id="curriculum">
        <div className="section-intro">
          <div>
            <h2>The handbook</h2>
            <p>
              {TUTORIALS.length} chapters in four parts, about {Math.round(totalMinutes / 6) / 10}{' '}
              hours of reading plus exercises. Each chapter assumes only the ones before it.
            </p>
          </div>
          <label className="filter-input">
            <Search size={15} />
            <input
              aria-label="Filter chapters"
              placeholder="Filter chapters"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button aria-label="Clear filter" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            )}
          </label>
        </div>
        {TRACKS.map((track, ti) => {
          const lessons = visible.filter((q) => q.track === track);
          if (!lessons.length) return null;
          const all = TUTORIALS.filter((q) => q.track === track);
          return (
            <div className="part" key={track}>
              <div className="part-aside">
                <span className="part-name">{PART_NAMES[ti]}</span>
                <h3>{track}</h3>
                <p>{PART_COPY[ti]}</p>
                <span className="part-meta">
                  {all.length} chapters · {all.reduce((s, q) => s + minutes(q.duration), 0)} min
                </span>
              </div>
              <ol className="part-chapters">
                {lessons.map((q) => {
                  const index = TUTORIALS.indexOf(q);
                  const done = completed.includes(q.id);
                  return (
                    <li key={q.id}>
                      <Link href={chapterHref(q.id)}>
                        <span className={`chapter-index ${done ? 'done' : ''}`}>
                          {done ? <Check size={12} strokeWidth={3} /> : index + 1}
                        </span>
                        <span className="chapter-row-text">
                          <strong>{q.title}</strong>
                          <span>{q.summary}</span>
                        </span>
                        <span className="chapter-row-meta">{q.duration}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="empty-state large">
            <Search size={22} />
            <p>
              No chapter mentions “{search}”. Try <em>HTTP</em>, <em>middleware</em>, or{' '}
              <em>CORS</em>.
            </p>
            <button className="button button-quiet" onClick={() => setSearch('')}>
              Clear filter
            </button>
          </div>
        )}
        {completed.length > 0 && (
          <button className="link-button reset-progress" onClick={reset}>
            Reset reading progress
          </button>
        )}
      </section>
      <section className="practice-tools" id="practice-tools">
        <div className="section-intro">
          <div>
            <h2>Practice without a server</h2>
            <p>
              Small simulations of the real thing. Everything runs in your browser, so you can break
              it freely.
            </p>
          </div>
        </div>
        <ul className="tool-list">
          {[...NAV_ITEMS.slice(1), GLOSSARY_ITEM].map(
            ({ href, label, icon: Icon, description }) => (
              <li key={href}>
                <Link href={href}>
                  <span className="tool-icon">
                    <Icon size={18} strokeWidth={1.6} />
                  </span>
                  <span>
                    <strong>{label === 'Reference' ? 'API reference' : label}</strong>
                    <span>{description}</span>
                  </span>
                  <ArrowRight size={16} className="tool-arrow" />
                </Link>
              </li>
            ),
          )}
        </ul>
      </section>
    </>
  );
}

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join('|');
  useEffect(() => {
    const els = key
      .split('|')
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: '-80px 0px -65% 0px' },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);
  return active;
}

function Exercise({ exercise }: { exercise: NonNullable<Tutorial['exercise']> }) {
  return (
    <section className="article-block exercise" id="exercise">
      <h2>Try it yourself</h2>
      <p className="exercise-goal">{exercise.goal}</p>
      <ol className="exercise-steps">
        {exercise.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {exercise.hint && (
        <p className="exercise-hint">
          <Lightbulb size={15} /> <span>{exercise.hint}</span>
        </p>
      )}
      <details className="exercise-answer">
        <summary>Show what you should see</summary>
        <p>{exercise.expected}</p>
      </details>
    </section>
  );
}

function Quiz({ article, onCorrect }: { article: Tutorial; onCorrect: () => void }) {
  const [answer, setAnswer] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const correct = answer === article.quiz.correctIndex;
  return (
    <fieldset className="quiz">
      <legend>{article.quiz.question}</legend>
      <div className="quiz-options">
        {article.quiz.options.map((option, i) => {
          const state = submitted
            ? i === article.quiz.correctIndex
              ? 'correct'
              : answer === i
                ? 'incorrect'
                : ''
            : answer === i
              ? 'selected'
              : '';
          return (
            <button
              key={option}
              className={`quiz-option ${state}`}
              aria-pressed={answer === i}
              disabled={submitted}
              onClick={() => setAnswer(i)}
            >
              <span className="quiz-letter">{String.fromCharCode(65 + i)}</span>
              <span>{option}</span>
            </button>
          );
        })}
      </div>
      {!submitted ? (
        <button
          className="button button-primary"
          disabled={answer === null}
          onClick={() => {
            setSubmitted(true);
            if (correct) onCorrect();
          }}
        >
          Check answer
        </button>
      ) : (
        <div className={`quiz-feedback ${correct ? 'is-correct' : 'is-wrong'}`} role="status">
          <strong>{correct ? 'Correct.' : 'Not quite.'}</strong> {article.quiz.explanation}
          {!correct && (
            <button
              className="link-button"
              onClick={() => {
                setSubmitted(false);
                setAnswer(null);
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}

export function Reader({ index }: { index: number }) {
  const { completed, complete } = useProgress();
  const article = TUTORIALS[index];
  const toc = [
    ...article.sections.map((s, i) => ({ id: `section-${i}`, title: s.title })),
    ...(article.comparison ? [{ id: 'framework-comparison', title: 'Express and EFC' }] : []),
    ...(article.exercise ? [{ id: 'exercise', title: 'Try it yourself' }] : []),
    { id: 'practice', title: 'Check your understanding' },
  ];
  const activeSection = useActiveSection(toc.map((t) => t.id));
  const done = completed.includes(article.id);
  const partIndex = TRACKS.indexOf(article.track);
  const prev = TUTORIALS[index - 1];
  const next = TUTORIALS[index + 1];
  const tool = article.playground ? NAV_ITEMS.find((n) => n.id === article.playground) : null;

  return (
    <div className="reader-shell">
      <aside className="reader-sidebar" aria-label="Chapter navigation">
        <div className="reader-sidebar-inner">
          <div className="sidebar-progress">
            <span>
              {completed.length} of {TUTORIALS.length} read
            </span>
            <div className="meter">
              <span style={{ width: `${(completed.length / TUTORIALS.length) * 100}%` }} />
            </div>
          </div>
          <ChapterList completedQuests={completed} />
        </div>
      </aside>
      <div className="reader">
        <article className="article">
          <header className="article-header">
            <div className="article-kicker">
              <Link href="/">Handbook</Link>
              <span aria-hidden="true">/</span>
              <span>
                {PART_NAMES[partIndex]}: {article.track}
              </span>
            </div>
            <h1>
              <span className="article-number" aria-hidden="true">
                {index + 1}
              </span>
              {article.title}
            </h1>
            <p className="article-lead">{article.summary}</p>
            <div className="article-meta">
              <span>{article.duration} read</span>
              <span>{article.difficulty}</span>
              {article.exercise && <span>Includes an exercise</span>}
              {done && (
                <span className="meta-done">
                  <Check size={13} strokeWidth={3} /> Read
                </span>
              )}
            </div>
          </header>
          <aside className="callout callout-accent">
            <strong>By the end of this chapter</strong>
            <p>{article.takeaway}</p>
          </aside>
          {article.terms && article.terms.length > 0 && (
            <aside className="terms" aria-labelledby="terms-title">
              <h2 id="terms-title">Words to know</h2>
              <dl>
                {article.terms.map((t) => (
                  <div key={t.term}>
                    <dt>{t.term}</dt>
                    <dd>{t.meaning}</dd>
                  </div>
                ))}
              </dl>
              <Link href={GLOSSARY_ITEM.href} className="terms-more">
                All terms in the glossary <ArrowRight size={13} />
              </Link>
            </aside>
          )}
          {article.sections.map((section, i) => (
            <section className="article-block" id={`section-${i}`} key={section.title}>
              <h2>{section.title}</h2>
              {section.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {section.code && (
                <CodeBlock
                  code={section.code}
                  lang={isShell(section.code) ? 'shell' : 'code'}
                  label={isShell(section.code) ? 'Terminal' : 'Example'}
                />
              )}
              {section.note && (
                <aside className="callout">
                  <p>{section.note}</p>
                </aside>
              )}
              {i === 0 && <ConceptDiagram kind={article.diagram} />}
            </section>
          ))}
          {article.comparison && <FrameworkComparison data={article.comparison} />}
          {article.exercise && <Exercise exercise={article.exercise} />}
          <section className="article-block" id="practice">
            <h2>Check your understanding</h2>
            {article.id === 'http-basics' && <RequestLab />}
            {tool && PLAYGROUND_PROMPTS[tool.id] && (
              <div className="playground-prompt">
                <p>{PLAYGROUND_PROMPTS[tool.id]}</p>
                <Link className="button button-quiet" href={hrefFor(tool.id)}>
                  Open the {tool.label.toLowerCase()} playground <ArrowUpRight size={14} />
                </Link>
              </div>
            )}
            <Quiz article={article} onCorrect={() => complete(article.id)} />
          </section>
          <footer className="article-end">
            <div className="article-finish">
              <button
                className={`button ${done ? 'button-done' : 'button-primary'}`}
                onClick={() => complete(article.id)}
                disabled={done}
              >
                <Check size={15} strokeWidth={2.5} />
                {done ? 'Marked as read' : 'Mark as read'}
              </button>
              {article.sources.length > 0 && (
                <div className="sources">
                  <span>Further reading</span>
                  {article.sources.map((s) => (
                    <a href={s.url} key={s.url} target="_blank" rel="noreferrer">
                      {s.title} <ArrowUpRight size={12} />
                    </a>
                  ))}
                </div>
              )}
            </div>
            <nav className="pager" aria-label="Chapter navigation">
              {prev ? (
                <Link href={chapterHref(prev.id)}>
                  <span>
                    <ArrowLeft size={13} /> Previous
                  </span>
                  <strong>{prev.title}</strong>
                </Link>
              ) : (
                <span />
              )}
              <Link className="pager-next" href={next ? chapterHref(next.id) : '/'}>
                <span>
                  {next ? 'Next' : 'Finished'} <ArrowRight size={13} />
                </span>
                <strong>{next ? next.title : 'Back to the handbook'}</strong>
              </Link>
            </nav>
          </footer>
        </article>
        <aside className="toc" aria-label="On this page">
          <div className="toc-inner">
            <span className="toc-title">On this page</span>
            <ul>
              {toc.map((t) => (
                <li key={t.id}>
                  <a
                    href={`#${t.id}`}
                    className={activeSection === t.id ? 'active' : ''}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth' });
                      history.replaceState(null, '', `#${t.id}`);
                    }}
                  >
                    {t.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
