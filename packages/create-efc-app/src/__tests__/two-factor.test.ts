import { it, expect, vi, afterEach, describe } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import ts from 'typescript';
import { scaffold } from '../scaffold.js';
import { VARIANTS, registryOptions, itemPrompts, envFromAnswers } from '../registry.js';
import { twoFactorLibrary } from '../two-factor.js';

const dirs: string[] = [];
const originalEnv = {
  key: process.env.TWO_FACTOR_KEY,
  method: process.env.TWO_FACTOR_METHOD,
  smtp: process.env.SMTP_HOST,
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const [name, value] of Object.entries({
    TWO_FACTOR_KEY: originalEnv.key,
    TWO_FACTOR_METHOD: originalEnv.method,
    SMTP_HOST: originalEnv.smtp,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await Promise.all(dirs.splice(0).map((dir) => fs.remove(dir)));
});

type Fn = (...args: never[]) => unknown;
function evaluate(source: string, dependencies: Record<string, unknown>): Record<string, Fn> {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)((name: string) => {
    if (!(name in dependencies)) throw new Error('Unexpected import: ' + name);
    return dependencies[name];
  }, exports);
  return exports;
}
class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
function library(
  table = false,
  collection = false,
  enqueue = vi.fn().mockResolvedValue(undefined),
) {
  return evaluate(twoFactorLibrary(true, table, collection), {
    'node:crypto': crypto,
    'express-file-cluster': { HttpError },
    'express-file-cluster/tasks': { enqueue },
  }) as unknown as {
    totp(secret: string, step: number): string;
    codeStep(secret: string, code: unknown, last?: number, now?: number): number | undefined;
    sealSecret(secret: string, identity: string): string;
    openSecret(secret: string, identity: string): string;
    sendEmailCode(model: unknown, account: unknown, kind: string, purpose: string): Promise<void>;
    consumeEmailCode(
      model: unknown,
      account: unknown,
      kind: string,
      purpose: string,
      code: unknown,
    ): Promise<boolean>;
    acceptTwoFactor(
      model: unknown,
      account: unknown,
      kind: string,
      code: unknown,
      purpose?: string,
    ): Promise<boolean>;
  };
}
function response() {
  return {
    statusCode: 200,
    body: {} as Record<string, unknown>,
    cookies: [] as string[],
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set() {
      return this;
    },
    cookie(name: string) {
      this.cookies.push(name);
    },
    clearCookie() {},
    json(body: Record<string, unknown>) {
      this.body = body;
      return this;
    },
  };
}

type Handler = (
  req: { body?: Record<string, unknown> },
  res: ReturnType<typeof response>,
) => Promise<unknown>;

it('matches independent RFC 6238 SHA-1 vectors (six-digit truncation) and rejects malformed/replayed/expired codes', () => {
  const lib = library();
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  for (const [seconds, expected] of [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ] as const) {
    const step = Math.floor(seconds / 30);
    expect(lib.totp(secret, step)).toBe(expected);
    expect(lib.codeStep(secret, expected, -1, seconds * 1000)).toBe(step);
    expect(lib.codeStep(secret, expected, step, seconds * 1000)).toBeUndefined();
    expect(lib.codeStep(secret, expected, -1, (seconds + 120) * 1000)).toBeUndefined();
  }
  for (const value of [null, {}, 123456, '123', '1234567'])
    expect(lib.codeStep(secret, value)).toBeUndefined();
});

it('authenticates encrypted secrets and binds ciphertext to its account identity', () => {
  process.env.TWO_FACTOR_KEY = 'ab'.repeat(32);
  const lib = library();
  const encrypted = lib.sealSecret('SECRET', 'user:1');
  expect(encrypted).not.toContain('SECRET');
  expect(lib.openSecret(encrypted, 'user:1')).toBe('SECRET');
  expect(() => lib.openSecret(encrypted, 'admin:1')).toThrow();
  const bytes = Buffer.from(encrypted, 'base64url');
  bytes[30] = bytes[30]! ^ 1;
  expect(() => lib.openSecret(bytes.toString('base64url'), 'user:1')).toThrow();
  process.env.TWO_FACTOR_KEY = 'cd'.repeat(32);
  expect(() => lib.openSecret(encrypted, 'user:1')).toThrow();
  delete process.env.TWO_FACTOR_KEY;
  expect(() => lib.sealSecret('SECRET', 'user:1')).toThrow('TWO_FACTOR_KEY');
});

it('exposes init/add options for TOTP, email OTP, or both', () => {
  const prompts = itemPrompts(['account-security']);
  const prompt = prompts.find((q) => q.name === 'TWO_FACTOR_METHOD');
  expect(prompt?.options?.map((o) => o.value)).toEqual(['totp', 'email', 'both']);
  expect(envFromAnswers(prompts, { TWO_FACTOR_METHOD: 'both' })).toMatchObject({
    TWO_FACTOR_METHOD: 'both',
  });
});

