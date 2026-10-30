import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import crypto from 'node:crypto';
import { scaffold, NO_ADMIN_FEATURES, NO_USER_FEATURES } from '../scaffold.js';
import { VARIANTS, registryOptions } from '../registry.js';
import { hashPassword, verifyPassword } from 'express-file-cluster/auth';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.remove(dir)));
});

interface Reply {
  statusCode: number;
  body?: unknown;
  cleared: string[];
  status(code: number): Reply;
  json(body: unknown): Reply;
  clearCookie(name: string): void;
  cookie(name: string, value: string, options?: unknown): void;
}
function reply(): Reply {
  return {
    statusCode: 200,
    cleared: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    cookie() {},
    clearCookie(name) {
      this.cleared.push(name);
    },
  };
}
interface Route {
  middlewares: unknown[];
  meta: Record<string, { response: { status: number } }>;
  [method: string]: unknown;
}
type Handler = (req: { body?: unknown }, res: Reply) => Promise<unknown> | unknown;

// Execute the generated route, with only its database/auth dependencies supplied
// by the harness. Both JS and TS pass through the same compiler as app code.
function load(file: string, dependencies: Record<string, unknown>): Route {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', source)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected generated import: ${name}`);
    return dependencies[name];
  }, exports);
  return exports as Route;
}

