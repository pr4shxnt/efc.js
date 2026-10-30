/* eslint-disable @typescript-eslint/no-explicit-any -- execute generated JS/TS with controlled drivers */
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import ts from 'typescript';
import { scaffold } from '../scaffold.js';
import { VARIANTS, registryOptions } from '../registry.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.remove(dir)));
});
function evaluate(source: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: any[]) => Promise<unknown>> = {};
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  new Function('require', 'exports', js)((name: string) => {
    if (!(name in dependencies)) throw new Error('Unexpected import: ' + name);
    return dependencies[name];
  }, exports);
  return exports;
}
for (const variant of VARIANTS) {
  it.each(['user', 'admin'])(
    `${variant.key} atomically consumes %s reset links and invalidates refresh/challenge credentials`,
    async (kind) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'efc-reset-regression-'));
      dirs.push(dir);
      await scaffold(
        registryOptions(variant, ['forgot-password', 'account-security'], { projectName: dir }),
      );
      const ext = variant.language === 'typescript' ? 'ts' : 'js';
      const read = (file: string) =>
        fs.readFileSync(path.join(dir, 'src', file + '.' + ext), 'utf8');
      const account: Record<string, any> = {
        id: kind + '-one',
        email: 'one@test.dev',
        isActive: true,
        role: kind,
        password: 'old',
        resetToken: 'single-use',
        resetTokenExpiry: new Date(Date.now() + 600000),
        refreshToken: 'copied-refresh',
        refreshTokenExpiry: new Date(Date.now() + 600000),
        twoFactorEnabled: true,
        twoFactorMethod: 'totp',
        twoFactorSecret: 'active-encrypted',
        twoFactorPendingSecret: 'pending',
        twoFactorEmailHash: 'challenge',
      };
      const table = variant.modelApi === 'defineTable';
      const matches = (where: Record<string, any>) =>
        Object.entries(where).every(([key, value]) => {
          if (value && typeof value === 'object') {
            if ('$ne' in value) return account[key] !== value.$ne;
            return account[key] > (value.gt ?? value.$gt);
          }
          return account[key] === value;
        });
      const model = (active: boolean) => ({
        findOne: async (where: any) => (active && matches(where) ? { ...account } : null),
        findFirst: async ({ where }: any) => (active && matches(where) ? { ...account } : null),
        updateMany: async (...args: any[]) => {
          const { where, data } = table ? args[0] : { where: args[0], data: args[1] };
          const count = active && matches(where) ? 1 : 0;
          if (count) Object.assign(account, data);
          return table
            ? { count }
            : variant.modelApi === 'defineCollection'
              ? { modifiedCount: count }
              : count;
        },
      });
      const User = model(kind === 'user'),
        Admin = model(kind === 'admin');
      let hashes = 0;
      let release!: () => void;
      const bothHashing = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hashPassword = vi.fn(async (password: string) => {
        if (++hashes === 2) release();
        await bothHashing;
        return 'hash:' + password;
      });
      const revokeAllSessions = vi.fn().mockResolvedValue(undefined);
      const issueToken = vi.fn();
      const auth = { hashPassword, revokeAllSessions, issueToken };
      const lib = evaluate(read('lib/two-factor'), {
        'node:crypto': crypto,
        'express-file-cluster': {},
        'express-file-cluster/tasks': { enqueue: async () => {} },
      });
      const dependencies = {
        'node:crypto': crypto,
        'express-file-cluster/auth': auth,
        '../../model/User.js': { User },
        '../../model/Admin.js': { Admin },
        '../../lib/two-factor.js': lib,
      };
      const reset = evaluate(read('api/auth/reset-password'), dependencies).POST!;
      const refresh = evaluate(read('api/auth/refresh'), dependencies).POST!;
      const reply = () => ({
        statusCode: 200,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json() {},
        cookie() {},
      });
      const replies = [reply(), reply()];
      await Promise.all(
        replies.map((res, i) =>
          reset({ body: { token: 'single-use', password: 'replacement-' + i } }, res),
        ),
      );
      expect(replies.map((res) => res.statusCode).sort()).toEqual([200, 400]);
      expect(revokeAllSessions).toHaveBeenCalledTimes(1);
      expect(account.refreshToken).toBe('');
      expect(account.resetToken).toBe('');
      expect(account.twoFactorPendingSecret).toBe('');
      expect(account.twoFactorEmailHash).toBe('');
      expect(account.twoFactorEnabled).toBe(true);
      expect(account.twoFactorSecret).toBe('active-encrypted');
      const replay = reply();
      await refresh({ body: { refreshToken: 'copied-refresh' } }, replay);
      expect(replay.statusCode).toBe(401);
      expect(issueToken).not.toHaveBeenCalled();
      const saved = account.password;
      account.resetToken = 'expires-during-hash';
      account.resetTokenExpiry = new Date(Date.now() + 600000);
      hashPassword.mockImplementationOnce(async () => {
        account.resetTokenExpiry = new Date(0);
        return 'late-hash';
      });
      const late = reply();
      await reset({ body: { token: 'expires-during-hash', password: 'late' } }, late);
      expect(late.statusCode).toBe(400);
      expect(account.password).toBe(saved);
      const empty = reply();
      await reset({ body: null }, empty);
      expect(empty.statusCode).toBe(400);
    },
  );
}
