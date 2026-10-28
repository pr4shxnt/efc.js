import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The feature registry behind `efc add` — shadcn-style: an item's files are copied into the
// app and belong to it from then on. The registry ships inside this package
// (dist/registry, rendered at build time by scripts/bundle-registry.mjs), so the items always
// match the installed framework version. `efc.json` records the app's variant, the installed
// items and a hash of every file efc wrote, so later adds can tell an untouched file
// (safe to update) from one the app has changed (left alone unless --overwrite).

export interface RegistryFile {
  path: string;
  content: string;
}

export interface RegistryEnvVar {
  key: string;
  value: string;
  example: string;
}

export interface RegistryItem {
  name: string;
  files: RegistryFile[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  env: RegistryEnvVar[];
}

/** A question asked when an item is added (see create-efc-app's registry.ts ItemPrompt). */
export interface ItemPrompt {
  name: string;
  message: string;
  type: 'text' | 'password' | 'select' | 'file';
  options?: { value: string; label: string; hint?: string; env?: Record<string, string> }[];
  default?: string;
  placeholder?: string;
  when?: Record<string, string>;
  required?: boolean;
  pattern?: string;
  patternMessage?: string;
  stripSpaces?: boolean;
  note?: string;
  /** Write the answer to this efc.config key instead of .env (e.g. `authStrategy`). */
  config?: string;
}

export interface RegistryIndexItem {
  name: string;
  aliases: string[];
  prompts: ItemPrompt[];
  title: string;
  description: string;
  group: string;
  registryDependencies: string[];
  replaces: string[];
  docs?: string;
  requiresTasks: boolean;
}

export interface RegistryIndex {
  version: string;
  variants: { key: string; language: string; database: string; modelApi: string }[];
  items: RegistryIndexItem[];
}

export interface EfcJson {
  /** Framework version whose registry last wrote files. */
  registry: string;
  language: 'typescript' | 'javascript';
  database: 'mongodb' | 'postgresql';
  modelApi: 'defineModel' | 'defineTable' | 'defineCollection';
  tasks: 'bullmq' | 'pg-boss' | null;
  items: string[];
  /** sha256 of every file as efc last wrote it. */
  files: Record<string, string>;
}

export const EFC_JSON = 'efc.json';

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** dist/registry of this package (or EFC_REGISTRY_DIR). */
export function registryDir(): string {
  const override = process.env['EFC_REGISTRY_DIR'];
  if (override) return path.resolve(override);
  // Walk up to this package's root: the CLI is bundled into dist/ (and chunks), tests run
  // from src/ — both sit under it.
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); ; dir = path.dirname(dir)) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      const { name } = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string };
      if (name === 'express-file-cluster') return path.join(dir, 'dist', 'registry');
    }
    if (path.dirname(dir) === dir) break;
  }
  throw new Error('Could not locate the express-file-cluster package (for its registry)');
}

export class Registry {
  readonly index: RegistryIndex;

  constructor(readonly dir: string = registryDir()) {
    const file = path.join(dir, 'index.json');
    if (!fs.existsSync(file)) {
      throw new Error(
        `The feature registry is missing (${file}) — reinstall express-file-cluster, or build it with \`npm run build\``,
      );
    }
    this.index = JSON.parse(fs.readFileSync(file, 'utf8')) as RegistryIndex;
  }

  has(name: string): boolean {
    return this.index.items.some((i) => i.name === name || i.aliases?.includes(name));
  }

  meta(name: string): RegistryIndexItem {
    const item = this.index.items.find((i) => i.name === name || i.aliases?.includes(name));
    if (!item) {
      const names = this.index.items.map((i) => i.name).join(', ');
      throw new Error(`Unknown item "${name}". Available: ${names}`);
    }
    return item;
  }

  item(variant: string, name: string): RegistryItem {
    const { name: file } = this.meta(name);
    return JSON.parse(
      fs.readFileSync(path.join(this.dir, variant, `${file}.json`), 'utf8'),
    ) as RegistryItem;
  }

  base(variant: string): RegistryFile[] {
    return (
      JSON.parse(fs.readFileSync(path.join(this.dir, variant, '_base.json'), 'utf8')) as {
        files: RegistryFile[];
      }
    ).files;
  }