for (const variant of VARIANTS) {
  describe(`generated account security — ${variant.key}`, () => {
    it('changes only the authenticated account after verifying its password and invalidates sessions', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'efc-account-security-'));
      dirs.push(dir);
      const opts = registryOptions(variant, ['account-security'], { projectName: dir });
      await scaffold(opts);
      let principal = { id: 'user-id', role: 'user' };
      const revokeAllSessions = vi.fn().mockResolvedValue(undefined);
      const user = {
        id: 'user-id',
        password: await hashPassword('old-user'),
        isActive: true,
        refreshToken: 'refresh-user',
      };
      const admin = {
        id: 'admin-id',
        password: await hashPassword('old-admin'),
        isActive: true,
        refreshToken: 'refresh-admin',
      };
      const model = (account: typeof user) => ({
        findById: vi.fn(async (id: string) => (id === account.id ? account : null)),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === account.id ? account : null,
        ),
        update: vi.fn(async (...args: unknown[]) => {
          const data =
            variant.modelApi === 'defineTable'
              ? (args[0] as { data: object }).data
              : (args[1] as object);
          Object.assign(account, data);
          return account;
        }),
        findByIdAndUpdate: vi.fn(async (_id: string, data: object) => {
          Object.assign(account, data);
          return account;
        }),
      });
      const User = model(user);
      const Admin = model(admin);
      const guard = () => {};
      const auth = {
        requireAuth: () => guard,
        getCurrentUser: () => principal,
        hashPassword,
        verifyPassword,
        revokeAllSessions,
      };
      const ext = variant.language === 'typescript' ? 'ts' : 'js';
      const route = load(path.join(dir, 'src/api/auth', `change-password.${ext}`), {
        'express-file-cluster/auth': auth,
        'express-file-cluster': { rateLimit: () => guard },
        '../../model/User.js': { User },
        '../../model/Admin.js': { Admin },
      });
      const POST = route.POST as Handler;
      for (const body of [
        undefined,
        { oldPassword: {}, newPassword: 'new' },
        { oldPassword: 'old-user', newPassword: [] },
      ]) {
        const res = reply();
        await POST({ body }, res);
        expect(res.statusCode).toBe(400);
      }
      const wrong = reply();
      await POST({ body: { oldPassword: 'wrong', newPassword: 'new-user' } }, wrong);
      expect(wrong.statusCode).toBe(401);
      expect(await verifyPassword('old-user', user.password)).toBe(true);
      expect(revokeAllSessions).not.toHaveBeenCalled();
      user.isActive = false;
      const suspended = reply();
      await POST({ body: { oldPassword: 'old-user', newPassword: 'new-user' } }, suspended);
      expect(suspended.statusCode).toBe(403);
      user.isActive = true;
      const success = reply();
      await POST({ body: { oldPassword: 'old-user', newPassword: 'new-user' } }, success);
      expect(success.statusCode).toBe(200);
      expect(await verifyPassword('new-user', user.password)).toBe(true);
      expect(await verifyPassword('old-user', user.password)).toBe(false);
      expect(user.refreshToken).toBe('');
      expect(revokeAllSessions).toHaveBeenCalledWith('user-id');
      expect(success.cleared).toContain('efc_refresh_token');
      expect(await verifyPassword('old-admin', admin.password)).toBe(true);
      principal = { id: 'admin-id', role: 'admin' };
      const adminSuccess = reply();
      await POST({ body: { oldPassword: 'old-admin', newPassword: 'new-admin' } }, adminSuccess);
      expect(adminSuccess.statusCode).toBe(200);
      expect(await verifyPassword('new-admin', admin.password)).toBe(true);
      expect(revokeAllSessions).toHaveBeenCalledWith('admin-id');
      expect(admin.refreshToken).toBe('');
      revokeAllSessions.mockRejectedValueOnce(new Error('cache unavailable'));
      await expect(
        POST({ body: { oldPassword: 'new-admin', newPassword: 'another' } }, reply()),
      ).rejects.toThrow('cache unavailable');
    }, 30_000);

    it.each(['user', 'admin'])(
      'invalidates %s refresh credentials on logout and rejects stale password logins',
      async (kind) => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'efc-auth-race-'));
        dirs.push(dir);
        await scaffold(registryOptions(variant, ['account-security'], { projectName: dir }));
        const ext = variant.language === 'typescript' ? 'ts' : 'js';
        const account: Record<string, unknown> = {
          id: kind + '-id',
          email: kind + '@test.dev',
          role: kind,
          password: 'old-hash',
          isActive: true,
          twoFactorEnabled: false,
          refreshToken: 'copied-refresh',
          refreshTokenExpiry: new Date(Date.now() + 600000),
        };
        const table = variant.modelApi === 'defineTable';
        const model = (active: boolean) => ({
          findById: async () => (active ? { ...account } : null),
          findUnique: async () => (active ? { ...account } : null),
          findFirst: async ({ where }: { where: Record<string, unknown> }) =>
            active && Object.entries(where).every(([key, value]) => account[key] === value)
              ? { ...account }
              : null,
          findOne: async (where: Record<string, unknown>) =>
            active && Object.entries(where).every(([key, value]) => account[key] === value)
              ? { ...account }
              : null,
          updateMany: async (...args: unknown[]) => {
            const where = (table ? (args[0] as { where: object }).where : args[0]) as Record<
              string,
              unknown
            >;
            const data = (table ? (args[0] as { data: object }).data : args[1]) as object;
            const count =
              active &&
              Object.entries(where).every(([key, value]) =>
                typeof value === 'object' && value !== null && '$ne' in value
                  ? account[key] !== value.$ne
                  : account[key] === value,
              )
                ? 1
                : 0;
            if (count) Object.assign(account, data);
            return table
              ? { count }
              : variant.modelApi === 'defineCollection'
                ? { modifiedCount: count }
                : count;
          },
        });
        const User = model(kind === 'user');
        const Admin = model(kind === 'admin');
        const issueToken = vi.fn().mockResolvedValue('access');
        const verify = vi.fn().mockResolvedValue(true);
        const auth = {
          requireAuth: () => {},
          getCurrentUser: () => ({ id: account.id, role: kind }),
          issueToken,
          verifyPassword: verify,
          revokeSession: vi.fn().mockResolvedValue(undefined),
        };
        const common = {
          'node:crypto': crypto,
          'express-file-cluster': {
            HttpError: class extends Error {
              constructor(_status: number, message: string) {
                super(message);
              }
            },
            rateLimit: () => () => {},
          },
        };
        const library = load(path.join(dir, 'src/lib', `two-factor.${ext}`), {
          ...common,
          'express-file-cluster/tasks': { enqueue: async () => {} },
        });
        const deps = {
          ...common,
          'express-file-cluster/auth': auth,
          '../../model/User.js': { User },
          '../../model/Admin.js': { Admin },
          '../../lib/two-factor.js': library,
        };
        const route = (name: string) =>
          load(path.join(dir, 'src/api/auth', `${name}.${ext}`), deps).POST as (
            req: { body?: unknown; cookies?: Record<string, string> },
            res: Reply,
          ) => Promise<unknown>;
        const logout = route('logout');
        const refresh = route('refresh');
        const login = route('login');
        await logout({}, reply()); // Bearer logout also invalidates refresh without a cookie/body.
        expect(account.refreshToken).toBe('');
        const replay = reply();
        await refresh({ body: { refreshToken: 'copied-refresh' } }, replay);
        expect(replay.statusCode).toBe(401);
        expect(issueToken).not.toHaveBeenCalled();
        // Snapshot was read before the password change, but the DB CAS runs afterwards.
        verify.mockImplementationOnce(async () => {
          account.password = 'new-hash';
          return true;
        });
        await expect(
          login({ body: { email: account.email, password: 'old-password' } }, reply()),
        ).rejects.toThrow('Account security changed');
        expect(account.refreshToken).toBe('');
        expect(issueToken).not.toHaveBeenCalled();
        // Successful tokens carry the time from BEFORE verification, not token issuance.
        const before = Date.now();
        await login({ body: { email: account.email, password: 'new-password' } }, reply());
        const claims = issueToken.mock.calls[0]![1] as { efc_auth_at: number };
        expect(claims.efc_auth_at).toBeGreaterThanOrEqual(before);
        expect(claims.efc_auth_at).toBeLessThanOrEqual(Date.now());
        const rotated = reply();
        issueToken.mockClear();
        await refresh({ body: { refreshToken: account.refreshToken } }, rotated);
        expect(rotated.statusCode).toBe(200);
        expect(issueToken.mock.calls[0]![1]).toHaveProperty('efc_auth_at');
      },
    );

    it('returns 501 from unimplemented device-session handlers', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'efc-security-extension-'));
      dirs.push(dir);
      await scaffold({
        ...registryOptions(variant, ['account-security'], { projectName: dir }),
        routeDocs: true,
      });
      const ext = variant.language === 'typescript' ? 'ts' : 'js';
      const guard = () => {};
      for (const file of ['sessions/index', 'sessions/[id]']) {
        const route = load(path.join(dir, 'src/api/auth', `${file}.${ext}`), {
          'express-file-cluster/auth': { requireAuth: () => guard },
        });
        expect(route.middlewares).toHaveLength(1);
        for (const method of ['GET', 'POST', 'DELETE']) {
          if (typeof route[method] !== 'function') continue;
          const res = reply();
          await (route[method] as Handler)({ body: { code: 'anything' } }, res);
          expect(res.statusCode).toBe(501);
          expect(res.body).toMatchObject({ statusCode: 501 });
          expect(route.meta[method]!.response.status).toBe(501);
        }
      }
    });
  });
}

it('generates password changes without importing a missing Admin model in user-only apps', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'efc-user-security-'));
  dirs.push(dir);
  await scaffold({
    projectName: dir,
    language: 'javascript',
    database: 'mongodb',
    authStrategy: 'http-only',
    cluster: false,
    tasks: false,
    routeDocs: false,
    userPortal: true,
    adminPortal: false,
    userFeatures: { ...NO_USER_FEATURES, accountSecurity: true },
    adminFeatures: NO_ADMIN_FEATURES,
    rbac: false,
    mailer: false,
  });
  expect(fs.readFileSync(path.join(dir, 'src/api/auth/change-password.js'), 'utf8')).not.toContain(
    'Admin',
  );
});
