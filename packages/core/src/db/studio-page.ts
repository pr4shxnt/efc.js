// EFC Studio Frontend UI
// Formatted with exact client/ workspace.css & style.css layout, components, and design system.

export const STUDIO_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>EFC Studio</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<style>
/* Exact client/ tokens */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
[hidden] { display: none !important; }

:root {
  color-scheme: dark;
  --bg:         #08090b;
  --bg-card:    #0e1014;
  --bg-raised:  #14171c;
  --border:     #1d2127;
  --border-lit: #2b3038;
  --text:       #e8eaed;
  --text-dim:   #959ba5;
  --text-muted: #5b616b;
  --accent:     #F0A030;
  --accent-2:   #f6c37a;
  --accent-dim: rgba(240,160,48,.10);
  --accent-glow:rgba(240,160,48,.22);
  --purple:     #b9a8f5;
  --blue:       #7cb6f2;
  --orange:     #f0a070;
  --green:      #8cc49f;
  --red:        #f07a72;
  /* Local fonts only: the studio makes no outside requests (and works offline).
     Inter / JetBrains Mono are used when installed, the system's fonts otherwise. */
  --font-mono:  'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
  --font-sans:  'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --r:          8px;
  --radius-lg:  12px;
  --ease-out:   cubic-bezier(.16,1,.3,1);
}

html, body {
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

body {
  display: flex;
  flex-direction: column;
}

/* Global grid overlay — exact from client/workspace.css */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  background-image:
    linear-gradient(var(--border) 1px, transparent 1px),
    linear-gradient(90deg, var(--border) 1px, transparent 1px);
  background-size: 60px 60px;
  opacity: .28;
  pointer-events: none;
}

/* Scrollbars — exact from client/workspace.css */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border-lit); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
* { scrollbar-width: thin; scrollbar-color: var(--border-lit) var(--bg); }

::selection { background: var(--accent); color: #111; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ─── TOP BAR (exact from client/workspace.html .ws-topbar) ─── */
.ws-topbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 60px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  position: relative;
  z-index: 10;
}

.logo {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-weight: 500;
  letter-spacing: -.5px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
  user-select: none;
  white-space: nowrap;
}
.logo-dot { color: var(--accent); }
.logo-img { width: 26px; height: 26px; color: var(--accent); flex-shrink: 0; }

.ws-topbar-label {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--text-muted);
  white-space: nowrap;
}

.badge-group {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.badge-engine, .badge-mode {
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 4px;
  line-height: 1.35;
}
.badge-engine.pg { color: var(--blue); background: rgba(124,182,242,.12); border: 1px solid rgba(124,182,242,.28); }
.badge-engine.mongo { color: var(--green); background: rgba(140,196,159,.12); border: 1px solid rgba(140,196,159,.28); }

.badge-mode.write { color: var(--green); background: rgba(140,196,159,.12); border: 1px solid rgba(140,196,159,.28); }
.badge-mode.ro { color: var(--text-muted); background: var(--bg-raised); border: 1px solid var(--border); }

.topbar-spacer { flex: 1; }

/* ─── BUTTONS & CONTROLS (exact from client/style.css) ─── */
.btn-primary, .btn-ghost, .btn-danger {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: var(--font-sans);
  font-weight: 500; font-size: 14px; line-height: 1;
  padding: 9px 18px; border-radius: var(--r);
  white-space: nowrap; cursor: pointer;
  transition: background .15s, border-color .15s, color .15s, transform .15s;
}

.btn-primary {
  background: var(--accent); color: #1a1100; border: 1px solid var(--accent);
}
.btn-primary:hover:not(:disabled) {
  background: #f3b04f;
  transform: translateY(-1px);
}
.btn-primary:disabled {
  opacity: .4; cursor: default; transform: none;
}

.btn-ghost {
  border: 1px solid var(--border-lit); color: var(--text-dim); background: transparent;
}
.btn-ghost:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.btn-ghost:disabled {
  opacity: .35; cursor: default;
}

.btn-icon { padding: 9px 12px; }

.btn-group { display: inline-flex; }
.btn-group .btn-ghost { border-radius: 0; }
.btn-group .btn-ghost:first-child {
  border-top-left-radius: var(--r);
  border-bottom-left-radius: var(--r);
}
.btn-group .btn-ghost:last-child {
  border-top-right-radius: var(--r);
  border-bottom-right-radius: var(--r);
  margin-left: -1px;
}

.btn-danger {
  background: rgba(240, 122, 114, .12);
  border: 1px solid rgba(240, 122, 114, .35);
  color: var(--red);
}
.btn-danger:hover:not(:disabled) {
  background: var(--red);
  color: #1a0808;
  border-color: var(--red);
}

/* Tabbar — exact from client/workspace.css */
.tabbar {
  display: flex;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r);
  overflow: hidden;
  flex-shrink: 0;
}
.tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  font-family: var(--font-mono);
  font-size: 13.5px;
  color: var(--text-dim);
  background: transparent;
  border: 0;
  border-right: 1px solid var(--border);
  cursor: pointer;
  transition: color .15s, background .15s;
  user-select: none;
}
.tab-item:last-child { border-right: 0; }
.tab-item:hover:not(:disabled) { color: var(--text); }
.tab-item.active {
  background: var(--bg-raised);
  color: var(--text);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.tab-item:disabled { opacity: .35; cursor: default; }

/* Search Inputs — exact style.css install input */
.input-search-wrap {
  display: flex;
  align-items: center;
  background: var(--bg-raised);
  border: 1px solid var(--border-lit);
  border-radius: var(--r);
  padding: 8px 12px;
  gap: 8px;
  transition: border-color .15s, box-shadow .15s;
}
.input-search-wrap:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-glow);
}
.input-search-wrap svg { color: var(--text-dim); flex-shrink: 0; }
.input-search {
  background: none;
  border: 0;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13.5px;
  outline: none;
  width: 100%;
}
.input-search::placeholder { color: var(--text-muted); }
.clear-btn {
  background: none;
  border: 0;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 15px;
  padding: 0 2px;
}
.clear-btn:hover { color: var(--text); }

