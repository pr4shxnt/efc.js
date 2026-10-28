import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A globally installed `efc` must hand every command to the project's own
// express-file-cluster (its drivers, its single framework instance). Simulated with a
// project holding a separate copy of the package that reports a different version.
const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = path.join(CORE, 'dist', 'cli', 'index.js');

describe.skipIf(!fs.existsSync(CLI))('efc CLI — delegation to the project-local install', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function project(withLocalCopy: boolean): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-delegate-'));
    dirs.push(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'app', type: 'module' }),
    );
    if (withLocalCopy) {
      const local = path.join(root, 'node_modules', 'express-file-cluster');
      fs.mkdirSync(local, { recursive: true });
      fs.cpSync(path.join(CORE, 'dist'), path.join(local, 'dist'), { recursive: true });
      const pkg = JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8'));
      fs.writeFileSync(
        path.join(local, 'package.json'),
        JSON.stringify({ ...pkg, version: '9.9.9-local' }),
      );
      // What `npm install` would put next to it: the package's runtime dependencies. Take
      // core's own copy when npm nested it (a hoisted one may be another package's version).
      const repoModules = path.resolve(CORE, '..', '..', 'node_modules');
      for (const dep of Object.keys(pkg.dependencies as Record<string, string>)) {
        const nested = path.join(CORE, 'node_modules', dep);
        const source = fs.existsSync(nested) ? nested : path.join(repoModules, dep);
        fs.symlinkSync(source, path.join(root, 'node_modules', dep), 'dir');
      }
    }
    fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true });
    return root;
  }

  const efc = (cwd: string, ...args: string[]) =>
    execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' }).trim();

  it('runs the project’s own copy — also from a subdirectory', () => {
    const root = project(true);
    expect(efc(root, '--version')).toBe('9.9.9-local');
    expect(efc(path.join(root, 'src', 'deep'), '--version')).toBe('9.9.9-local');
  });

  it('runs itself when the project has no local install', () => {
    const own = JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8')).version;
    expect(efc(project(false), '--version')).toBe(own);
  });

  it('passes the exit code through', () => {
    const root = project(true);
    let status = 0;
    try {
      efc(root, 'build', 'nonsense');
    } catch (err) {
      status = (err as { status: number }).status;
    }
    expect(status).toBe(1);
  });
});
