'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { TUTORIALS } from '../lib/tutorials';
import { useProgress } from './AppShell';
import { chapterHref } from './Navbar';
import { MethodTag } from './ui';

const ROUTES = [
  {
    file: 'health.ts',
    url: '/health',
    methods: ['GET'],
    req: 'GET /health',
    res: '200 OK',
    body: '{ "status": "ok" }',
  },
  {
    file: 'users/index.ts',
    url: '/users',
    methods: ['GET', 'POST'],
    req: 'POST /users',
    res: '201 Created',
    body: '{ "id": "42", "name": "Ada" }',
  },
  {
    file: 'users/[id].ts',
    url: '/users/:id',
    methods: ['GET', 'DELETE'],
    req: 'GET /users/42',
    res: '200 OK',
    body: '{ "id": "42", "name": "Ada" }',
  },
  {
    file: 'users/[id].ts',
    url: '/users/:id',
    methods: ['GET', 'DELETE'],
    req: 'PUT /users/42',
    res: '405 Method Not Allowed',
    body: 'Allow: GET, DELETE',
  },
  {
    file: 'docs/[...slug].ts',
    url: '/docs/*',
    methods: ['GET'],
    req: 'GET /docs/setup/install',
    res: '200 OK',
    body: '{ "slug": ["setup", "install"] }',
  },
];
const FILES = ROUTES.filter((r, i) => ROUTES.findIndex((x) => x.file === r.file) === i);

function RouteFigure() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setStep((s) => (s + 1) % ROUTES.length), 2800);
    return () => clearInterval(timer);
  }, []);
  const current = ROUTES[step];
  return (
    <figure className="hero-figure" aria-label="Files in src/api become routes">
      <div className="hero-figure-head">
        <span>src/api</span>
        <span>routes</span>
      </div>
      <ul className="hero-tree">
        {FILES.map((r) => (
          <li key={r.file} className={r.file === current.file ? 'is-hit' : ''}>
            <span className="hero-file">{r.file}</span>
            <span className="hero-arrow" aria-hidden="true" />
            <span className="hero-url">{r.url}</span>
            <span className="hero-methods">
              {r.methods.map((m) => (
                <MethodTag key={m} method={m} />
              ))}
            </span>
          </li>
        ))}
      </ul>
      <div className="hero-exchange" aria-live="off" key={step}>
        <div>
          <span className="hero-prompt">→</span> {current.req}
        </div>
        <div className={current.res.startsWith('2') ? 'ok' : 'warn'}>
          <span className="hero-prompt">←</span> {current.res}
          <span className="hero-body">{current.body}</span>
        </div>
      </div>
    </figure>
  );
}

export function HeroSection() {
  const { completed } = useProgress();
  const total = TUTORIALS.length;
  const next = TUTORIALS.find((q) => !completed.includes(q.id)) ?? null;
  const started = completed.length > 0;
  return (
    <section className="hero">
      <div className="hero-copy">
        <h1>
          Learn how backends work, <em>from the first request.</em>
        </h1>
        <p>
          A handbook for people who have never written a server. Install Node, learn HTTP, build the
          same ideas in Express, then ship a real API with EFC. No experience needed beyond a little
          JavaScript.
        </p>
        <div className="hero-actions">
          <Link className="button button-primary" href={chapterHref((next ?? TUTORIALS[0]).id)}>
            {!started ? 'Start chapter 1' : next ? 'Continue reading' : 'Read it again'}
            <ArrowRight size={16} />
          </Link>
          <a className="button button-quiet" href="#curriculum">
            See all {total} chapters
          </a>
        </div>
        {started && (
          <div className="hero-progress">
            <div className="meter">
              <span style={{ width: `${(completed.length / total) * 100}%` }} />
            </div>
            <span>
              {completed.length} of {total} read
              {next ? <> · next up: {next.title}</> : ' · all done'}
            </span>
          </div>
        )}
      </div>
      <RouteFigure />
    </section>
  );
}