  /** `names` plus their registry dependencies, dependencies first. */
  withDependencies(names: string[]): string[] {
    const out: string[] = [];
    const visit = (alias: string): void => {
      const name = this.meta(alias).name;
      if (out.includes(name)) return;
      for (const dep of this.meta(name).registryDependencies) visit(dep);
      out.push(name);
    };
    for (const name of names) visit(name);
    return out;
  }
}

export function variantOf(cfg: Pick<EfcJson, 'language' | 'database' | 'modelApi'>): string {
  const lang = cfg.language === 'typescript' ? 'ts' : 'js';
  if (cfg.database === 'mongodb')
    return cfg.modelApi === 'defineCollection' ? `${lang}-mongo-collection` : `${lang}-mongo`;
  return `${lang}-pg-${cfg.modelApi === 'defineTable' ? 'table' : 'model'}`;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function readEfcJson(cwd: string): EfcJson | undefined {
  const file = path.join(cwd, EFC_JSON);
  return fs.existsSync(file) ? readJson<EfcJson>(file) : undefined;
}

export function writeEfcJson(cwd: string, cfg: EfcJson): void {
  const files = Object.fromEntries(
    Object.entries(cfg.files).sort(([a], [b]) => a.localeCompare(b)),
  );
  fs.writeFileSync(
    path.join(cwd, EFC_JSON),
    JSON.stringify({ ...cfg, items: [...cfg.items].sort(), files }, null, 2) + '\n',
  );
}

/** Work out efc.json for an app that doesn't have one yet (made before 0.8, or by hand). */
export function detectProject(cwd: string, version: string): EfcJson {
  const pkgFile = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgFile)) throw new Error(`No package.json in ${cwd}`);
  const pkg = readJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(pkgFile);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  const language: EfcJson['language'] =
    fs.existsSync(path.join(cwd, 'src', 'index.ts')) ||
    fs.existsSync(path.join(cwd, 'tsconfig.json'))
      ? 'typescript'
      : 'javascript';

  let database: EfcJson['database'];
  if (deps['mongoose']) database = 'mongodb';
  else if (deps['pg']) database = 'postgresql';
  else {
    throw new Error(
      'Could not tell the database from package.json — install mongoose (MongoDB) or pg + drizzle-orm (PostgreSQL)',
    );
  }

  let modelApi: EfcJson['modelApi'] = database === 'postgresql' ? 'defineTable' : 'defineModel';
  const modelDir = path.join(cwd, 'src', 'model');
  if (database === 'mongodb' && fs.existsSync(modelDir)) {
    const sources = fs
      .readdirSync(modelDir)
      .filter((f) => /\.[jt]s$/.test(f))
      .map((f) => fs.readFileSync(path.join(modelDir, f), 'utf8'))
      .join('\n');
    if (/\bdefineCollection\(/.test(sources)) modelApi = 'defineCollection';
  }
  if (database === 'postgresql' && fs.existsSync(modelDir)) {
    const sources = fs
      .readdirSync(modelDir)
      .filter((f) => /\.[jt]s$/.test(f))
      .map((f) => fs.readFileSync(path.join(modelDir, f), 'utf8'))
      .join('\n');
    if (/\bdefineModel\(/.test(sources) && !/\bdefineTable\(/.test(sources))
      modelApi = 'defineModel';
  }

  const tasks = deps['bullmq'] ? 'bullmq' : deps['pg-boss'] ? 'pg-boss' : null;
  return { registry: version, language, database, modelApi, tasks, items: [], files: {} };
}

export type FileAction = 'create' | 'update' | 'skip-identical' | 'conflict' | 'overwrite';

export interface AddPlan {
  cfg: EfcJson;
  variant: string;
  /** Items to install, dependencies first. */
  items: string[];
  files: { path: string; content: string; action: FileAction; item: string }[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  env: RegistryEnvVar[];
  /** Questions for the env vars and config keys being added (deduplicated by name + condition). */
  prompts: ItemPrompt[];
  docs: { item: string; text: string }[];
  problems: string[];
}

export interface AddOptions {
  overwrite?: boolean;
}

/**
 * What `efc add <names>` would do. Items already installed are skipped unless named
 * explicitly (which re-adds them: untouched files are updated, changed ones conflict).
 */
export function planAdd(
  cwd: string,
  registry: Registry,
  names: string[],
  opts: AddOptions = {},
  cfg: EfcJson = readEfcJson(cwd) ?? detectProject(cwd, registry.index.version),
): AddPlan {
  const variant = variantOf(cfg);
  const named = names.map((n) => registry.meta(n).name);
  const items = registry
    .withDependencies(named)
    .filter((n) => named.includes(n) || !cfg.items.includes(n));
  const plan: AddPlan = {
    cfg,
    variant,
    items,
    files: [],
    dependencies: {},
    devDependencies: {},
    env: [],
    prompts: [],
    docs: [],
    problems: [],
  };

  const pkg = fs.existsSync(path.join(cwd, 'package.json'))
    ? readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
        path.join(cwd, 'package.json'),
      )
    : {};
  const envKeys = new Set([
    ...readEnvKeys(path.join(cwd, '.env')),
    ...readEnvKeys(path.join(cwd, '.env.example')),
  ]);
  const planned = new Map<string, string>();

  // A file that's already there is only replaced if efc wrote it and it hasn't changed since
  // (e.g. the base SendEmail stub the mailer replaces) — or with --overwrite.
  const addFile = (file: RegistryFile, item: string): void => {
    const prior = planned.get(file.path);
    if (prior !== undefined) {
      if (prior !== file.content)
        plan.problems.push(`${item} and another item both write ${file.path}`);
      return;
    }
    planned.set(file.path, file.content);
    const abs = path.join(cwd, file.path);
    let action: FileAction;
    if (!fs.existsSync(abs)) action = 'create';
    else {
      const local = fs.readFileSync(abs, 'utf8');
      if (local === file.content) action = 'skip-identical';
      else if (cfg.files[file.path] === sha256(local)) action = 'update';
      else if (opts.overwrite) action = 'overwrite';
      else action = 'conflict';
    }
    plan.files.push({ path: file.path, content: file.content, action, item });
  };

  const needsTasks = items.filter((n) => registry.meta(n).requiresTasks);
  if (needsTasks.length) {
    if (!cfg.tasks) {
      plan.problems.push(
        `${needsTasks.join(', ')} send email through the SendEmail task, which needs a task backend — set \`tasks\` in efc.config (bullmq or pg-boss) and record it in efc.json`,
      );
    }
    // Their routes enqueue SendEmail: bring the base stub along if the app has no such task.
    const ext = cfg.language === 'typescript' ? 'ts' : 'js';
    const sendEmail = `src/tasks/SendEmail.${ext}`;
    if (!items.includes('mailer') && !fs.existsSync(path.join(cwd, sendEmail))) {
      const stub = registry.base(variant).find((f) => f.path === sendEmail);
      if (stub) addFile(stub, 'base');
    }
  }

  for (const name of items) {
    const meta = registry.meta(name);
    const item = registry.item(variant, name);
    for (const file of item.files) addFile(file, name);
    for (const [dep, range] of Object.entries(item.dependencies)) {
      if (!pkg.dependencies?.[dep]) plan.dependencies[dep] = range;
    }
    for (const [dep, range] of Object.entries(item.devDependencies)) {
      if (!pkg.devDependencies?.[dep] && !pkg.dependencies?.[dep])
        plan.devDependencies[dep] = range;
    }
    for (const v of item.env) {
      if (!envKeys.has(v.key) && !plan.env.some((e) => e.key === v.key)) plan.env.push(v);
    }
    if (meta.docs) plan.docs.push({ item: name, text: meta.docs });
  }

  // Ask only about env vars that are being added; choices (lower-case) come along with them.
  // Config questions (`config`) belong to the item itself, so they're asked whenever it's added.
  const adding = new Set(plan.env.map((v) => v.key));
  for (const name of items) {
    const prompts = registry.meta(name).prompts ?? [];
    const sets = (p: ItemPrompt) =>
      isEnvName(p.name)
        ? adding.has(p.name)
        : (p.options ?? []).some((o) => Object.keys(o.env ?? {}).some((k) => adding.has(k))) ||
          prompts.some(
            (q) => isEnvName(q.name) && adding.has(q.name) && q.when?.[p.name] !== undefined,
          );
    for (const p of prompts) {
      const dup = plan.prompts.some(
        (q) => q.name === p.name && JSON.stringify(q.when) === JSON.stringify(p.when),
      );
      if (!dup && (p.config !== undefined || sets(p))) plan.prompts.push(p);
    }
  }
  return plan;
}

function readEnvKeys(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => /^([A-Za-z0-9_]+)=/.exec(l)?.[1])
    .filter((k): k is string => !!k);
}

function appendEnv(file: string, lines: string[]): void {
  if (lines.length === 0) return;
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const sep = existing === '' || existing.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, existing + sep + lines.join('\n') + '\n');
}

