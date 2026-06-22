import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ScaffoldOptions {
  projectName: string;
  language: 'typescript' | 'javascript';
  database: 'mongodb' | 'postgresql';
  authStrategy: 'http-only' | 'localStorage';
  cluster: boolean;
  tasks: boolean;
  taskBackend?: 'bullmq' | 'pg-boss';
}

export async function scaffold(opts: ScaffoldOptions): Promise<void> {
  const dest = path.resolve(process.cwd(), opts.projectName);
  await fs.ensureDir(dest);

  await writePackageJson(dest, opts);
  await writeTsConfig(dest, opts);
  await writeEfcConfig(dest, opts);
  await writeEntryPoint(dest, opts);
  await writeGitignore(dest);
  await writeEnvFiles(dest);
  await writeExampleRoute(dest, opts);
  if (opts.tasks) await writeExampleTask(dest, opts);
}

async function writePackageJson(dest: string, opts: ScaffoldOptions): Promise<void> {
  const deps: Record<string, string> = {
    'express-file-cluster': '^0.1.0',
  };
  if (opts.database === 'mongodb') deps['mongoose'] = '^8.0.0';
  if (opts.database === 'postgresql') {
    deps['pg'] = '^8.0.0';
    deps['drizzle-orm'] = '^0.33.0';
  }
  if (opts.tasks && opts.taskBackend === 'bullmq') deps['bullmq'] = '^5.0.0';
  if (opts.tasks && opts.taskBackend === 'pg-boss') deps['pg-boss'] = '^10.0.0';

  const devDeps: Record<string, string> = {
    vitest: '^2.0.0',
  };
  if (opts.language === 'typescript') {
    devDeps['typescript'] = '^5.5.0';
    devDeps['@types/node'] = '^22.0.0';
    devDeps['@types/express'] = '^4.17.21';
    devDeps['tsup'] = '^8.2.0';
    devDeps['tsx'] = '^4.0.0';
  }

  const pkg = {
    name: opts.projectName,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'efc start dev',
      build: 'efc build prod',
      start: 'efc start prod',
      test: 'efc run tests',
    },
    dependencies: deps,
    devDependencies: devDeps,
  };

  await fs.writeJson(path.join(dest, 'package.json'), pkg, { spaces: 2 });
}

async function writeTsConfig(dest: string, opts: ScaffoldOptions): Promise<void> {
  if (opts.language !== 'typescript') return;
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: './dist',
      rootDir: './src',
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  };
  await fs.writeJson(path.join(dest, 'tsconfig.json'), config, { spaces: 2 });
}

async function writeEfcConfig(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const tasks = opts.tasks
    ? `{
    backend: '${opts.taskBackend ?? 'bullmq'}',
    redisUrl: process.env.REDIS_URL,
    concurrency: 5,
  }`
    : 'false';

  const content = `import type { EFCConfig } from 'express-file-cluster';

const config: EFCConfig = {
  port: Number(process.env.PORT) || 3000,
  apiDir: './src/api',
  tasksDir: './src/tasks',
  database: '${opts.database}',
  databaseUrl: process.env.DATABASE_URL!,
  authStrategy: '${opts.authStrategy}',
  jwtSecret: process.env.JWT_SECRET!,
  cluster: process.env.NODE_ENV === 'production',
  tasks: ${tasks},
  globalMiddlewares: [],
};

export default config;
`;
  await fs.outputFile(path.join(dest, `efc.config.${ext}`), content);
}

async function writeEntryPoint(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const content = `import { ignite } from 'express-file-cluster';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

ignite({
  port: Number(process.env.PORT) || 3000,
  apiDir: path.join(__dirname, 'api'),
  tasksDir: path.join(__dirname, 'tasks'),
  database: '${opts.database}',
  databaseUrl: process.env.DATABASE_URL,
  authStrategy: '${opts.authStrategy}',
  jwtSecret: process.env.JWT_SECRET,
  cluster: process.env.NODE_ENV === 'production',
}).catch(console.error);
`;
  await fs.outputFile(path.join(dest, 'src', `index.${ext}`), content);
}

async function writeGitignore(dest: string): Promise<void> {
  await fs.outputFile(
    path.join(dest, '.gitignore'),
    'node_modules/\ndist/\n.env\n.env.local\n*.log\n',
  );
}

async function writeEnvFiles(dest: string): Promise<void> {
  const secret = crypto.randomBytes(64).toString('hex');
  const dotenv = `PORT=3000\nNODE_ENV=development\nDATABASE_URL=\nJWT_SECRET=${secret}\nREDIS_URL=redis://localhost:6379\nCORS_ORIGINS=http://localhost:3000\n`;
  const example = `PORT=3000\nNODE_ENV=development\nDATABASE_URL=\nJWT_SECRET=<generate with: openssl rand -hex 64>\nREDIS_URL=redis://localhost:6379\nCORS_ORIGINS=http://localhost:3000,https://yourapp.com\n`;
  await fs.outputFile(path.join(dest, '.env'), dotenv);
  await fs.outputFile(path.join(dest, '.env.example'), example);
}

async function writeExampleRoute(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const content =
    opts.language === 'typescript'
      ? `import type { Request, Response } from 'express';

export const GET = async (_req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
};
`
      : `export const GET = async (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', `health.${ext}`), content);
}

async function writeExampleTask(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const content =
    opts.language === 'typescript'
      ? `import { defineTask } from 'express-file-cluster/tasks';

interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

export default defineTask<SendEmailPayload>(async (payload) => {
  // TODO: wire up your mailer
  console.log('[SendEmail] Sending to', payload.to);
});
`
      : `import { defineTask } from 'express-file-cluster/tasks';

export default defineTask(async (payload) => {
  console.log('[SendEmail] Sending to', payload.to);
});
`;
  await fs.outputFile(path.join(dest, 'src', 'tasks', `SendEmail.${ext}`), content);
}
