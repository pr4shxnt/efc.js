import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import {
  generateEntityAuth,
  validateEntityName,
  type EfcJson,
} from '../../cli/registry.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

describe('custom auth entities', () => {
  describe('validateEntityName', () => {
    it('accepts valid single-word entity names', () => {
      const res = validateEntityName('merchant');
      expect(res).toEqual({
        pascal: 'Merchant',
        camel: 'merchant',
        slug: 'merchant',
      });
    });

    it('accepts PascalCase entity names', () => {
      const res = validateEntityName('Merchant');
      expect(res).toEqual({
        pascal: 'Merchant',
        camel: 'merchant',
        slug: 'merchant',
      });
    });

    it('normalises kebab-case and snake_case entity names', () => {
      const kebab = validateEntityName('delivery-partner');
      expect(kebab).toEqual({
        pascal: 'DeliveryPartner',
        camel: 'deliveryPartner',
        slug: 'delivery-partner',
      });

      const snake = validateEntityName('delivery_partner');
      expect(snake).toEqual({
        pascal: 'DeliveryPartner',
        camel: 'deliveryPartner',
        slug: 'delivery-partner',
      });
    });

    it('normalises mixed camelCase entity names', () => {
      const camel = validateEntityName('deliveryPartner');
      expect(camel).toEqual({
        pascal: 'DeliveryPartner',
        camel: 'deliveryPartner',
        slug: 'delivery-partner',
      });
    });

    it('rejects reserved built-in entities', () => {
      expect(validateEntityName('user')).toHaveProperty('error');
      expect(validateEntityName('User')).toHaveProperty('error');
      expect(validateEntityName('admin')).toHaveProperty('error');
      expect(validateEntityName('Admin')).toHaveProperty('error');
    });

    it('rejects invalid names', () => {
      expect(validateEntityName('')).toHaveProperty('error');
      expect(validateEntityName('   ')).toHaveProperty('error');
      expect(validateEntityName('123vendor')).toHaveProperty('error');
      expect(validateEntityName('vendor@hub')).toHaveProperty('error');
    });
  });

  describe('generateEntityAuth (TypeScript + defineTable + PostgreSQL)', () => {
    it('scaffolds model, routes, index, and efc.json tracking', () => {
      const dir = tmp('efc-entity-test-ts-');
      const cfg: EfcJson = {
        registry: '0.9.0',
        language: 'typescript',
        database: 'postgresql',
        modelApi: 'defineTable',
        tasks: 'pg-boss',
        items: ['auth'],
        files: {},
      };

      // Create model index file
      fs.mkdirpSync(path.join(dir, 'src', 'model'));
      fs.writeFileSync(
        path.join(dir, 'src', 'model', 'index.ts'),
        `import type { User } from './User.js';\nexport { User } from './User.js';\n\nexport interface Tables {\n  User: typeof User;\n}\n`,
      );
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'test-app', dependencies: {}, devDependencies: {} }, null, 2),
      );
      fs.writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=postgres://localhost/test\n');

      const result = generateEntityAuth(dir, 'merchant', cfg);

      expect(result.written).toEqual([
        'src/model/Merchant.ts',
        'src/api/auth/merchant/register.ts',
        'src/api/auth/merchant/login.ts',
        'src/api/auth/merchant/logout.ts',
        'src/api/auth/merchant/me.ts',
      ]);
      expect(result.conflicts).toEqual([]);

      // Verify Model file
      const modelContent = fs.readFileSync(path.join(dir, 'src/model/Merchant.ts'), 'utf8');
      expect(modelContent).toContain("import { defineTable } from 'express-file-cluster';");
      expect(modelContent).toContain("export const Merchant = defineTable('Merchant', {");
      expect(modelContent).toContain("role:               { type: 'string',  required: true, default: 'merchant' },");

      // Verify Register route
      const registerContent = fs.readFileSync(path.join(dir, 'src/api/auth/merchant/register.ts'), 'utf8');
      expect(registerContent).toContain("import { Merchant } from '../../../model/Merchant.js';");
      expect(registerContent).toContain("Merchant.findFirst({ where: { email } })");
      expect(registerContent).toContain("Merchant.create({ data: { name, email, password: hashed } })");
      expect(registerContent).toContain("merchant: safe");

      // Verify Login route
      const loginContent = fs.readFileSync(path.join(dir, 'src/api/auth/merchant/login.ts'), 'utf8');
      expect(loginContent).toContain("import { issueToken, verifyPassword } from 'express-file-cluster/auth';");
      expect(loginContent).toContain("Merchant.findFirst({ where: { email } })");
      expect(loginContent).toContain("issueToken(res, { id: record.id, role: record.role, email: record.email })");
      expect(loginContent).toContain("Logged in as merchant");

      // Verify Logout route
      const logoutContent = fs.readFileSync(path.join(dir, 'src/api/auth/merchant/logout.ts'), 'utf8');
      expect(logoutContent).toContain("import { requireAuth, revokeSession } from 'express-file-cluster/auth';");
      expect(logoutContent).toContain("export const middlewares = [requireAuth];");

      // Verify Me route
      const meContent = fs.readFileSync(path.join(dir, 'src/api/auth/merchant/me.ts'), 'utf8');
      expect(meContent).toContain("export const middlewares = [requireAuth('merchant')];");

      // Verify model index updated
      const indexContent = fs.readFileSync(path.join(dir, 'src/model/index.ts'), 'utf8');
      expect(indexContent).toContain("export { Merchant } from './Merchant.js';");
      expect(indexContent).toContain("Merchant: typeof Merchant;");

      // Verify efc.json tracking
      expect(cfg.items).toContain('auth:merchant');
      expect(cfg.files['src/model/Merchant.ts']).toBeDefined();
      expect(cfg.files['src/api/auth/merchant/login.ts']).toBeDefined();

      // Passwords hash through express-file-cluster/auth — no bcrypt dependency
      const pkg = fs.readJsonSync(path.join(dir, 'package.json'));
      expect(pkg.dependencies?.['bcrypt']).toBeUndefined();
      expect(fs.readFileSync(path.join(dir, 'src/api/auth/merchant/login.ts'), 'utf8')).toContain('verifyPassword');

      // Verify JWT_SECRET added to .env
      const env = fs.readFileSync(path.join(dir, '.env'), 'utf8');
      expect(env).toContain('JWT_SECRET=');
    });

    it('respects dryRun option without writing to filesystem', () => {
      const dir = tmp('efc-entity-dryrun-');
      const cfg: EfcJson = {
        registry: '0.9.0',
        language: 'typescript',
        database: 'postgresql',
        modelApi: 'defineTable',
        tasks: 'pg-boss',
        items: [],
        files: {},
      };

      const result = generateEntityAuth(dir, 'driver', cfg, { dryRun: true });
      expect(result.written.length).toBe(5);
      expect(fs.existsSync(path.join(dir, 'src', 'model', 'Driver.ts'))).toBe(false);
      expect(cfg.items).toContain('auth:driver');
      expect(fs.existsSync(path.join(dir, 'efc.json'))).toBe(false);
    });

    it('handles existing files and overwrite option', () => {
      const dir = tmp('efc-entity-overwrite-');
      const cfg: EfcJson = {
        registry: '0.9.0',
        language: 'typescript',
        database: 'mongodb',
        modelApi: 'defineModel',
        tasks: null,
        items: [],
        files: {},
      };

      // Pre-create the model
      const modelPath = path.join(dir, 'src', 'model', 'Partner.ts');
      fs.mkdirpSync(path.dirname(modelPath));
      fs.writeFileSync(modelPath, '// custom partner model');

      // Run without overwrite
      const res1 = generateEntityAuth(dir, 'partner', cfg, { overwrite: false });
      expect(res1.conflicts).toContain('src/model/Partner.ts');
      expect(fs.readFileSync(modelPath, 'utf8')).toBe('// custom partner model');

      // Run with overwrite
      const res2 = generateEntityAuth(dir, 'partner', cfg, { overwrite: true });
      expect(res2.conflicts).toEqual([]);
      expect(res2.written).toContain('src/model/Partner.ts');
      expect(fs.readFileSync(modelPath, 'utf8')).toContain('defineModel');
    });
  });

  describe('generateEntityAuth (JavaScript + defineModel + MongoDB)', () => {
    it('scaffolds JavaScript files with defineModel and mongoose-style findOne/create', () => {
      const dir = tmp('efc-entity-js-');
      const cfg: EfcJson = {
        registry: '0.9.0',
        language: 'javascript',
        database: 'mongodb',
        modelApi: 'defineModel',
        tasks: null,
        items: ['auth'],
        files: {},
      };

      const result = generateEntityAuth(dir, 'delivery-partner', cfg);

      expect(result.written).toEqual([
        'src/model/DeliveryPartner.js',
        'src/api/auth/delivery-partner/register.js',
        'src/api/auth/delivery-partner/login.js',
        'src/api/auth/delivery-partner/logout.js',
        'src/api/auth/delivery-partner/me.js',
      ]);

      const model = fs.readFileSync(path.join(dir, 'src/model/DeliveryPartner.js'), 'utf8');
      expect(model).toContain("import { defineModel } from 'express-file-cluster';");
      expect(model).toContain("export const DeliveryPartner = defineModel('DeliveryPartner', {");
      expect(model).toContain("role:               { type: 'string',  required: true, default: 'delivery-partner' },");

      const register = fs.readFileSync(path.join(dir, 'src/api/auth/delivery-partner/register.js'), 'utf8');
      expect(register).not.toContain('import type');
      expect(register).toContain("DeliveryPartner.findOne({ email })");
      expect(register).toContain("DeliveryPartner.create({ name, email, password: hashed })");
      expect(register).toContain("deliveryPartner: safe");

      const me = fs.readFileSync(path.join(dir, 'src/api/auth/delivery-partner/me.js'), 'utf8');
      expect(me).toContain("export const middlewares = [requireAuth('delivery-partner')];");
    });
  });
});

it('custom-entity logout propagates revocation write failures', async () => {
  const dir = tmp('efc-entity-revocation-');
  try {
    generateEntityAuth(dir, 'merchant', {
      registry: '0.10.2',
      language: 'typescript',
      database: 'postgresql',
      modelApi: 'defineTable',
      tasks: 'pg-boss',
      items: ['auth'],
      files: {},
    });
    const source = fs.readFileSync(path.join(dir, 'src/api/auth/merchant/logout.ts'), 'utf8');
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports: { POST?: (req: object, res: object) => Promise<unknown> } = {};
    new Function('require', 'exports', js)(
      () => ({
        requireAuth: () => {},
        revokeSession: async () => {
          throw new Error('Redis write rejected');
        },
      }),
      exports,
    );
    let success = false;
    await expect(
      exports.POST!(
        {},
        {
          clearCookie() {},
          json() {
            success = true;
          },
        },
      ),
    ).rejects.toThrow('Redis write rejected');
    expect(success).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