export interface AddResult {
  written: string[];
  skipped: string[];
  conflicts: string[];
  /** Model index changes that couldn't be applied automatically. */
  manual: string[];
  installNeeded: boolean;
}

const isEnvName = (name: string): boolean => /^[A-Z][A-Z0-9_]*$/.test(name);

export type PromptAnswers = Record<string, string>;

/** Whether a prompt applies, given the answers so far. */
export function promptApplies(p: ItemPrompt, answers: PromptAnswers): boolean {
  return Object.entries(p.when ?? {}).every(([k, v]) => answers[k] === v);
}

/** The default for a prompt, with `{{NAME}}` filled in from earlier answers. */
export function promptDefault(p: ItemPrompt, answers: PromptAnswers): string | undefined {
  return p.default?.replace(/\{\{(\w+)\}\}/g, (_, k: string) => answers[k] ?? '');
}

/**
 * Turns a raw answer into the value to store, or an error to re-ask with. `file` answers are
 * paths (relative to `cwd`): the file's contents are stored, newlines written as \n.
 */
export function normalizeAnswer(
  p: ItemPrompt,
  raw: string,
  cwd: string,
): { value: string } | { error: string } {
  let value = p.stripSpaces ? raw.replace(/\s/g, '') : raw.trim();
  if (!value) return p.required ? { error: 'Required' } : { value };
  if (p.type === 'file') {
    const file = path.resolve(cwd, value.replace(/^~(?=$|\/)/, process.env['HOME'] ?? '~'));
    if (!fs.existsSync(file)) return { error: `No such file: ${file}` };
    value = fs.readFileSync(file, 'utf8').trim();
  }
  if (p.pattern && !new RegExp(p.pattern).test(value)) {
    return { error: p.patternMessage ?? `Must match ${p.pattern}` };
  }
  if (p.type === 'file') value = value.replace(/\r?\n/g, '\\n');
  return { value };
}