/* ─── APP BODY (Sidebar + Editor Area) ─── */
.ws-body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
  z-index: 1;
}

aside {
  width: 290px;
  min-width: 290px;
  background: var(--bg-card);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.search-box {
  padding: 14px 16px 10px;
  position: relative;
}

.sidebar-header {
  padding: 12px 18px 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--text-muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.table-tree {
  flex: 1;
  overflow-y: auto;
  padding: 4px 10px 18px;
}

.tree-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 3px;
  border-radius: 6px;
  font-size: 13.5px;
  min-height: 38px;
  color: var(--text-dim);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  border: 1px solid transparent;
  transition: background .15s, color .15s;
}
.tree-row:hover {
  background: var(--bg-raised);
  color: var(--text);
}
.tree-row.active {
  background: var(--accent-dim);
  color: var(--text);
  box-shadow: inset 2px 0 0 var(--accent);
}
.tree-left {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  min-width: 0;
}
.ico-table {
  color: var(--text-muted);
  flex-shrink: 0;
}
.tree-row.active .ico-table {
  color: var(--accent);
}
.table-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-row.active .table-name {
  color: var(--accent-2);
  font-weight: 600;
}

.count-badge {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  background: var(--bg-raised);
  border: 1px solid var(--border);
  padding: 2px 7px;
  border-radius: 4px;
  flex-shrink: 0;
}
.tree-row.active .count-badge {
  background: rgba(240,160,48,.15);
  border-color: rgba(240,160,48,.35);
  color: var(--accent);
}

/* ─── WORKSPACE CONTENT ─── */
main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg);
  overflow: hidden;
}

.workspace-bar {
  height: 50px;
  min-height: 50px;
  padding: 0 24px;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}
.active-title {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
  white-space: nowrap;
}
.meta-chip {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-dim);
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 3px 10px;
  border-radius: 4px;
  white-space: nowrap;
}

/* ─── DATA GRID ─── */
.wrap {
  overflow: auto;
  flex: 1;
  background: var(--bg);
  position: relative;
}

table.data-table {
  border-collapse: separate;
  border-spacing: 0;
  width: max-content;
  min-width: 100%;
}

th, td {
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
  padding: 13px 20px;
  text-align: left;
  vertical-align: middle;
  max-width: 460px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 1.5;
}

th {
  position: sticky;
  top: 0;
  background: var(--bg-card);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 12.5px;
  letter-spacing: .06em;
  text-transform: uppercase;
  z-index: 5;
  cursor: pointer;
  user-select: none;
  transition: color .15s, background .15s;
  padding: 12px 20px;
}
th:hover {
  color: var(--accent);
  background: var(--bg-raised);
}
th .th-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
th .sort-arrow {
  color: var(--accent);
  font-size: 11px;
}

td {
  font-family: var(--font-mono);
  background: var(--bg);
  color: var(--text);
}
tr:hover td {
  background: var(--bg-card);
}

/* Syntax colors from client/style.css */
td.cell-id { color: var(--purple); font-weight: 500; }
td.cell-number { color: var(--blue); }
td.cell-date { color: var(--orange); }
td.cell-bool-true { color: var(--green); }
td.cell-bool-false { color: var(--text-muted); }
td.cell-null { color: var(--text-muted); font-style: italic; }
td.cell-obj { color: var(--accent); cursor: pointer; }
td.cell-obj:hover { text-decoration: underline; color: var(--accent-2); }

td.num-col, th.num-col {
  width: 52px;
  min-width: 52px;
  max-width: 52px;
  text-align: center;
  position: sticky;
  left: 0;
  z-index: 3;
  border-right: 1px solid var(--border);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  user-select: none;
}
th.num-col { z-index: 7; background: var(--bg-card); cursor: default; }
td.num-col { background: var(--bg-card); }
tr:hover td.num-col { background: var(--bg-raised); color: var(--accent); }

td.act-col, th.act-col {
  width: 100px;
  min-width: 100px;
  max-width: 100px;
  text-align: center;
  position: sticky;
  left: 52px;
  z-index: 2;
  border-right: 2px solid var(--border);
}
th.act-col { z-index: 6; background: var(--bg-card); cursor: default; }
td.act-col { background: var(--bg-card); }
tr:hover td.act-col { background: var(--bg-raised); }

