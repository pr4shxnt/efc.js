#!/usr/bin/env node
// Copies the framework documentation into a package's build output, so the published
// package carries the docs for its own version:
//
//   node scripts/bundle-docs.mjs <dest>      → <dest>/docs/**  (docs/ + Skills/efc → docs/skills)
//
// Used by express-file-cluster (dist/docs — agents read node_modules/express-file-cluster/
// dist/docs) and express-file-cluster-mcp (dist/docs — served over MCP).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = process.argv[2];
if (!dest) {
  console.error('usage: bundle-docs.mjs <dest-dir>');
  process.exit(1);
}
const out = path.resolve(process.cwd(), dest, 'docs');

function copyMarkdown(from, to) {
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) count += copyMarkdown(src, dst);
    else if (entry.name.endsWith('.md')) {
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(src, dst);
      count++;
    }
  }
  return count;
}

fs.rmSync(out, { recursive: true, force: true });
const docs = copyMarkdown(path.join(root, 'docs'), out);
const skills = copyMarkdown(path.join(root, 'Skills', 'efc'), path.join(out, 'skills'));
console.log(`bundled ${docs} docs + ${skills} skill cards → ${path.relative(process.cwd(), out)}`);