/** Env values from the answers: answers named like env vars, plus what chosen options set. */
export function envFromAnswers(
  prompts: ItemPrompt[],
  answers: PromptAnswers,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const p of prompts) {
    if (!(p.name in answers) || !promptApplies(p, answers)) continue;
    if (isEnvName(p.name)) env[p.name] = answers[p.name]!;
    const chosen = p.options?.find((o) => o.value === answers[p.name]);
    Object.assign(env, chosen?.env ?? {});
  }
  return env;
}

/** efc.config values from the answers to `config` prompts. */
export function configFromAnswers(
  prompts: ItemPrompt[],
  answers: PromptAnswers,
): Record<string, string> {
  const config: Record<string, string> = {};
  for (const p of prompts) {
    if (p.config !== undefined && p.name in answers && promptApplies(p, answers)) {
      config[p.config] = answers[p.name]!;
    }
  }
  return config;
}

/**
 * Sets string values in efc.config.(ts|js) by rewriting their `key: '…'` line. Returns the
 * edits it couldn't make (no config file, or the key isn't a plain string literal there).
 */
export function setConfigValues(cwd: string, values: Record<string, string>): string[] {
  const entries = Object.entries(values);
  if (entries.length === 0) return [];
  const file = ['efc.config.ts', 'efc.config.js', 'efc.config.mjs']
    .map((f) => path.join(cwd, f))
    .find((f) => fs.existsSync(f));
  if (!file) return entries.map(([k, v]) => `efc.config: set \`${k}: '${v}'\``);
  let text = fs.readFileSync(file, 'utf8');
  const manual: string[] = [];
  for (const [key, value] of entries) {
    // Only a single plain `key: '…'` line is rewritten. Zero (computed, or removed) or several
    // (a nested object with the same key) → reported for a human instead of guessed.
    const re = new RegExp(`^(\\s*)${key}:\\s*(['"])[^'"\\n]*\\2`, 'gm');
    const found = text.match(re)?.length ?? 0;
    if (found === 1) text = text.replace(re, `$1${key}: '${value}'`);
    else manual.push(`${path.basename(file)}: set \`${key}: '${value}'\``);
  }
  fs.writeFileSync(file, text);
  return manual;
}

