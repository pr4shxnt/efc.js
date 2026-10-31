'use client';

import { useState } from 'react';
import {
  ArrowRight,
  Braces,
  Database,
  Globe2,
  Layers3,
  Monitor,
  Server,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import type { Tutorial } from '../lib/tutorials';

export function ConceptDiagram({ kind = 'web' }: { kind?: Tutorial['diagram'] }) {
  const flows = {
    web: [
      { icon: Monitor, title: 'Your browser', label: 'The client asks' },
      { icon: Globe2, title: 'HTTP request', label: 'Method + URL + data' },
      { icon: Server, title: 'Your backend', label: 'The server processes' },
      { icon: Braces, title: 'HTTP response', label: 'Status + headers + body' },
    ],
    http: [
      { icon: Monitor, title: 'Client', label: 'Send GET /notes' },
      { icon: Workflow, title: 'Route', label: 'Match method + path' },
      { icon: Server, title: 'Handler', label: 'Run your function' },
      { icon: Braces, title: 'Response', label: '200 · JSON data' },
    ],
    middleware: [
      { icon: Globe2, title: 'Request', label: 'Incoming HTTP message' },
      { icon: Layers3, title: 'Middleware', label: 'Parse · check · next()' },
      { icon: ShieldCheck, title: 'Handler', label: 'Do the allowed work' },
      { icon: Braces, title: 'Response', label: 'Send once, then finish' },
    ],
    database: [
      { icon: Monitor, title: 'Frontend', label: 'Ask your API for data' },
      { icon: Server, title: 'Backend', label: 'Validate + authorize' },
      { icon: Database, title: 'Database', label: 'Read or write records' },
      { icon: Braces, title: 'Safe response', label: 'Return selected fields' },
    ],
    runtime: [
      { icon: Braces, title: 'Your code', label: 'JavaScript functions' },
      { icon: Layers3, title: 'Node.js', label: 'Runs your application' },
      { icon: Server, title: 'Server process', label: 'Listens for requests' },
      { icon: Globe2, title: 'Client', label: 'Connects to the port' },
    ],
  };
  const steps = flows[kind];
  return (
    <figure className="flow-figure">
      <ol className="flow">
        {steps.map(({ icon: Icon, title, label }, i) => (
          <li key={title}>
            <span className="flow-icon">
              <Icon size={18} strokeWidth={1.6} />
            </span>
            <strong>{title}</strong>
            <span>{label}</span>
            {i < steps.length - 1 && (
              <ArrowRight className="flow-arrow" size={15} aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>
      <figcaption>Each step is covered in the sections below.</figcaption>
    </figure>
  );
}

export function RequestLab() {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/notes');
  const [title, setTitle] = useState('Learn how requests work');
  const [result, setResult] = useState<{
    status: number;
    label: string;
    body: unknown;
    why: string;
  } | null>(null);
  const change = () => setResult(null);
  function send() {
    if (path === '/missing')
      return setResult({
        status: 404,
        label: 'Not Found',
        body: { error: 'Route not found' },
        why: 'This sample API has no route for /missing.',
      });
    if (method === 'DELETE')
      return setResult({
        status: 405,
        label: 'Method Not Allowed',
        body: { error: 'Try GET or POST', allow: 'GET, POST' },
        why: 'The path exists, but this sample route has no DELETE handler.',
      });
    if (method === 'POST' && !title.trim())
      return setResult({
        status: 400,
        label: 'Bad Request',
        body: { error: 'A title is required' },
        why: 'The handler rejects an empty title before creating a note.',
      });
    if (method === 'POST')
      return setResult({
        status: 201,
        label: 'Created',
        body: { id: 'note-2', title: title.trim() },
        why: 'The sample handler accepted the input and created a note in this simulation.',
      });
    setResult({
      status: 200,
      label: 'OK',
      body: [{ id: 'note-1', title: 'My first backend' }],
      why: 'The GET handler reads the sample notes and returns a JSON list.',
    });
  }
  return (
    <div className="request-lab">
      <div className="request-lab-head">
        <strong>Make a request</strong>
        <span>Simulated in your browser. No server involved.</span>
      </div>
      <div className="request-lab-body">
        <div className="request-lab-form">
          <div className="field-row">
            <label className="field">
              <span>Method</span>
              <select
                className="select"
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  change();
                }}
              >
                <option>GET</option>
                <option>POST</option>
                <option>DELETE</option>
              </select>
            </label>
            <label className="field grow">
              <span>Path</span>
              <select
                className="select mono"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  change();
                }}
              >
                <option>/notes</option>
                <option>/missing</option>
              </select>
            </label>
          </div>
          {method === 'POST' && (
            <label className="field">
              <span>Body · title</span>
              <input
                className="input"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  change();
                }}
                placeholder="Try leaving this empty"
              />
            </label>
          )}
          <button className="button button-primary" onClick={send}>
            Send request <ArrowRight size={15} />
          </button>
        </div>
        <div className="request-lab-result" aria-live="polite">
          {result ? (
            <>
              <span className={`status ${result.status >= 400 ? 'status-err' : 'status-ok'}`}>
                {result.status} {result.label}
              </span>
              <pre>{JSON.stringify(result.body, null, 2)}</pre>
              <p>{result.why}</p>
            </>
          ) : (
            <div className="empty-state">
              <Server size={20} />
              <p>Pick a method and path, then send it. The response appears here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
