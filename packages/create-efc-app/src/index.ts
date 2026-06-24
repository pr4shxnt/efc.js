import * as p from '@clack/prompts';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import { scaffold, type ScaffoldOptions } from './scaffold.js';

async function main(): Promise<void> {
  console.log();
  p.intro(pc.bgCyan(pc.black(' create-efc-app ')));

  const projectName = await p.text({
    message: 'Project name:',
    placeholder: 'my-api',
    defaultValue: 'my-api',
    validate: (v) => (!v.trim() ? 'Project name is required' : undefined),
  });
  if (p.isCancel(projectName)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const language = await p.select({
    message: 'Language:',
    options: [
      { value: 'typescript', label: 'TypeScript', hint: 'recommended' },
      { value: 'javascript', label: 'JavaScript' },
    ],
  });
  if (p.isCancel(language)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const database = await p.select({
    message: 'Database:',
    options: [
      { value: 'mongodb', label: 'MongoDB', hint: 'Mongoose' },
      { value: 'postgresql', label: 'PostgreSQL', hint: 'Drizzle ORM' },
    ],
  });
  if (p.isCancel(database)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const authStrategy = await p.select({
    message: 'Authentication strategy:',
    options: [
      { value: 'http-only', label: 'http-only', hint: 'secure cookie — recommended for SSR' },
      { value: 'localStorage', label: 'localStorage', hint: 'bearer token — for SPAs' },
    ],
  });
  if (p.isCancel(authStrategy)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const cluster = await p.confirm({
    message: 'Enable multi-core clustering?',
    initialValue: true,
  });
  if (p.isCancel(cluster)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const tasks = await p.confirm({
    message: 'Enable background tasks?',
    initialValue: true,
  });
  if (p.isCancel(tasks)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  let taskBackend: ScaffoldOptions['taskBackend'];
  if (tasks) {
    const backend = await p.select({
      message: 'Task queue backend:',
      options: [
        { value: 'bullmq', label: 'BullMQ', hint: 'Redis' },
        { value: 'pg-boss', label: 'pg-boss', hint: 'PostgreSQL' },
      ],
    });
    if (p.isCancel(backend)) {
      p.cancel('Cancelled');
      process.exit(0);
    }
    taskBackend = backend as ScaffoldOptions['taskBackend'];
  }

  const opts: ScaffoldOptions = {
    projectName: projectName as string,
    language: language as ScaffoldOptions['language'],
    database: database as ScaffoldOptions['database'],
    authStrategy: authStrategy as ScaffoldOptions['authStrategy'],
    cluster: cluster as boolean,
    tasks: tasks as boolean,
    ...(taskBackend !== undefined && { taskBackend }),
  };

  const spinner = p.spinner();
  spinner.start('Scaffolding project…');

  try {
    await scaffold(opts);
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

  p.outro(
    pc.green(`\nYour project is ready!\n\n`) +
      pc.dim(`  cd ${projectName as string}\n`) +
      pc.dim(`  efc start dev\n`) +
      pc.dim(`\n  (or: npm run dev)\n`),
  );
}

function npmInstall(projectDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install'], {
      cwd: projectDir,
      stdio: 'ignore',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm install failed`))));
  });
}

function npmInstallGlobal(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '-g', 'express-file-cluster'], {
      stdio: 'ignore',
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('global install failed')),
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