function envLine(key: string, value: string): string {
  if (!/[\s#"'`]/.test(value)) return `${key}=${value}`;
  return value.includes("'") ? `${key}="${value.replace(/"/g, '\\"')}"` : `${key}='${value}'`;
}

/**
 * Carry out a plan: write files, merge package.json and .env, update efc.json. `env` holds
 * the answers to the plan's prompts (`envFromAnswers`); other new vars get their defaults.
 * `config` (`configFromAnswers`) is written to efc.config; unanswered keys are left alone.
 */
export function applyAdd(
  cwd: string,
  plan: AddPlan,
  registry: Registry,
  env: Record<string, string> = {},
  config: Record<string, string> = {},
): AddResult {
  const result: AddResult = {
    written: [],
    skipped: [],
    conflicts: [],
    manual: [],
    installNeeded: false,
  };
  const cfg: EfcJson = { ...plan.cfg, files: { ...plan.cfg.files }, items: [...plan.cfg.items] };
  const newModels: string[] = [];

  for (const f of plan.files) {
    if (f.action === 'conflict') {
      result.conflicts.push(f.path);
      continue;
    }
    if (f.action === 'skip-identical') {
      result.skipped.push(f.path);
    } else {
      const abs = path.join(cwd, f.path);
      const existed = fs.existsSync(abs);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content);
      result.written.push(f.path);
      const model = /^src\/model\/([A-Za-z0-9_]+)\.[jt]s$/.exec(f.path)?.[1];
      if (model && model !== 'index' && !existed) newModels.push(model);
    }
    cfg.files[f.path] = sha256(f.content);
  }

  const pkgFile = path.join(cwd, 'package.json');
  if (
    fs.existsSync(pkgFile) &&
    (Object.keys(plan.dependencies).length || Object.keys(plan.devDependencies).length)
  ) {
    const pkg = readJson<Record<string, unknown>>(pkgFile);
    const sorted = (o: Record<string, string>) =>
      Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
    pkg['dependencies'] = sorted({
      ...(pkg['dependencies'] as Record<string, string>),
      ...plan.dependencies,
    });
    if (Object.keys(plan.devDependencies).length) {
      pkg['devDependencies'] = sorted({
        ...(pkg['devDependencies'] as Record<string, string>),
        ...plan.devDependencies,
      });
    }
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
    result.installNeeded = true;
  }

  const envFile = path.join(cwd, '.env');
  const exampleFile = path.join(cwd, '.env.example');
  appendEnv(
    envFile,
    plan.env
      .filter((v) => !readEnvKeys(envFile).includes(v.key))
      .map((v) => envLine(v.key, env[v.key] ?? v.value)),
  );
  if (fs.existsSync(exampleFile)) {
    appendEnv(
      exampleFile,
      plan.env
        .filter((v) => !readEnvKeys(exampleFile).includes(v.key))
        .map((v) => `${v.key}=${v.example}`),
    );
  }

  result.manual.push(...setConfigValues(cwd, config));

  if (cfg.modelApi === 'defineTable' && cfg.database === 'postgresql' && newModels.length) {
    result.manual.push(...registerModels(cwd, cfg.language, newModels));
  }

  for (const name of plan.items) if (!cfg.items.includes(name)) cfg.items.push(name);
  cfg.registry = registry.index.version;
  writeEfcJson(cwd, cfg);
  return result;
}

/**
 * Add models to src/model/index (defineTable apps): an export per model and, in TypeScript,
 * its entry in the `Tables` declaration. Returns the edits it couldn't make.
 */
export function registerModels(
  cwd: string,
  language: EfcJson['language'],
  models: string[],
): string[] {
  const ts = language === 'typescript';
  const file = path.join(cwd, 'src', 'model', `index.${ts ? 'ts' : 'js'}`);
  const rel = path.relative(cwd, file);
  if (!fs.existsSync(file)) {
    const names = [...models].sort();
    fs.writeFileSync(file, modelIndex(names, ts));
    return [];
  }
  let text = fs.readFileSync(file, 'utf8');
  const manual: string[] = [];
  for (const name of [...models].sort()) {
    const exportLine = `export { ${name} } from './${name}.js';`;
    if (!new RegExp(`export \\{ ${name} \\}`).test(text)) {
      text =
        insertAfterLast(text, /^export \{ [A-Za-z0-9_]+ \} from .*$/gm, exportLine) ??
        exportLine + '\n' + text;
    }
    if (!ts) continue;
    const importLine = `import type { ${name} } from './${name}.js';`;
    if (!text.includes(importLine)) {
      const next = insertAfterLast(text, /^import type \{ [A-Za-z0-9_]+ \} from .*$/gm, importLine);
      if (next) text = next;
      else manual.push(`${rel}: add \`${importLine}\``);
    }
    if (!new RegExp(`^\\s+${name}: typeof ${name};`, 'm').test(text)) {
      const m = /interface Tables \{\n/.exec(text);
      if (m) {
        const at = m.index + m[0].length;
        text = text.slice(0, at) + `    ${name}: typeof ${name};\n` + text.slice(at);
      } else manual.push(`${rel}: add \`${name}: typeof ${name};\` to \`interface Tables\``);
    }
  }
  fs.writeFileSync(file, text);
  return manual;
}

function insertAfterLast(text: string, re: RegExp, line: string): string | undefined {
  let last: RegExpExecArray | undefined;
  for (const m of text.matchAll(re)) last = m as RegExpExecArray;
  if (!last) return undefined;
  const at = last.index + last[0].length;
  return text.slice(0, at) + '\n' + line + text.slice(at);
}

/** The model index create-efc-app writes for defineTable apps. */
export function modelIndex(names: string[], ts: boolean): string {
  const exports = names.map((n) => `export { ${n} } from './${n}.js';`).join('\n');
  const tables = ts
    ? `
${names.map((n) => `import type { ${n} } from './${n}.js';`).join('\n')}

// Types \`include\` results: relations name models by string, this maps the names to models.
declare module 'express-file-cluster' {
  interface Tables {
${names.map((n) => `    ${n}: typeof ${n};`).join('\n')}
  }
}
`
    : '';
  return `// Every model, in one import: \`import { User } from '../model/index.js'\` also registers the
// models its relations reach, which \`include\` needs.
${exports}
${tables}`;
}

export type FileStatus = 'unchanged' | 'modified' | 'missing' | 'outdated' | 'outdated+modified';

/**
 * How an installed item's files compare with the registry: `modified` = changed in the app,
 * `outdated` = the registry's version differs from what efc wrote (an update is available).
 */
export function itemStatus(
  cwd: string,
  registry: Registry,
  cfg: EfcJson,
  name: string,
): { path: string; status: FileStatus; registry: string; local?: string }[] {
  return registry.item(variantOf(cfg), name).files.map((f) => {
    const abs = path.join(cwd, f.path);
    if (!fs.existsSync(abs))
      return { path: f.path, status: 'missing' as const, registry: f.content };
    const local = fs.readFileSync(abs, 'utf8');
    if (local === f.content)
      return { path: f.path, status: 'unchanged' as const, registry: f.content, local };
    const written = cfg.files[f.path];
    const modified = written !== sha256(local);
    const outdated = written !== undefined && written !== sha256(f.content);
    const status: FileStatus = outdated
      ? modified
        ? 'outdated+modified'
        : 'outdated'
      : 'modified';
    return { path: f.path, status, registry: f.content, local };
  });
}

/** A minimal unified-style line diff (LCS). */
export function lineDiff(a: string, b: string): string[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      out.push(`  ${x[i]}`);
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      out.push(`+ ${y[j]}`);
      j++;
    } else {
      out.push(`- ${x[i]}`);
      i++;
    }
  }
  // Keep changed lines with two lines of context.
  const keep = out.map((l, k) =>
    out.slice(Math.max(0, k - 2), k + 3).some((c) => !c.startsWith('  ')),
  );
  const shown: string[] = [];
  out.forEach((l, k) => {
    if (keep[k]) shown.push(l);
    else if (keep[k - 1]) shown.push('  …');
  });
  return shown;
}