tr.ghost-row td {
  background: transparent !important;
  border-bottom: 1px solid rgba(29, 33, 39, .6);
  border-right: 1px solid rgba(29, 33, 39, .6);
  pointer-events: none;
  user-select: none;
  height: 46px;
}
tr.ghost-row td.num-col {
  background: rgba(14, 16, 20, .3) !important;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.row-act-btn {
  background: none;
  border: 0;
  color: var(--text-dim);
  cursor: pointer;
  padding: 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: color .15s, background .15s;
}
.row-act-btn svg { width: 15px; height: 15px; }
.row-act-btn:hover { background: var(--border-lit); color: var(--text); }
.row-act-btn.edit:hover { color: var(--accent); }
.row-act-btn.del:hover { color: var(--red); }

/* ─── STRUCTURE CARDS ─── */
.structure-wrap {
  padding: 28px;
  max-width: 1100px;
}
.window-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 24px;
  box-shadow: 0 16px 40px rgba(0,0,0,.45);
}
.code-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-raised);
}
.dot { width: 10px; height: 10px; border-radius: 50%; }
.dot.r { background: #ff5f57; }
.dot.y { background: #febc2e; }
.dot.g { background: #28c840; }
.code-bar-label {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-dim);
  margin-left: 6px;
}
.type-tag {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--blue);
  background: rgba(124,182,242,.12);
  border: 1px solid rgba(124,182,242,.28);
  padding: 3px 8px;
  border-radius: 4px;
}
.null-tag {
  font-family: var(--font-mono);
  font-size: 12.5px;
  padding: 3px 8px;
  border-radius: 4px;
}
.null-tag.not-null { color: var(--green); background: rgba(140,196,159,.12); border: 1px solid rgba(140,196,159,.28); }
.null-tag.nullable { color: var(--text-muted); background: var(--bg-raised); border: 1px solid var(--border); }

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 96px 20px;
  color: var(--text-dim);
  text-align: center;
}
.empty-state svg {
  color: var(--accent);
  opacity: .7;
  margin-bottom: 16px;
}
.empty-state h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}
.empty-state p {
  color: var(--text-dim);
  font-size: 15px;
}

/* ─── MODALS ─── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 9, 11, .85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal-overlay.on { display: flex; }

.modal-window {
  background: var(--bg-card);
  border: 1px solid var(--border-lit);
  border-radius: var(--radius-lg);
  width: min(780px, 94vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 80px rgba(0,0,0,.7), 0 0 0 1px var(--border);
  overflow: hidden;
  animation: modalIn .2s var(--ease-out);
}
@keyframes modalIn {
  from { opacity: 0; transform: translateY(12px) scale(.98); }
  to { opacity: 1; transform: none; }
}

.modal-header {
  padding: 14px 22px;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-header h3 {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}
.modal-close {
  background: none;
  border: 0;
  color: var(--text-dim);
  font-size: 20px;
  cursor: pointer;
}
.modal-close:hover { color: var(--text); }

.modal-tabs {
  display: flex;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  padding: 0 16px;
}
.modal-tab-btn {
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 11px 20px;
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--text-dim);
  cursor: pointer;
  transition: color .15s;
}
.modal-tab-btn:hover { color: var(--text); }
.modal-tab-btn.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 500;
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.form-grid {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 16px 22px;
  align-items: center;
}
.form-label {
  font-family: var(--font-mono);
  font-size: 13.5px;
  color: var(--text-dim);
  word-break: break-all;
}
.form-input {
  width: 100%;
  background: var(--bg-raised);
  border: 1px solid var(--border-lit);
  border-radius: var(--r);
  padding: 9px 14px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 14px;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.form-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-glow);
}

.json-textarea {
  width: 100%;
  height: 320px;
  background: var(--bg-raised);
  border: 1px solid var(--border-lit);
  border-radius: var(--r);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13.5px;
  line-height: 1.6;
  padding: 16px;
  outline: none;
  resize: vertical;
}
.json-textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-glow);
}

.modal-err {
  margin-top: 14px;
  padding: 11px 16px;
  border-radius: var(--r);
  background: rgba(240,122,114,.12);
  border: 1px solid rgba(240,122,114,.35);
  color: var(--red);
  font-family: var(--font-mono);
  font-size: 13px;
  white-space: pre-wrap;
  display: none;
}
.modal-err.on { display: block; }

.modal-footer {
  padding: 16px 22px;
  border-top: 1px solid var(--border);
  background: var(--bg-raised);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-footer-right {
  display: flex;
  gap: 12px;
}

/* ─── STATUS BAR ─── */
.statusbar {
  flex-shrink: 0;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: var(--bg-card);
  border-top: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 12.5px;
  position: relative;
  z-index: 10;
}
.sb-left, .sb-right, .sb-center {
  display: flex;
  align-items: center;
  gap: 18px;
}
.sb-item {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.sb-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 6px rgba(140,196,159,.5);
}
.sb-hint {
  color: var(--text-muted);
  font-size: 12px;
}

/* Toast */
.toast-wrap {
  position: fixed;
  bottom: 38px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 200;
  pointer-events: none;
}
.toast {
  background: var(--bg-card);
  border: 1px solid var(--border-lit);
  color: var(--text);
  padding: 10px 18px;
  border-radius: var(--r);
  font-size: 13.5px;
  box-shadow: 0 8px 24px rgba(0,0,0,.6);
  display: flex;
  align-items: center;
  gap: 8px;
  animation: toastIn .2s var(--ease-out);
}
.toast::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
@keyframes toastIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
</style>
</head>
<body>

