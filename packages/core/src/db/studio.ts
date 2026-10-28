import crypto from 'node:crypto';
import http from 'node:http';
import type { Connection } from 'mongoose';
import type { Pool } from 'pg';
import type { DatabaseEngine } from '../types.js';
import type { RegisteredModel, StudioWriter } from './engine.js';

// `efc db studio`: a data browser on 127.0.0.1 only. Read-only by default — it lists
// tables/collections and pages through their rows. With `--write`, rows can be inserted,
// edited and deleted, but only through the app's models (so validation, defaults and
// casting apply) and only by the page the studio served: every write must carry the
// random token embedded in that page and come from the studio's own origin.

interface Structure {
  /** PostgreSQL: the real columns. MongoDB: fields seen in a sample of documents. */
  columns: { name: string; type: string; nullable?: boolean }[];
  indexes: { name: string; definition: string }[];
}

interface Source {
  collections(): Promise<{ name: string; count: number }[]>;
  rows(name: string, skip: number, limit: number): Promise<{ rows: unknown[]; total: number }>;
  structure(name: string): Promise<Structure>;
}

function mongoSource(conn: Connection): Source {
  const db = conn.db!;
  return {
    async collections() {
      const cols = (await db.listCollections({}, { nameOnly: true }).toArray())
        .map((c) => c.name)
        .filter((n) => !n.startsWith('system.'))
        .sort();
      return Promise.all(
        cols.map(async (name) => ({
          name,
          count: await db.collection(name).estimatedDocumentCount(),
        })),
      );
    },
    async rows(name, skip, limit) {
      const col = db.collection(name);
      const [rows, total] = await Promise.all([
        col.find({}).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
        col.countDocuments(),
      ]);
      return { rows, total };
    },
    async structure(name) {
      const col = db.collection(name);
      const sample = await col.find({}).limit(200).toArray();
      const types = new Map<string, Set<string>>();
      for (const doc of sample) {
        for (const [k, v] of Object.entries(doc)) {
          const t =
            v === null
              ? 'null'
              : Array.isArray(v)
                ? 'array'
                : v instanceof Date
                  ? 'date'
                  : typeof v === 'object' && v.constructor?.name === 'ObjectId'
                    ? 'objectId'
                    : typeof v;
          (types.get(k) ?? types.set(k, new Set()).get(k)!).add(t);
        }
      }
      const indexes = await col.indexes().catch(() => []);
      return {
        columns: [...types].map(([n, t]) => ({ name: n, type: [...t].sort().join(' | ') })),
        indexes: indexes.map((i) => ({
          name: String(i.name),
          definition: `${i.unique ? 'unique ' : ''}${JSON.stringify(i.key)}${i.expireAfterSeconds !== undefined ? ` ttl ${i.expireAfterSeconds}s` : ''}`,
        })),
      };
    },
  };
}