// ── Custom auth entities ──────────────────────────────────────────────────────

const RESERVED_ENTITIES = new Set(['user', 'admin']);

function toPascal(s: string): string {
  const parts = s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
}

function toCamel(s: string): string {
  const p = toPascal(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function toSlug(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[-_\s]+/g, '-')
    .toLowerCase();
}

export interface ValidatedEntityName {
  pascal: string;
  camel: string;
  slug: string;
}

function validateEntityName(name: string): ValidatedEntityName | { error: string } {
  const raw = name.trim();
  if (!raw) return { error: 'Entity name cannot be empty' };
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(raw))
    return { error: `Entity name must be alphanumeric and start with a letter: "${raw}"` };
  const pascal = toPascal(raw);
  const camel = toCamel(raw);
  const slug = toSlug(raw);
  if (RESERVED_ENTITIES.has(slug) || RESERVED_ENTITIES.has(pascal.toLowerCase()))
    return { error: `"${pascal}" is a built-in entity — use \`efc add auth\` for User/Admin` };
  return { pascal, camel, slug };
}

/**
 * Whether the app uses `defineTable` (PostgreSQL-native queries).
 * Must match the `usesTables` logic in create-efc-app's scaffold.ts.
 */
function entityUsesTables(cfg: EfcJson): boolean {
  return cfg.database === 'postgresql' && cfg.modelApi === 'defineTable';
}