<!-- TOP BAR (Full width across top so badges never clip) -->
<header class="ws-topbar">
  <div class="logo">
    <svg class="logo-img" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="6" y="7" width="20" height="3" rx="1.5" fill="currentColor" />
      <rect x="6" y="14.5" width="14" height="3" rx="1.5" fill="currentColor" opacity="0.85" />
      <rect x="6" y="22" width="20" height="3" rx="1.5" fill="currentColor" />
    </svg>
    <span>efc<span class="logo-dot">.</span>studio</span>
  </div>
  <span class="ws-topbar-label">Studio</span>
  <div class="badge-group">
    <span class="badge-engine" id="engineBadge">db</span>
    <span class="badge-mode ro" id="modeBadge">read-only</span>
  </div>

  <div class="topbar-spacer"></div>

  <div class="header-center" id="rowSearchWrap">
    <div class="input-search-wrap" style="width: 240px;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input type="text" id="rowSearch" class="input-search" placeholder="Filter rows in view..." autocomplete="off" disabled>
      <button id="rowSearchClear" class="clear-btn" hidden title="Clear filter">&times;</button>
    </div>
  </div>

  <div class="tabbar">
    <button id="btnModeRows" class="tab-item active" title="View data rows">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"></line>
        <line x1="8" y1="12" x2="21" y2="12"></line>
        <line x1="8" y1="18" x2="21" y2="18"></line>
        <line x1="3" y1="6" x2="3.01" y2="6"></line>
        <line x1="3" y1="12" x2="3.01" y2="12"></line>
        <line x1="3" y1="18" x2="3.01" y2="18"></line>
      </svg>
      Rows
    </button>
    <button id="btnModeStructure" class="tab-item" title="View schema structure" disabled>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="3" y1="9" x2="21" y2="9"></line>
        <line x1="9" y1="21" x2="9" y2="9"></line>
      </svg>
      Structure
    </button>
  </div>

  <button id="btnRefresh" class="btn-ghost btn-icon" title="Refresh data" disabled>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M23 4v6h-6"></path>
      <path d="M1 20v-6h6"></path>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>
  </button>

  <div class="btn-group">
    <button id="prev" class="btn-ghost btn-icon" disabled title="Previous page">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>
    <button id="next" class="btn-ghost btn-icon" disabled title="Next page">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </button>
  </div>

  <button id="ins" class="btn-primary" hidden>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
    + Insert
  </button>
</header>

<div class="ws-body">
  <aside>
    <div class="search-box">
      <div class="input-search-wrap">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input type="text" id="tableSearch" class="input-search" placeholder="Search tables..." autocomplete="off">
        <button id="tableSearchClear" class="clear-btn" hidden title="Clear search">&times;</button>
      </div>
    </div>

    <div class="sidebar-header">
      <span>Collections</span>
      <span id="tableCountBadge"></span>
    </div>

    <div id="list" class="table-tree"></div>
  </aside>

  <main>
    <div class="workspace-bar">
      <svg class="ico-table" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"></rect>
        <line x1="3" y1="9" x2="21" y2="9"></line>
        <line x1="9" y1="21" x2="9" y2="9"></line>
      </svg>
      <h2 id="title" class="active-title">Select a table</h2>
      <span id="meta" class="meta-chip">empty</span>
    </div>

    <div class="wrap" id="grid">
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect x="6" y="7" width="20" height="3" rx="1.5" fill="currentColor" />
          <rect x="6" y="14.5" width="14" height="3" rx="1.5" fill="currentColor" opacity="0.85" />
          <rect x="6" y="22" width="20" height="3" rx="1.5" fill="currentColor" />
        </svg>
        <h3>Select a collection</h3>
        <p>Choose any table or collection from the left sidebar to inspect and edit records.</p>
      </div>
    </div>
  </main>
</div>

<footer class="statusbar">
  <div class="sb-left">
    <div class="sb-item">
      <span class="sb-dot on"></span>
      <span id="sbEngine">Database</span>
    </div>
    <div class="sb-item">
      <span id="sbTable">—</span>
    </div>
  </div>
  <div class="sb-center">
    <span class="sb-hint">Double-click row to inspect/edit · Filter: / · Next/Prev: ← / →</span>
  </div>
  <div class="sb-right">
    <div class="sb-item">
      <span id="sbCount">0 records</span>
    </div>
    <div class="sb-item">
      <span id="sbMode">read-only</span>
    </div>
  </div>
</footer>

<!-- Editor Modal -->
<div id="ed" class="modal-overlay">
  <div class="modal-window">
    <div class="modal-header">
      <h3 id="edTitle">Edit record</h3>
      <button id="edClose" class="modal-close" title="Close (Esc)">&times;</button>
    </div>
    <div class="modal-tabs">
      <button id="edTabForm" class="modal-tab-btn active">Form</button>
      <button id="edTabJson" class="modal-tab-btn">JSON</button>
    </div>
    <div class="modal-body">
      <div id="edFormPanel">
        <div id="edFormFields" class="form-grid"></div>
      </div>
      <div id="edJsonPanel" style="display:none">
        <textarea id="edText" class="json-textarea" spellcheck="false"></textarea>
      </div>
      <div id="edErr" class="modal-err"></div>
    </div>
    <div class="modal-footer">
      <button id="edDel" class="btn-danger">Delete</button>
      <div class="modal-footer-right">
        <button id="edCancel" class="btn-ghost">Cancel</button>
        <button id="edSave" class="btn-primary">Save Changes</button>
      </div>
    </div>
  </div>
