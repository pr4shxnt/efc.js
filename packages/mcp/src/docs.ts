import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** One markdown page of the bundled EFC documentation. */
export interface DocPage {
  /** Path without `.md`, e.g. `guides/database`, `api-reference/db`, `skills/routing-rules`. */
  id: string;
  /** `efc://docs/<id>` */
  uri: string;
  /** First `#` heading. */
  title: string;
  /** First paragraph after the heading, one line. */
  summary: string;
  content: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the docs are: `dist/docs` in the published package (bundled at build time from
 * the repo's docs/ and Skills/efc), or the repo itself when running from source.
 */
export function defaultDocsDir(): string {
  const bundled = path.join(here, 'docs');
  if (fs.existsSync(bundled)) return bundled;
  const dist = path.join(here, '..', 'dist', 'docs');
  if (fs.existsSync(dist)) return dist;
  throw new Error(
    '[efc-mcp] bundled docs not found — build the package first (npm run build -w express-file-cluster-mcp)',
  );
}

function summaryOf(content: string): string {
  const lines = content.split('\n');
  const start = lines.findIndex((l) => l.startsWith('# ')) + 1;
  const para: string[] = [];
  for (const raw of lines.slice(start)) {
    const line = raw.trim();
    if (!line) {
      if (para.length) break;
      continue;
    }
    if (/^(#|```|\||---|>|- |\* |\d+\. )/.test(line)) {
      if (para.length) break;
      continue;
    }
    para.push(line);
  }
  const text = para.join(' ').replace(/\s+/g, ' ');
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

export function loadDocs(dir: string = defaultDocsDir()): DocPage[] {
  const pages: DocPage[] = [];
  const walk = (sub: string) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = path.posix.join(sub, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(path.join(dir, rel), 'utf8');
        const id = rel.replace(/\.md$/, '');
        const title = /^# (.+)$/m.exec(content)?.[1]?.trim() ?? id;
        pages.push({ id, uri: `efc://docs/${id}`, title, summary: summaryOf(content), content });
      }
    }
  };
  walk('');
  return pages.sort((a, b) => a.id.localeCompare(b.id));
}

/** Pages ranked by how well they match `query` (all terms must appear somewhere). */
export function searchDocs(
  pages: DocPage[],
  query: string,
  maxSnippets = 3,
): { page: DocPage; score: number; snippets: string[] }[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const results: { page: DocPage; score: number; snippets: string[] }[] = [];
  for (const page of pages) {
    const lower = page.content.toLowerCase();
    if (!terms.every((t) => lower.includes(t))) continue;
    let score = 0;
    for (const t of terms) {
      score += lower.split(t).length - 1;
      if (page.title.toLowerCase().includes(t)) score += 10;
      if (page.id.toLowerCase().includes(t)) score += 5;
    }
    const lines = page.content.split('\n');
    const snippets: string[] = [];
    for (let i = 0; i < lines.length && snippets.length < maxSnippets; i++) {
      if (terms.some((t) => lines[i]!.toLowerCase().includes(t))) {
        snippets.push(lines.slice(Math.max(0, i - 1), i + 2).join('\n'));
        i += 2;
      }
    }
    results.push({ page, score, snippets });
  }
  return results.sort((a, b) => b.score - a.score);
}