/** Code for model calls in the generated routes, adapting to defineModel vs defineTable. */
function entityOrm(cfg: EfcJson) {
  const t = entityUsesTables(cfg);
  return {
    findOne: (model: string, filter: string) =>
      t ? `${model}.findFirst({ where: ${filter} })` : `${model}.findOne(${filter})`,
    create: (model: string, data: string) =>
      t ? `${model}.create({ data: ${data} })` : `${model}.create(${data})`,
  };
}

function entityModelContent(pascal: string, slug: string, cfg: EfcJson): string {
  const api = entityUsesTables(cfg) ? 'defineTable' : 'defineModel';
  return `import { ${api} } from 'express-file-cluster';

export const ${pascal} = ${api}('${pascal}', {
  name:               { type: 'string',  required: true },
  email:              { type: 'string',  required: true, unique: true },
  password:           { type: 'string',  required: true },
  role:               { type: 'string',  required: true, default: '${slug}' },
  avatar:             { type: 'string' },
  isVerified:         { type: 'boolean', default: false },
  isActive:           { type: 'boolean', default: true },
  verifyToken:        { type: 'string' },
  resetToken:         { type: 'string' },
  resetTokenExpiry:   { type: 'date' },
  refreshToken:       { type: 'string' },
  refreshTokenExpiry: { type: 'date' },
});
`;
}

function entityRegisterContent(pascal: string, camel: string, cfg: EfcJson): string {
  const ts = cfg.language === 'typescript';
  const db = entityOrm(cfg);
  const typedArgs = ts ? '(req: Request, res: Response)' : '(req, res)';
  const typeImport = ts ? "import type { Request, Response } from 'express';\n" : '';
  return `${typeImport}import { hashPassword } from 'express-file-cluster/auth';
import { ${pascal} } from '../../../model/${pascal}.js';

export const POST = async ${typedArgs} => {
  const { name, email, password } = req.body;
  // Strings only: an object such as {"$ne": null} would be read as a filter operator and match any account.
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string' || !name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  const existing = await ${db.findOne(pascal, '{ email }')};
  if (existing) return res.status(409).json({ error: 'Email already in use' });
  const hashed = await hashPassword(password);
  const record = await ${db.create(pascal, '{ name, email, password: hashed }')};
  const { password: _, ...safe } = record;
  res.status(201).json({ message: '${pascal} account created', ${camel}: safe });
};
`;
}

function entityLoginContent(pascal: string, slug: string, cfg: EfcJson): string {
  const ts = cfg.language === 'typescript';
  const db = entityOrm(cfg);
  const typedArgs = ts ? '(req: Request, res: Response)' : '(req, res)';
  const typeImport = ts ? "import type { Request, Response } from 'express';\n" : '';
  return `${typeImport}import { issueToken, verifyPassword } from 'express-file-cluster/auth';
import { ${pascal} } from '../../../model/${pascal}.js';

export const POST = async ${typedArgs} => {
  const { email, password } = req.body;
  // Strings only: an object such as {"$ne": null} would be read as a filter operator and match any account.
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const record = await ${db.findOne(pascal, '{ email }')};
  if (!record) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await verifyPassword(password, record.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  if (!record.isActive) return res.status(403).json({ error: 'Account suspended' });
  const token = await issueToken(res, { id: record.id, role: record.role, email: record.email });
  // bearer: the client stores the token itself; http-only: it's a cookie.
  res.json({ message: 'Logged in as ${slug}', ...(token ? { token } : {}) });
};
`;
}

