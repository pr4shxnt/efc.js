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
  await writeEnvFiles(dest, opts);
  await writeExampleRoute(dest, opts);
  await writeAuthRoutes(dest, opts);
  await writeAdminRoutes(dest, opts);
  await writeUserRoutes(dest, opts);
  if (opts.tasks) await writeExampleTask(dest, opts);
}

async function writePackageJson(dest: string, opts: ScaffoldOptions): Promise<void> {
  const deps: Record<string, string> = {
    'express-file-cluster': '^0.2.1',
  };
  if (opts.database === 'mongodb') deps['mongoose'] = '^8.0.0';
  if (opts.database === 'postgresql') {
    deps['pg'] = '^8.0.0';
    deps['drizzle-orm'] = '^0.33.0';
  }
  if (opts.tasks && opts.taskBackend === 'bullmq') deps['bullmq'] = '^5.0.0';
  if (opts.tasks && opts.taskBackend === 'pg-boss') deps['pg-boss'] = '^10.0.0';

  const devDeps: Record<string, string> = {
    vitest: '^4.1.9',
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
    ? `{ backend: '${opts.taskBackend ?? 'bullmq'}', concurrency: 5 }`
    : 'false';

  const content = `import type { EFCConfig } from 'express-file-cluster';

// Structural config only — runtime values (PORT, DATABASE_URL, JWT_SECRET, etc.) are read from .env
const config: EFCConfig = {
  authStrategy: '${opts.authStrategy}',
  tasks: ${tasks},
  globalMiddlewares: [],
};

export default config;
`;
  await fs.outputFile(path.join(dest, `efc.config.${ext}`), content);
}

async function writeEntryPoint(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const taskLine = opts.tasks ? `  tasks: { backend: '${opts.taskBackend ?? 'bullmq'}' },\n` : '';
  const content = `import { ignite, gracefulShutdown } from 'express-file-cluster';

// PORT, DATABASE_URL, JWT_SECRET, CORS_ORIGINS are read from .env automatically
ignite({
  cluster: ${opts.cluster},
${taskLine}}).then(gracefulShutdown).catch(console.error);
`;
  await fs.outputFile(path.join(dest, 'src', `index.${ext}`), content);
}

async function writeGitignore(dest: string): Promise<void> {
  await fs.outputFile(
    path.join(dest, '.gitignore'),
    'node_modules/\ndist/\n.env\n.env.local\n*.log\n',
  );
}

async function writeEnvFiles(dest: string, opts: ScaffoldOptions): Promise<void> {
  const secret = crypto.randomBytes(64).toString('hex');
  const projectName = path.basename(dest);
  const dbUrl =
    opts.database === 'mongodb'
      ? `mongodb://localhost:27017/${projectName}`
      : `postgresql://localhost:5432/${projectName}`;
  const dbExampleUrl =
    opts.database === 'mongodb'
      ? `mongodb://localhost:27017/${projectName}`
      : `postgresql://user:password@localhost:5432/${projectName}`;

  const dotenv = `PORT=3000\nNODE_ENV=development\nDATABASE_URL=${dbUrl}\nJWT_SECRET=${secret}\nREDIS_URL=redis://localhost:6379\nCORS_ORIGINS=http://localhost:3000\n`;
  const example = `PORT=3000\nNODE_ENV=development\nDATABASE_URL=${dbExampleUrl}\nJWT_SECRET=<generate with: openssl rand -hex 64>\nREDIS_URL=redis://localhost:6379\nCORS_ORIGINS=http://localhost:3000,https://yourapp.com\n`;
  await fs.outputFile(path.join(dest, '.env'), dotenv);
  await fs.outputFile(path.join(dest, '.env.example'), example);
}

async function writeExampleRoute(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const content =
    opts.language === 'typescript'
      ? `import type { Request, Response } from 'express';
import type { RouteMeta } from 'express-file-cluster';

export const meta: RouteMeta = {
  description: 'Health check — returns server status and current timestamp.',
  response: { status: 200, body: { status: 'OK', timestamp: '2024-01-01T00:00:00.000Z' } },
};

export const GET = async (_req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
};
`
      : `export const meta = {
  description: 'Health check — returns server status and current timestamp.',
  response: { status: 200, body: { status: 'OK', timestamp: '2024-01-01T00:00:00.000Z' } },
};

export const GET = async (_req, res) => {
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

async function writeAuthRoutes(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const loginContent =
    opts.language === 'typescript'
      ? `import { issueToken } from 'express-file-cluster/auth';
import type { Request, Response } from 'express';
import type { RouteMeta } from 'express-file-cluster';

export const meta: RouteMeta = {
  description: 'Authenticate a user and issue a JWT via http-only cookie.',
  request: { body: { email: 'user@example.com', password: 'user' } },
  response: { status: 200, body: { message: 'Logged in as user' } },
};

export const POST = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  
  if (email === 'admin@example.com' && password === 'admin') {
    await issueToken(res, { id: '1', role: 'admin', email });
    return res.json({ message: 'Logged in as admin' });
  }
  
  if (email === 'user@example.com' && password === 'user') {
    await issueToken(res, { id: '2', role: 'user', email });
    return res.json({ message: 'Logged in as user' });
  }
  
  res.status(401).json({ error: 'Invalid credentials' });
};
`
      : `import { issueToken } from 'express-file-cluster/auth';

export const meta = {
  description: 'Authenticate a user and issue a JWT via http-only cookie.',
  request: { body: { email: 'user@example.com', password: 'user' } },
  response: { status: 200, body: { message: 'Logged in as user' } },
};

export const POST = async (req, res) => {
  const { email, password } = req.body;

  if (email === 'admin@example.com' && password === 'admin') {
    await issueToken(res, { id: '1', role: 'admin', email });
    return res.json({ message: 'Logged in as admin' });
  }

  if (email === 'user@example.com' && password === 'user') {
    await issueToken(res, { id: '2', role: 'user', email });
    return res.json({ message: 'Logged in as user' });
  }

  res.status(401).json({ error: 'Invalid credentials' });
};
`;

  const logoutContent =
    opts.language === 'typescript'
      ? `import { revokeToken } from 'express-file-cluster/auth';
import type { Request, Response } from 'express';
import type { RouteMeta } from 'express-file-cluster';

export const meta: RouteMeta = {
  description: 'Clear the auth cookie and log the user out.',
  response: { status: 200, body: { message: 'Logged out successfully' } },
};

export const POST = async (_req: Request, res: Response) => {
  revokeToken(res);
  res.json({ message: 'Logged out successfully' });
};
`
      : `import { revokeToken } from 'express-file-cluster/auth';

export const meta = {
  description: 'Clear the auth cookie and log the user out.',
  response: { status: 200, body: { message: 'Logged out successfully' } },
};

export const POST = async (_req, res) => {
  revokeToken(res);
  res.json({ message: 'Logged out successfully' });
};
`;

  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', `login.${ext}`), loginContent);
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', `logout.${ext}`), logoutContent);
}

async function writeAdminRoutes(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const content =
    opts.language === 'typescript'
      ? `import { requireAuth } from 'express-file-cluster/auth';
import type { Request, Response } from 'express';
import type { RouteMeta } from 'express-file-cluster';

export const meta: RouteMeta = {
  description: 'Admin dashboard stats. Requires authentication with admin role.',
  response: { status: 200, body: { message: 'Welcome to the Admin Panel', stats: { users: 120, revenue: 5000 } } },
};

export const middlewares = [requireAuth];

export const GET = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  
  res.json({
    message: 'Welcome to the Admin Panel',
    stats: { users: 120, revenue: 5000 }
  });
};
`
      : `import { requireAuth } from 'express-file-cluster/auth';