for (const variant of VARIANTS) {
  describe(variant.key, () => {
    it.each([
      { method: 'totp', kind: 'user' },
      { method: 'email', kind: 'user' },
      { method: 'totp', kind: 'admin' },
      { method: 'email', kind: 'admin' },
    ])(
      'enrolls $method for $kind, enforces login, rejects replay, and disables with credentials',
      async ({ method, kind }) => {
        process.env.TWO_FACTOR_KEY = 'ab'.repeat(32);
        process.env.TWO_FACTOR_METHOD = 'both';
        process.env.SMTP_HOST = 'mail.test';
        let now = 1700000000000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'efc-2fa-'));
        dirs.push(dir);
        await scaffold(
          registryOptions(variant, ['account-security', 'user-profile'], { projectName: dir }),
        );
        const enqueue = vi.fn().mockResolvedValue(undefined);
        const lib = library(
          variant.modelApi === 'defineTable',
          variant.modelApi === 'defineCollection',
          enqueue,
        );
        const account: Record<string, unknown> = {
          id: 'user-id',
          email: 'user@test.com',
          password: 'hashed',
          role: kind,
          isActive: true,
          twoFactorEnabled: false,
          twoFactorSecret: '',
          twoFactorPendingSecret: '',
          twoFactorLastStep: -1,
          refreshToken: 'old-refresh',
        };
        const matches = (where: Record<string, unknown>) =>
          Object.entries(where).every(([key, value]) => {
            if (value && typeof value === 'object') {
              const op = value as Record<string, number>;
              if ('$ne' in op) return account[key] !== op.$ne;
              return Number(account[key]) < (op.lt ?? op.$lt)!;
            }
            return account[key] === value;
          });
        const User = {
          findById: async () => ({ ...account }),
          findUnique: async () => ({ ...account }),
          findOne: async () => (kind === 'user' ? { ...account } : null),
          findFirst: async () => (kind === 'user' ? { ...account } : null),
          updateMany: async (...args: unknown[]) => {
            const where =
              variant.modelApi === 'defineTable'
                ? (args[0] as { where: Record<string, unknown> }).where
                : (args[0] as Record<string, unknown>);
            const data =
              variant.modelApi === 'defineTable'
                ? (args[0] as { data: object }).data
                : (args[1] as object);
            const count = matches(where) ? 1 : 0;
            if (count) Object.assign(account, data);
            return variant.modelApi === 'defineTable'
              ? { count }
              : variant.modelApi === 'defineCollection'
                ? { modifiedCount: count }
                : count;
          },
        };
        const Admin = {
          ...User,
          findFirst: async () => (kind === 'admin' ? { ...account } : null),
          findOne: async () => (kind === 'admin' ? { ...account } : null),
        };
        const issueToken = vi.fn(async (res: ReturnType<typeof response>) => {
          res.cookie('efc_token');
          return 'access-token';
        });
        const revokeAllSessions = vi.fn().mockResolvedValue(undefined);
        const auth = {
          requireAuth: () => {},
          getCurrentUser: () => ({ id: account.id, role: account.role }),
          verifyPassword: async (password: string) => password === 'password',
          issueToken,
          revokeAllSessions,
        };
        const shared = {
          'node:crypto': crypto,
          'express-file-cluster': { HttpError, rateLimit: () => () => {} },
          'express-file-cluster/auth': auth,
        };
        const ext = variant.language === 'typescript' ? 'ts' : 'js';
        const read = (file: string) =>
          fs.readFileSync(path.join(dir, `src/${file}.${ext}`), 'utf8');
        const setup = evaluate(read('api/auth/2fa/setup'), {
          ...shared,
          '../../../model/User.js': { User },
          '../../../model/Admin.js': { Admin },
          '../../../lib/two-factor.js': lib,
        });
        const disable = evaluate(read('api/auth/2fa/disable'), {
          ...shared,
          '../../../model/User.js': { User },
          '../../../model/Admin.js': { Admin },
          '../../../lib/two-factor.js': lib,
        });
        const login = evaluate(read('api/auth/login'), {
          ...shared,
          '../../model/User.js': { User },
          '../../model/Admin.js': { Admin },
          '../../lib/two-factor.js': lib,
        });
        const verify = evaluate(read('api/auth/2fa/verify'), { '../login.js': login });
        const run = async (route: Record<string, Fn>, body: Record<string, unknown>) => {
          const res = response();
          await (route.POST as unknown as Handler)({ body }, res);
          return res;
        };
        const sentCode = () =>
          String((enqueue.mock.calls.at(-1)![1] as { body: string }).body).match(
            /<b>(\d{6})<\/b>/,
          )![1]!;
        expect((await run(setup, { password: 'wrong', method })).statusCode).toBe(401);
        const begin = await run(setup, { password: 'password', method });
        expect(begin.statusCode).toBe(method === 'email' ? 202 : 200);
        expect(account.twoFactorEnabled).toBe(false);
        const secret = begin.body.secret as string;
        let code = method === 'totp' ? lib.totp(secret, Math.floor(now / 30000)) : sentCode();
        expect(
          (await run(setup, { password: 'password', method, code: 'xxxxxx' })).statusCode,
        ).toBe(400);
        expect((await run(setup, { password: 'password', method, code })).statusCode).toBe(200);
        expect(account.twoFactorEnabled).toBe(true);
        expect(account.twoFactorMethod).toBe(method);
        expect(account.refreshToken).toBe('');
        expect(revokeAllSessions).toHaveBeenCalledWith('user-id');
        expect((await run(login, { email: account.email, password: 'password' })).statusCode).toBe(
          401,
        );
        expect(issueToken).not.toHaveBeenCalled();
        now += 30000;
        code = method === 'totp' ? lib.totp(secret, Math.floor(now / 30000)) : sentCode();
        const attempts = await Promise.all([
          run(verify, { email: account.email, password: 'password', code }),
          run(verify, { email: account.email, password: 'password', code }),
        ]);
        expect(attempts.map((r) => r.statusCode).sort()).toEqual([200, 401]);
        const signed = attempts.find((r) => r.statusCode === 200)!;
        expect(signed.statusCode).toBe(200);
        expect(signed.cookies).toContain('efc_token');
        expect(issueToken).toHaveBeenCalledTimes(1);
        expect(
          (await run(login, { email: account.email, password: 'password', code })).statusCode,
        ).toBe(401);
        expect(issueToken).toHaveBeenCalledTimes(1);
        expect((await run(disable, { password: 'wrong', code })).statusCode).toBe(401);
        now += 30000;
        if (method === 'email') {
          expect((await run(disable, { password: 'password' })).statusCode).toBe(202);
          code = sentCode();
        } else code = lib.totp(secret, Math.floor(now / 30000));
        expect((await run(disable, { password: 'password', code })).statusCode).toBe(200);
        expect(account.twoFactorEnabled).toBe(false);
        expect(account.twoFactorSecret).toBe('');
        expect((await run(login, { email: account.email, password: 'password' })).statusCode).toBe(
          200,
        );
        const profile = evaluate(read('api/user/profile'), {
          ...shared,
          '../../model/User.js': { User },
        });
        const safe = response();
        await (profile.GET as unknown as (req: unknown, res: unknown) => Promise<void>)(
          { user: { id: account.id } },
          safe,
        );
        for (const field of [
          'password',
          'twoFactorSecret',
          'twoFactorPendingSecret',
          'twoFactorEmailHash',
          'twoFactorEmailPurpose',
          'refreshToken',
        ])
          expect(safe.body.user).not.toHaveProperty(field);
      },
      15000,
    );
  });
}