function pgSource(pool: Pool): Source {
  const tables = async () =>
    (
      await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
      )
    ).rows.map((r) => r.table_name);
  const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
  return {
    async collections() {
      return Promise.all(
        (await tables()).map(async (name) => ({
          name,
          count: (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${q(name)}`))
            .rows[0]!.n,
        })),
      );
    },
    async rows(name, skip, limit) {
      // Only names that exist in information_schema are ever interpolated.
      if (!(await tables()).includes(name))
        throw Object.assign(new Error('Unknown table'), { status: 404 });
      const [rows, total] = await Promise.all([
        pool.query(`SELECT * FROM ${q(name)} LIMIT $1 OFFSET $2`, [limit, skip]),
        pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${q(name)}`),
      ]);
      return { rows: rows.rows, total: total.rows[0]!.n };
    },
    async structure(name) {
      if (!(await tables()).includes(name))
        throw Object.assign(new Error('Unknown table'), { status: 404 });
      const [columns, indexes] = await Promise.all([
        pool.query<{ name: string; type: string; nullable: boolean }>(
          `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = $1 AND n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
          [name],
        ),
        pool.query<{ name: string; definition: string }>(
          `SELECT indexname AS name, indexdef AS definition FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname`,
          [name],
        ),
      ]);
      return { columns: columns.rows, indexes: indexes.rows };
    },
  };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>EFC Studio</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0f1115;--panel:#161a21;--line:#262c36;--text:#e6e9ef;--dim:#8b93a3;--acc:#5cc8ff}
*{box-sizing:border-box}body{margin:0;font:13px/1.45 ui-sans-serif,system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;height:100vh}
aside{width:240px;border-right:1px solid var(--line);overflow:auto;background:var(--panel)}
aside h1{font-size:13px;margin:0;padding:14px 16px;border-bottom:1px solid var(--line);letter-spacing:.04em}
aside h1 span{color:var(--dim);font-weight:400}
aside button{display:flex;justify-content:space-between;width:100%;padding:8px 16px;border:0;background:none;color:var(--text);cursor:pointer;text-align:left;font:inherit}
aside button:hover,aside button.on{background:#1f2530}aside button small{color:var(--dim)}
main{flex:1;display:flex;flex-direction:column;min-width:0}
header{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--line)}
header b{font-size:14px}header .sp{flex:1}header button{background:#1f2530;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}
header button:disabled{opacity:.4;cursor:default}#meta{color:var(--dim)}
.wrap{overflow:auto;flex:1}table{border-collapse:collapse;width:max-content;min-width:100%}
th,td{border-bottom:1px solid var(--line);padding:6px 12px;text-align:left;vertical-align:top;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace;font-size:12px}
th{position:sticky;top:0;background:var(--panel);color:var(--dim);font-weight:500}
td.obj{color:var(--acc);cursor:pointer}td.null{color:var(--dim)}
.empty{padding:40px;color:var(--dim)}pre{white-space:pre-wrap;margin:0}
td.act button{background:none;border:0;color:var(--acc);cursor:pointer;font:inherit;padding:0}
#ed{position:fixed;inset:0;background:#000a;display:none;align-items:center;justify-content:center}
#ed.on{display:flex}#ed>div{background:var(--panel);border:1px solid var(--line);border-radius:8px;width:min(720px,94vw);padding:16px}
#ed textarea{width:100%;height:50vh;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:6px;font:12px/1.5 ui-monospace,monospace;padding:10px}
#ed .row{display:flex;gap:8px;margin-top:10px}#ed .row .sp{flex:1}#ed button{background:#1f2530;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:6px 12px;cursor:pointer}
#ed button.danger{border-color:#7a2b2b;color:#ff8a8a}#ed .err{color:#ff8a8a;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;margin-top:8px}
</style></head><body>
<aside><h1>EFC STUDIO <span id="engine"></span></h1><div id="list"></div></aside>
<main><header><b id="title">Select a table</b><span id="meta"></span><span class="sp"></span>
<button id="ins" hidden>+ Insert</button><button id="view" disabled>Structure</button><button id="prev" disabled>‹ Prev</button><button id="next" disabled>Next ›</button></header>
<div class="wrap" id="grid"><div class="empty">Select a table on the left.</div></div></main>
<div id="ed"><div><b id="edTitle"></b><textarea id="edText" spellcheck="false"></textarea><div class="err" id="edErr"></div>
<div class="row"><button class="danger" id="edDel">Delete</button><span class="sp"></span><button id="edCancel">Cancel</button><button id="edSave">Save</button></div></div></div>
<script>
const TOKEN=__EFC_TOKEN__;const LIMIT=50;let cur=null,skip=0,mode='rows',write=false,writable=new Set(),editing=null;
const SKIP=new Set(['_id','id','__v','createdAt','updatedAt']);
async function send(method,p,body){const r=await fetch(p,{method,headers:{'Content-Type':'application/json','X-EFC-Studio-Token':TOKEN},body:body===undefined?undefined:JSON.stringify(body)});
const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||r.statusText);e.issues=d.issues;throw e}return d}
function openEditor(row){editing=row;const v={};if(row)for(const[k,x]of Object.entries(row))if(!SKIP.has(k))v[k]=x;
document.getElementById('edTitle').textContent=row?'Edit '+cur+' '+(row.id??row._id):'Insert into '+cur;
document.getElementById('edText').value=JSON.stringify(v,null,2);document.getElementById('edErr').textContent='';
document.getElementById('edDel').hidden=!row;document.getElementById('ed').classList.add('on')}
function closeEditor(){document.getElementById('ed').classList.remove('on');editing=null}
document.getElementById('edCancel').onclick=closeEditor;
document.getElementById('edSave').onclick=async()=>{const err=document.getElementById('edErr');let v;
try{v=JSON.parse(document.getElementById('edText').value)}catch(e){err.textContent='Not valid JSON: '+e.message;return}
const base='/api/collections/'+encodeURIComponent(cur);
try{if(editing){const ch={};for(const[k,x]of Object.entries(v))if(JSON.stringify(x)!==JSON.stringify(editing[k]))ch[k]=x;
if(Object.keys(ch).length)await send('PATCH',base+'/'+encodeURIComponent(editing.id??editing._id),ch)}else await send('POST',base,v);
closeEditor();await loadList();await loadRows()}catch(e){err.textContent=e.message+(e.issues?'\\n'+JSON.stringify(e.issues,null,2):'')}};
document.getElementById('edDel').onclick=async()=>{if(!confirm('Delete this record?'))return;
try{await send('DELETE','/api/collections/'+encodeURIComponent(cur)+'/'+encodeURIComponent(editing.id??editing._id));closeEditor();await loadList();await loadRows()}
catch(e){document.getElementById('edErr').textContent=e.message}};
document.getElementById('ins').onclick=()=>openEditor(null);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(p){const r=await fetch(p);if(!r.ok)throw new Error((await r.json()).error);return r.json()}
async function loadList(){const d=await api('/api/collections');write=d.write;writable=new Set(d.collections.filter(c=>c.writable).map(c=>c.name));
document.getElementById('engine').textContent='· '+d.engine+(write?' · write':' · read-only');
const el=document.getElementById('list');el.innerHTML='';
for(const c of d.collections){const b=document.createElement('button');b.innerHTML=esc(c.name)+'<small>'+c.count+'</small>';
if(cur===c.name)b.classList.add('on');
b.onclick=()=>{cur=c.name;skip=0;[...el.children].forEach(x=>x.classList.remove('on'));b.classList.add('on');document.getElementById('view').disabled=false;show()};el.appendChild(b)}
if(!d.collections.length)el.innerHTML='<div class="empty">No tables yet.</div>'}
async function loadRows(){const d=await api('/api/collections/'+encodeURIComponent(cur)+'?skip='+skip+'&limit='+LIMIT);
document.getElementById('title').textContent=cur;
document.getElementById('meta').textContent=d.total?(skip+1)+'–'+Math.min(skip+LIMIT,d.total)+' of '+d.total:'empty';
document.getElementById('prev').disabled=skip===0;document.getElementById('next').disabled=skip+LIMIT>=d.total;
const canWrite=writable.has(cur);document.getElementById('ins').hidden=!canWrite;
const cols=[...new Set(d.rows.flatMap(r=>Object.keys(r)))];const g=document.getElementById('grid');
if(!d.rows.length){g.innerHTML='<div class="empty">No rows.</div>';return}
let h='<table><thead><tr>'+(canWrite?'<th></th>':'')+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>';
d.rows.forEach((r,i)=>{h+='<tr>'+(canWrite?'<td class="act"><button data-i="'+i+'" title="edit">✎</button></td>':'')+cols.map(c=>{const v=r[c];if(v===null||v===undefined)return '<td class="null">null</td>';
if(typeof v==='object'){const j=JSON.stringify(v);return '<td class="obj" title="click to expand" data-j="'+esc(j)+'">'+esc(j)+'</td>'}
return '<td title="'+esc(v)+'">'+esc(v)+'</td>'}).join('')+'</tr>'});
g.innerHTML=h+'</tbody></table>';
g.querySelectorAll('td.act button').forEach(b=>b.onclick=()=>openEditor(d.rows[Number(b.dataset.i)]));
g.querySelectorAll('td.obj').forEach(td=>td.onclick=()=>{td.innerHTML='<pre>'+esc(JSON.stringify(JSON.parse(td.dataset.j),null,2))+'</pre>';td.style.whiteSpace='normal';td.onclick=null})}
function show(){document.getElementById('view').textContent=mode==='rows'?'Structure':'Rows';if(mode!=='rows')document.getElementById('ins').hidden=true;return mode==='rows'?loadRows():loadStructure()}
async function loadStructure(){const d=await api('/api/collections/'+encodeURIComponent(cur)+'/structure');
document.getElementById('title').textContent=cur;document.getElementById('meta').textContent=d.columns.length+' columns · '+d.indexes.length+' indexes';
document.getElementById('prev').disabled=true;document.getElementById('next').disabled=true;
const row=(cells)=>'<tr>'+cells.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>';
document.getElementById('grid').innerHTML='<table><thead><tr><th>column</th><th>type</th><th>nullable</th></tr></thead><tbody>'+
d.columns.map(c=>row([c.name,c.type,c.nullable===undefined?'':String(c.nullable)])).join('')+'</tbody></table>'+
'<table style="margin-top:18px"><thead><tr><th>index</th><th>definition</th></tr></thead><tbody>'+d.indexes.map(i=>row([i.name,i.definition])).join('')+'</tbody></table>'}
document.getElementById('view').onclick=()=>{mode=mode==='rows'?'structure':'rows';skip=0;show()};
document.getElementById('prev').onclick=()=>{skip=Math.max(0,skip-LIMIT);loadRows()};
document.getElementById('next').onclick=()=>{skip+=LIMIT;loadRows()};
loadList().catch(e=>document.getElementById('grid').innerHTML='<div class="empty">'+esc(e.message)+'</div>');
</script></body></html>`;

/** Reads a JSON body (at most 1 MB). */
function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1_048_576) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
        if (!v || typeof v !== 'object' || Array.isArray(v))
          throw new Error('Expected a JSON object');
        resolve(v as Record<string, unknown>);
      } catch (err) {
        reject(Object.assign(new Error((err as Error).message), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Fields the database or the model own; never sent through a write. */
const SERVER_FIELDS = ['_id', 'id', '__v', 'createdAt', 'updatedAt'];

export function startStudio(
  engine: DatabaseEngine,
  client: unknown,
  port: number,
  options: { write?: boolean; models?: RegisteredModel[] } = {},
): Promise<{ server: http.Server; url: string }> {
  const source =
    engine === 'postgresql' ? pgSource(client as Pool) : mongoSource(client as Connection);
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));
  };
  const token = crypto.randomBytes(32).toString('hex');
  const page = PAGE.replace('__EFC_TOKEN__', JSON.stringify(options.write ? token : ''));

  // Table/collection name → the model that stores there (write mode only).
  let writers: Promise<Map<string, StudioWriter>> | undefined;
  const writerFor = async (name: string): Promise<StudioWriter | undefined> => {
    if (!options.write) return undefined;
    writers ??= (async () => {
      const map = new Map<string, StudioWriter>();
      for (const m of options.models ?? []) {
        if (!m.studio) continue;
        try {
          map.set(await m.studio.storage(), m.studio);
        } catch {
          /* a model for the other engine — not writable here */
        }
      }
      return map;
    })();
    return (await writers).get(name);
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Loopback binding alone doesn't stop DNS rebinding (a web page re-pointing its own
      // hostname at 127.0.0.1), so only answer requests addressed to a loopback host.
      const rawHost = req.headers.host ?? '';
      const host = rawHost.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
        return json(res, 403, { error: 'Studio only answers on localhost' });
      }
      if (req.method !== 'GET') {
        if (!options.write)
          return json(res, 405, { error: 'Studio is read-only (start it with --write)' });
        // CSRF: only the page this studio served knows the token, and a cross-site page
        // can't send the custom header without a CORS preflight this server never approves.
        const sent = String(req.headers['x-efc-studio-token'] ?? '');
        const ok =
          sent.length === token.length &&
          crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token)) &&
          req.headers.origin === `http://${rawHost}` &&
          String(req.headers['content-type'] ?? '').startsWith('application/json');
        if (!ok) return json(res, 403, { error: 'Missing or invalid studio token' });
      }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
        });
        return res.end(page);
      }
      if (req.method === 'GET' && url.pathname === '/api/collections') {
        const collections = await source.collections();
        return json(res, 200, {
          engine,
          write: !!options.write,
          collections: await Promise.all(
            collections.map(async (c) => ({ ...c, writable: !!(await writerFor(c.name)) })),
          ),
        });
      }
      const st = /^\/api\/collections\/([^/]+)\/structure$/.exec(url.pathname);
      if (req.method === 'GET' && st)
        return json(res, 200, await source.structure(decodeURIComponent(st[1]!)));
      const m = /^\/api\/collections\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const skip = Math.max(0, Number(url.searchParams.get('skip')) || 0);
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        return json(res, 200, await source.rows(decodeURIComponent(m[1]!), skip, limit));
      }

      // Writes — through the model only.
      const w = /^\/api\/collections\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if (w && req.method !== 'GET') {
        const name = decodeURIComponent(w[1]!);
        const id = w[2] !== undefined ? decodeURIComponent(w[2]) : undefined;
        const writer = await writerFor(name);
        if (!writer) {
          return json(res, 409, {
            error: `No model stores in "${name}" — studio writes go through your models (src/model)`,
          });
        }
        const body = req.method === 'DELETE' ? {} : await readJson(req);
        for (const k of SERVER_FIELDS) delete body[k];
        if (req.method === 'POST' && id === undefined)
          return json(res, 201, { record: await writer.create(body) });
        if (req.method === 'PATCH' && id !== undefined) {
          const record = await writer.update(id, body);
          return record ? json(res, 200, { record }) : json(res, 404, { error: 'Not found' });
        }
        if (req.method === 'DELETE' && id !== undefined) {
          const record = await writer.delete(id);
          return record ? json(res, 200, { record }) : json(res, 404, { error: 'Not found' });
        }
        return json(res, 405, { error: 'Method not allowed' });
      }
      json(res, 404, { error: 'Not found' });
    })().catch((err: Error & { status?: number; statusCode?: number; issues?: unknown }) =>
      json(res, err.status ?? err.statusCode ?? 500, {
        error: err.message,
        ...(err.issues !== undefined && { issues: err.issues }),
      }),
    );
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}
