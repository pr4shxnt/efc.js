// Writes model files from a plain description — shared by `efc db pull` (introspected
// PostgreSQL → defineTable, sampled MongoDB → defineCollection) and `efc import-prisma`.
import fs from 'node:fs';
import path from 'node:path';

export interface ModelSource {
  name: string;
  /** Field name → definition, in column order. */
  fields: [string, unknown][];
  /** defineTable options (empty keys are left out). */
  options: Record<string, unknown>;
  /** Comments put above the model — what couldn't be carried over. */
  notes: string[];
  /** Default `defineTable`. */
  api?: 'defineTable' | 'defineCollection';
  /** The table / collection it was pulled from. */
  table?: string;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (k: string) =>
  IDENT.test(k) ? k : `'${k.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function literal(v: unknown, indent: string): string {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'bigint') return `${v}n`;
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    const items = v.map((x) => literal(x, indent));
    const flat = `[${items.join(', ')}]`;
    return flat.length <= 80 && !flat.includes('\n')
      ? flat
      : `[\n${items.map((i) => `${indent}  ${i},`).join('\n')}\n${indent}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  if (entries.length === 0) return '{}';
  const flat = `{ ${entries.map(([k, x]) => `${key(k)}: ${literal(x, indent)}`).join(', ')} }`;
  if (flat.length <= 80 && !flat.includes('\n')) return flat;
  return `{\n${entries.map(([k, x]) => `${indent}  ${key(k)}: ${literal(x, `${indent}  `)},`).join('\n')}\n${indent}}`;
}

export function modelFile(model: ModelSource): string {
  const notes = model.notes.map((n) => `// ${n}\n`).join('');
  const fields = model.fields
    .map(([name, def]) => `    ${key(name)}: ${literal(def, '    ')},`)
    .join('\n');
  const options = Object.fromEntries(
    Object.entries(model.options).filter(
      ([, v]) =>
        v !== undefined && !(typeof v === 'object' && v !== null && Object.keys(v).length === 0),
    ),
  );
  const opts = Object.keys(options).length ? `\n  ${literal(options, '  ')},` : '';
  const api = model.api ?? 'defineTable';
  return `import { ${api} } from 'express-file-cluster';

${notes}export const ${model.name} = ${api}(
  '${model.name}',
  {
${fields}
  },${opts}
);
`;
}

/**
 * The barrel that registers every model and, in TypeScript, declares `Tables` for
 * `include` (defineTable only — `tables: false` for collections).
 */
export function modelIndex(
  names: string[],
  typescript: boolean,
  tables = true,
  /** Model → its module when that isn't `./<Model>.js`. */
  modules: Record<string, string> = {},
): string {
  const sorted = [...names].sort();
  const from = (n: string) => modules[n] ?? `./${n}.js`;
  const exports = sorted.map((n) => `export { ${n} } from '${from(n)}';`).join('\n');
  if (!typescript || !tables) return `${exports}\n`;
  return `${exports}

${sorted.map((n) => `import type { ${n} } from '${from(n)}';`).join('\n')}

// Types \`include\` results: relations name models by string, this maps the names to models.
declare module 'express-file-cluster' {
  interface Tables {
${sorted.map((n) => `    ${n}: typeof ${n};`).join('\n')}
  }
}
`;
}

/** A model already in the output directory: its name and the file that defines it. */
export interface ExistingModel {
  name: string;
  file: string;
}

/**
 * Writes the models (and index) into `dir`; existing files are kept unless `force`.
 * A model whose table an `existing` model already maps is never written to another file,
 * and a file name that differs from an existing one only in case is never written — on
 * macOS and Windows that would be the same file.
 */
export function writeModels(
  dir: string,
  models: ModelSource[],
  opts: {
    typescript: boolean;
    force?: boolean;
    /** Table / collection → the model in `dir` that already maps it. */
    existing?: Map<string, ExistingModel>;
  },
): { written: string[]; skipped: { file: string; reason: string }[] } {
  const ext = opts.typescript ? 'ts' : 'js';
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const skipped: { file: string; reason: string }[] = [];
  const entries = fs.readdirSync(dir);
  const put = (file: string, content: string): boolean => {
    const p = path.join(dir, file);
    const caseTwin = entries.find((e) => e !== file && e.toLowerCase() === file.toLowerCase());
    if (caseTwin) {
      skipped.push({ file: p, reason: `differs only in case from ${caseTwin} — kept` });
      return false;
    }
    if (fs.existsSync(p) && !opts.force) {
      skipped.push({ file: p, reason: 'exists — kept (--force overwrites)' });
      return true;
    }
    fs.writeFileSync(p, content);
    written.push(p);
    return true;
  };
  const indexed: string[] = [];
  const modules: Record<string, string> = {};
  for (const m of models) {
    const file = `${m.name}.${ext}`;
    const owner = m.table !== undefined ? opts.existing?.get(m.table) : undefined;
    if (owner && path.resolve(owner.file) !== path.resolve(dir, file)) {
      skipped.push({
        file: path.join(dir, file),
        reason: `${m.table} is already ${owner.name} in ${path.basename(owner.file)} — kept`,
      });
      if (path.dirname(path.resolve(owner.file)) === path.resolve(dir)) {
        indexed.push(owner.name);
        modules[owner.name] = `./${path.basename(owner.file).replace(/\.[mc]?[jt]s$/, '.js')}`;
      }
      continue;
    }
    if (put(file, modelFile(m))) indexed.push(m.name);
  }
  put(
    `index.${ext}`,
    modelIndex(
      [...new Set(indexed)],
      opts.typescript,
      models.some((m) => (m.api ?? 'defineTable') === 'defineTable'),
      modules,
    ),
  );
  return { written, skipped };
}

// ── Naming ───────────────────────────────────────────────────────────────────

export const pascal = (s: string) =>
  s
    .split(/[^A-Za-z0-9]+|_/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');

export const camel = (s: string) => {
  const p = pascal(s);
  return p ? p[0]!.toLowerCase() + p.slice(1) : s;
};

export const lcFirst = (s: string) => s[0]!.toLowerCase() + s.slice(1);

export function singular(word: string): string {
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + 'y';
  if (/(s|x|z|ch|sh)es$/i.test(word)) return word.slice(0, -2);
  if (/[^s]s$/i.test(word)) return word.slice(0, -1);
  return word;
}

export function plural(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + 'es';
  return word + 's';
}
