// HTTP journey against a running app: health → register → login → /me → logout → replay.
const base = process.argv[2];
const ok = (cond, msg) => { if (!cond) { console.error('FAIL', msg); process.exit(1); } console.log('ok  ', msg); };
const start = Date.now();
for (;;) {
  try { if ((await fetch(base + '/health')).ok) break; } catch {}
  if (Date.now() - start > 40000) { console.error('FAIL server never healthy'); process.exit(1); }
  await new Promise((r) => setTimeout(r, 300));
}
ok((await (await fetch(base + '/health')).json()).status === 'OK', 'health');
const email = `u${Date.now()}@example.com`;
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
ok((await post('/auth/register', { name: 'Ada', email, password: 'secret-pass-123' })).status === 201, 'register');
const login = await post('/auth/login', { email, password: 'secret-pass-123' });
ok(login.status === 200, 'login');
const cookie = login.headers.get('set-cookie');
ok((await fetch(base + '/auth/me', { headers: { cookie } })).status === 200, '/me with cookie');
ok((await fetch(base + '/auth/me')).status === 401, '/me without cookie → 401');
ok((await post('/auth/logout', {}, { cookie })).status === 200, 'logout');
let all401 = true;
for (let i = 0; i < 6; i++) all401 &&= (await fetch(base + '/auth/me', { headers: { cookie, connection: 'close' } })).status === 401;
ok(all401, 'replayed cookie after logout → 401 on every worker');