export const meta = {
  description: 'Admin dashboard stats. Requires authentication with admin role.',
  response: { status: 200, body: { message: 'Welcome to the Admin Panel', stats: { users: 120, revenue: 5000 } } },
};

export const middlewares = [requireAuth];

export const GET = async (req, res) => {
  const user = req.user;
  if (user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  res.json({
    message: 'Welcome to the Admin Panel',
    stats: { users: 120, revenue: 5000 }
  });
};
`;

  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', `dashboard.${ext}`), content);
}

async function writeUserRoutes(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const content =
    opts.language === 'typescript'
      ? `import { requireAuth } from 'express-file-cluster/auth';
import type { Request, Response } from 'express';
import type { RouteMeta } from 'express-file-cluster';

export const meta: RouteMeta = {
  description: "Fetch the authenticated user's profile. Requires a valid JWT.",
  response: { status: 200, body: { message: 'User Profile Panel', user: { id: '1', role: 'user', email: 'user@example.com' } } },
};

export const middlewares = [requireAuth];

export const GET = async (req: Request, res: Response) => {
  const user = (req as any).user;
  
  res.json({
    message: 'User Profile Panel',
    user
  });
};
`
      : `import { requireAuth } from 'express-file-cluster/auth';

export const meta = {
  description: "Fetch the authenticated user's profile. Requires a valid JWT.",
  response: { status: 200, body: { message: 'User Profile Panel', user: { id: '1', role: 'user', email: 'user@example.com' } } },
};

export const middlewares = [requireAuth];

export const GET = async (req, res) => {
  const user = req.user;

  res.json({
    message: 'User Profile Panel',
    user
  });
};
`;

  await fs.outputFile(path.join(dest, 'src', 'api', 'user', `profile.${ext}`), content);
}
