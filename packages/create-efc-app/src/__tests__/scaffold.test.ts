import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { execFileSync } from 'node:child_process';
import { scaffold, NO_ADMIN_FEATURES, NO_USER_FEATURES } from '../scaffold.js';
import type { ScaffoldOptions } from '../scaffold.js';

// Regression test for a real bug found by actually running a fresh scaffold:
// `writeEntryPoint()` used to hardcode `cluster: ${opts.cluster}` into the generated
// src/index.ts. Selecting "Multi-core clustering" (the default) emitted a literal
// `cluster: true`, which always wins over ignite()'s own NODE_ENV-aware default — so
// `efc start dev` clustered too, contradicting the documented single-process dev
// guarantee. Fixed: omit `cluster` entirely when it's wanted; only emit an explicit
// `cluster: false` when opted out.

const dirs: string[] = [];

function tmpDest(name: string): string {
  const dir = path.join(
    os.tmpdir(),
    `efc-scaffold-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  dirs.push(dir);
  return dir;
}

function baseOptions(dest: string, cluster: boolean): ScaffoldOptions {
  return {
    projectName: dest,
    language: 'typescript',
    database: 'mongodb',
    authStrategy: 'http-only',
    cluster,
    tasks: true,
    taskBackend: 'bullmq',
    routeDocs: true,
    userPortal: false,
    adminPortal: false,
    userFeatures: NO_USER_FEATURES,
    adminFeatures: NO_ADMIN_FEATURES,
    rbac: false,
    mailer: false,
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.remove(d)));
});

describe('scaffold() — generated entrypoint cluster behavior', () => {
  it('omits `cluster` entirely when clustering is wanted, so ignite() dev/prod default applies', async () => {
    const dest = tmpDest('cluster-true');
    await scaffold(baseOptions(dest, true));
    const content = await fs.readFile(path.join(dest, 'src', 'index.ts'), 'utf8');

    expect(content).not.toMatch(/cluster:\s*true/);
    expect(content).not.toContain('cluster:');
  });

  it('emits an explicit `cluster: false` when clustering is opted out', async () => {
    const dest = tmpDest('cluster-false');
    await scaffold(baseOptions(dest, false));
    const content = await fs.readFile(path.join(dest, 'src', 'index.ts'), 'utf8');

    expect(content).toMatch(/cluster:\s*false/);
  });
});

describe('scaffold() — JavaScript projects', () => {
  // JS output was once untested and shipped TypeScript syntax in efc.config.js. Parse
  // every generated file with node --check, with every feature switched on.
  it('generates only syntactically valid JavaScript', async () => {
    const dest = tmpDest('js-syntax');
    const every = <T extends object>(flags: T): T =>
      Object.fromEntries(Object.keys(flags).map((k) => [k, true])) as T;
    await scaffold({
      ...baseOptions(dest, true),
      language: 'javascript',
      database: 'postgresql',
      taskBackend: 'pg-boss',
      userPortal: true,
      adminPortal: true,
      rbac: true,
      userFeatures: every(NO_USER_FEATURES),
      adminFeatures: every(NO_ADMIN_FEATURES),
    });

    const files: string[] = [path.join(dest, 'efc.config.js')];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(path.join(dest, 'src'));

    expect(files.filter((f) => f.endsWith('.ts'))).toEqual([]);
    const broken = files.filter((f) => {
      try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
        return false;
      } catch {
        return true;
      }
    });
    expect(broken.map((f) => path.relative(dest, f))).toEqual([]);
    expect(files.length).toBeGreaterThan(50);
  }, 60_000);
});

describe('scaffold() — AGENTS.md', () => {
  it('points agents at doc pages that really ship in express-file-cluster/dist/docs', async () => {
    const dest = tmpDest('agents');
    await scaffold(baseOptions(dest, true));
    const agents = await fs.readFile(path.join(dest, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('node_modules/express-file-cluster/dist/docs/');

    // Bundle the docs exactly like the core build does, then check every referenced page.
    const bundle = tmpDest('agents-docs');
    const root = path.resolve(import.meta.dirname, '../../../..');
    execFileSync('node', [path.join(root, 'scripts/bundle-docs.mjs'), bundle]);
    const pages = [
      ...agents.matchAll(
        /`(?:node_modules\/express-file-cluster\/dist\/docs\/)?([\w-]+(?:\/[\w-]+)*\.md)`/g,
      ),
    ].map((m) => m[1]!);
    expect(pages.length).toBeGreaterThan(8);
    for (const page of pages) {
      expect(fs.existsSync(path.join(bundle, 'docs', page)), page).toBe(true);
    }
  });
});

describe('scaffold() — model API', () => {
  const every = <T extends object>(flags: T): T =>
    Object.fromEntries(Object.keys(flags).map((k) => [k, true])) as T;
  const full = (dest: string, extra: Partial<ScaffoldOptions>): ScaffoldOptions => ({
    ...baseOptions(dest, true),
    userPortal: true,
    adminPortal: true,
    rbac: true,
    userFeatures: every(NO_USER_FEATURES),
    adminFeatures: every(NO_ADMIN_FEATURES),
    ...extra,
  });
  const read = (dest: string, ...p: string[]) => fs.readFileSync(path.join(dest, ...p), 'utf8');
  const allSource = (dest: string): string => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else out.push(fs.readFileSync(p, 'utf8'));
      }
    };
    walk(path.join(dest, 'src'));
    return out.join('\n');
  };

  it('PostgreSQL apps get defineTable models with foreign keys and relations', async () => {
    const dest = tmpDest('pg-table');
    await scaffold(full(dest, { database: 'postgresql', taskBackend: 'pg-boss' }));
    const user = read(dest, 'src', 'model', 'User.ts');
    expect(user).toContain("import { defineTable } from 'express-file-cluster';");
    expect(user).toContain("sessions: { hasMany: 'Session', foreignKey: 'user' }");
    expect(read(dest, 'src', 'model', 'Session.ts')).toMatch(
      /user: +\{ type: 'uuid', ref: 'User', required: true, onDelete: 'cascade' \}/,
    );
    expect(read(dest, 'src', 'model', 'Subscription.ts')).toMatch(
      /plan: +\{ type: 'uuid', ref: 'Plan', required: true \}/,
    );
    expect(read(dest, 'src', 'model', 'AuditLog.ts')).toMatch(
      /admin: +\{ type: 'uuid', ref: 'Admin', onDelete: 'setNull' \}/,
    );
    // The barrel registers every model and types `include`.
    const index = read(dest, 'src', 'model', 'index.ts');
    expect(index).toContain("export { User } from './User.js';");
    expect(index).toMatch(/interface Tables \{[\s\S]*User: typeof User;/);
    // Routes speak defineTable.
    const src = allSource(dest);
    expect(src).toContain('User.findFirst({ where: { email } })');
    expect(src).toContain('User.create({ data: {');
    expect(src).toContain('model.update({ where: { id }, data: {');
    expect(src).not.toMatch(/\bUser\.(findOne|findById)\(/);
    expect(src).not.toContain('${'.concat('db.'));
    // The init migration creates referenced tables first and drops them last.
    const init = read(dest, 'src', 'migrations', '00000000000000_init.ts');
    const order = /const models = \[(.*)\]/.exec(init)![1]!.split(', ');
    for (const [child, parent] of [
      ['Session', 'User'],
      ['Subscription', 'Plan'],
      ['Invoice', 'Subscription'],
      ['Blog', 'Admin'],
    ]) {
      expect(order.indexOf(parent!), `${parent} before ${child}`).toBeLessThan(
        order.indexOf(child!),
      );
    }
    expect(order).not.toContain('index');
  }, 60_000);

  it('keeps refs as plain ids when the target model is not generated', async () => {
    const dest = tmpDest('pg-table-admin-only');
    await scaffold(
      full(dest, {
        database: 'postgresql',
        taskBackend: 'pg-boss',
        userPortal: false,
        userFeatures: NO_USER_FEATURES,
        adminFeatures: { ...every(NO_ADMIN_FEATURES), userManagement: false },
      }),
    );
    // No User model: Notification keeps its userId string; Admin refs still apply.
    expect(fs.existsSync(path.join(dest, 'src', 'model', 'User.ts'))).toBe(false);
    expect(read(dest, 'src', 'model', 'Notification.ts')).toMatch(/userId: +\{ type: 'string'/);
    expect(read(dest, 'src', 'model', 'AuditLog.ts')).toContain("ref: 'Admin'");
    expect(read(dest, 'src', 'model', 'Admin.ts')).not.toContain("'Session'");
  }, 60_000);

  it('defineModel stays available on both engines', async () => {
    for (const extra of [
      { database: 'postgresql', taskBackend: 'pg-boss', modelApi: 'defineModel' },
      { database: 'mongodb', taskBackend: 'bullmq', modelApi: 'defineModel' },
    ] as const) {
      const dest = tmpDest(`model-${extra.database}`);
      await scaffold(full(dest, extra));
      const user = read(dest, 'src', 'model', 'User.ts');
      expect(user).toContain("import { defineModel } from 'express-file-cluster';");
      expect(user).not.toContain('relations');
      expect(read(dest, 'src', 'model', 'Session.ts')).toMatch(/userId: +\{ type: 'string'/);
      expect(fs.existsSync(path.join(dest, 'src', 'model', 'index.ts'))).toBe(false);
      const src = allSource(dest);
      expect(src).toContain('User.findOne({ email })');
      expect(src).toContain('model.update(id, {');
    }
  }, 60_000);

  it('MongoDB apps get defineCollection by default, with its query vocabulary', async () => {
    const dest = tmpDest('model-collection');
    await scaffold(full(dest, { database: 'mongodb', taskBackend: 'bullmq' }));
    const user = read(dest, 'src', 'model', 'User.ts');
    expect(user).toContain("import { defineCollection } from 'express-file-cluster';");
    expect(user).toContain("export const User = defineCollection('User', {");
    expect(fs.existsSync(path.join(dest, 'src', 'model', 'index.ts'))).toBe(false);
    const src = allSource(dest);
    expect(src).toContain('User.findOne({ email })');
    expect(src).toContain("model.findByIdAndUpdate(id, {");
    expect(src).toContain("{ returnDocument: 'after' })");
    expect(src).toContain('User.countDocuments(');
    expect(src).not.toMatch(/\bUser\.(update|delete|count)\(/);
    expect(read(dest, 'AGENTS.md')).toContain('`defineCollection` models (MongoDB-native');
  }, 60_000);
});