function entityLogoutContent(cfg: EfcJson): string {
  const ts = cfg.language === 'typescript';
  const typedArgs = ts ? '(req: Request, res: Response)' : '(req, res)';
  const typeImport = ts ? "import type { Request, Response } from 'express';\n" : '';
  return `${typeImport}import { requireAuth, revokeSession } from 'express-file-cluster/auth';

export const middlewares = [requireAuth];

export const POST = async ${typedArgs} => {
  try {
    await revokeSession(req, res);
  } catch {
    res.clearCookie('efc_token');
  }
  res.json({ message: 'Logged out successfully' });
};
`;
}

function entityMeContent(slug: string, cfg: EfcJson): string {
  const ts = cfg.language === 'typescript';
  const typedArgs = ts ? '(req: Request, res: Response)' : '(req, res)';
  const typeImport = ts ? "import type { Request, Response } from 'express';\n" : '';
  return `${typeImport}import { requireAuth } from 'express-file-cluster/auth';

export const middlewares = [requireAuth('${slug}')];

export const GET = async ${typedArgs} => {
  res.json((req${ts ? ' as any' : ''}).user);
};
`;
}

export interface EntityAuthOptions {
  dryRun?: boolean | undefined;
  overwrite?: boolean | undefined;
}

export interface EntityAuthResult {
  written: string[];
  manual: string[];
  conflicts: string[];
}

/**
 * Generate a model and auth routes for a custom entity (e.g. Merchant, Driver).
 * The entity gets its own namespaced routes under `src/api/auth/<slug>/` and uses
 * the same auth primitives (issueToken, requireAuth) as User/Admin.
 */
export function generateEntityAuth(
  cwd: string,
  entityName: string,
  cfg: EfcJson,
  options?: EntityAuthOptions,
): EntityAuthResult {
  const validated = validateEntityName(entityName);
  if ('error' in validated) throw new Error(`[EFC] ${validated.error}`);
  const { pascal, camel, slug } = validated;

  const ext = cfg.language === 'typescript' ? 'ts' : 'js';
  const result: EntityAuthResult = { written: [], manual: [], conflicts: [] };

  const files: { rel: string; content: string }[] = [
    { rel: `src/model/${pascal}.${ext}`, content: entityModelContent(pascal, slug, cfg) },
    {
      rel: `src/api/auth/${slug}/register.${ext}`,
      content: entityRegisterContent(pascal, camel, cfg),
    },
    {
      rel: `src/api/auth/${slug}/login.${ext}`,
      content: entityLoginContent(pascal, slug, cfg),
    },
    {
      rel: `src/api/auth/${slug}/logout.${ext}`,
      content: entityLogoutContent(cfg),
    },
    {
      rel: `src/api/auth/${slug}/me.${ext}`,
      content: entityMeContent(slug, cfg),
    },
  ];

  for (const f of files) {
    const abs = path.join(cwd, f.rel);
    const exists = fs.existsSync(abs);
    if (exists && !options?.overwrite) {
      result.conflicts.push(f.rel);
      result.manual.push(`${f.rel} already exists — skipped (pass --overwrite to replace)`);
      continue;
    }
    result.written.push(f.rel);
    if (!options?.dryRun) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content);
      cfg.files[f.rel] = sha256(f.content);
    }
  }

  // Register the model in src/model/index (defineTable apps)
  if (entityUsesTables(cfg) && !options?.dryRun) {
    result.manual.push(...registerModels(cwd, cfg.language, [pascal]));
  }

  // Ensure JWT_SECRET in .env
  const envFile = path.join(cwd, '.env');
  if (fs.existsSync(envFile)) {
    const envKeys = readEnvKeys(envFile);
    if (!envKeys.includes('JWT_SECRET')) {
      const secret = crypto.randomBytes(64).toString('hex');
      if (!options?.dryRun) {
        appendEnv(envFile, [`JWT_SECRET=${secret}`]);
        const exampleFile = path.join(cwd, '.env.example');
        if (fs.existsSync(exampleFile) && !readEnvKeys(exampleFile).includes('JWT_SECRET')) {
          appendEnv(exampleFile, ['JWT_SECRET=<generate with: openssl rand -hex 64>']);
        }
      }
      result.manual.push('Added JWT_SECRET to .env');
    }
  }

  // Track in efc.json — use a virtual item name
  const itemName = `auth:${slug}`;
  if (!cfg.items.includes(itemName)) cfg.items.push(itemName);
  if (!options?.dryRun) {
    writeEfcJson(cwd, cfg);
  }

  return result;
}

export { validateEntityName };

