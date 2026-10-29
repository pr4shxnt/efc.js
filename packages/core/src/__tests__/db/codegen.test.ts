import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeModels, type ModelSource } from '../../db/codegen.js';

const model = (name: string, table?: string): ModelSource => ({
  name,
  fields: [['action', { type: 'string' }]],
  options: {},
  notes: [],
  ...(table && { table }),
});

describe('writeModels', () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const setup = () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-codegen-'));
    fs.writeFileSync(path.join(dir, 'AuditLog.ts'), '// mine\n');
  };

  it('never writes a file whose name differs from an existing one only in case', () => {
    setup();
    for (const force of [false, true]) {
      const { written, skipped } = writeModels(dir, [model('Auditlog')], {
        typescript: true,
        force,
      });
      expect(written.map((f) => path.basename(f))).not.toContain('Auditlog.ts');
      expect(skipped[0]!.reason).toMatch(/differs only in case from AuditLog\.ts/);
    }
    expect(fs.readFileSync(path.join(dir, 'AuditLog.ts'), 'utf8')).toBe('// mine\n');
    expect(fs.readFileSync(path.join(dir, 'index.ts'), 'utf8')).not.toContain('Auditlog');
  });

  it('skips a table an existing model in another file already maps, even with force', () => {
    setup();
    const existing = new Map([
      ['audit_logs', { name: 'AuditLog', file: path.join(dir, 'AuditLog.ts') }],
    ]);
    const { written, skipped } = writeModels(dir, [model('Audit', 'audit_logs')], {
      typescript: true,
      force: true,
      existing,
    });
    expect(written.map((f) => path.basename(f))).toEqual(['index.ts']);
    expect(skipped[0]!.reason).toMatch(/audit_logs is already AuditLog in AuditLog\.ts/);
    expect(fs.readFileSync(path.join(dir, 'index.ts'), 'utf8')).toContain(
      "export { AuditLog } from './AuditLog.js';",
    );
  });

  it('overwrites the existing model in its own file with force', () => {
    setup();
    const existing = new Map([
      ['auditlogs', { name: 'AuditLog', file: path.join(dir, 'AuditLog.ts') }],
    ]);
    writeModels(dir, [model('AuditLog', 'auditlogs')], { typescript: true, force: true, existing });
    expect(fs.readFileSync(path.join(dir, 'AuditLog.ts'), 'utf8')).toContain("'AuditLog'");
  });
});