</div>

<!-- Value Inspector Modal -->
<div id="jsonModal" class="modal-overlay">
  <div class="modal-window" style="width: min(600px, 94vw);">
    <div class="modal-header">
      <h3 id="jsonModalTitle">Inspect Value</h3>
      <button id="jsonModalClose" class="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <pre id="jsonModalPre" style="margin:0; font-family:var(--font-mono); font-size:.8rem; line-height:1.6; white-space:pre-wrap; color:var(--text);"></pre>
    </div>
    <div class="modal-footer" style="justify-content: flex-end;">
      <button id="jsonModalCopy" class="btn-ghost">Copy JSON</button>
    </div>
  </div>
</div>

<div class="toast-wrap" id="toasts"></div>

<script>
const TOKEN=__EFC_TOKEN__;
const LIMIT=50;
let cur=null,skip=0,mode='rows',write=false,writable=new Set(),editing=null;
let allCollections=[];
let currentRows=[];
let activeColumns=[];
let sortCol=null,sortAsc=true;
const SKIP=new Set(['_id','id','__v','createdAt','updatedAt']);

const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function toast(msg){
  const el=document.createElement('div');
  el.className='toast';
  el.textContent=msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(),2500);
}

async function api(p){
  const r=await fetch(p);
  if(!r.ok){
    const d=await r.json().catch(()=>({}));
    throw new Error(d.error||r.statusText);
  }
  return r.json();
}

async function send(method,p,body){
  const r=await fetch(p,{
    method,
    headers:{
      'Content-Type':'application/json',
      'X-EFC-Studio-Token':TOKEN
    },
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok){
    const e=new Error(d.error||r.statusText);
    e.issues=d.issues;
    throw e;
  }
  return d;
}

function selectTable(name){
  cur=name;
  skip=0;
  sortCol=null;
  location.hash='#'+encodeURIComponent(name);
  document.querySelectorAll('.tree-row').forEach(x=>{
    const on=x.dataset.name===name;
    x.classList.toggle('active', on);
    if(on) x.scrollIntoView({ block: 'nearest' });
  });
  document.getElementById('btnModeStructure').disabled=false;
  document.getElementById('btnRefresh').disabled=false;
  document.getElementById('rowSearch').disabled=false;
  show();
}

function renderTableList(filterText=''){
  const el=document.getElementById('list');
  el.innerHTML='';
  const q=filterText.toLowerCase().trim();
  const filtered=allCollections.filter(c=>!q||c.name.toLowerCase().includes(q));
  document.getElementById('tableCountBadge').textContent=filtered.length===allCollections.length?String(allCollections.length):filtered.length+' / '+allCollections.length;
  
  if(!filtered.length){
    el.innerHTML='<div style="padding:24px 16px; color:var(--text-dim); text-align:center;">No collections match "'+esc(filterText)+'"</div>';
    return;
  }

  for(const c of filtered){
    const b=document.createElement('div');
    b.className='tree-row'+(cur===c.name?' active':'');
    b.dataset.name=c.name;
    b.innerHTML='<div class="tree-left">'+
      '<svg class="ico-table" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+
      '<rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>'+
      '<span class="table-name" title="'+esc(c.name)+'">'+esc(c.name)+'</span></div>'+
      '<span class="count-badge">'+c.count+'</span>';
    b.onclick=()=>selectTable(c.name);
    el.appendChild(b);
  }
}

async function loadList(){
  const d=await api('/api/collections');
  write=d.write;
  writable=new Set(d.collections.filter(c=>c.writable).map(c=>c.name));
  allCollections=d.collections;
  
  const eng=document.getElementById('engineBadge');
  eng.textContent=d.engine;
  eng.className='badge-engine '+(d.engine==='postgresql'?'pg':'mongo');
  
  const mb=document.getElementById('modeBadge');
  mb.textContent=write?'write':'read-only';
  mb.className='badge-mode '+(write?'write':'ro');

  const sbEng=document.getElementById('sbEngine');
  if(sbEng) sbEng.textContent=d.engine==='postgresql'?'PostgreSQL':d.engine==='mongo'?'MongoDB':d.engine;
  const sbMd=document.getElementById('sbMode');
  if(sbMd) sbMd.textContent=write?'read-write':'read-only';

  renderTableList(document.getElementById('tableSearch').value);
  if(!allCollections.length){
    document.getElementById('list').innerHTML='<div style="padding:24px 16px; color:var(--text-dim); text-align:center;">No collections found</div>';
    return;
  }

  const hash=decodeURIComponent(location.hash.slice(1));
  const target=allCollections.find(c=>c.name===hash)||allCollections.find(c=>c.name==='studiobooks')||allCollections[0];
  if(target&&!cur){
    selectTable(target.name);
  }
}

document.getElementById('tableSearch').oninput=(e)=>{
  const v=e.target.value;
  document.getElementById('tableSearchClear').hidden=!v;
  renderTableList(v);
};
document.getElementById('tableSearchClear').onclick=()=>{
  document.getElementById('tableSearch').value='';
  document.getElementById('tableSearchClear').hidden=true;
  renderTableList();
};

function formatCell(val, key){
  if(val===null||val===undefined) return '<td class="cell-null">null</td>';
  if(typeof val==='boolean') return '<td class="'+(val?'cell-bool-true':'cell-bool-false')+'">'+val+'</td>';
  if(typeof val==='number') return '<td class="cell-number" title="'+val+'">'+val+'</td>';
  if(typeof val==='object'){
    const j=JSON.stringify(val);
    return '<td class="cell-obj" data-json="'+esc(j)+'" title="Click to inspect">'+esc(j)+'</td>';
  }
  const s=String(val);
  const isId=key==='id'||key==='_id'||/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const isDate=/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}/.test(s);
  const cls=isId?'cell-id':(isDate?'cell-date':'');
  return '<td class="'+cls+'" title="'+esc(s)+'">'+esc(s)+'</td>';
}