it('expires email codes, scopes them to purpose, invalidates resend codes, and rejects delivery failures', async () => {
  process.env.TWO_FACTOR_KEY = 'ab'.repeat(32);
  process.env.SMTP_HOST = 'mail.test';
  let now = 1700000000000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const lib = library(false, false, enqueue);
  const row: Record<string, unknown> = {
    id: '1',
    email: 'user@test.com',
    twoFactorEnabled: true,
    twoFactorMethod: 'email',
  };
  const model = {
    updateMany: async (where: Record<string, unknown>, data: object) => {
      if (
        !Object.entries(where).every(([key, value]) =>
          value && typeof value === 'object' && '$ne' in value
            ? row[key] !== (value as { $ne: unknown }).$ne
            : row[key] === value,
        )
      )
        return 0;
      Object.assign(row, data);
      return 1;
    },
  };
  const sentCode = () =>
    String((enqueue.mock.calls.at(-1)![1] as { body: string }).body).match(/<b>(\d{6})<\/b>/)![1]!;
  await lib.sendEmailCode(model, row, 'user', 'login');
  let code = sentCode();
  expect(row.twoFactorEmailHash).not.toBe(code);
  expect(await lib.consumeEmailCode(model, { ...row }, 'user', 'disable', code)).toBe(false);
  expect(await lib.consumeEmailCode(model, { ...row }, 'admin', 'login', code)).toBe(false);
  now += 300001;
  expect(await lib.consumeEmailCode(model, { ...row }, 'user', 'login', code)).toBe(false);
  await lib.sendEmailCode(model, row, 'user', 'login');
  code = sentCode();
  const snapshot = { ...row };
  expect(
    (
      await Promise.all([
        lib.consumeEmailCode(model, snapshot, 'user', 'login', code),
        lib.consumeEmailCode(model, snapshot, 'user', 'login', code),
      ])
    ).sort(),
  ).toEqual([false, true]);
  enqueue.mockRejectedValueOnce(new Error('mail queue unavailable'));
  await expect(lib.sendEmailCode(model, row, 'user', 'login')).rejects.toThrow(
    'mail queue unavailable',
  );
  expect(row.twoFactorEmailHash).toBe('');
  delete process.env.SMTP_HOST;
  await expect(lib.sendEmailCode(model, row, 'user', 'login')).rejects.toThrow('SMTP');
});
