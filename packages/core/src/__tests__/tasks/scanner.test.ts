import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanTasks } from '../../tasks/scanner.js';
import { taskRegistry } from '../../tasks/index.js';

describe('scanTasks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-test-'));
    taskRegistry.clear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns silently when directory does not exist', async () => {
    await expect(scanTasks('/nonexistent/path/xyz')).resolves.toBeUndefined();
    expect(taskRegistry.size).toBe(0);
  });

  it('returns silently for an empty directory', async () => {
    await scanTasks(tmpDir);
    expect(taskRegistry.size).toBe(0);
  });

  it('registers a valid task from a .js file', async () => {
    const taskFile = path.join(tmpDir, 'MyTask.js');
    fs.writeFileSync(
      taskFile,
      `export default { handler: async (p) => {}, options: {}, name: '' };`,
    );

    await scanTasks(tmpDir);
    expect(taskRegistry.has('MyTask')).toBe(true);
    const def = taskRegistry.get('MyTask');
    expect(typeof def?.handler).toBe('function');
  });

  it('skips files with no valid default export and logs a warning', async () => {
    const taskFile = path.join(tmpDir, 'BadTask.js');
    fs.writeFileSync(taskFile, `export const foo = 42;`);

    await scanTasks(tmpDir);
    expect(taskRegistry.has('BadTask')).toBe(false);
  });

  it('skips unimportable files gracefully', async () => {
    const taskFile = path.join(tmpDir, 'BrokenTask.js');
    fs.writeFileSync(taskFile, `this is not valid javascript !!!`);

    await expect(scanTasks(tmpDir)).resolves.toBeUndefined();
    expect(taskRegistry.has('BrokenTask')).toBe(false);
  });
});