function renderGrid(rows){
  const canWrite=writable.has(cur);
  const g=document.getElementById('grid');
  if(!rows.length){
    g.innerHTML='<div class="empty-state">'+
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>'+
      '<h3>No records found</h3><p>'+(currentRows.length?'No records match your filter in this view.':'This collection contains no data rows.')+'</p></div>';
    return;
  }

  let h='<table class="data-table"><thead><tr>';
  h+='<th class="num-col">#</th>';
  if(canWrite) h+='<th class="act-col">Actions</th>';
  for(const c of activeColumns){
    const isSorted=sortCol===c;
    const arrow=isSorted?(sortAsc?'▲':'▼'):'';
    h+='<th data-col="'+esc(c)+'"><div class="th-content"><span>'+esc(c)+'</span><span class="sort-arrow">'+arrow+'</span></div></th>';
  }
  h+='</tr></thead><tbody>';

  rows.forEach((r,i)=>{
    h+='<tr data-idx="'+i+'">';
    h+='<td class="num-col">'+(skip+i+1)+'</td>';
    if(canWrite){
      h+='<td class="act-col"><div class="row-actions">'+
        '<button class="row-act-btn edit" data-idx="'+i+'" title="Edit record">'+
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>'+
        '</button>'+
        '<button class="row-act-btn del" data-idx="'+i+'" title="Delete record">'+
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>'+
        '</button>'+
        '</div></td>';
    }
    for(const c of activeColumns){
      h+=formatCell(r[c], c);
    }
    h+='</tr>';
  });

  const ghostCount=Math.max(0, 15 - rows.length);
  for(let g=0; g<ghostCount; g++){
    h+='<tr class="ghost-row"><td class="num-col"></td>';
    if(canWrite) h+='<td class="act-col"></td>';
    for(let c=0; c<activeColumns.length; c++){
      h+='<td></td>';
    }
    h+='</tr>';
  }

  h+='</tbody></table>';
  g.innerHTML=h;

  g.querySelectorAll('th[data-col]').forEach(th=>{
    th.onclick=()=>{
      const col=th.dataset.col;
      if(sortCol===col){
        if(sortAsc) sortAsc=false;
        else { sortCol=null; sortAsc=true; }
      } else {
        sortCol=col;
        sortAsc=true;
      }
      filterAndSortRows();
    };
  });

  g.querySelectorAll('.row-act-btn.edit').forEach(b=>{
    b.onclick=()=>openEditor(rows[Number(b.dataset.idx)]);
  });

  g.querySelectorAll('.row-act-btn.del').forEach(b=>{
    b.onclick=async()=>{
      const row=rows[Number(b.dataset.idx)];
      if(!confirm('Delete this record?')) return;
      try {
        await send('DELETE', '/api/collections/'+encodeURIComponent(cur)+'/'+encodeURIComponent(row.id??row._id));
        toast('Record deleted');
        await loadList();
        await loadRows();
      } catch(e) {
        alert(e.message);
      }
    };
  });

  g.querySelectorAll('td.cell-obj').forEach(td=>{
    td.onclick=()=>{
      try {
        const val=JSON.parse(td.dataset.json);
        document.getElementById('jsonModalTitle').textContent='Inspect Object Value';
        document.getElementById('jsonModalPre').textContent=JSON.stringify(val, null, 2);
        document.getElementById('jsonModal').classList.add('on');
      } catch(e){}
    };
  });

  g.querySelectorAll('td.cell-id').forEach(td=>{
    td.onclick=()=>{
      const t=td.getAttribute('title')||td.textContent;
      navigator.clipboard.writeText(t).then(()=>toast('Copied ID to clipboard')).catch(()=>{});
    };
  });
}

function filterAndSortRows(){
  let rows=[...currentRows];
  const q=document.getElementById('rowSearch').value.toLowerCase().trim();
  if(q){
    rows=rows.filter(r=>Object.values(r).some(v=>v!==null&&v!==undefined&&String(typeof v==='object'?JSON.stringify(v):v).toLowerCase().includes(q)));
  }
  if(sortCol){
    rows.sort((a,b)=>{
      let va=a[sortCol], vb=b[sortCol];
      if(va===vb) return 0;
      if(va===null||va===undefined) return 1;
      if(vb===null||vb===undefined) return -1;
      if(typeof va==='string') return sortAsc?va.localeCompare(String(vb)):String(vb).localeCompare(va);
      return sortAsc?(va>vb?1:-1):(va<vb?1:-1);
    });
  }
  renderGrid(rows);
}

