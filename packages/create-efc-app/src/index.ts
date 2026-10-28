import * as p from '@clack/prompts';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { scaffold, type ScaffoldOptions } from './scaffold.js';
import {
  AUTH_STRATEGY_OPTIONS,
  ITEMS,
  envFromAnswers,
  itemPrompts,
  normalizeAnswer,
  promptApplies,
  promptDefault,
  registryOptions,
  setEnvValues,
  withDependencies,
  writeManifest,
  type PromptAnswers,
} from './registry.js';

function cancel(msg = 'Cancelled'): never {
  p.cancel(msg);
  process.exit(0);
}

async function main(): Promise<void> {
  console.log();
  p.intro(pc.bgCyan(pc.black(' create-efc-app ')));

  const projectName = await p.text({
    message: 'Project name:',
    placeholder: 'my-api',
    defaultValue: 'my-api',
    validate: (v) => (!v.trim() ? 'Project name is required' : undefined),
  });
  if (p.isCancel(projectName)) cancel();

  const language = await p.select({
    message: 'Language:',
    options: [
      { value: 'typescript', label: 'TypeScript', hint: 'recommended' },
      { value: 'javascript', label: 'JavaScript' },
    ],
  });
  if (p.isCancel(language)) cancel();

  const database = await p.select({
    message: 'Database:',
    options: [
      { value: 'mongodb', label: 'MongoDB', hint: 'Mongoose' },
      { value: 'postgresql', label: 'PostgreSQL', hint: 'Drizzle ORM' },
    ],
  });
  if (p.isCancel(database)) cancel();

  const api = await p.select({
    message: 'Models:',
    options:
      database === 'postgresql'
        ? [
            {
              value: 'defineTable',
              label: 'defineTable',
              hint: 'PostgreSQL-native — foreign keys, relations, include, Prisma-style queries',
            },
            { value: 'defineModel', label: 'defineModel', hint: 'portable — the same API on MongoDB' },
          ]
        : [
            {
              value: 'defineCollection',
              label: 'defineCollection',
              hint: 'MongoDB-native — mongoose-style queries, typed pipelines, BSON types',
            },
            {
              value: 'defineModel',
              label: 'defineModel',
              hint: 'portable — the same API on PostgreSQL',
            },
          ],
  });
  if (p.isCancel(api)) cancel();
  const modelApi = api as ScaffoldOptions['modelApi'];

  // pg-boss keeps jobs in the app's own PostgreSQL; BullMQ needs Redis.
  const taskBackend = await p.select({
    message: 'Task queue backend:',
    options:
      database === 'postgresql'
        ? [
            { value: 'pg-boss', label: 'pg-boss', hint: 'uses your PostgreSQL — no Redis' },
            { value: 'bullmq', label: 'BullMQ', hint: 'Redis' },
          ]
        : [{ value: 'bullmq', label: 'BullMQ', hint: 'Redis' }],
  });
  if (p.isCancel(taskBackend)) cancel();

  const cluster = await p.confirm({
    message: 'Multi-core clustering? (one worker per CPU in production)',
    initialValue: true,
  });
  if (p.isCancel(cluster)) cancel();

  // The base app is the server, src/api, src/tasks and the database. Features are registry
  // items — the same ones `efc add` installs later.
  const groupLabel: Record<string, string> = {
    auth: 'Auth',
    user: 'User portal',
    admin: 'Admin portal',
    integrations: 'Integrations',
  };
  const groups: Record<string, { value: string; label: string; hint: string }[]> = {};
  for (const item of ITEMS) {
    (groups[groupLabel[item.group]!] ??= []).push({
      value: item.name,
      label: item.title,
      hint: item.description,
    });
  }
  // Asked up front, not only when an auth feature is ticked — it decides how every client
  // (browser, mobile app) talks to the API.
  const auth = await p.select({
    message: 'Authentication:',
    options: [
      ...AUTH_STRATEGY_OPTIONS,
      { value: 'none', label: 'None', hint: 'add it later with `efc add auth`' },
    ],
  });
  if (p.isCancel(auth)) cancel();

  const picked = await p.groupMultiselect({
    message: `Add features now? ${pc.dim('(space to toggle, enter to confirm — or add any later with `efc add <item>`)')}`,
    options: groups,
    initialValues: auth === 'none' ? [] : ['auth'],
    required: false,
  });
  if (p.isCancel(picked)) cancel();
  const items = withDependencies(picked as string[]);

  // Each feature's own questions (SMTP for the email client, OAuth credentials…) — the same
  // ones `efc add` asks. Answers named like env vars go into .env.
  const answers: PromptAnswers = auth === 'none' ? {} : { authStrategy: auth as string };
  const prompts = itemPrompts(items);
  for (const q of prompts) {
    if (q.name in answers || !promptApplies(q, answers)) continue;
    if (q.note) p.note(q.note);
    if (q.type === 'select') {
      const choice = await p.select({
        message: q.message,
        options: (q.options ?? []).map((o) => ({
          value: o.value,
          label: o.label,
          ...(o.hint !== undefined && { hint: o.hint }),
        })),
      });
      if (p.isCancel(choice)) cancel();
      answers[q.name] = choice as string;
      continue;
    }
    const def = promptDefault(q, answers);
    const check = (v: string) => {
      const r = normalizeAnswer(q, v.trim() === '' ? (def ?? '') : v);
      return 'error' in r ? r.error : undefined;
    };
    const raw =
      q.type === 'password'
        ? await p.password({ message: q.message, validate: check })
        : await p.text({
            message: q.message,
            ...(q.placeholder !== undefined && { placeholder: q.placeholder }),
            ...(def !== undefined && { placeholder: def, defaultValue: def }),
            validate: check,
          });
    if (p.isCancel(raw)) cancel();
    const r = normalizeAnswer(q, (raw as string).trim() === '' ? (def ?? '') : (raw as string));
    answers[q.name] = 'value' in r ? r.value : '';
  }
  const env = envFromAnswers(prompts, answers);

  const opts = registryOptions(
    {
      language: language as ScaffoldOptions['language'],
      database: database as ScaffoldOptions['database'],
      modelApi: modelApi ?? 'defineModel',
    },
    items,
    {
      projectName: projectName as string,
      authStrategy: (answers['authStrategy'] ?? 'http-only') as ScaffoldOptions['authStrategy'],
      cluster: cluster as boolean,
      taskBackend: taskBackend as 'bullmq' | 'pg-boss',
      ...(answers['provider'] === 'custom' && { smtpProvider: 'custom' as const }),
    },
  );

  const spinner = p.spinner();
  spinner.start('Scaffolding project…');

  try {
    await scaffold(opts);
    if (Object.keys(env).length) {
      await setEnvValues(path.resolve(process.cwd(), opts.projectName, '.env'), env);
    }
    await writeManifest(path.resolve(process.cwd(), opts.projectName), opts, items);
    spinner.stop('Project created');
  } catch (err) {
    spinner.stop('Failed to scaffold project');
    console.error(err);
    process.exit(1);
  }

  spinner.start('Installing dependencies…');
  await npmInstall(projectName as string);
  spinner.stop('Dependencies installed');

  spinner.start('Installing efc CLI globally…');
  await npmInstallGlobal().catch(() => {
    /* non-fatal */
  });
  spinner.stop('efc CLI ready');

  const secrets = Object.keys(env).filter((k) => /PASS|SECRET|PRIVATE_KEY/.test(k));
  if (secrets.length) {
    p.note(
      `${secrets.join(', ')} ${secrets.length > 1 ? 'were' : 'was'} written to ${projectName as string}/.env — that file is gitignored, never commit it.\n` +
        'Rotate any of them immediately if it is ever exposed.',
      'Credentials',
    );
  }

  if (opts.database === 'postgresql') {
    // EFC creates tables, but not the database or the login — the most common first-run error.
    const db = path.basename(opts.projectName);
    p.note(
      `.env points DATABASE_URL at postgresql://localhost:5432/${db}, with no user or password.\n` +
        'EFC creates the tables on first use, but not the database or the login:\n' +
        `  • Local server: createdb ${db}  (add user:password@ to the URL if it asks for one)\n` +
        '  • Neon, Supabase, RDS: create the database in the dashboard and paste its full\n' +
        '    connection string into .env as DATABASE_URL',
      'PostgreSQL',
    );
  }

  // Tables (PostgreSQL) and collections/indexes (MongoDB) are created on first use, so
  // there's nothing to set up before the first run; migrations are there when wanted.
  p.outro(
    pc.green(`\nYour project is ready!\n\n`) +
      pc.dim(`  cd ${projectName as string}\n`) +
      pc.dim(`  efc start dev\n`) +
      pc.dim(`\n  (or: npm run dev)\n`) +
      pc.dim(`\n  Add features any time: efc list · efc add <item>\n`),
  );
}

function npmInstall(projectDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install'], { cwd: projectDir, stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('npm install failed'))));
  });
}

function npmInstallGlobal(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '-g', 'express-file-cluster'], { stdio: 'ignore' });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('global install failed')),
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
