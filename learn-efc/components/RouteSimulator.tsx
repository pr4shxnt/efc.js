'use client';

import React, { useState } from 'react';
import { Plus, RotateCcw, Send } from 'lucide-react';
import { INITIAL_ROUTES, RoutePreset } from '../lib/efc-data';
import { compileRoute, matchRoute, MatchResult, parseSegments } from '../lib/router-engine';
import { CodeBlock, MethodTag, PageHeader, Panel, ToolIntro } from './ui';

export function RouteSimulator() {
  const [routes, setRoutes] = useState<RoutePreset[]>(INITIAL_ROUTES);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);
  const [requestMethod, setRequestMethod] = useState<string>('GET');
  const [requestUrl, setRequestUrl] = useState<string>('/users/me');
  const [result, setResult] = useState<MatchResult | null>(null);

  // Custom route creation modal/state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newFilePath, setNewFilePath] = useState<string>('src/api/posts/[id]/comments.ts');
  const [newMethods, setNewMethods] = useState<string>('GET, POST');

  const compiledRoutes = routes.map((r) =>
    compileRoute(r.filePath, r.methods, r.code, r.description),
  );

  const selectedRoute = routes[selectedRouteIndex];

  const handleTest = (url = requestUrl, method = requestMethod) => {
    const res = matchRoute(compiledRoutes, method, url);
    setResult(res);
  };

  const handleAddRoute = (e: React.FormEvent) => {
    e.preventDefault();
    const methodsArr = newMethods
      .split(',')
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean);
    const newRoute: RoutePreset = {
      filePath: newFilePath,
      urlPath:
        '/' +
        parseSegments(newFilePath)
          .map((s) => s.raw)
          .join('/'),
      methods: methodsArr.length > 0 ? methodsArr : ['GET'],
      description: 'Custom user defined route',
      code: `import type { Request, Response } from 'express';

${methodsArr.map((m) => `export async function ${m}(req: Request, res: Response) {\n  res.json({ message: 'Handled by ${m}' });\n}`).join('\n\n')}`,
    };

    const updated = [...routes, newRoute];
    setRoutes(updated);
    setSelectedRouteIndex(updated.length - 1);
    setShowAddModal(false);
  };

  const handleReset = () => {
    setRoutes(INITIAL_ROUTES);
    setSelectedRouteIndex(0);
    setRequestMethod('GET');
    setRequestUrl('/users/me');
    setResult(null);
  };

  const presets = [
    { method: 'GET', url: '/users/me', note: 'static wins' },
    { method: 'GET', url: '/users/42', note: 'dynamic [id]' },
    { method: 'POST', url: '/users/42', note: '405' },
    { method: 'GET', url: '/docs/setup/install', note: 'catch-all' },
    { method: 'GET', url: '/posts', note: 'optional [[id]]' },
    { method: 'GET', url: '/unknown/path', note: '404' },
  ];

  const pickRoute = (idx: number) => {
    const route = routes[idx];
    setSelectedRouteIndex(idx);
    setRequestUrl(
      route.urlPath.includes(':')
        ? route.urlPath.replace(':id?', '101').replace(':id', '42').replace(':slug*', 'guide/intro')
        : route.urlPath,
    );
    setRequestMethod(route.methods[0] || 'GET');
  };

  const tone = result
    ? result.status < 300
      ? 'status-ok'
      : result.status === 405
        ? 'status-warn'
        : 'status-err'
    : '';

  return (
    <>
      <PageHeader
        title="Route simulator"
        actions={
          <>
            <button
              className="button button-quiet button-small"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={14} /> Add a file
            </button>
            <button className="button button-quiet button-small" onClick={handleReset}>
              <RotateCcw size={14} /> Reset
            </button>
          </>
        }
      >
        Every file in <code>src/api</code> becomes a route. Send a request and see which file
        answers, what lands in <code>req.params</code>, and when you get a 404 or an automatic 405.
      </PageHeader>

      <ToolIntro
        chapterIds={['quest-2', 'efc-first-project']}
        steps={[
          <>Click a file on the left. That is a route file in an EFC project.</>,
          <>
            Press <strong>Send</strong>, or pick one of the <em>Try</em> requests. The response
            panel says which file answered and why.
          </>,
          <>
            Change the method to POST and send again. A file that does not export POST answers{' '}
            <strong>405</strong>; a path no file matches answers <strong>404</strong>.
          </>,
          <>
            Use <strong>Add a file</strong> to create your own, such as{' '}
            <code>src/api/books/[id].ts</code>, and test it.
          </>,
        ]}
      >
        In a real project you never write app.get(&apos;/users/:id&apos;). You create a file, and
        its name becomes the URL. This page shows that matching without running a server. URLs here
        leave out the <code>/v1/api</code> prefix to stay short.
      </ToolIntro>

      <div className="presets">
        <span>Try</span>
        {presets.map((p) => (
          <button
            key={p.method + p.url}
            className={`preset ${result && requestMethod === p.method && requestUrl === p.url ? 'active' : ''}`}
            onClick={() => {
              setRequestMethod(p.method);
              setRequestUrl(p.url);
              handleTest(p.url, p.method);
            }}
          >
            <code>
              {p.method} {p.url}
            </code>
            <small>{p.note}</small>
          </button>
        ))}
      </div>

      <div className="tool-grid narrow-left">
        <Panel title="src/api" meta={`${routes.length} files`} flush>
          <ul className="file-tree">
            {routes.map((route, idx) => (
              <li key={idx}>
                <button
                  className={selectedRouteIndex === idx ? 'active' : ''}
                  aria-pressed={selectedRouteIndex === idx}
                  onClick={() => pickRoute(idx)}
                >
                  <span className="file-tree-row">
                    <span className="file-tree-path">{route.filePath.replace('src/api/', '')}</span>
                    <span className="file-tree-methods">
                      {route.methods.map((m) => (
                        <MethodTag key={m} method={m} />
                      ))}
                    </span>
                  </span>
                  <span className="file-tree-url">{route.urlPath}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="legend">
            <span>Most specific wins:</span>
            <code>static</code> → <code>[id]</code> → <code>[[id]]</code> → <code>[...slug]</code>
          </div>
        </Panel>

        <div className="stack">
          <Panel title="Request">
            <form
              className="dispatch"
              onSubmit={(e) => {
                e.preventDefault();
                handleTest();
              }}
            >
              <select
                aria-label="HTTP method"
                className="select mono"
                value={requestMethod}
                onChange={(e) => setRequestMethod(e.target.value)}
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                aria-label="Request path"
                className="input mono"
                value={requestUrl}
                onChange={(e) => setRequestUrl(e.target.value)}
                placeholder="/users/me"
              />
              <button className="button button-primary" type="submit">
                <Send size={14} /> Send
              </button>
            </form>
          </Panel>

          <div aria-live="polite">
            {result && (
              <Panel title="Response">
                <div className="result-head">
                  <span className={`status ${tone}`}>
                    {result.status} {result.statusText}
                  </span>
                  {result.allowHeader && (
                    <span className="header-chip">Allow: {result.allowHeader}</span>
                  )}
                </div>
                <p className="result-explain">{result.explanation}</p>
                {Object.keys(result.params).length > 0 && (
                  <div className="kv">
                    <span>req.params</span>
                    <pre>{JSON.stringify(result.params, null, 2)}</pre>
                  </div>
                )}
              </Panel>
            )}
          </div>

          {selectedRoute && (
            <Panel flush>
              <CodeBlock
                code={selectedRoute.code}
                label={`${selectedRoute.filePath}  →  ${selectedRoute.urlPath}`}
                footer={selectedRoute.description}
              />
            </Panel>
          )}
        </div>
      </div>

      {showAddModal && (
        <div className="modal-layer" onMouseDown={() => setShowAddModal(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-route-title"
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setShowAddModal(false)}
          >
            <h2 id="add-route-title">Add a route file</h2>
            <p>
              Use <code>[id]</code>, <code>[[id]]</code> or <code>[...slug]</code> in the path to
              see how dynamic segments match.
            </p>
            <form onSubmit={handleAddRoute}>
              <label className="field">
                <span>File path</span>
                <input
                  autoFocus
                  className="input mono"
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  placeholder="src/api/products/[id].ts"
                  required
                />
              </label>
              <label className="field">
                <span>Exported methods, comma separated</span>
                <input
                  className="input mono"
                  value={newMethods}
                  onChange={(e) => setNewMethods(e.target.value)}
                  placeholder="GET, POST, DELETE"
                  required
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="button button-primary">
                  Add file
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