document.getElementById('rowSearch').oninput=(e)=>{
  document.getElementById('rowSearchClear').hidden=!e.target.value;
  filterAndSortRows();
};
document.getElementById('rowSearchClear').onclick=()=>{
  document.getElementById('rowSearch').value='';
  document.getElementById('rowSearchClear').hidden=true;
  filterAndSortRows();
};

async function loadRows(){
  const d=await api('/api/collections/'+encodeURIComponent(cur)+'?skip='+skip+'&limit='+LIMIT);
  document.getElementById('title').textContent=cur;
  document.getElementById('meta').textContent=d.total?(skip+1)+'–'+Math.min(skip+LIMIT,d.total)+' of '+d.total:'empty';
  document.getElementById('prev').disabled=skip===0;
  document.getElementById('next').disabled=skip+LIMIT>=d.total;
  
  const canWrite=writable.has(cur);
  document.getElementById('ins').hidden=!canWrite;
  document.getElementById('rowSearchWrap').hidden=false;

  const sbTbl=document.getElementById('sbTable');
  if(sbTbl) sbTbl.textContent=cur;
  const sbCnt=document.getElementById('sbCount');
  if(sbCnt) sbCnt.textContent=d.total?(d.total+' '+(d.total===1?'record':'records')):'0 records';
  const sbMd=document.getElementById('sbMode');
  if(sbMd) sbMd.textContent=canWrite?'read-write':'read-only';

  currentRows=d.rows;
  activeColumns=[...new Set(d.rows.flatMap(r=>Object.keys(r)))];
  filterAndSortRows();
}

async function loadStructure(){
  const d=await api('/api/collections/'+encodeURIComponent(cur)+'/structure');
  document.getElementById('title').textContent=cur;
  document.getElementById('meta').textContent=d.columns.length+' columns · '+d.indexes.length+' indexes';
  document.getElementById('prev').disabled=true;
  document.getElementById('next').disabled=true;
  document.getElementById('ins').hidden=true;
  document.getElementById('rowSearch').value='';
  document.getElementById('rowSearchWrap').hidden=true;

  const sbTbl=document.getElementById('sbTable');
  if(sbTbl) sbTbl.textContent=cur+' (schema)';
  const sbCnt=document.getElementById('sbCount');
  if(sbCnt) sbCnt.textContent=d.columns.length+' cols · '+d.indexes.length+' idx';

  let h='<div class="structure-wrap">'+
    '<div class="window-card">'+
    '<div class="code-bar">'+
      '<span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>'+
      '<span class="code-bar-label">COLUMNS ('+d.columns.length+')</span>'+
    '</div>'+
    '<table class="data-table" style="width:100%"><thead><tr><th>Column Name</th><th>Data Type</th><th>Nullable</th></tr></thead><tbody>';
  for(const c of d.columns){
    h+='<tr><td style="font-weight:600; color:var(--text)">'+esc(c.name)+'</td>'+
      '<td><span class="type-tag">'+esc(c.type)+'</span></td>'+
      '<td><span class="null-tag '+(c.nullable?'nullable':'not-null')+'">'+(c.nullable===undefined?'—':(c.nullable?'NULL':'NOT NULL'))+'</span></td></tr>';
  }
  h+='</tbody></table></div>'+
    '<div class="window-card">'+
    '<div class="code-bar">'+
      '<span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>'+
      '<span class="code-bar-label">INDEXES ('+d.indexes.length+')</span>'+
    '</div>'+
    '<table class="data-table" style="width:100%"><thead><tr><th>Index Name</th><th>Definition</th></tr></thead><tbody>';
  for(const idx of d.indexes){
    h+='<tr><td style="font-weight:600; color:var(--text)">'+esc(idx.name)+'</td>'+
      '<td style="color:var(--text-dim); font-family:var(--font-mono)">'+esc(idx.definition)+'</td></tr>';
  }
  h+='</tbody></table></div></div>';
  document.getElementById('grid').innerHTML=h;
}

function show(){
  document.getElementById('btnModeRows').classList.toggle('active', mode==='rows');
  document.getElementById('btnModeStructure').classList.toggle('active', mode==='structure');
  return mode==='rows'?loadRows():loadStructure();
}

document.getElementById('btnModeRows').onclick=()=>{
  if(mode==='rows') return;
  mode='rows';
  show();
};
document.getElementById('btnModeStructure').onclick=()=>{
  if(mode==='structure') return;
  mode='structure';
  show();
};
document.getElementById('btnRefresh').onclick=()=>show();
document.getElementById('prev').onclick=()=>{skip=Math.max(0,skip-LIMIT);loadRows();};
document.getElementById('next').onclick=()=>{skip+=LIMIT;loadRows();};
document.getElementById('ins').onclick=()=>openEditor(null);

function updateEditorForm(vals){
  const f=document.getElementById('edFormFields');
  f.innerHTML='';
  const keys=[...new Set([...Object.keys(vals), ...activeColumns.filter(c=>!SKIP.has(c))])];
  if(!keys.length){
    f.innerHTML='<div style="grid-column: span 2; color:var(--text-muted); padding:10px 0;">No editable fields</div>';
    return;
  }
  for(const k of keys){
    const l=document.createElement('div');
    l.className='form-label';
    l.textContent=k;
    const v=vals[k];
    const inp=document.createElement('input');
    inp.className='form-input';
    inp.dataset.key=k;
    if(typeof v==='number') {
      inp.type='number';
      inp.value=v;
    } else if(typeof v==='boolean') {
      inp.type='text';
      inp.value=String(v);
      inp.placeholder='true / false';
    } else if(typeof v==='object'&&v!==null) {
      inp.type='text';
      inp.value=JSON.stringify(v);
    } else {
      inp.type='text';
      inp.value=v===undefined||v===null?'':String(v);
    }
    inp.oninput=syncFormToJson;
    f.appendChild(l);
    f.appendChild(inp);
  }
}

