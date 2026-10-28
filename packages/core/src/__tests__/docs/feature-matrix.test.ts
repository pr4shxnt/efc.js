import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// docs/guides/feature-matrix.md cites a test for every row as `file: test name (prefix)`.
// Renaming or deleting a cited test must fail here, so the page can't go stale.
const here = path.dirname(fileURLToPath(import.meta.url));
const testsRoot = path.resolve(here, '..');
const doc = fs.readFileSync(path.resolve(here, '../../../../../docs/guides/feature-matrix.md'), 'utf8');

const citations = [...doc.matchAll(/`([\w./-]+\.test(?:-d)?\.ts): ([^`]+)`/g)].map((m) => ({
  file: m[1]!,
  name: m[2]!,
}));

describe('docs/guides/feature-matrix.md', () => {
  it('cites tests on every row', () => {
    const rows = doc.split('\n').filter((l) => /^\| [^-F|]/.test(l));
    expect(rows.length).toBeGreaterThan(25);
    for (const row of rows) expect(row, row).toMatch(/`[\w./-]+\.test(?:-d)?\.ts: /);
  });

  it('every cited test exists', () => {
    expect(citations.length).toBeGreaterThan(40);
    const missing = citations.filter(({ file, name }) => {
      const p = path.join(testsRoot, file);
      if (!fs.existsSync(p)) return true;
      // Type tests are proven by compiling; anything else by an it() starting with the name.
      if (file.endsWith('.test-d.ts')) return false;
      const src = fs.readFileSync(p, 'utf8').replace(/\\'/g, "'");
      return !src.includes(`it('${name}`) && !src.includes(`it("${name}`) && !src.includes(`it(\`${name}`);
    });
    expect(missing).toEqual([]);
  });
});
