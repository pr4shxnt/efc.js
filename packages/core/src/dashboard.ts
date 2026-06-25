import type { MountedRoute } from './types.js';

const HTTP_STATUS: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity',
  500: 'Internal Server Error', 503: 'Service Unavailable',
};

export function generateDashboard(
  routes: MountedRoute[],
  basePath: string,
  port: number,
  projectName: string,
  projectVersion: string,
): string {
  const safeRoutes = JSON.stringify(
    routes.map((r) => ({ urlPath: r.urlPath, methods: r.methods, params: r.params, meta: r.meta ?? null })),
  ).replace(/<\/script>/gi, '<\\/script>');
  const safeHttpStatus = JSON.stringify(HTTP_STATUS);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${projectName} — API Reference</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:          #080b0f;
      --bg-card:     #0d1117;
      --bg-raised:   #111820;
      --border:      #1e2832;
      --border-lit:  #263040;
      --text:        #e2e8f0;
      --text-dim:    #64748b;
      --text-muted:  #334155;
      --accent:      #F0A030;
      --accent-dim:  rgba(240,160,48,.12);
      --accent-glow: rgba(240,160,48,.22);
      --purple:      #a78bfa;
      --blue:        #60a5fa;
      --orange:      #fb923c;
      --green:       #7AAE8E;
      --radius:      10px;
      --radius-lg:   16px;
      --font-mono:   'JetBrains Mono', monospace;
      --font-sans:   'Inter', sans-serif;
    }
    html { scroll-behavior: smooth; }
    body {
      background: var(--bg); color: var(--text);
      font-family: var(--font-sans); font-size: 16px;
      line-height: 1.6; -webkit-font-smoothing: antialiased;
      position: relative;
    }
    body::before {
      content: ''; position: fixed; inset: 0; z-index: 0;
      background-image:
        linear-gradient(var(--border) 1px, transparent 1px),
        linear-gradient(90deg, var(--border) 1px, transparent 1px);
      background-size: 60px 60px; opacity: .28; pointer-events: none;
    }
    section, footer, .page-hero, .docs-layout { position: relative; z-index: 1; }
    a { text-decoration: none; color: inherit; }
    em { font-style: italic; }
    code {
      font-family: var(--font-mono); font-size: .85em;
      background: var(--bg-raised); border: 1px solid var(--border);
      border-radius: 4px; padding: 1px 6px; color: var(--accent);
    }
    .container { max-width: 1140px; margin: 0 auto; padding: 0 24px; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: var(--border-lit); border-radius: 3px; }

    /* ── PAGE HERO ── */
    .page-hero {
      padding: 48px 0 56px; border-bottom: 1px solid var(--border);
    }
    .page-hero .hero-glow {
      position: absolute; top: -40px; left: 10%; width: 500px; height: 350px;
      background: radial-gradient(ellipse, rgba(240,160,48,.1) 0%, transparent 68%);
      pointer-events: none;
    }
    .page-title {
      font-size: clamp(2rem, 5vw, 3.4rem); font-weight: 800;
      line-height: 1.1; letter-spacing: -.02em; margin-bottom: 24px;
      display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap;
    }
    .project-version {
      font-family: var(--font-mono); font-size: clamp(.85rem, 2vw, 1.1rem);
      font-weight: 500; color: var(--accent);
      background: var(--accent-dim); border: 1px solid rgba(240,160,48,.3);
      border-radius: 6px; padding: 2px 10px; letter-spacing: .5px;
    }
    .hero-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 40px; }
    .base-url-pill {
      display: flex; align-items: center; gap: 8px;
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 7px; padding: 8px 14px;
    }
    .base-url-label { font-size: .72rem; font-family: var(--font-mono);
      color: var(--text-muted); text-transform: uppercase; letter-spacing: .5px; }
    .base-url-val { font-family: var(--font-mono); font-size: .8rem; color: var(--accent); }
    .count-pill {
      font-family: var(--font-mono); font-size: .72rem; color: var(--text-dim);
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 7px; padding: 8px 14px;
    }

    /* ── TOOLBAR ── */
    .toolbar {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    }
    .method-filters { display: flex; gap: 4px; flex-wrap: wrap; }
    .filter-btn {
      background: var(--bg-card); border: 1px solid var(--border);
      color: var(--text-dim); font-family: var(--font-mono);
      font-size: .72rem; font-weight: 600; letter-spacing: .5px;
      padding: 6px 12px; border-radius: 6px; cursor: pointer;
      transition: all .15s;
    }
    .filter-btn:hover { border-color: var(--border-lit); color: var(--text); }
    .filter-btn.active { background: var(--accent); color: #0d0d1a; border-color: var(--accent); }
    .filter-btn[data-method="GET"].active    { background: rgba(96,165,250,.18); color: #60a5fa; border-color: rgba(96,165,250,.4); }
    .filter-btn[data-method="POST"].active   { background: rgba(122,174,142,.18); color: #7AAE8E; border-color: rgba(122,174,142,.4); }
    .filter-btn[data-method="PUT"].active    { background: rgba(240,160,48,.18); color: #F0A030; border-color: rgba(240,160,48,.4); }
    .filter-btn[data-method="PATCH"].active  { background: rgba(251,191,36,.18); color: #fbbf24; border-color: rgba(251,191,36,.4); }
    .filter-btn[data-method="DELETE"].active { background: rgba(248,113,113,.18); color: #f87171; border-color: rgba(248,113,113,.4); }
    .filter-btn[data-method="HEAD"].active   { background: rgba(167,139,250,.18); color: #a78bfa; border-color: rgba(167,139,250,.4); }
    .search-wrap { margin-left: auto; }
    .search-input {
      background: var(--bg-card); border: 1px solid var(--border);
      color: var(--text); font-family: var(--font-sans); font-size: .85rem;
      padding: 7px 14px; border-radius: 7px; width: 240px;
      outline: none; transition: border-color .2s;
    }
    .search-input::placeholder { color: var(--text-muted); }
    .search-input:focus { border-color: var(--border-lit); }

    /* ── DOCS LAYOUT ── */
    .docs-layout {
      display: grid; grid-template-columns: 220px 1fr;
      gap: 48px; padding: 52px 0 80px; max-width: 1140px;
      margin: 0 auto; padding-left: 24px; padding-right: 24px;
    }

    /* ── SIDEBAR ── */
    .docs-sidebar { position: sticky; top: 24px; height: fit-content; }
    .sidebar-section { margin-bottom: 28px; }
    .sidebar-label {
      font-family: var(--font-mono); font-size: .68rem; font-weight: 600;
      color: var(--text-muted); letter-spacing: 1.2px; text-transform: uppercase;
      margin-bottom: 8px; padding: 0 4px;
    }
    .sidebar-link {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px; border-radius: 6px;
      border-left: 2px solid transparent;
      font-size: .82rem; color: var(--text-dim); cursor: pointer;
      transition: background .15s, color .15s, border-color .15s;
      text-overflow: ellipsis; overflow: hidden; white-space: nowrap;
    }
    .sidebar-link:hover { background: var(--bg-raised); color: var(--text); }
    .sidebar-link.active { color: var(--accent); border-left-color: var(--accent); background: var(--accent-dim); }
    .sidebar-method-dot {
      width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
    }
    .sidebar-path { font-family: var(--font-mono); font-size: .75rem; }

    /* ── ENDPOINT CARDS ── */
    .endpoint-card {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: var(--radius-lg); margin-bottom: 20px;
      overflow: hidden; transition: border-color .2s;
      animation: fadeUp .45s ease both;
    }
    .endpoint-card:hover { border-color: var(--border-lit); }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .endpoint-card { animation: none; }
    }
    .endpoint-header {
      display: flex; align-items: center; gap: 14px;
      padding: 20px 24px 18px; border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .method-badges { display: flex; gap: 6px; flex-wrap: wrap; }
    .method-badge {
      font-family: var(--font-mono); font-size: .7rem; font-weight: 600;
      letter-spacing: .8px; padding: 4px 10px; border-radius: 5px;
      border: 1px solid; text-transform: uppercase;
    }
    .endpoint-path {
      font-family: var(--font-mono); font-size: .9rem; color: var(--text);
      background: none; border: none; padding: 0;
      word-break: break-all;
    }
    .endpoint-body { padding: 18px 24px 24px; }
    .endpoint-desc { font-size: .9rem; color: var(--text-dim); line-height: 1.7; margin-bottom: 20px; }

    /* ── CODE BLOCKS ── */
    .example-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .code-block-wrap {
      background: var(--bg-raised); border: 1px solid var(--border);
      border-radius: var(--radius); overflow: hidden;
    }
    .code-bar {
      display: flex; align-items: center; gap: 6px;
      padding: 9px 14px; border-bottom: 1px solid var(--border);
      background: var(--bg-card);
    }
    .dot { width: 11px; height: 11px; border-radius: 50%; }
    .dot-r { background: #ff5f57; }
    .dot-y { background: #febc2e; }
    .dot-g { background: #28c840; }
    .code-label { font-family: var(--font-mono); font-size: .68rem; color: var(--text-dim); margin-left: 4px; }
    pre.code-pre {
      font-family: var(--font-mono); font-size: .78rem; line-height: 1.7;
      padding: 16px 18px; overflow-x: auto; tab-size: 2; white-space: pre;
    }
    .c-dim    { color: var(--text-muted); }
    .c-green  { color: #7AAE8E; }
    .c-blue   { color: #60a5fa; }
    .c-orange { color: #fb923c; }
    .c-purple { color: #a78bfa; }
    .c-accent { color: var(--accent); }
    .status-2xx { color: #7AAE8E; }
    .status-4xx { color: #f87171; }
    .status-5xx { color: #fb923c; }

    /* ── EMPTY STATE ── */
    .empty-state {
      text-align: center; padding: 80px 24px;
      color: var(--text-muted); font-size: .9rem;
    }

    /* ── RESPONSIVE ── */
    @media (max-width: 900px) {
      .docs-layout { grid-template-columns: 1fr; }
      .docs-sidebar { position: static; }
      .example-grid { grid-template-columns: 1fr; }
      .search-wrap { margin-left: 0; width: 100%; }
      .search-input { width: 100%; }
    }
    @media (max-width: 600px) {
      .page-hero { padding: 32px 0 32px; }
      .page-title { font-size: 2rem; }
    }
  </style>
</head>
<body>

  <div class="page-hero">
    <div class="hero-glow"></div>
    <div class="container">
      <h1 class="page-title">${projectName}${projectVersion ? `<span class="project-version">v${projectVersion}</span>` : ''}</h1>
      <div class="hero-meta">
        <div class="base-url-pill">
          <span class="base-url-label">Base</span>
          <span class="base-url-val">http://localhost:${port}${basePath}</span>
        </div>
        <div class="count-pill" id="countPill"></div>
      </div>
      <div class="toolbar">
        <div class="method-filters" id="methodFilters">
          <button class="filter-btn active" data-method="ALL">ALL</button>
        </div>
        <div class="search-wrap">
          <input type="text" id="searchInput" class="search-input" placeholder="Search endpoints…" />
        </div>
      </div>
    </div>
  </div>

  <div class="docs-layout">
    <aside class="docs-sidebar" id="sidebar"></aside>
    <main id="endpoints"></main>
  </div>

  <script>
    const ROUTES = ${safeRoutes};
    const BASE_PATH = ${JSON.stringify(basePath)};
    const HTTP_STATUS = ${safeHttpStatus};

    const METHOD_STYLE = {
      GET:     { bg: 'rgba(96,165,250,.14)',   color: '#60a5fa', border: 'rgba(96,165,250,.35)'   },
      POST:    { bg: 'rgba(122,174,142,.14)',  color: '#7AAE8E', border: 'rgba(122,174,142,.35)'  },
      PUT:     { bg: 'rgba(240,160,48,.14)',   color: '#F0A030', border: 'rgba(240,160,48,.35)'   },
      PATCH:   { bg: 'rgba(251,191,36,.14)',   color: '#fbbf24', border: 'rgba(251,191,36,.35)'   },
      DELETE:  { bg: 'rgba(248,113,113,.14)',  color: '#f87171', border: 'rgba(248,113,113,.35)'  },
      HEAD:    { bg: 'rgba(167,139,250,.14)',  color: '#a78bfa', border: 'rgba(167,139,250,.35)'  },
      OPTIONS: { bg: 'rgba(148,163,184,.14)',  color: '#94a3b8', border: 'rgba(148,163,184,.35)'  },
    };

    function esc(s) {
      return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function methodBadge(m) {
      const s = METHOD_STYLE[m] || METHOD_STYLE.GET;
      return '<span class="method-badge" style="background:' + s.bg + ';color:' + s.color + ';border-color:' + s.border + '">' + m + '</span>';
    }

    function joinPath(base, p) {
      return (base.replace(/\\/+$/, '') + p) || '/';
    }

    function sidebarDot(method) {
      const s = METHOD_STYLE[method] || METHOD_STYLE.GET;
      return '<span class="sidebar-method-dot" style="background:' + s.color + '"></span>';
    }

    function statusClass(code) {
      if (code >= 200 && code < 300) return 'status-2xx';
      if (code >= 400 && code < 500) return 'status-4xx';
      if (code >= 500) return 'status-5xx';
      return '';
    }

    function renderSchema(val, indent) {
      const pad = '  '.repeat(indent || 0);
      if (val === null) return '<span class="c-dim">null</span>';
      if (typeof val === 'string') {
        const isDate = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}/.test(val);
        return isDate ? '<span class="c-green">Date</span>' : '<span class="c-purple">String</span>';
      }
      if (typeof val === 'number') return '<span class="c-orange">Number</span>';
      if (typeof val === 'boolean') return '<span class="c-purple">Boolean</span>';
      if (Array.isArray(val)) {
        if (!val.length) return '[]';
        return '[\\n' + pad + '  ' + renderSchema(val[0], (indent || 0) + 1) + '\\n' + pad + ']';
      }
      if (typeof val === 'object') {
        const keys = Object.keys(val);
        if (!keys.length) return '{}';
        const inner = keys.map(function(k) {
          return pad + '  <span class="c-blue">&quot;' + esc(k) + '&quot;</span>: ' + renderSchema(val[k], (indent || 0) + 1);
        }).join(',\\n');
        return '{\\n' + inner + '\\n' + pad + '}';
      }
      return esc(String(val));
    }

    function codeBlock(label, content) {
      return '<div class="code-block-wrap">' +
        '<div class="code-bar">' +
          '<span class="dot dot-r"></span>' +
          '<span class="dot dot-y"></span>' +
          '<span class="dot dot-g"></span>' +
          '<span class="code-label">' + esc(label) + '</span>' +
        '</div>' +
        '<pre class="code-pre">' + content + '</pre>' +
      '</div>';
    }

    function buildRequestContent(route, example) {
      const req = example || {};
      const method = route.methods[0] || 'GET';
      let path = joinPath(BASE_PATH, route.urlPath);
      if (req.params) {
        for (const [k, v] of Object.entries(req.params)) {
          path = path.replace(':' + k, String(v));
        }
      }
      if (req.query && Object.keys(req.query).length) {
        path += '?' + new URLSearchParams(req.query).toString();
      }
      let lines = '<span class="c-accent">' + esc(method) + '</span> <span class="c-blue">' + esc(path) + '</span>';
      const headers = { ...(req.headers || {}) };
      if (req.body !== undefined && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      if (Object.keys(headers).length) {
        lines += '\\n' + Object.entries(headers)
          .map(([k, v]) => '<span class="c-dim">' + esc(k) + ':</span> ' + esc(String(v)))
          .join('\\n');
      }
      if (req.body !== undefined) {
        lines += '\\n\\n' + renderSchema(req.body, 0);
      }
      return lines;
    }

    function buildResponseContent(example) {
      const resp = example || {};
      const code = resp.status || 200;
      const text = HTTP_STATUS[code] || 'OK';
      const cls = statusClass(code);
      let lines = 'HTTP/1.1 <span class="' + cls + '">' + code + ' ' + esc(text) + '</span>';
      if (resp.body !== undefined) {
        lines += '\\n<span class="c-dim">Content-Type:</span> application/json\\n\\n';
        lines += renderSchema(resp.body, 0);
      }
      return lines;
    }

    function renderCard(route, index) {
      const id = 'ep-' + index;
      const fullPath = joinPath(BASE_PATH, route.urlPath);
      const badges = route.methods.map(methodBadge).join('');
      const meta = route.meta;
      const desc = meta && meta.description
        ? '<p class="endpoint-desc">' + esc(meta.description) + '</p>'
        : '';
      let examples = '';
      if (meta) {
        const reqHtml = meta.request !== undefined
          ? codeBlock('request', buildRequestContent(route, meta.request))
          : '';
        const respHtml = meta.response !== undefined
          ? codeBlock('response', buildResponseContent(meta.response))
          : '';
        if (reqHtml || respHtml) {
          examples = '<div class="example-grid">' + reqHtml + respHtml + '</div>';
        }
      }
      const delay = (index * 0.06).toFixed(2) + 's';
      return '<div class="endpoint-card" id="' + id + '" data-methods="' + route.methods.join(',') + '" data-path="' + esc(fullPath) + '" style="animation-delay:' + delay + '">' +
        '<div class="endpoint-header">' +
          '<div class="method-badges">' + badges + '</div>' +
          '<code class="endpoint-path">' + esc(fullPath) + '</code>' +
        '</div>' +
        '<div class="endpoint-body">' + desc + examples + '</div>' +
      '</div>';
    }

    function buildMethodFilters() {
      const allMethods = [...new Set(ROUTES.flatMap(r => r.methods))].sort();
      const filtersEl = document.getElementById('methodFilters');
      allMethods.forEach(m => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.dataset.method = m;
        btn.textContent = m;
        filtersEl.appendChild(btn);
      });
    }

    function buildSidebar(routes) {
      const sidebar = document.getElementById('sidebar');
      if (!routes.length) { sidebar.innerHTML = ''; return; }

      const label = document.createElement('div');
      label.className = 'sidebar-label';
      label.textContent = 'Endpoints';
      sidebar.appendChild(label);

      routes.forEach((route, i) => {
        const link = document.createElement('div');
        link.className = 'sidebar-link';
        link.dataset.target = 'ep-' + ROUTES.indexOf(route);
        link.innerHTML = sidebarDot(route.methods[0] || 'GET') +
          '<span class="sidebar-path">' + esc(joinPath(BASE_PATH, route.urlPath)) + '</span>';
        link.addEventListener('click', () => {
          const target = document.getElementById(link.dataset.target);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        sidebar.appendChild(link);
      });
    }

    let activeFilter = 'ALL';
    let searchQuery = '';

    function applyFilters() {
      const cards = document.querySelectorAll('.endpoint-card');
      let visible = 0;
      cards.forEach(card => {
        const methods = card.dataset.methods.split(',');
        const path = card.dataset.path || '';
        const matchMethod = activeFilter === 'ALL' || methods.includes(activeFilter);
        const matchSearch = !searchQuery || path.toLowerCase().includes(searchQuery);
        const show = matchMethod && matchSearch;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      document.getElementById('empty-state').style.display = visible ? 'none' : 'block';

      // Sync sidebar visibility
      document.querySelectorAll('.sidebar-link').forEach(link => {
        const targetId = link.dataset.target;
        const targetCard = document.getElementById(targetId);
        link.style.display = targetCard && targetCard.style.display !== 'none' ? '' : 'none';
      });
    }

    function init() {
      const count = ROUTES.length;
      document.getElementById('countPill').textContent = count + ' endpoint' + (count !== 1 ? 's' : '');

      buildMethodFilters();

      const container = document.getElementById('endpoints');
      container.innerHTML = ROUTES.map((r, i) => renderCard(r, i)).join('');

      // Add empty state after cards
      const emptyEl = document.createElement('div');
      emptyEl.id = 'empty-state';
      emptyEl.className = 'empty-state';
      emptyEl.style.display = 'none';
      emptyEl.innerHTML = '<p>No endpoints match your filter.</p>';
      container.after(emptyEl);

      buildSidebar(ROUTES);

      // Method filter clicks
      document.getElementById('methodFilters').addEventListener('click', e => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.method;
        applyFilters();
      });

      // Search
      document.getElementById('searchInput').addEventListener('input', e => {
        searchQuery = e.target.value.trim().toLowerCase();
        applyFilters();
      });

      // Scroll spy for sidebar
      const cardEls = document.querySelectorAll('.endpoint-card');
      const sidebarLinks = document.querySelectorAll('.sidebar-link');
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            sidebarLinks.forEach(l => l.classList.toggle('active', l.dataset.target === id));
          }
        });
      }, { rootMargin: '-80px 0px -60% 0px' });
      cardEls.forEach(el => observer.observe(el));

    }

    try {
      init();
    } catch (e) {
      document.body.insertAdjacentHTML('afterbegin',
        '<div style="position:fixed;top:60px;left:0;right:0;z-index:9999;background:#7f1d1d;color:#fca5a5;padding:16px 24px;font-family:monospace;font-size:13px;border-bottom:1px solid #ef4444">' +
        '<strong>Dashboard JS error:</strong> ' + (e && e.message ? e.message : String(e)) +
        (e && e.stack ? '<pre style="margin-top:8px;white-space:pre-wrap">' + e.stack + '</pre>' : '') +
        '</div>'
      );
    }
  </script>
</body>
</html>`;
}