function syncFormToJson(){
  const f=document.getElementById('edFormFields');
  const res={};
  f.querySelectorAll('.form-input').forEach(inp=>{
    const k=inp.dataset.key;
    const raw=inp.value.trim();
    if(raw==='') return;
    if(raw==='true') res[k]=true;
    else if(raw==='false') res[k]=false;
    else if(raw==='null') res[k]=null;
    else if(!isNaN(Number(raw))&&inp.type==='number') res[k]=Number(raw);
    else if((raw.startsWith('{')&&raw.endsWith('}'))||(raw.startsWith('[')&&raw.endsWith(']'))){
      try { res[k]=JSON.parse(raw); } catch { res[k]=raw; }
    } else {
      res[k]=raw;
    }
  });
  document.getElementById('edText').value=JSON.stringify(res, null, 2);
}

function syncJsonToForm(){
  try {
    const v=JSON.parse(document.getElementById('edText').value);
    updateEditorForm(v);
    document.getElementById('edErr').classList.remove('on');
  } catch(e){
    document.getElementById('edErr').textContent='Not valid JSON: '+e.message;
    document.getElementById('edErr').classList.add('on');
  }
}

function openEditor(row){
  editing=row;
  const v={};
  if(row){
    for(const [k,x] of Object.entries(row)){
      if(!SKIP.has(k)) v[k]=x;
    }
  }
  document.getElementById('edTitle').textContent=row?'Edit '+cur+' #'+(row.id??row._id):'New record in '+cur;
  document.getElementById('edText').value=JSON.stringify(v, null, 2);
  updateEditorForm(v);
  document.getElementById('edErr').classList.remove('on');
  document.getElementById('edDel').hidden=!row;
  setEditorTab('form');
  document.getElementById('ed').classList.add('on');
}

function closeEditor(){
  document.getElementById('ed').classList.remove('on');
  editing=null;
}

function setEditorTab(tab){
  document.getElementById('edTabForm').classList.toggle('active', tab==='form');
  document.getElementById('edTabJson').classList.toggle('active', tab==='json');
  document.getElementById('edFormPanel').style.display=tab==='form'?'block':'none';
  document.getElementById('edJsonPanel').style.display=tab==='json'?'block':'none';
}

document.getElementById('edTabForm').onclick=()=>{
  syncJsonToForm();
  setEditorTab('form');
};
document.getElementById('edTabJson').onclick=()=>{
  syncFormToJson();
  setEditorTab('json');
};

document.getElementById('edClose').onclick=closeEditor;
document.getElementById('edCancel').onclick=closeEditor;

document.getElementById('edSave').onclick=async()=>{
  const err=document.getElementById('edErr');
  let v;
  try {
    v=JSON.parse(document.getElementById('edText').value);
  } catch(e){
    err.textContent='Not valid JSON: '+e.message;
    err.classList.add('on');
    return;
  }

  const base='/api/collections/'+encodeURIComponent(cur);
  try {
    if(editing){
      const ch={};
      for(const [k,x] of Object.entries(v)){
        if(JSON.stringify(x)!==JSON.stringify(editing[k])) ch[k]=x;
      }
      if(Object.keys(ch).length){
        await send('PATCH', base+'/'+encodeURIComponent(editing.id??editing._id), ch);
        toast('Record updated');
      }
    } else {
      await send('POST', base, v);
      toast('Record created');
    }
    closeEditor();
    await loadList();
    await loadRows();
  } catch(e){
    err.textContent=e.message+(e.issues?'\\n'+JSON.stringify(e.issues,null,2):'');
    err.classList.add('on');
  }
};

document.getElementById('edDel').onclick=async()=>{
  if(!confirm('Delete this record?')) return;
  try {
    await send('DELETE', '/api/collections/'+encodeURIComponent(cur)+'/'+encodeURIComponent(editing.id??editing._id));
    toast('Record deleted');
    closeEditor();
    await loadList();
    await loadRows();
  } catch(e){
    document.getElementById('edErr').textContent=e.message;
    document.getElementById('edErr').classList.add('on');
  }
};

document.getElementById('jsonModalClose').onclick=()=>document.getElementById('jsonModal').classList.remove('on');
document.getElementById('jsonModalCopy').onclick=()=>{
  navigator.clipboard.writeText(document.getElementById('jsonModalPre').textContent)
    .then(()=>toast('Copied JSON to clipboard')).catch(()=>{});
};

window.addEventListener('keydown', e=>{
  if(e.key==='Escape'){
    closeEditor();
    document.getElementById('jsonModal').classList.remove('on');
  }
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){
    if(document.getElementById('ed').classList.contains('on')){
      document.getElementById('edSave').click();
    }
  }
});

loadList().catch(e=>{
  document.getElementById('grid').innerHTML='<div class="empty-state"><h3>Error loading database</h3><p>'+esc(e.message)+'</p></div>';
});
</script>
</body>
</html>`;
