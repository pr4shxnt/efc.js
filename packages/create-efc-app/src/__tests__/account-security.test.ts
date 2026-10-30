import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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
