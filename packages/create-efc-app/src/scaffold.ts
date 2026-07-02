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
  routeDocs: boolean;
  userPortal: boolean;
  adminPortal: boolean;
  rbac: boolean;
  mailer: boolean;
  smtpProvider?: 'gmail' | 'custom';
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
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
  if (opts.rbac) await writeRequireRoleMiddleware(dest, opts);
  if (opts.userPortal) await writeUserModel(dest, opts);
  if (opts.adminPortal) await writeAdminModel(dest, opts);
  await writeAuthRoutes(dest, opts);
  if (opts.adminPortal) await writeAdminRoutes(dest, opts);
  if (opts.userPortal) await writeUserRoutes(dest, opts);
  if (opts.tasks) await writeExampleTask(dest, opts);
  // Extended models
  if (opts.userPortal) await writeSessionModel(dest, opts);
  if (opts.userPortal) await writeNotificationModel(dest, opts);
  if (opts.userPortal) await writeFileModel(dest, opts);
  if (opts.userPortal || opts.adminPortal) await writeSupportTicketModel(dest, opts);
  if (opts.adminPortal) await writeAuditLogModel(dest, opts);
  if (opts.userPortal) await writeSubscriptionModel(dest, opts);
  if (opts.adminPortal) await writePlanModel(dest, opts);
  if (opts.userPortal) await writeInvoiceModel(dest, opts);
  if (opts.userPortal) await writeApiKeyModel(dest, opts);
  if (opts.rbac) await writeRoleModel(dest, opts);
  if (opts.adminPortal) await writeFAQModel(dest, opts);
  if (opts.adminPortal) await writeBlogModel(dest, opts);
  if (opts.adminPortal) await writeCategoryModel(dest, opts);
  if (opts.adminPortal) await writeCouponModel(dest, opts);
  // Extended routes
  if (opts.userPortal) await writeAuthExtendedRoutes(dest, opts);
  if (opts.userPortal) await writeUserExtendedRoutes(dest, opts);
  if (opts.userPortal) await writeUserBillingRoutes(dest, opts);
  if (opts.userPortal) await writeSupportRoutes(dest, opts);
  if (opts.adminPortal) await writeAdminExtendedRoutes(dest, opts);
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
  if (opts.mailer) deps['nodemailer'] = '^6.9.0';
  if (opts.database === 'mongodb') deps['bcrypt'] = '^5.1.0';

  const devDeps: Record<string, string> = {
    vitest: '^4.1.9',
  };
  if (opts.language === 'typescript') {
    devDeps['typescript'] = '^5.5.0';
    devDeps['@types/node'] = '^22.0.0';
    devDeps['@types/express'] = '^4.17.21';
    devDeps['tsup'] = '^8.2.0';
    devDeps['tsx'] = '^4.0.0';
    if (opts.mailer) devDeps['@types/nodemailer'] = '^6.4.0';
    if (opts.database === 'mongodb') devDeps['@types/bcrypt'] = '^5.0.0';
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

  const isGmail = opts.mailer && opts.smtpProvider !== 'custom';
  const resolvedHost = isGmail ? 'smtp.gmail.com' : opts.smtpHost ?? 'smtp.gmail.com';
  const resolvedPort = isGmail ? '465' : opts.smtpPort ?? '587';
  const passComment = isGmail
    ? ' # Gmail App Password (16 chars) — NOT your regular Gmail password. Generate at: Google Account > Security > 2-Step Verification > App passwords'
    : '';

  const smtpVars = opts.mailer
    ? `\nSMTP_HOST=${resolvedHost}\nSMTP_PORT=${resolvedPort}\nSMTP_USER=${opts.smtpUser ?? ''}\nSMTP_PASS=${opts.smtpPass ?? ''}${passComment}\nSMTP_FROM=${opts.smtpUser ?? 'noreply@example.com'}\n`
    : '';
  const smtpExample = opts.mailer
    ? `\nSMTP_HOST=${resolvedHost}\nSMTP_PORT=${resolvedPort}\nSMTP_USER=your@email.com\nSMTP_PASS=${isGmail ? 'your_16_char_app_password' : 'your_smtp_password'}${passComment}\nSMTP_FROM=noreply@yourapp.com\n`
    : '';
  const dotenv = `PORT=3000\nNODE_ENV=development\nDATABASE_URL=${dbUrl}\nJWT_SECRET=${secret}\nREDIS_URL=redis://localhost:6379\nCORS_ORIGINS=http://localhost:3000${smtpVars}`;
  const example = `PORT=3000\nNODE_ENV=development\nDATABASE_URL=${dbExampleUrl}\nJWT_SECRET=<generate with: openssl rand -hex 64>\nREDIS_URL=redis://localhost:6379\nCORS_ORIGINS=http://localhost:3000,https://yourapp.com${smtpExample}`;
  await fs.outputFile(path.join(dest, '.env'), dotenv);
  await fs.outputFile(path.join(dest, '.env.example'), example);
}

async function writeExampleRoute(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const metaTs = opts.routeDocs
    ? `import type { RouteMeta } from 'express-file-cluster';\n\nexport const meta: RouteMeta = {\n  description: 'Health check — returns server status and current timestamp.',\n  response: { status: 200, body: { status: 'OK', timestamp: '2024-01-01T00:00:00.000Z' } },\n};\n\n`
    : '';
  const metaJs = opts.routeDocs
    ? `export const meta = {\n  description: 'Health check — returns server status and current timestamp.',\n  response: { status: 200, body: { status: 'OK', timestamp: '2024-01-01T00:00:00.000Z' } },\n};\n\n`
    : '';
  const content =
    opts.language === 'typescript'
      ? `import type { Request, Response } from 'express';\n${metaTs}export const GET = async (_req: Request, res: Response) => {\n  res.json({ status: 'OK', timestamp: new Date().toISOString() });\n};\n`
      : `${metaJs}export const GET = async (_req, res) => {\n  res.json({ status: 'OK', timestamp: new Date().toISOString() });\n};\n`;
  await fs.outputFile(path.join(dest, 'src', 'api', `health.${ext}`), content);
}

async function writeExampleTask(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';

  const tsMailer = `import { defineTask } from 'express-file-cluster/tasks';
import nodemailer from 'nodemailer';

interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export default defineTask<SendEmailPayload>(async (payload) => {
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: payload.to,
    subject: payload.subject,
    html: payload.body,
  });
});
`;

  const jsMailer = `import { defineTask } from 'express-file-cluster/tasks';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export default defineTask(async (payload) => {
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: payload.to,
    subject: payload.subject,
    html: payload.body,
  });
});
`;

  const tsStub = `import { defineTask } from 'express-file-cluster/tasks';

interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

export default defineTask<SendEmailPayload>(async (payload) => {
  // TODO: wire up your mailer
  console.log('[SendEmail] Sending to', payload.to);
});
`;

  const jsStub = `import { defineTask } from 'express-file-cluster/tasks';

export default defineTask(async (payload) => {
  // TODO: wire up your mailer
  console.log('[SendEmail] Sending to', payload.to);
});
`;

  const content = opts.mailer
    ? opts.language === 'typescript' ? tsMailer : jsMailer
    : opts.language === 'typescript' ? tsStub : jsStub;

  await fs.outputFile(path.join(dest, 'src', 'tasks', `SendEmail.${ext}`), content);
}

async function writeUserModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';

  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface UserDocument {
  name: string;
  email: string;
  password: string;
  role: string;
  avatar?: string;
  isVerified: boolean;
  isActive: boolean;
}

export const User = defineModel<UserDocument>('User', {
  name:       { type: 'string',  required: true },
  email:      { type: 'string',  required: true, unique: true },
  password:   { type: 'string',  required: true },
  role:       { type: 'string',  required: true, default: 'user' },
  avatar:     { type: 'string' },
  isVerified: { type: 'boolean', default: false },
  isActive:   { type: 'boolean', default: true },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const User = defineModel('User', {
  name:       { type: 'string',  required: true },
  email:      { type: 'string',  required: true, unique: true },
  password:   { type: 'string',  required: true },
  role:       { type: 'string',  required: true, default: 'user' },
  avatar:     { type: 'string' },
  isVerified: { type: 'boolean', default: false },
  isActive:   { type: 'boolean', default: true },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for User
// import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';
//
// export const users = pgTable('users', {
//   id:         serial('id').primaryKey(),
//   name:       text('name').notNull(),
//   email:      text('email').notNull().unique(),
//   password:   text('password').notNull(),
//   role:       text('role').notNull().default('user'),
//   avatar:     text('avatar'),
//   isVerified: boolean('is_verified').notNull().default(false),
//   isActive:   boolean('is_active').notNull().default(true),
//   createdAt:  timestamp('created_at').defaultNow(),
//   updatedAt:  timestamp('updated_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for User
export {};
`;

  await fs.outputFile(path.join(dest, 'src', 'model', `User.${ext}`), content);
}

async function writeAdminModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';

  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface AdminDocument {
  name: string;
  email: string;
  password: string;
  role: string;
  permissions: string[];
  isActive: boolean;
}

export const Admin = defineModel<AdminDocument>('Admin', {
  name:        { type: 'string',  required: true },
  email:       { type: 'string',  required: true, unique: true },
  password:    { type: 'string',  required: true },
  role:        { type: 'string',  required: true, default: 'admin' },
  permissions: { type: 'array',   default: [] },
  isActive:    { type: 'boolean', default: true },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const Admin = defineModel('Admin', {
  name:        { type: 'string',  required: true },
  email:       { type: 'string',  required: true, unique: true },
  password:    { type: 'string',  required: true },
  role:        { type: 'string',  required: true, default: 'admin' },
  permissions: { type: 'array',   default: [] },
  isActive:    { type: 'boolean', default: true },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for Admin
// import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';
//
// export const admins = pgTable('admins', {
//   id:          serial('id').primaryKey(),
//   name:        text('name').notNull(),
//   email:       text('email').notNull().unique(),
//   password:    text('password').notNull(),
//   role:        text('role').notNull().default('admin'),
//   permissions: text('permissions').array().notNull().default([]),
//   isActive:    boolean('is_active').notNull().default(true),
//   createdAt:   timestamp('created_at').defaultNow(),
//   updatedAt:   timestamp('updated_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for Admin
export {};
`;

  await fs.outputFile(path.join(dest, 'src', 'model', `Admin.${ext}`), content);
}

async function writeAuthRoutes(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';

  const loginMeta = opts.routeDocs
    ? ts
      ? `import type { RouteMeta } from 'express-file-cluster';\n\nexport const meta: RouteMeta = {\n  description: 'Authenticate a user and issue a JWT.',\n  request: { body: { email: 'user@example.com', password: 'user' } },\n  response: { status: 200, body: { message: 'Logged in as user' } },\n};\n\n`
      : `export const meta = {\n  description: 'Authenticate a user and issue a JWT.',\n  request: { body: { email: 'user@example.com', password: 'user' } },\n  response: { status: 200, body: { message: 'Logged in as user' } },\n};\n\n`
    : '';

  const loginDbImports = opts.database === 'mongodb'
    ? ts
      ? `import bcrypt from 'bcrypt';\nimport { User } from '../../model/User.js';\nimport { Admin } from '../../model/Admin.js';\n`
      : `import bcrypt from 'bcrypt';\nimport { User } from '../../model/User.js';\nimport { Admin } from '../../model/Admin.js';\n`
    : '';

  const loginContent = opts.database === 'mongodb'
    ? ts
      ? `import { issueToken } from 'express-file-cluster/auth';
import type { Request, Response } from 'express';
${loginDbImports}${loginMeta}export const POST = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const admin = await Admin.findOne({ email });
  if (admin) {
    const match = await bcrypt.compare(password, admin.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    if (!admin.isActive) return res.status(403).json({ error: 'Account suspended' });
    await issueToken(res, { id: admin.id, role: admin.role, email: admin.email });
    return res.json({ message: 'Logged in as admin' });
  }

  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.isActive) return res.status(403).json({ error: 'Account suspended' });
  await issueToken(res, { id: user.id, role: user.role, email: user.email });
  res.json({ message: 'Logged in' });
};
`
      : `import { issueToken } from 'express-file-cluster/auth';
${loginDbImports}${loginMeta}export const POST = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const admin = await Admin.findOne({ email });
  if (admin) {
    const match = await bcrypt.compare(password, admin.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    if (!admin.isActive) return res.status(403).json({ error: 'Account suspended' });
    await issueToken(res, { id: admin.id, role: admin.role, email: admin.email });
    return res.json({ message: 'Logged in as admin' });
  }

  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.isActive) return res.status(403).json({ error: 'Account suspended' });
  await issueToken(res, { id: user.id, role: user.role, email: user.email });
  res.json({ message: 'Logged in' });
};
`
    : ts
      ? `import { issueToken } from 'express-file-cluster/auth';
import type { Request, Response } from 'express';
${loginMeta}export const POST = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  // TODO: look up user in DB and compare password
  res.status(401).json({ error: 'Invalid credentials' });
};
`
      : `import { issueToken } from 'express-file-cluster/auth';
${loginMeta}export const POST = async (req, res) => {
  const { email, password } = req.body;
  // TODO: look up user in DB and compare password
  res.status(401).json({ error: 'Invalid credentials' });
};
`;

  const logoutMeta = opts.routeDocs
    ? ts
      ? `import type { RouteMeta } from 'express-file-cluster';\n\nexport const meta: RouteMeta = {\n  description: 'Clear the auth cookie and log the user out.',\n  response: { status: 200, body: { message: 'Logged out successfully' } },\n};\n\n`
      : `export const meta = {\n  description: 'Clear the auth cookie and log the user out.',\n  response: { status: 200, body: { message: 'Logged out successfully' } },\n};\n\n`
    : '';

  const logoutContent = ts
    ? `import { revokeToken } from 'express-file-cluster/auth';
import type { Request, Response } from 'express';
${logoutMeta}export const POST = async (_req: Request, res: Response) => {
  revokeToken(res);
  res.json({ message: 'Logged out successfully' });
};
`
    : `import { revokeToken } from 'express-file-cluster/auth';
${logoutMeta}export const POST = async (_req, res) => {
  revokeToken(res);
  res.json({ message: 'Logged out successfully' });
};
`;

  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', `login.${ext}`), loginContent);
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', `logout.${ext}`), logoutContent);

  if (!opts.userPortal) return;

  const registerMeta = opts.routeDocs
    ? ts
      ? `import type { RouteMeta } from 'express-file-cluster';\n\nexport const meta: RouteMeta = {\n  description: 'Register a new user account.',\n  request: { body: { name: 'Jane Doe', email: 'jane@example.com', password: 'secret' } },\n  response: { status: 201, body: { message: 'Account created successfully' } },\n};\n\n`
      : `export const meta = {\n  description: 'Register a new user account.',\n  request: { body: { name: 'Jane Doe', email: 'jane@example.com', password: 'secret' } },\n  response: { status: 201, body: { message: 'Account created successfully' } },\n};\n\n`
    : '';

  const registerDbImports = opts.database === 'mongodb'
    ? ts
      ? `import bcrypt from 'bcrypt';\nimport { User } from '../../model/User.js';\n`
      : `import bcrypt from 'bcrypt';\nimport { User } from '../../model/User.js';\n`
    : '';

  const registerContent = opts.database === 'mongodb'
    ? ts
      ? `import type { Request, Response } from 'express';
${registerDbImports}${registerMeta}export const POST = async (req: Request, res: Response) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  const existing = await User.findOne({ email });
  if (existing) return res.status(409).json({ error: 'Email already in use' });
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, password: hashed });
  const { password: _, ...safe } = user;
  res.status(201).json({ message: 'Account created successfully', user: safe });
};
`
      : `${registerDbImports}${registerMeta}export const POST = async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  const existing = await User.findOne({ email });
  if (existing) return res.status(409).json({ error: 'Email already in use' });
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, password: hashed });
  const { password: _, ...safe } = user;
  res.status(201).json({ message: 'Account created successfully', user: safe });
};
`
    : ts
      ? `import type { Request, Response } from 'express';
${registerMeta}export const POST = async (req: Request, res: Response) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  // TODO: hash password and persist to DB
  res.status(201).json({ message: 'Account created successfully' });
};
`
      : `${registerMeta}export const POST = async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  // TODO: hash password and persist to DB
  res.status(201).json({ message: 'Account created successfully' });
};
`;

  const meMeta = opts.routeDocs
    ? ts
      ? `import type { RouteMeta } from 'express-file-cluster';\n\nexport const meta: RouteMeta = {\n  description: 'Return the currently authenticated user.',\n  response: { status: 200, body: { user: { id: '1', role: 'user', email: 'user@example.com' } } },\n};\n\n`
      : `export const meta = {\n  description: 'Return the currently authenticated user.',\n  response: { status: 200, body: { user: { id: '1', role: 'user', email: 'user@example.com' } } },\n};\n\n`
    : '';

  const requireRoleImport = opts.rbac
    ? ts
      ? `import { requireRole } from '../../middleware/requireRole.js';\n`
      : `import { requireRole } from '../../middleware/requireRole.js';\n`
    : '';
  const meMiddlewares = opts.rbac
    ? `export const middlewares = [requireAuth, requireRole('user', 'admin')];\n\n`
    : `export const middlewares = [requireAuth];\n\n`;

  const meContent = ts
    ? `import { requireAuth } from 'express-file-cluster/auth';
${requireRoleImport}import type { Request, Response } from 'express';
${meMeta}${meMiddlewares}export const GET = async (req: Request, res: Response) => {
  res.json({ user: (req as any).user });
};
`
    : `import { requireAuth } from 'express-file-cluster/auth';
${requireRoleImport}${meMeta}${meMiddlewares}export const GET = async (req, res) => {
  res.json({ user: req.user });
};
`;

  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', `register.${ext}`), registerContent);
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', `me.${ext}`), meContent);
}

async function writeRequireRoleMiddleware(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const content =
    opts.language === 'typescript'
      ? `import type { Request, Response, NextFunction } from 'express';

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
`
      : `export function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
`;
  await fs.outputFile(path.join(dest, 'src', 'middleware', `requireRole.${ext}`), content);
}

async function writeAdminRoutes(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';

  const requireRoleImport = opts.rbac
    ? `import { requireRole } from '../../middleware/requireRole.js';\n`
    : '';
  const usersRequireRoleImport = opts.rbac
    ? `import { requireRole } from '../../../middleware/requireRole.js';\n`
    : '';
  const middlewares = opts.rbac
    ? `export const middlewares = [requireAuth, requireRole('admin')];\n`
    : `export const middlewares = [requireAuth];\n`;
  const roleGuard = opts.rbac
    ? ''
    : ts
      ? `  const user = (req as any).user;\n  if (user?.role !== 'admin') {\n    return res.status(403).json({ error: 'Forbidden: Admin access required' });\n  }\n\n`
      : `  const user = req.user;\n  if (user?.role !== 'admin') {\n    return res.status(403).json({ error: 'Forbidden: Admin access required' });\n  }\n\n`;

  const dashboardMeta = opts.routeDocs
    ? ts
      ? `import type { RouteMeta } from 'express-file-cluster';\n\nexport const meta: RouteMeta = {\n  description: 'Admin dashboard stats. Requires admin role.',\n  response: { status: 200, body: { stats: { users: 120, revenue: 5000 } } },\n};\n\n`
      : `export const meta = {\n  description: 'Admin dashboard stats. Requires admin role.',\n  response: { status: 200, body: { stats: { users: 120, revenue: 5000 } } },\n};\n\n`
    : '';

  const dashboardDbImport = opts.database === 'mongodb'
    ? `import { User } from '../../model/User.js';\n`
    : '';

  const dashboardContent = opts.database === 'mongodb'
    ? ts
      ? `import { requireAuth } from 'express-file-cluster/auth';
${requireRoleImport}import type { Request, Response } from 'express';
${dashboardDbImport}${dashboardMeta}${middlewares}
export const GET = async (_req: Request, res: Response) => {
${roleGuard}  const [totalUsers, activeUsers, verifiedUsers] = await Promise.all([
    User.count({}),
    User.count({ isActive: true }),
    User.count({ isVerified: true }),
  ]);
  res.json({ stats: { totalUsers, activeUsers, verifiedUsers } });
};
`
      : `import { requireAuth } from 'express-file-cluster/auth';
${requireRoleImport}${dashboardDbImport}${dashboardMeta}${middlewares}
export const GET = async (_req, res) => {
${roleGuard}  const [totalUsers, activeUsers, verifiedUsers] = await Promise.all([
    User.count({}),
    User.count({ isActive: true }),
    User.count({ isVerified: true }),
  ]);
  res.json({ stats: { totalUsers, activeUsers, verifiedUsers } });
};
`
    : ts
      ? `import { requireAuth } from 'express-file-cluster/auth';
${requireRoleImport}import type { Request, Response } from 'express';
${dashboardMeta}${middlewares}
export const GET = async (_req: Request, res: Response) => {
${roleGuard}  // TODO: aggregate stats from DB
  res.json({ stats: { users: 0 } });
};
`
      : `import { requireAuth } from 'express-file-cluster/auth';
${requireRoleImport}${dashboardMeta}${middlewares}
export const GET = async (_req, res) => {
${roleGuard}  // TODO: aggregate stats from DB
  res.json({ stats: { users: 0 } });
};
`;

  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', `dashboard.${ext}`), dashboardContent);

  // Admin user management routes
  const usersListMeta = opts.routeDocs
    ? ts
      ? `import type { RouteMeta } from 'express-file-cluster';\n\nexport const meta: RouteMeta = {\n  description: 'List all users (admin only).',\n  response: { status: 200, body: { users: [], total: 0 } },\n};\n\n`
      : `export const meta = {\n  description: 'List all users (admin only).',\n  response: { status: 200, body: { users: [], total: 0 } },\n};\n\n`
    : '';

  const adminUsersDbImport = opts.database === 'mongodb'
    ? ts
      ? `import bcrypt from 'bcrypt';\nimport { User } from '../../../model/User.js';\n`
      : `import bcrypt from 'bcrypt';\nimport { User } from '../../../model/User.js';\n`
    : '';

  const usersListContent = opts.database === 'mongodb'
    ? ts
      ? `import { requireAuth } from 'express-file-cluster/auth';
${usersRequireRoleImport}import type { Request, Response } from 'express';
${adminUsersDbImport}${usersListMeta}${middlewares}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const [all, total] = await Promise.all([User.find({}), User.count({})]);
  const users = all.slice((page - 1) * limit, page * limit).map(({ password: _, ...u }) => u);
  res.json({ users, total, page, limit });
};

export const POST = async (req: Request, res: Response) => {
${roleGuard}  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  const existing = await User.findOne({ email });
  if (existing) return res.status(409).json({ error: 'Email already in use' });
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, password: hashed, role: role ?? 'user' });
  const { password: _, ...safe } = user;
  res.status(201).json({ message: 'User created', user: safe });
};
`
      : `import { requireAuth } from 'express-file-cluster/auth';
${usersRequireRoleImport}${adminUsersDbImport}${usersListMeta}${middlewares}
export const GET = async (req, res) => {
${roleGuard}  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const [all, total] = await Promise.all([User.find({}), User.count({})]);
  const users = all.slice((page - 1) * limit, page * limit).map(({ password: _, ...u }) => u);
  res.json({ users, total, page, limit });
};

export const POST = async (req, res) => {
${roleGuard}  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  const existing = await User.findOne({ email });
  if (existing) return res.status(409).json({ error: 'Email already in use' });
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, password: hashed, role: role ?? 'user' });
  const { password: _, ...safe } = user;
  res.status(201).json({ message: 'User created', user: safe });
};
`
    : ts
      ? `import { requireAuth } from 'express-file-cluster/auth';
${usersRequireRoleImport}import type { Request, Response } from 'express';
${usersListMeta}${middlewares}
export const GET = async (_req: Request, res: Response) => {
${roleGuard}  // TODO: fetch users from DB with pagination
  res.json({ users: [], total: 0 });
};

export const POST = async (req: Request, res: Response) => {
${roleGuard}  const { name, email, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  // TODO: create user in DB
  res.status(201).json({ message: 'User created', user: { id: 'new-id', name, email, role: role ?? 'user' } });
};
`
      : `import { requireAuth } from 'express-file-cluster/auth';
${usersRequireRoleImport}${usersListMeta}${middlewares}
export const GET = async (_req, res) => {
${roleGuard}  // TODO: fetch users from DB with pagination
  res.json({ users: [], total: 0 });
};

export const POST = async (req, res) => {
${roleGuard}  const { name, email, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  // TODO: create user in DB
  res.status(201).json({ message: 'User created', user: { id: 'new-id', name, email, role: role ?? 'user' } });
};
`;

  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'users', `index.${ext}`), usersListContent);

  const userByIdMeta = opts.routeDocs
    ? ts
      ? `import type { RouteMeta } from 'express-file-cluster';\n\nexport const meta: RouteMeta = {\n  description: 'Get, update, or delete a single user by ID (admin only).',\n};\n\n`
      : `export const meta = {\n  description: 'Get, update, or delete a single user by ID (admin only).',\n};\n\n`
    : '';

  const adminUserByIdDbImport = opts.database === 'mongodb'
    ? `import { User } from '../../../model/User.js';\n`
    : '';

  const userByIdContent = opts.database === 'mongodb'
    ? ts
      ? `import { requireAuth } from 'express-file-cluster/auth';
${usersRequireRoleImport}import type { Request, Response } from 'express';
${adminUserByIdDbImport}${userByIdMeta}${middlewares}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  const user = await User.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...safe } = user;
  res.json({ user: safe });
};

export const PUT = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  const { name, email, role, isActive } = req.body;
  const updated = await User.update(id, { name, email, role, isActive });
  if (!updated) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...safe } = updated;
  res.json({ message: 'User updated', user: safe });
};

export const DELETE = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  const user = await User.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await User.delete(id);
  res.json({ message: \`User \${id} deleted\` });
};
`
      : `import { requireAuth } from 'express-file-cluster/auth';
${usersRequireRoleImport}${adminUserByIdDbImport}${userByIdMeta}${middlewares}
export const GET = async (req, res) => {
${roleGuard}  const { id } = req.params;
  const user = await User.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...safe } = user;
  res.json({ user: safe });
};

export const PUT = async (req, res) => {
${roleGuard}  const { id } = req.params;
  const { name, email, role, isActive } = req.body;
  const updated = await User.update(id, { name, email, role, isActive });
  if (!updated) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...safe } = updated;
  res.json({ message: 'User updated', user: safe });
};

export const DELETE = async (req, res) => {
${roleGuard}  const { id } = req.params;
  const user = await User.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await User.delete(id);
  res.json({ message: \`User \${id} deleted\` });
};
`
    : ts
      ? `import { requireAuth } from 'express-file-cluster/auth';
${usersRequireRoleImport}import type { Request, Response } from 'express';
${userByIdMeta}${middlewares}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: fetch user from DB
  res.json({ user: { id } });
};

export const PUT = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: update user in DB
  res.json({ message: 'User updated', user: { id, ...req.body } });
};

export const DELETE = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: delete user from DB
  res.json({ message: \`User \${id} deleted\` });
};
`
      : `import { requireAuth } from 'express-file-cluster/auth';
${usersRequireRoleImport}${userByIdMeta}${middlewares}
export const GET = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: fetch user from DB
  res.json({ user: { id } });
};

export const PUT = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: update user in DB
  res.json({ message: 'User updated', user: { id, ...req.body } });
};

export const DELETE = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: delete user from DB
  res.json({ message: \`User \${id} deleted\` });
};
`;

  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'users', `[id].${ext}`), userByIdContent);
}

async function writeUserRoutes(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';

  const requireRoleImport = opts.rbac
    ? `import { requireRole } from '../../middleware/requireRole.js';\n`
    : '';
  const middlewares = opts.rbac
    ? `export const middlewares = [requireAuth, requireRole('user', 'admin')];\n`
    : `export const middlewares = [requireAuth];\n`;

  const profileMeta = opts.routeDocs
    ? ts
      ? `import type { RouteMeta } from 'express-file-cluster';\n\nexport const meta: RouteMeta = {\n  description: "View or update the authenticated user's profile.",\n  response: { status: 200, body: { user: { id: '1', role: 'user', email: 'user@example.com' } } },\n};\n\n`
      : `export const meta = {\n  description: "View or update the authenticated user's profile.",\n  response: { status: 200, body: { user: { id: '1', role: 'user', email: 'user@example.com' } } },\n};\n\n`
    : '';

  const profileDbImport = opts.database === 'mongodb'
    ? `import { User } from '../../model/User.js';\n`
    : '';

  const profileContent = opts.database === 'mongodb'
    ? ts
      ? `import { requireAuth } from 'express-file-cluster/auth';
${requireRoleImport}import type { Request, Response } from 'express';
${profileDbImport}${profileMeta}${middlewares}
export const GET = async (req: Request, res: Response) => {
  const { id } = (req as any).user;
  const user = await User.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...safe } = user;
  res.json({ user: safe });
};

export const PUT = async (req: Request, res: Response) => {
  const { id } = (req as any).user;
  const { name, email } = req.body;
  const updated = await User.update(id, { name, email });
  if (!updated) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...safe } = updated;
  res.json({ message: 'Profile updated', user: safe });
};
`
      : `import { requireAuth } from 'express-file-cluster/auth';
${requireRoleImport}${profileDbImport}${profileMeta}${middlewares}
export const GET = async (req, res) => {
  const { id } = req.user;
  const user = await User.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...safe } = user;
  res.json({ user: safe });
};

export const PUT = async (req, res) => {
  const { id } = req.user;
  const { name, email } = req.body;
  const updated = await User.update(id, { name, email });
  if (!updated) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...safe } = updated;
  res.json({ message: 'Profile updated', user: safe });
};
`
    : ts
      ? `import { requireAuth } from 'express-file-cluster/auth';
${requireRoleImport}import type { Request, Response } from 'express';
${profileMeta}${middlewares}
export const GET = async (req: Request, res: Response) => {
  res.json({ user: (req as any).user });
};

export const PUT = async (req: Request, res: Response) => {
  const { name, email } = req.body;
  // TODO: update user in DB
  res.json({ message: 'Profile updated', user: { ...(req as any).user, name, email } });
};
`
      : `import { requireAuth } from 'express-file-cluster/auth';
${requireRoleImport}${profileMeta}${middlewares}
export const GET = async (req, res) => {
  res.json({ user: req.user });
};

export const PUT = async (req, res) => {
  const { name, email } = req.body;
  // TODO: update user in DB
  res.json({ message: 'Profile updated', user: { ...req.user, name, email } });
};
`;

  await fs.outputFile(path.join(dest, 'src', 'api', 'user', `profile.${ext}`), profileContent);
}

// ─── META HELPER ─────────────────────────────────────────────────────────

function mkMeta(opts: ScaffoldOptions, description: string, body: string, req?: string): string {
  if (!opts.routeDocs) return '';
  const reqLine = req ? `  request: { body: ${req} },\n` : '';
  return opts.language === 'typescript'
    ? `import type { RouteMeta } from 'express-file-cluster';\n\nexport const meta: RouteMeta = {\n  description: '${description}',\n${reqLine}  response: { status: 200, body: ${body} },\n};\n\n`
    : `export const meta = {\n  description: '${description}',\n${reqLine}  response: { status: 200, body: ${body} },\n};\n\n`;
}

// ─── EXTENDED MODEL WRITERS ───────────────────────────────────────────────

async function writeSessionModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface SessionDocument {
  userId: string;
  token: string;
  ip: string;
  userAgent: string;
  expiresAt: Date;
  isActive: boolean;
}

export const Session = defineModel<SessionDocument>('Session', {
  userId:    { type: 'string',  required: true },
  token:     { type: 'string',  required: true, unique: true },
  ip:        { type: 'string',  required: true },
  userAgent: { type: 'string',  required: true },
  expiresAt: { type: 'date',    required: true },
  isActive:  { type: 'boolean', default: true },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const Session = defineModel('Session', {
  userId:    { type: 'string',  required: true },
  token:     { type: 'string',  required: true, unique: true },
  ip:        { type: 'string',  required: true },
  userAgent: { type: 'string',  required: true },
  expiresAt: { type: 'date',    required: true },
  isActive:  { type: 'boolean', default: true },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for Session
// import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';
//
// export const sessions = pgTable('sessions', {
//   id:        serial('id').primaryKey(),
//   userId:    text('user_id').notNull(),
//   token:     text('token').notNull().unique(),
//   ip:        text('ip').notNull(),
//   userAgent: text('user_agent').notNull(),
//   expiresAt: timestamp('expires_at').notNull(),
//   isActive:  boolean('is_active').notNull().default(true),
// });
export {};
`
      : `// TODO: define your Drizzle schema for Session
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `Session.${ext}`), content);
}

async function writeNotificationModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface NotificationDocument {
  userId: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  link?: string;
}

export const Notification = defineModel<NotificationDocument>('Notification', {
  userId:  { type: 'string',  required: true },
  title:   { type: 'string',  required: true },
  message: { type: 'string',  required: true },
  type:    { type: 'string',  required: true, default: 'info' },
  isRead:  { type: 'boolean', default: false },
  link:    { type: 'string' },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const Notification = defineModel('Notification', {
  userId:  { type: 'string',  required: true },
  title:   { type: 'string',  required: true },
  message: { type: 'string',  required: true },
  type:    { type: 'string',  required: true, default: 'info' },
  isRead:  { type: 'boolean', default: false },
  link:    { type: 'string' },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for Notification
// import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';
//
// export const notifications = pgTable('notifications', {
//   id:      serial('id').primaryKey(),
//   userId:  text('user_id').notNull(),
//   title:   text('title').notNull(),
//   message: text('message').notNull(),
//   type:    text('type').notNull().default('info'),
//   isRead:  boolean('is_read').notNull().default(false),
//   link:    text('link'),
//   createdAt: timestamp('created_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for Notification
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `Notification.${ext}`), content);
}

async function writeFileModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface FileDocument {
  userId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  isPublic: boolean;
}

export const File = defineModel<FileDocument>('File', {
  userId:       { type: 'string',  required: true },
  filename:     { type: 'string',  required: true },
  originalName: { type: 'string',  required: true },
  mimeType:     { type: 'string',  required: true },
  size:         { type: 'number',  required: true },
  url:          { type: 'string',  required: true },
  isPublic:     { type: 'boolean', default: false },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const File = defineModel('File', {
  userId:       { type: 'string',  required: true },
  filename:     { type: 'string',  required: true },
  originalName: { type: 'string',  required: true },
  mimeType:     { type: 'string',  required: true },
  size:         { type: 'number',  required: true },
  url:          { type: 'string',  required: true },
  isPublic:     { type: 'boolean', default: false },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for File
// import { pgTable, serial, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
//
// export const files = pgTable('files', {
//   id:           serial('id').primaryKey(),
//   userId:       text('user_id').notNull(),
//   filename:     text('filename').notNull(),
//   originalName: text('original_name').notNull(),
//   mimeType:     text('mime_type').notNull(),
//   size:         integer('size').notNull(),
//   url:          text('url').notNull(),
//   isPublic:     boolean('is_public').notNull().default(false),
//   createdAt:    timestamp('created_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for File
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `File.${ext}`), content);
}

async function writeSupportTicketModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface SupportTicketDocument {
  userId: string;
  subject: string;
  message: string;
  status: string;
  priority: string;
  assignedTo?: string;
}

export const SupportTicket = defineModel<SupportTicketDocument>('SupportTicket', {
  userId:     { type: 'string', required: true },
  subject:    { type: 'string', required: true },
  message:    { type: 'string', required: true },
  status:     { type: 'string', required: true, default: 'open' },
  priority:   { type: 'string', required: true, default: 'normal' },
  assignedTo: { type: 'string' },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const SupportTicket = defineModel('SupportTicket', {
  userId:     { type: 'string', required: true },
  subject:    { type: 'string', required: true },
  message:    { type: 'string', required: true },
  status:     { type: 'string', required: true, default: 'open' },
  priority:   { type: 'string', required: true, default: 'normal' },
  assignedTo: { type: 'string' },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for SupportTicket
// import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
//
// export const supportTickets = pgTable('support_tickets', {
//   id:         serial('id').primaryKey(),
//   userId:     text('user_id').notNull(),
//   subject:    text('subject').notNull(),
//   message:    text('message').notNull(),
//   status:     text('status').notNull().default('open'),
//   priority:   text('priority').notNull().default('normal'),
//   assignedTo: text('assigned_to'),
//   createdAt:  timestamp('created_at').defaultNow(),
//   updatedAt:  timestamp('updated_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for SupportTicket
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `SupportTicket.${ext}`), content);
}

async function writeAuditLogModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface AuditLogDocument {
  adminId: string;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ip: string;
}

export const AuditLog = defineModel<AuditLogDocument>('AuditLog', {
  adminId:  { type: 'string', required: true },
  action:   { type: 'string', required: true },
  entity:   { type: 'string', required: true },
  entityId: { type: 'string', required: true },
  metadata: { type: 'object' },
  ip:       { type: 'string', required: true },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const AuditLog = defineModel('AuditLog', {
  adminId:  { type: 'string', required: true },
  action:   { type: 'string', required: true },
  entity:   { type: 'string', required: true },
  entityId: { type: 'string', required: true },
  metadata: { type: 'object' },
  ip:       { type: 'string', required: true },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for AuditLog
// import { pgTable, serial, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
//
// export const auditLogs = pgTable('audit_logs', {
//   id:        serial('id').primaryKey(),
//   adminId:   text('admin_id').notNull(),
//   action:    text('action').notNull(),
//   entity:    text('entity').notNull(),
//   entityId:  text('entity_id').notNull(),
//   metadata:  jsonb('metadata'),
//   ip:        text('ip').notNull(),
//   createdAt: timestamp('created_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for AuditLog
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `AuditLog.${ext}`), content);
}

async function writeSubscriptionModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface SubscriptionDocument {
  userId: string;
  planId: string;
  status: string;
  startDate: Date;
  endDate: Date;
  cancelledAt?: Date;
}

export const Subscription = defineModel<SubscriptionDocument>('Subscription', {
  userId:      { type: 'string', required: true },
  planId:      { type: 'string', required: true },
  status:      { type: 'string', required: true, default: 'active' },
  startDate:   { type: 'date',   required: true },
  endDate:     { type: 'date',   required: true },
  cancelledAt: { type: 'date' },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const Subscription = defineModel('Subscription', {
  userId:      { type: 'string', required: true },
  planId:      { type: 'string', required: true },
  status:      { type: 'string', required: true, default: 'active' },
  startDate:   { type: 'date',   required: true },
  endDate:     { type: 'date',   required: true },
  cancelledAt: { type: 'date' },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for Subscription
// import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
//
// export const subscriptions = pgTable('subscriptions', {
//   id:          serial('id').primaryKey(),
//   userId:      text('user_id').notNull(),
//   planId:      text('plan_id').notNull(),
//   status:      text('status').notNull().default('active'),
//   startDate:   timestamp('start_date').notNull(),
//   endDate:     timestamp('end_date').notNull(),
//   cancelledAt: timestamp('cancelled_at'),
//   createdAt:   timestamp('created_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for Subscription
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `Subscription.${ext}`), content);
}

async function writePlanModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface PlanDocument {
  name: string;
  description: string;
  price: number;
  interval: string;
  features: string[];
  isActive: boolean;
}

export const Plan = defineModel<PlanDocument>('Plan', {
  name:        { type: 'string',  required: true },
  description: { type: 'string',  required: true },
  price:       { type: 'number',  required: true },
  interval:    { type: 'string',  required: true, default: 'monthly' },
  features:    { type: 'array',   default: [] },
  isActive:    { type: 'boolean', default: true },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const Plan = defineModel('Plan', {
  name:        { type: 'string',  required: true },
  description: { type: 'string',  required: true },
  price:       { type: 'number',  required: true },
  interval:    { type: 'string',  required: true, default: 'monthly' },
  features:    { type: 'array',   default: [] },
  isActive:    { type: 'boolean', default: true },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for Plan
// import { pgTable, serial, text, numeric, boolean, timestamp } from 'drizzle-orm/pg-core';
//
// export const plans = pgTable('plans', {
//   id:          serial('id').primaryKey(),
//   name:        text('name').notNull(),
//   description: text('description').notNull(),
//   price:       numeric('price').notNull(),
//   interval:    text('interval').notNull().default('monthly'),
//   features:    text('features').array().notNull().default([]),
//   isActive:    boolean('is_active').notNull().default(true),
//   createdAt:   timestamp('created_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for Plan
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `Plan.${ext}`), content);
}

async function writeInvoiceModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface InvoiceDocument {
  userId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: string;
  paidAt?: Date;
}

export const Invoice = defineModel<InvoiceDocument>('Invoice', {
  userId:         { type: 'string', required: true },
  subscriptionId: { type: 'string', required: true },
  amount:         { type: 'number', required: true },
  currency:       { type: 'string', required: true, default: 'USD' },
  status:         { type: 'string', required: true, default: 'pending' },
  paidAt:         { type: 'date' },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const Invoice = defineModel('Invoice', {
  userId:         { type: 'string', required: true },
  subscriptionId: { type: 'string', required: true },
  amount:         { type: 'number', required: true },
  currency:       { type: 'string', required: true, default: 'USD' },
  status:         { type: 'string', required: true, default: 'pending' },
  paidAt:         { type: 'date' },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for Invoice
// import { pgTable, serial, text, numeric, timestamp } from 'drizzle-orm/pg-core';
//
// export const invoices = pgTable('invoices', {
//   id:             serial('id').primaryKey(),
//   userId:         text('user_id').notNull(),
//   subscriptionId: text('subscription_id').notNull(),
//   amount:         numeric('amount').notNull(),
//   currency:       text('currency').notNull().default('USD'),
//   status:         text('status').notNull().default('pending'),
//   paidAt:         timestamp('paid_at'),
//   createdAt:      timestamp('created_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for Invoice
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `Invoice.${ext}`), content);
}

async function writeApiKeyModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface ApiKeyDocument {
  userId: string;
  name: string;
  key: string;
  lastUsed?: Date;
  expiresAt?: Date;
  isActive: boolean;
}

export const ApiKey = defineModel<ApiKeyDocument>('ApiKey', {
  userId:   { type: 'string',  required: true },
  name:     { type: 'string',  required: true },
  key:      { type: 'string',  required: true, unique: true },
  lastUsed: { type: 'date' },
  expiresAt:{ type: 'date' },
  isActive: { type: 'boolean', default: true },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const ApiKey = defineModel('ApiKey', {
  userId:    { type: 'string',  required: true },
  name:      { type: 'string',  required: true },
  key:       { type: 'string',  required: true, unique: true },
  lastUsed:  { type: 'date' },
  expiresAt: { type: 'date' },
  isActive:  { type: 'boolean', default: true },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for ApiKey
// import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';
//
// export const apiKeys = pgTable('api_keys', {
//   id:        serial('id').primaryKey(),
//   userId:    text('user_id').notNull(),
//   name:      text('name').notNull(),
//   key:       text('key').notNull().unique(),
//   lastUsed:  timestamp('last_used'),
//   expiresAt: timestamp('expires_at'),
//   isActive:  boolean('is_active').notNull().default(true),
//   createdAt: timestamp('created_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for ApiKey
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `ApiKey.${ext}`), content);
}

async function writeRoleModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface RoleDocument {
  name: string;
  description: string;
  permissions: string[];
}

export const Role = defineModel<RoleDocument>('Role', {
  name:        { type: 'string', required: true, unique: true },
  description: { type: 'string', required: true },
  permissions: { type: 'array',  default: [] },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const Role = defineModel('Role', {
  name:        { type: 'string', required: true, unique: true },
  description: { type: 'string', required: true },
  permissions: { type: 'array',  default: [] },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for Role
// import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
//
// export const roles = pgTable('roles', {
//   id:          serial('id').primaryKey(),
//   name:        text('name').notNull().unique(),
//   description: text('description').notNull(),
//   permissions: text('permissions').array().notNull().default([]),
//   createdAt:   timestamp('created_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for Role
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `Role.${ext}`), content);
}

async function writeFAQModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface FAQDocument {
  question: string;
  answer: string;
  category: string;
  order: number;
  isPublished: boolean;
}

export const FAQ = defineModel<FAQDocument>('FAQ', {
  question:    { type: 'string',  required: true },
  answer:      { type: 'string',  required: true },
  category:    { type: 'string',  required: true, default: 'general' },
  order:       { type: 'number',  default: 0 },
  isPublished: { type: 'boolean', default: false },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const FAQ = defineModel('FAQ', {
  question:    { type: 'string',  required: true },
  answer:      { type: 'string',  required: true },
  category:    { type: 'string',  required: true, default: 'general' },
  order:       { type: 'number',  default: 0 },
  isPublished: { type: 'boolean', default: false },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for FAQ
// import { pgTable, serial, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
//
// export const faqs = pgTable('faqs', {
//   id:          serial('id').primaryKey(),
//   question:    text('question').notNull(),
//   answer:      text('answer').notNull(),
//   category:    text('category').notNull().default('general'),
//   order:       integer('order').notNull().default(0),
//   isPublished: boolean('is_published').notNull().default(false),
//   createdAt:   timestamp('created_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for FAQ
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `FAQ.${ext}`), content);
}

async function writeBlogModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface BlogDocument {
  title: string;
  slug: string;
  content: string;
  authorId: string;
  category: string;
  tags: string[];
  status: string;
  publishedAt?: Date;
}

export const Blog = defineModel<BlogDocument>('Blog', {
  title:       { type: 'string', required: true },
  slug:        { type: 'string', required: true, unique: true },
  content:     { type: 'string', required: true },
  authorId:    { type: 'string', required: true },
  category:    { type: 'string', required: true, default: 'general' },
  tags:        { type: 'array',  default: [] },
  status:      { type: 'string', required: true, default: 'draft' },
  publishedAt: { type: 'date' },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const Blog = defineModel('Blog', {
  title:       { type: 'string', required: true },
  slug:        { type: 'string', required: true, unique: true },
  content:     { type: 'string', required: true },
  authorId:    { type: 'string', required: true },
  category:    { type: 'string', required: true, default: 'general' },
  tags:        { type: 'array',  default: [] },
  status:      { type: 'string', required: true, default: 'draft' },
  publishedAt: { type: 'date' },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for Blog
// import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
//
// export const blogs = pgTable('blogs', {
//   id:          serial('id').primaryKey(),
//   title:       text('title').notNull(),
//   slug:        text('slug').notNull().unique(),
//   content:     text('content').notNull(),
//   authorId:    text('author_id').notNull(),
//   category:    text('category').notNull().default('general'),
//   tags:        text('tags').array().notNull().default([]),
//   status:      text('status').notNull().default('draft'),
//   publishedAt: timestamp('published_at'),
//   createdAt:   timestamp('created_at').defaultNow(),
//   updatedAt:   timestamp('updated_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for Blog
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `Blog.${ext}`), content);
}

async function writeCategoryModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface CategoryDocument {
  name: string;
  slug: string;
  description?: string;
  parentId?: string;
}

export const Category = defineModel<CategoryDocument>('Category', {
  name:        { type: 'string', required: true },
  slug:        { type: 'string', required: true, unique: true },
  description: { type: 'string' },
  parentId:    { type: 'string' },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const Category = defineModel('Category', {
  name:        { type: 'string', required: true },
  slug:        { type: 'string', required: true, unique: true },
  description: { type: 'string' },
  parentId:    { type: 'string' },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for Category
// import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
//
// export const categories = pgTable('categories', {
//   id:          serial('id').primaryKey(),
//   name:        text('name').notNull(),
//   slug:        text('slug').notNull().unique(),
//   description: text('description'),
//   parentId:    text('parent_id'),
//   createdAt:   timestamp('created_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for Category
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `Category.${ext}`), content);
}

async function writeCouponModel(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  const content = opts.database === 'mongodb'
    ? ts
      ? `import { defineModel } from 'express-file-cluster';

export interface CouponDocument {
  code: string;
  type: string;
  value: number;
  maxUses: number;
  usedCount: number;
  expiresAt?: Date;
  isActive: boolean;
}

export const Coupon = defineModel<CouponDocument>('Coupon', {
  code:      { type: 'string',  required: true, unique: true },
  type:      { type: 'string',  required: true, default: 'percent' },
  value:     { type: 'number',  required: true },
  maxUses:   { type: 'number',  default: 0 },
  usedCount: { type: 'number',  default: 0 },
  expiresAt: { type: 'date' },
  isActive:  { type: 'boolean', default: true },
});
`
      : `import { defineModel } from 'express-file-cluster';

export const Coupon = defineModel('Coupon', {
  code:      { type: 'string',  required: true, unique: true },
  type:      { type: 'string',  required: true, default: 'percent' },
  value:     { type: 'number',  required: true },
  maxUses:   { type: 'number',  default: 0 },
  usedCount: { type: 'number',  default: 0 },
  expiresAt: { type: 'date' },
  isActive:  { type: 'boolean', default: true },
});
`
    : ts
      ? `// TODO: define your Drizzle schema for Coupon
// import { pgTable, serial, text, numeric, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
//
// export const coupons = pgTable('coupons', {
//   id:        serial('id').primaryKey(),
//   code:      text('code').notNull().unique(),
//   type:      text('type').notNull().default('percent'),
//   value:     numeric('value').notNull(),
//   maxUses:   integer('max_uses').notNull().default(0),
//   usedCount: integer('used_count').notNull().default(0),
//   expiresAt: timestamp('expires_at'),
//   isActive:  boolean('is_active').notNull().default(true),
//   createdAt: timestamp('created_at').defaultNow(),
// });
export {};
`
      : `// TODO: define your Drizzle schema for Coupon
export {};
`;
  await fs.outputFile(path.join(dest, 'src', 'model', `Coupon.${ext}`), content);
}

// ─── EXTENDED ROUTE WRITERS ───────────────────────────────────────────────

async function writeAuthExtendedRoutes(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  // requireRole import paths: auth/* = 2 levels, auth/subdir/* = 3 levels
  const rr2 = opts.rbac ? `import { requireRole } from '../../middleware/requireRole.js';\n` : '';
  const rr3 = opts.rbac ? `import { requireRole } from '../../../middleware/requireRole.js';\n` : '';
  const mwUser2 = opts.rbac
    ? `export const middlewares = [requireAuth, requireRole('user', 'admin')];\n`
    : `export const middlewares = [requireAuth];\n`;
  const mwUser3 = mwUser2;
  const reqT = ts ? `import type { Request, Response } from 'express';\n` : '';
  const RA = `import { requireAuth } from 'express-file-cluster/auth';\n`;

  // refresh.ts
  const refreshMeta = mkMeta(opts, 'Refresh the JWT and issue a new token.', `{ message: 'Token refreshed' }`);
  const refreshContent = ts
    ? `${RA}import type { Request, Response } from 'express';
${refreshMeta}export const POST = async (_req: Request, res: Response) => {
  // TODO: validate refresh token, issue new JWT
  res.json({ message: 'Token refreshed' });
};
`
    : `${RA}${refreshMeta}export const POST = async (_req, res) => {
  // TODO: validate refresh token, issue new JWT
  res.json({ message: 'Token refreshed' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', `refresh.${ext}`), refreshContent);

  // verify-email.ts
  const veMeta = mkMeta(opts, 'Verify email address via token or resend verification email.', `{ message: 'Email verified' }`);
  const veContent = ts
    ? `${RA}import type { Request, Response } from 'express';
${veMeta}export const GET = async (req: Request, res: Response) => {
  const { token } = req.query;
  // TODO: verify token and mark user as verified
  res.json({ message: 'Email verified' });
};

export const POST = async (_req: Request, res: Response) => {
  // TODO: resend verification email
  res.json({ message: 'Verification email sent' });
};
`
    : `${RA}${veMeta}export const GET = async (req, res) => {
  const { token } = req.query;
  // TODO: verify token and mark user as verified
  res.json({ message: 'Email verified' });
};

export const POST = async (_req, res) => {
  // TODO: resend verification email
  res.json({ message: 'Verification email sent' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', `verify-email.${ext}`), veContent);

  // forgot-password.ts
  const fpMeta = mkMeta(opts, 'Send a password reset email to the given address.', `{ message: 'Reset email sent' }`, `{ email: 'user@example.com' }`);
  const fpContent = ts
    ? `${RA}import type { Request, Response } from 'express';
${fpMeta}export const POST = async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });
  // TODO: generate reset token and send email
  res.json({ message: 'Reset email sent' });
};
`
    : `${RA}${fpMeta}export const POST = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });
  // TODO: generate reset token and send email
  res.json({ message: 'Reset email sent' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', `forgot-password.${ext}`), fpContent);

  // reset-password.ts
  const rpMeta = mkMeta(opts, 'Reset password using a valid reset token.', `{ message: 'Password reset successfully' }`, `{ token: 'reset-token', password: 'newpassword' }`);
  const rpContent = ts
    ? `${RA}import type { Request, Response } from 'express';
${rpMeta}export const POST = async (req: Request, res: Response) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
  // TODO: validate token, hash and update password
  res.json({ message: 'Password reset successfully' });
};
`
    : `${RA}${rpMeta}export const POST = async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
  // TODO: validate token, hash and update password
  res.json({ message: 'Password reset successfully' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', `reset-password.${ext}`), rpContent);

  // change-password.ts (protected)
  const cpMeta = mkMeta(opts, 'Change password for the authenticated user.', `{ message: 'Password changed successfully' }`, `{ oldPassword: 'current', newPassword: 'newpassword' }`);
  const cpContent = ts
    ? `${RA}${rr2}import type { Request, Response } from 'express';
${cpMeta}${mwUser2}
export const POST = async (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'oldPassword and newPassword are required' });
  // TODO: verify old password, hash and update new password
  res.json({ message: 'Password changed successfully' });
};
`
    : `${RA}${rr2}${cpMeta}${mwUser2}
export const POST = async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'oldPassword and newPassword are required' });
  // TODO: verify old password, hash and update new password
  res.json({ message: 'Password changed successfully' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', `change-password.${ext}`), cpContent);

  // 2fa/setup.ts
  const tfaSetupMeta = mkMeta(opts, 'Get 2FA QR code (GET) or enable 2FA with a verified TOTP code (POST).', `{ message: '2FA enabled' }`);
  const tfaSetupContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${tfaSetupMeta}${mwUser3}
export const GET = async (req: Request, res: Response) => {
  // TODO: generate TOTP secret and return QR code URL
  res.json({ qrCode: 'otpauth://totp/...', secret: 'BASE32SECRET' });
};

export const POST = async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  // TODO: verify TOTP code and enable 2FA
  res.json({ message: '2FA enabled' });
};
`
    : `${RA}${rr3}${tfaSetupMeta}${mwUser3}
export const GET = async (req, res) => {
  // TODO: generate TOTP secret and return QR code URL
  res.json({ qrCode: 'otpauth://totp/...', secret: 'BASE32SECRET' });
};

export const POST = async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  // TODO: verify TOTP code and enable 2FA
  res.json({ message: '2FA enabled' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', '2fa', `setup.${ext}`), tfaSetupContent);

  // 2fa/verify.ts
  const tfaVerifyMeta = mkMeta(opts, 'Verify a TOTP code during login.', `{ message: '2FA verified' }`);
  const tfaVerifyContent = ts
    ? `${RA}import type { Request, Response } from 'express';
${tfaVerifyMeta}export const POST = async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  // TODO: verify TOTP code
  res.json({ message: '2FA verified' });
};
`
    : `${RA}${tfaVerifyMeta}export const POST = async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  // TODO: verify TOTP code
  res.json({ message: '2FA verified' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', '2fa', `verify.${ext}`), tfaVerifyContent);

  // 2fa/disable.ts
  const tfaDisableMeta = mkMeta(opts, 'Disable 2FA for the authenticated user.', `{ message: '2FA disabled' }`);
  const tfaDisableContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${tfaDisableMeta}${mwUser3}
export const POST = async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  // TODO: verify code and disable 2FA
  res.json({ message: '2FA disabled' });
};
`
    : `${RA}${rr3}${tfaDisableMeta}${mwUser3}
export const POST = async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  // TODO: verify code and disable 2FA
  res.json({ message: '2FA disabled' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', '2fa', `disable.${ext}`), tfaDisableContent);

  // sessions/index.ts
  const sessListMeta = mkMeta(opts, 'List all active sessions for the authenticated user.', `{ sessions: [] }`);
  const sessListContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${sessListMeta}${mwUser3}
export const GET = async (req: Request, res: Response) => {
  // TODO: fetch sessions for req.user.id
  res.json({ sessions: [] });
};
`
    : `${RA}${rr3}${sessListMeta}${mwUser3}
export const GET = async (req, res) => {
  // TODO: fetch sessions for req.user.id
  res.json({ sessions: [] });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', 'sessions', `index.${ext}`), sessListContent);

  // sessions/[id].ts
  const sessRevokeContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${mwUser3}
export const DELETE = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: revoke session by id
  res.json({ message: \`Session \${id} revoked\` });
};
`
    : `${RA}${rr3}${mwUser3}
export const DELETE = async (req, res) => {
  const { id } = req.params;
  // TODO: revoke session by id
  res.json({ message: \`Session \${id} revoked\` });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'auth', 'sessions', `[id].${ext}`), sessRevokeContent);
}

async function writeUserExtendedRoutes(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  // user/* = 2 levels up to src/, user/subdir/* = 3 levels
  const rr2 = opts.rbac ? `import { requireRole } from '../../middleware/requireRole.js';\n` : '';
  const rr3 = opts.rbac ? `import { requireRole } from '../../../middleware/requireRole.js';\n` : '';
  const mw2 = opts.rbac
    ? `export const middlewares = [requireAuth, requireRole('user', 'admin')];\n`
    : `export const middlewares = [requireAuth];\n`;
  const mw3 = mw2;
  const RA = `import { requireAuth } from 'express-file-cluster/auth';\n`;
  const user = ts ? `(req as any).user` : `req.user`;

  // avatar.ts
  const avatarMeta = mkMeta(opts, 'Upload (POST) or remove (DELETE) the authenticated user avatar.', `{ message: 'Avatar updated', url: 'https://...' }`);
  const avatarContent = ts
    ? `${RA}${rr2}import type { Request, Response } from 'express';
${avatarMeta}${mw2}
export const POST = async (req: Request, res: Response) => {
  // TODO: handle multipart upload, store file, update user.avatar
  res.json({ message: 'Avatar updated', url: 'https://example.com/avatar.jpg' });
};

export const DELETE = async (req: Request, res: Response) => {
  // TODO: remove avatar and clear user.avatar
  res.json({ message: 'Avatar removed' });
};
`
    : `${RA}${rr2}${avatarMeta}${mw2}
export const POST = async (req, res) => {
  // TODO: handle multipart upload, store file, update user.avatar
  res.json({ message: 'Avatar updated', url: 'https://example.com/avatar.jpg' });
};

export const DELETE = async (req, res) => {
  // TODO: remove avatar and clear user.avatar
  res.json({ message: 'Avatar removed' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', `avatar.${ext}`), avatarContent);

  // settings.ts
  const settingsMeta = mkMeta(opts, 'Get or update account settings (notifications, language, theme, privacy).', `{ settings: { notifications: true, language: 'en', theme: 'system' } }`);
  const settingsContent = ts
    ? `${RA}${rr2}import type { Request, Response } from 'express';
${settingsMeta}${mw2}
export const GET = async (req: Request, res: Response) => {
  // TODO: fetch user settings from DB
  res.json({ settings: { notifications: true, language: 'en', theme: 'system', privacy: 'public' } });
};

export const PUT = async (req: Request, res: Response) => {
  const { notifications, language, theme, privacy } = req.body;
  // TODO: update user settings in DB
  res.json({ message: 'Settings updated', settings: { notifications, language, theme, privacy } });
};
`
    : `${RA}${rr2}${settingsMeta}${mw2}
export const GET = async (req, res) => {
  // TODO: fetch user settings from DB
  res.json({ settings: { notifications: true, language: 'en', theme: 'system', privacy: 'public' } });
};

export const PUT = async (req, res) => {
  const { notifications, language, theme, privacy } = req.body;
  // TODO: update user settings in DB
  res.json({ message: 'Settings updated', settings: { notifications, language, theme, privacy } });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', `settings.${ext}`), settingsContent);

  // account.ts
  const accountMeta = mkMeta(opts, 'Delete account (DELETE) or download personal data (GET).', `{ message: 'Account deleted' }`);
  const accountContent = ts
    ? `${RA}${rr2}import type { Request, Response } from 'express';
${accountMeta}${mw2}
export const GET = async (req: Request, res: Response) => {
  // TODO: compile and return personal data export
  res.json({ data: { user: ${user}, exportedAt: new Date().toISOString() } });
};

export const DELETE = async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password confirmation required' });
  // TODO: verify password, schedule account deletion
  res.json({ message: 'Account scheduled for deletion' });
};
`
    : `${RA}${rr2}${accountMeta}${mw2}
export const GET = async (req, res) => {
  // TODO: compile and return personal data export
  res.json({ data: { user: ${user}, exportedAt: new Date().toISOString() } });
};

export const DELETE = async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password confirmation required' });
  // TODO: verify password, schedule account deletion
  res.json({ message: 'Account scheduled for deletion' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', `account.${ext}`), accountContent);

  // dashboard.ts
  const dashMeta = mkMeta(opts, 'Personal dashboard: stats, recent activity, and quick actions.', `{ stats: {}, recentActivity: [], quickActions: [] }`);
  const dashContent = ts
    ? `${RA}${rr2}import type { Request, Response } from 'express';
${dashMeta}${mw2}
export const GET = async (req: Request, res: Response) => {
  // TODO: aggregate personal stats and activity
  res.json({ stats: {}, recentActivity: [], quickActions: [] });
};
`
    : `${RA}${rr2}${dashMeta}${mw2}
export const GET = async (req, res) => {
  // TODO: aggregate personal stats and activity
  res.json({ stats: {}, recentActivity: [], quickActions: [] });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', `dashboard.${ext}`), dashContent);

  // activity.ts
  const actMeta = mkMeta(opts, 'Paginated activity history for the authenticated user.', `{ activities: [], total: 0, page: 1, limit: 20 }`);
  const actContent = ts
    ? `${RA}${rr2}import type { Request, Response } from 'express';
${actMeta}${mw2}
export const GET = async (req: Request, res: Response) => {
  const { page = 1, limit = 20 } = req.query;
  // TODO: fetch paginated activity log
  res.json({ activities: [], total: 0, page: Number(page), limit: Number(limit) });
};
`
    : `${RA}${rr2}${actMeta}${mw2}
export const GET = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  // TODO: fetch paginated activity log
  res.json({ activities: [], total: 0, page: Number(page), limit: Number(limit) });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', `activity.${ext}`), actContent);

  // notifications/index.ts
  const notifListMeta = mkMeta(opts, 'List notifications (GET) or mark all as read (POST).', `{ notifications: [], total: 0, unread: 0 }`);
  const notifListContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${notifListMeta}${mw3}
export const GET = async (req: Request, res: Response) => {
  // TODO: fetch notifications for user
  res.json({ notifications: [], total: 0, unread: 0 });
};

export const POST = async (req: Request, res: Response) => {
  // TODO: mark all notifications as read
  res.json({ message: 'All notifications marked as read' });
};
`
    : `${RA}${rr3}${notifListMeta}${mw3}
export const GET = async (req, res) => {
  // TODO: fetch notifications for user
  res.json({ notifications: [], total: 0, unread: 0 });
};

export const POST = async (req, res) => {
  // TODO: mark all notifications as read
  res.json({ message: 'All notifications marked as read' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'notifications', `index.${ext}`), notifListContent);

  // notifications/[id].ts
  const notifByIdContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${mw3}
export const GET = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: fetch notification by id
  res.json({ notification: { id } });
};

export const PATCH = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: mark notification as read
  res.json({ message: 'Notification marked as read', id });
};

export const DELETE = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: delete notification
  res.json({ message: \`Notification \${id} deleted\` });
};
`
    : `${RA}${rr3}${mw3}
export const GET = async (req, res) => {
  const { id } = req.params;
  // TODO: fetch notification by id
  res.json({ notification: { id } });
};

export const PATCH = async (req, res) => {
  const { id } = req.params;
  // TODO: mark notification as read
  res.json({ message: 'Notification marked as read', id });
};

export const DELETE = async (req, res) => {
  const { id } = req.params;
  // TODO: delete notification
  res.json({ message: \`Notification \${id} deleted\` });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'notifications', `[id].${ext}`), notifByIdContent);

  // files/index.ts
  const filesListMeta = mkMeta(opts, 'List uploaded files with storage usage (GET) or upload a new file (POST).', `{ files: [], total: 0, storageUsed: 0 }`);
  const filesListContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${filesListMeta}${mw3}
export const GET = async (req: Request, res: Response) => {
  // TODO: fetch user files and compute storage usage
  res.json({ files: [], total: 0, storageUsed: 0 });
};

export const POST = async (req: Request, res: Response) => {
  // TODO: handle multipart upload, persist file record
  res.status(201).json({ message: 'File uploaded', file: { id: 'new-id' } });
};
`
    : `${RA}${rr3}${filesListMeta}${mw3}
export const GET = async (req, res) => {
  // TODO: fetch user files and compute storage usage
  res.json({ files: [], total: 0, storageUsed: 0 });
};

export const POST = async (req, res) => {
  // TODO: handle multipart upload, persist file record
  res.status(201).json({ message: 'File uploaded', file: { id: 'new-id' } });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'files', `index.${ext}`), filesListContent);

  // files/[id].ts
  const fileByIdContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${mw3}
export const GET = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: stream or redirect to file download/preview URL
  res.json({ file: { id, url: 'https://...' } });
};

export const DELETE = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: delete file from storage and DB
  res.json({ message: \`File \${id} deleted\` });
};
`
    : `${RA}${rr3}${mw3}
export const GET = async (req, res) => {
  const { id } = req.params;
  // TODO: stream or redirect to file download/preview URL
  res.json({ file: { id, url: 'https://...' } });
};

export const DELETE = async (req, res) => {
  const { id } = req.params;
  // TODO: delete file from storage and DB
  res.json({ message: \`File \${id} deleted\` });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'files', `[id].${ext}`), fileByIdContent);

  // favorites/index.ts
  const favListContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${mw3}
export const GET = async (req: Request, res: Response) => {
  // TODO: fetch user favorites
  res.json({ favorites: [] });
};

export const POST = async (req: Request, res: Response) => {
  const { entityId, entityType } = req.body;
  if (!entityId || !entityType) return res.status(400).json({ error: 'entityId and entityType are required' });
  // TODO: add to favorites
  res.status(201).json({ message: 'Added to favorites' });
};
`
    : `${RA}${rr3}${mw3}
export const GET = async (req, res) => {
  // TODO: fetch user favorites
  res.json({ favorites: [] });
};

export const POST = async (req, res) => {
  const { entityId, entityType } = req.body;
  if (!entityId || !entityType) return res.status(400).json({ error: 'entityId and entityType are required' });
  // TODO: add to favorites
  res.status(201).json({ message: 'Added to favorites' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'favorites', `index.${ext}`), favListContent);

  // favorites/[id].ts
  const favByIdContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${mw3}
export const DELETE = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: remove from favorites
  res.json({ message: \`Removed favorite \${id}\` });
};
`
    : `${RA}${rr3}${mw3}
export const DELETE = async (req, res) => {
  const { id } = req.params;
  // TODO: remove from favorites
  res.json({ message: \`Removed favorite \${id}\` });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'favorites', `[id].${ext}`), favByIdContent);

  // bookmarks/index.ts
  const bkListContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${mw3}
export const GET = async (req: Request, res: Response) => {
  // TODO: fetch user bookmarks
  res.json({ bookmarks: [] });
};

export const POST = async (req: Request, res: Response) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  // TODO: save bookmark
  res.status(201).json({ message: 'Bookmark saved' });
};
`
    : `${RA}${rr3}${mw3}
export const GET = async (req, res) => {
  // TODO: fetch user bookmarks
  res.json({ bookmarks: [] });
};

export const POST = async (req, res) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  // TODO: save bookmark
  res.status(201).json({ message: 'Bookmark saved' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'bookmarks', `index.${ext}`), bkListContent);

  // bookmarks/[id].ts
  const bkByIdContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${mw3}
export const DELETE = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: delete bookmark
  res.json({ message: \`Bookmark \${id} removed\` });
};
`
    : `${RA}${rr3}${mw3}
export const DELETE = async (req, res) => {
  const { id } = req.params;
  // TODO: delete bookmark
  res.json({ message: \`Bookmark \${id} removed\` });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'bookmarks', `[id].${ext}`), bkByIdContent);

  // search.ts
  const searchMeta = mkMeta(opts, 'Search with filters, sort, and pagination.', `{ results: [], total: 0, page: 1, limit: 20 }`);
  const searchContent = ts
    ? `${RA}${rr2}import type { Request, Response } from 'express';
${searchMeta}${mw2}
export const GET = async (req: Request, res: Response) => {
  const { q, filter, sort, page = 1, limit = 20 } = req.query;
  // TODO: implement search
  res.json({ results: [], total: 0, page: Number(page), limit: Number(limit) });
};
`
    : `${RA}${rr2}${searchMeta}${mw2}
export const GET = async (req, res) => {
  const { q, filter, sort, page = 1, limit = 20 } = req.query;
  // TODO: implement search
  res.json({ results: [], total: 0, page: Number(page), limit: Number(limit) });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', `search.${ext}`), searchContent);

  // api-keys/index.ts
  const akListMeta = mkMeta(opts, 'List API keys (GET) or create a new one (POST).', `{ apiKeys: [] }`);
  const akListContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${akListMeta}${mw3}
export const GET = async (req: Request, res: Response) => {
  // TODO: fetch api keys for user
  res.json({ apiKeys: [] });
};

export const POST = async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  // TODO: generate and store API key
  res.status(201).json({ message: 'API key created', key: 'efc_...' });
};
`
    : `${RA}${rr3}${akListMeta}${mw3}
export const GET = async (req, res) => {
  // TODO: fetch api keys for user
  res.json({ apiKeys: [] });
};

export const POST = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  // TODO: generate and store API key
  res.status(201).json({ message: 'API key created', key: 'efc_...' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'api-keys', `index.${ext}`), akListContent);

  // api-keys/[id].ts
  const akByIdContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${mw3}
export const DELETE = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: revoke and delete API key
  res.json({ message: \`API key \${id} revoked\` });
};
`
    : `${RA}${rr3}${mw3}
export const DELETE = async (req, res) => {
  const { id } = req.params;
  // TODO: revoke and delete API key
  res.json({ message: \`API key \${id} revoked\` });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'api-keys', `[id].${ext}`), akByIdContent);
}

async function writeUserBillingRoutes(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  // user/billing/* = 3 levels, user/billing/subdir/* = 4 levels
  const rr3 = opts.rbac ? `import { requireRole } from '../../../middleware/requireRole.js';\n` : '';
  const rr4 = opts.rbac ? `import { requireRole } from '../../../../middleware/requireRole.js';\n` : '';
  const mw3 = opts.rbac
    ? `export const middlewares = [requireAuth, requireRole('user', 'admin')];\n`
    : `export const middlewares = [requireAuth];\n`;
  const mw4 = mw3;
  const RA = `import { requireAuth } from 'express-file-cluster/auth';\n`;

  // billing/plans.ts
  const plansMeta = mkMeta(opts, 'List all available subscription plans.', `{ plans: [] }`);
  const plansContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${plansMeta}${mw3}
export const GET = async (_req: Request, res: Response) => {
  // TODO: fetch active plans from DB
  res.json({ plans: [] });
};
`
    : `${RA}${rr3}${plansMeta}${mw3}
export const GET = async (_req, res) => {
  // TODO: fetch active plans from DB
  res.json({ plans: [] });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'billing', `plans.${ext}`), plansContent);

  // billing/subscription.ts
  const subMeta = mkMeta(opts, 'Get current subscription (GET), subscribe to a plan (POST), or cancel (DELETE).', `{ subscription: null }`);
  const subContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${subMeta}${mw3}
export const GET = async (req: Request, res: Response) => {
  // TODO: fetch current subscription for user
  res.json({ subscription: null });
};

export const POST = async (req: Request, res: Response) => {
  const { planId } = req.body;
  if (!planId) return res.status(400).json({ error: 'planId is required' });
  // TODO: create subscription via payment gateway
  res.status(201).json({ message: 'Subscribed', subscription: { planId } });
};

export const DELETE = async (req: Request, res: Response) => {
  // TODO: cancel subscription at period end
  res.json({ message: 'Subscription cancelled' });
};
`
    : `${RA}${rr3}${subMeta}${mw3}
export const GET = async (req, res) => {
  // TODO: fetch current subscription for user
  res.json({ subscription: null });
};

export const POST = async (req, res) => {
  const { planId } = req.body;
  if (!planId) return res.status(400).json({ error: 'planId is required' });
  // TODO: create subscription via payment gateway
  res.status(201).json({ message: 'Subscribed', subscription: { planId } });
};

export const DELETE = async (req, res) => {
  // TODO: cancel subscription at period end
  res.json({ message: 'Subscription cancelled' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'billing', `subscription.${ext}`), subContent);

  // billing/payment-methods/index.ts
  const pmListContent = ts
    ? `${RA}${rr4}import type { Request, Response } from 'express';
${mw4}
export const GET = async (req: Request, res: Response) => {
  // TODO: fetch payment methods for user
  res.json({ paymentMethods: [] });
};

export const POST = async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'payment token is required' });
  // TODO: attach payment method via payment gateway
  res.status(201).json({ message: 'Payment method added' });
};
`
    : `${RA}${rr4}${mw4}
export const GET = async (req, res) => {
  // TODO: fetch payment methods for user
  res.json({ paymentMethods: [] });
};

export const POST = async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'payment token is required' });
  // TODO: attach payment method via payment gateway
  res.status(201).json({ message: 'Payment method added' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'billing', 'payment-methods', `index.${ext}`), pmListContent);

  // billing/payment-methods/[id].ts
  const pmByIdContent = ts
    ? `${RA}${rr4}import type { Request, Response } from 'express';
${mw4}
export const DELETE = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: detach payment method from payment gateway
  res.json({ message: \`Payment method \${id} removed\` });
};
`
    : `${RA}${rr4}${mw4}
export const DELETE = async (req, res) => {
  const { id } = req.params;
  // TODO: detach payment method from payment gateway
  res.json({ message: \`Payment method \${id} removed\` });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'billing', 'payment-methods', `[id].${ext}`), pmByIdContent);

  // billing/invoices/index.ts
  const invListMeta = mkMeta(opts, 'List all invoices for the authenticated user.', `{ invoices: [], total: 0 }`);
  const invListContent = ts
    ? `${RA}${rr4}import type { Request, Response } from 'express';
${invListMeta}${mw4}
export const GET = async (req: Request, res: Response) => {
  // TODO: fetch invoices for user
  res.json({ invoices: [], total: 0 });
};
`
    : `${RA}${rr4}${invListMeta}${mw4}
export const GET = async (req, res) => {
  // TODO: fetch invoices for user
  res.json({ invoices: [], total: 0 });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'billing', 'invoices', `index.${ext}`), invListContent);

  // billing/invoices/[id].ts
  const invByIdContent = ts
    ? `${RA}${rr4}import type { Request, Response } from 'express';
${mw4}
export const GET = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: return invoice PDF URL or inline data
  res.json({ invoice: { id, downloadUrl: 'https://...' } });
};
`
    : `${RA}${rr4}${mw4}
export const GET = async (req, res) => {
  const { id } = req.params;
  // TODO: return invoice PDF URL or inline data
  res.json({ invoice: { id, downloadUrl: 'https://...' } });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'user', 'billing', 'invoices', `[id].${ext}`), invByIdContent);
}

async function writeSupportRoutes(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  // support/tickets/* = 3 levels
  const rr3 = opts.rbac ? `import { requireRole } from '../../../middleware/requireRole.js';\n` : '';
  const mw3 = opts.rbac
    ? `export const middlewares = [requireAuth, requireRole('user', 'admin')];\n`
    : `export const middlewares = [requireAuth];\n`;
  const RA = `import { requireAuth } from 'express-file-cluster/auth';\n`;

  // support/tickets/index.ts
  const ticketListMeta = mkMeta(opts, 'List own support tickets (GET) or create a new one (POST).', `{ tickets: [], total: 0 }`, `{ subject: 'Issue with login', message: 'I cannot log in', priority: 'normal' }`);
  const ticketListContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${ticketListMeta}${mw3}
export const GET = async (req: Request, res: Response) => {
  // TODO: fetch tickets for current user
  res.json({ tickets: [], total: 0 });
};

export const POST = async (req: Request, res: Response) => {
  const { subject, message, priority } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message are required' });
  // TODO: create support ticket in DB
  res.status(201).json({ message: 'Ticket created', ticket: { id: 'new-id', subject, status: 'open' } });
};
`
    : `${RA}${rr3}${ticketListMeta}${mw3}
export const GET = async (req, res) => {
  // TODO: fetch tickets for current user
  res.json({ tickets: [], total: 0 });
};

export const POST = async (req, res) => {
  const { subject, message, priority } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message are required' });
  // TODO: create support ticket in DB
  res.status(201).json({ message: 'Ticket created', ticket: { id: 'new-id', subject, status: 'open' } });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'support', 'tickets', `index.${ext}`), ticketListContent);

  // support/tickets/[id].ts
  const ticketByIdMeta = mkMeta(opts, 'View a support ticket (GET) or add a reply / close it (PUT).', `{ ticket: { id: '1', subject: 'Issue', status: 'open', replies: [] } }`);
  const ticketByIdContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${ticketByIdMeta}${mw3}
export const GET = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: fetch ticket by id, verify ownership
  res.json({ ticket: { id, subject: '', status: 'open', replies: [] } });
};

export const PUT = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reply, status } = req.body;
  // TODO: add reply or update status
  res.json({ message: 'Ticket updated', ticket: { id, status: status ?? 'open' } });
};
`
    : `${RA}${rr3}${ticketByIdMeta}${mw3}
export const GET = async (req, res) => {
  const { id } = req.params;
  // TODO: fetch ticket by id, verify ownership
  res.json({ ticket: { id, subject: '', status: 'open', replies: [] } });
};

export const PUT = async (req, res) => {
  const { id } = req.params;
  const { reply, status } = req.body;
  // TODO: add reply or update status
  res.json({ message: 'Ticket updated', ticket: { id, status: status ?? 'open' } });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'support', 'tickets', `[id].${ext}`), ticketByIdContent);
}

async function writeAdminExtendedRoutes(dest: string, opts: ScaffoldOptions): Promise<void> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const ts = opts.language === 'typescript';
  // depth: admin/subdir/* = 3, admin/subdir/subdir/* = 4, admin/users/[id]/* = 4
  const rr3 = opts.rbac ? `import { requireRole } from '../../../middleware/requireRole.js';\n` : '';
  const rr4 = opts.rbac ? `import { requireRole } from '../../../../middleware/requireRole.js';\n` : '';
  const mwAdmin3 = opts.rbac
    ? `export const middlewares = [requireAuth, requireRole('admin')];\n`
    : `export const middlewares = [requireAuth];\n`;
  const mwAdmin4 = mwAdmin3;
  const roleGuard = opts.rbac
    ? ''
    : ts
      ? `  const user = (req as any).user;\n  if (user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });\n`
      : `  const user = req.user;\n  if (user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });\n`;
  const RA = `import { requireAuth } from 'express-file-cluster/auth';\n`;

  // ── Analytics ──────────────────────────────────────────────────────────

  // admin/analytics/index.ts
  const analyticsOverviewMeta = mkMeta(opts, 'Analytics overview: users, revenue, traffic.', `{ users: {}, revenue: {}, traffic: {} }`);
  const analyticsOverviewContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${analyticsOverviewMeta}${mwAdmin3}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  // TODO: aggregate analytics overview
  res.json({ users: {}, revenue: {}, traffic: {} });
};
`
    : `${RA}${rr3}${analyticsOverviewMeta}${mwAdmin3}
export const GET = async (req, res) => {
${roleGuard}  // TODO: aggregate analytics overview
  res.json({ users: {}, revenue: {}, traffic: {} });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'analytics', `index.${ext}`), analyticsOverviewContent);

  const analyticsUsersMeta = mkMeta(opts, 'User analytics: registrations, active users, churn.', `{ registrations: [], activeUsers: 0, churn: 0 }`);
  const analyticsUsersContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${analyticsUsersMeta}${mwAdmin3}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const { period = '30d' } = req.query;
  // TODO: fetch user analytics for period
  res.json({ registrations: [], activeUsers: 0, churn: 0, period });
};
`
    : `${RA}${rr3}${analyticsUsersMeta}${mwAdmin3}
export const GET = async (req, res) => {
${roleGuard}  const { period = '30d' } = req.query;
  // TODO: fetch user analytics for period
  res.json({ registrations: [], activeUsers: 0, churn: 0, period });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'analytics', `users.${ext}`), analyticsUsersContent);

  const analyticsRevenueMeta = mkMeta(opts, 'Revenue analytics: MRR, ARR, payment history.', `{ mrr: 0, arr: 0, history: [] }`);
  const analyticsRevenueContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${analyticsRevenueMeta}${mwAdmin3}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const { period = '30d' } = req.query;
  // TODO: fetch revenue analytics for period
  res.json({ mrr: 0, arr: 0, history: [], period });
};
`
    : `${RA}${rr3}${analyticsRevenueMeta}${mwAdmin3}
export const GET = async (req, res) => {
${roleGuard}  const { period = '30d' } = req.query;
  // TODO: fetch revenue analytics for period
  res.json({ mrr: 0, arr: 0, history: [], period });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'analytics', `revenue.${ext}`), analyticsRevenueContent);

  const analyticsTrafficMeta = mkMeta(opts, 'Traffic analytics: page views, devices, countries.', `{ pageViews: 0, devices: {}, countries: {} }`);
  const analyticsTrafficContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${analyticsTrafficMeta}${mwAdmin3}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const { period = '30d' } = req.query;
  // TODO: fetch traffic analytics for period
  res.json({ pageViews: 0, devices: {}, countries: {}, period });
};
`
    : `${RA}${rr3}${analyticsTrafficMeta}${mwAdmin3}
export const GET = async (req, res) => {
${roleGuard}  const { period = '30d' } = req.query;
  // TODO: fetch traffic analytics for period
  res.json({ pageViews: 0, devices: {}, countries: {}, period });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'analytics', `traffic.${ext}`), analyticsTrafficContent);

  // ── User Actions ──────────────────────────────────────────────────────

  // admin/users/[id]/suspend.ts
  const suspendContent = ts
    ? `${RA}${rr4}import type { Request, Response } from 'express';
${mwAdmin4}
export const POST = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  const { reason } = req.body;
  // TODO: set user.isActive = false, log audit event
  res.json({ message: \`User \${id} suspended\`, reason });
};
`
    : `${RA}${rr4}${mwAdmin4}
export const POST = async (req, res) => {
${roleGuard}  const { id } = req.params;
  const { reason } = req.body;
  // TODO: set user.isActive = false, log audit event
  res.json({ message: \`User \${id} suspended\`, reason });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'users', '[id]', `suspend.${ext}`), suspendContent);

  // admin/users/[id]/activate.ts
  const activateContent = ts
    ? `${RA}${rr4}import type { Request, Response } from 'express';
${mwAdmin4}
export const POST = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: set user.isActive = true, log audit event
  res.json({ message: \`User \${id} activated\` });
};
`
    : `${RA}${rr4}${mwAdmin4}
export const POST = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: set user.isActive = true, log audit event
  res.json({ message: \`User \${id} activated\` });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'users', '[id]', `activate.${ext}`), activateContent);

  // admin/users/[id]/verify.ts
  const verifyUserContent = ts
    ? `${RA}${rr4}import type { Request, Response } from 'express';
${mwAdmin4}
export const POST = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: set user.isVerified = true
  res.json({ message: \`User \${id} verified\` });
};
`
    : `${RA}${rr4}${mwAdmin4}
export const POST = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: set user.isVerified = true
  res.json({ message: \`User \${id} verified\` });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'users', '[id]', `verify.${ext}`), verifyUserContent);

  // admin/users/export.ts
  const exportMeta = mkMeta(opts, 'Export all users as CSV.', `{ csv: '...' }`);
  const exportContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${exportMeta}${mwAdmin3}
export const GET = async (_req: Request, res: Response) => {
${roleGuard}  // TODO: generate CSV of all users and stream response
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
  res.send('id,name,email,role,createdAt\\n');
};
`
    : `${RA}${rr3}${exportMeta}${mwAdmin3}
export const GET = async (_req, res) => {
${roleGuard}  // TODO: generate CSV of all users and stream response
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
  res.send('id,name,email,role,createdAt\\n');
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'users', `export.${ext}`), exportContent);

  // ── Admins ────────────────────────────────────────────────────────────

  // admin/admins/index.ts
  const adminsListMeta = mkMeta(opts, 'List all admins (GET) or create a new admin (POST).', `{ admins: [], total: 0 }`);
  const adminsListContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${adminsListMeta}${mwAdmin3}
export const GET = async (_req: Request, res: Response) => {
${roleGuard}  // TODO: fetch admins from DB
  res.json({ admins: [], total: 0 });
};

export const POST = async (req: Request, res: Response) => {
${roleGuard}  const { name, email, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  // TODO: create admin account
  res.status(201).json({ message: 'Admin created', admin: { id: 'new-id', name, email, role: role ?? 'admin' } });
};
`
    : `${RA}${rr3}${adminsListMeta}${mwAdmin3}
export const GET = async (_req, res) => {
${roleGuard}  // TODO: fetch admins from DB
  res.json({ admins: [], total: 0 });
};

export const POST = async (req, res) => {
${roleGuard}  const { name, email, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  // TODO: create admin account
  res.status(201).json({ message: 'Admin created', admin: { id: 'new-id', name, email, role: role ?? 'admin' } });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'admins', `index.${ext}`), adminsListContent);

  // admin/admins/[id].ts
  const adminByIdContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${mwAdmin3}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: fetch admin by id
  res.json({ admin: { id } });
};

export const PUT = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: update admin record
  res.json({ message: 'Admin updated', admin: { id, ...req.body } });
};

export const DELETE = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: delete admin
  res.json({ message: \`Admin \${id} deleted\` });
};
`
    : `${RA}${rr3}${mwAdmin3}
export const GET = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: fetch admin by id
  res.json({ admin: { id } });
};

export const PUT = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: update admin record
  res.json({ message: 'Admin updated', admin: { id, ...req.body } });
};

export const DELETE = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: delete admin
  res.json({ message: \`Admin \${id} deleted\` });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'admins', `[id].${ext}`), adminByIdContent);

  // ── Roles (rbac only) ─────────────────────────────────────────────────

  if (opts.rbac) {
    const rolesListContent = ts
      ? `${RA}${rr3}import type { Request, Response } from 'express';
${mwAdmin3}
export const GET = async (_req: Request, res: Response) => {
  // TODO: fetch all roles
  res.json({ roles: [] });
};

export const POST = async (req: Request, res: Response) => {
  const { name, description, permissions } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  // TODO: create role
  res.status(201).json({ message: 'Role created', role: { id: 'new-id', name, permissions: permissions ?? [] } });
};
`
      : `${RA}${rr3}${mwAdmin3}
export const GET = async (_req, res) => {
  // TODO: fetch all roles
  res.json({ roles: [] });
};

export const POST = async (req, res) => {
  const { name, description, permissions } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  // TODO: create role
  res.status(201).json({ message: 'Role created', role: { id: 'new-id', name, permissions: permissions ?? [] } });
};
`;
    await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'roles', `index.${ext}`), rolesListContent);

    const roleByIdContent = ts
      ? `${RA}${rr3}import type { Request, Response } from 'express';
${mwAdmin3}
export const GET = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: fetch role by id
  res.json({ role: { id } });
};

export const PUT = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: update role
  res.json({ message: 'Role updated', role: { id, ...req.body } });
};

export const DELETE = async (req: Request, res: Response) => {
  const { id } = req.params;
  // TODO: delete role
  res.json({ message: \`Role \${id} deleted\` });
};
`
      : `${RA}${rr3}${mwAdmin3}
export const GET = async (req, res) => {
  const { id } = req.params;
  // TODO: fetch role by id
  res.json({ role: { id } });
};

export const PUT = async (req, res) => {
  const { id } = req.params;
  // TODO: update role
  res.json({ message: 'Role updated', role: { id, ...req.body } });
};

export const DELETE = async (req, res) => {
  const { id } = req.params;
  // TODO: delete role
  res.json({ message: \`Role \${id} deleted\` });
};
`;
    await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'roles', `[id].${ext}`), roleByIdContent);
  }

  // ── Notifications ─────────────────────────────────────────────────────

  // admin/notifications/index.ts
  const adminNotifContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${mwAdmin3}
export const GET = async (_req: Request, res: Response) => {
${roleGuard}  // TODO: fetch sent notifications
  res.json({ notifications: [], total: 0 });
};

export const POST = async (req: Request, res: Response) => {
${roleGuard}  const { userId, title, message, type } = req.body;
  if (!userId || !title || !message) return res.status(400).json({ error: 'userId, title and message are required' });
  // TODO: create and send notification to user
  res.status(201).json({ message: 'Notification sent' });
};
`
    : `${RA}${rr3}${mwAdmin3}
export const GET = async (_req, res) => {
${roleGuard}  // TODO: fetch sent notifications
  res.json({ notifications: [], total: 0 });
};

export const POST = async (req, res) => {
${roleGuard}  const { userId, title, message, type } = req.body;
  if (!userId || !title || !message) return res.status(400).json({ error: 'userId, title and message are required' });
  // TODO: create and send notification to user
  res.status(201).json({ message: 'Notification sent' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'notifications', `index.${ext}`), adminNotifContent);

  // admin/notifications/broadcast.ts
  const broadcastMeta = mkMeta(opts, 'Broadcast a notification to all users.', `{ message: 'Broadcast sent', count: 0 }`, `{ title: 'Announcement', message: 'Hello everyone!', type: 'info' }`);
  const broadcastContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${broadcastMeta}${mwAdmin3}
export const POST = async (req: Request, res: Response) => {
${roleGuard}  const { title, message, type } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message are required' });
  // TODO: send notification to all users
  res.json({ message: 'Broadcast sent', count: 0 });
};
`
    : `${RA}${rr3}${broadcastMeta}${mwAdmin3}
export const POST = async (req, res) => {
${roleGuard}  const { title, message, type } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message are required' });
  // TODO: send notification to all users
  res.json({ message: 'Broadcast sent', count: 0 });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'notifications', `broadcast.${ext}`), broadcastContent);

  // ── Logs ──────────────────────────────────────────────────────────────

  const mkLogContent = (label: string) => {
    const meta = mkMeta(opts, `Paginated ${label} log entries.`, `{ logs: [], total: 0, page: 1, limit: 50 }`);
    return ts
      ? `${RA}${rr3}import type { Request, Response } from 'express';
${meta}${mwAdmin3}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const { page = 1, limit = 50 } = req.query;
  // TODO: fetch ${label} logs with pagination
  res.json({ logs: [], total: 0, page: Number(page), limit: Number(limit) });
};
`
      : `${RA}${rr3}${meta}${mwAdmin3}
export const GET = async (req, res) => {
${roleGuard}  const { page = 1, limit = 50 } = req.query;
  // TODO: fetch ${label} logs with pagination
  res.json({ logs: [], total: 0, page: Number(page), limit: Number(limit) });
};
`;
  };

  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'logs', `audit.${ext}`), mkLogContent('audit'));
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'logs', `activity.${ext}`), mkLogContent('activity'));
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'logs', `security.${ext}`), mkLogContent('security'));

  // ── Settings & System ─────────────────────────────────────────────────

  // admin/settings/index.ts
  const settingsMeta = mkMeta(opts, 'Get or update system-wide settings.', `{ settings: {} }`);
  const settingsContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${settingsMeta}${mwAdmin3}
export const GET = async (_req: Request, res: Response) => {
${roleGuard}  // TODO: fetch system settings from DB
  res.json({ settings: {} });
};

export const PUT = async (req: Request, res: Response) => {
${roleGuard}  // TODO: update system settings
  res.json({ message: 'Settings updated', settings: req.body });
};
`
    : `${RA}${rr3}${settingsMeta}${mwAdmin3}
export const GET = async (_req, res) => {
${roleGuard}  // TODO: fetch system settings from DB
  res.json({ settings: {} });
};

export const PUT = async (req, res) => {
${roleGuard}  // TODO: update system settings
  res.json({ message: 'Settings updated', settings: req.body });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'settings', `index.${ext}`), settingsContent);

  // admin/system/health.ts
  const healthMeta = mkMeta(opts, 'System health check: DB, queue, cache status.', `{ status: 'ok', db: 'ok', queue: 'ok' }`);
  const healthContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${healthMeta}${mwAdmin3}
export const GET = async (_req: Request, res: Response) => {
${roleGuard}  // TODO: check DB connection, queue, cache health
  res.json({ status: 'ok', db: 'ok', queue: 'ok', uptime: process.uptime() });
};
`
    : `${RA}${rr3}${healthMeta}${mwAdmin3}
export const GET = async (_req, res) => {
${roleGuard}  // TODO: check DB connection, queue, cache health
  res.json({ status: 'ok', db: 'ok', queue: 'ok', uptime: process.uptime() });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'system', `health.${ext}`), healthContent);

  // admin/system/cache.ts
  const cacheMeta = mkMeta(opts, 'Flush the application cache.', `{ message: 'Cache cleared' }`);
  const cacheContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${cacheMeta}${mwAdmin3}
export const DELETE = async (_req: Request, res: Response) => {
${roleGuard}  // TODO: flush Redis or in-memory cache
  res.json({ message: 'Cache cleared' });
};
`
    : `${RA}${rr3}${cacheMeta}${mwAdmin3}
export const DELETE = async (_req, res) => {
${roleGuard}  // TODO: flush Redis or in-memory cache
  res.json({ message: 'Cache cleared' });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'system', `cache.${ext}`), cacheContent);

  // ── Support Tickets (admin view) ──────────────────────────────────────

  // admin/tickets/index.ts
  const adminTicketsListMeta = mkMeta(opts, 'List all support tickets with filters.', `{ tickets: [], total: 0 }`);
  const adminTicketsListContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${adminTicketsListMeta}${mwAdmin3}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const { status, priority, page = 1, limit = 20 } = req.query;
  // TODO: fetch all tickets with filters
  res.json({ tickets: [], total: 0, page: Number(page), limit: Number(limit) });
};
`
    : `${RA}${rr3}${adminTicketsListMeta}${mwAdmin3}
export const GET = async (req, res) => {
${roleGuard}  const { status, priority, page = 1, limit = 20 } = req.query;
  // TODO: fetch all tickets with filters
  res.json({ tickets: [], total: 0, page: Number(page), limit: Number(limit) });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'tickets', `index.${ext}`), adminTicketsListContent);

  // admin/tickets/[id].ts
  const adminTicketByIdContent = ts
    ? `${RA}${rr3}import type { Request, Response } from 'express';
${mwAdmin3}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: fetch ticket by id
  res.json({ ticket: { id } });
};

export const PUT = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  const { reply, status, assignedTo } = req.body;
  // TODO: update ticket (assign, change status, add reply)
  res.json({ message: 'Ticket updated', ticket: { id, status, assignedTo } });
};
`
    : `${RA}${rr3}${mwAdmin3}
export const GET = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: fetch ticket by id
  res.json({ ticket: { id } });
};

export const PUT = async (req, res) => {
${roleGuard}  const { id } = req.params;
  const { reply, status, assignedTo } = req.body;
  // TODO: update ticket (assign, change status, add reply)
  res.json({ message: 'Ticket updated', ticket: { id, status, assignedTo } });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'tickets', `[id].${ext}`), adminTicketByIdContent);

  // ── Content ───────────────────────────────────────────────────────────

  const mkContentCrud = (
    name: string,
    namePlural: string,
    dir: string[],
    createFields: string,
  ) => {
    const listMeta = mkMeta(opts, `List ${namePlural} (GET) or create a new ${name} (POST).`, `{ ${namePlural}: [], total: 0 }`);
    const listContent = ts
      ? `${RA}${rr4}import type { Request, Response } from 'express';
${listMeta}${mwAdmin4}
export const GET = async (_req: Request, res: Response) => {
${roleGuard}  // TODO: fetch ${namePlural}
  res.json({ ${namePlural}: [], total: 0 });
};

export const POST = async (req: Request, res: Response) => {
${roleGuard}  const { ${createFields} } = req.body;
  // TODO: create ${name}
  res.status(201).json({ message: '${name} created', ${name.toLowerCase()}: { id: 'new-id', ${createFields.split(', ')[0]} } });
};
`
      : `${RA}${rr4}${listMeta}${mwAdmin4}
export const GET = async (_req, res) => {
${roleGuard}  // TODO: fetch ${namePlural}
  res.json({ ${namePlural}: [], total: 0 });
};

export const POST = async (req, res) => {
${roleGuard}  const { ${createFields} } = req.body;
  // TODO: create ${name}
  res.status(201).json({ message: '${name} created', ${name.toLowerCase()}: { id: 'new-id' } });
};
`;
    const byIdContent = ts
      ? `${RA}${rr4}import type { Request, Response } from 'express';
${mwAdmin4}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: fetch ${name} by id
  res.json({ ${name.toLowerCase()}: { id } });
};

export const PUT = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: update ${name}
  res.json({ message: '${name} updated', ${name.toLowerCase()}: { id, ...req.body } });
};

export const DELETE = async (req: Request, res: Response) => {
${roleGuard}  const { id } = req.params;
  // TODO: delete ${name}
  res.json({ message: \`${name} \${id} deleted\` });
};
`
      : `${RA}${rr4}${mwAdmin4}
export const GET = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: fetch ${name} by id
  res.json({ ${name.toLowerCase()}: { id } });
};

export const PUT = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: update ${name}
  res.json({ message: '${name} updated', ${name.toLowerCase()}: { id, ...req.body } });
};

export const DELETE = async (req, res) => {
${roleGuard}  const { id } = req.params;
  // TODO: delete ${name}
  res.json({ message: \`${name} \${id} deleted\` });
};
`;
    return { listContent, byIdContent };
  };

  const { listContent: faqList, byIdContent: faqById } = mkContentCrud('FAQ', 'faqs', [], 'question, answer, category');
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'content', 'faqs', `index.${ext}`), faqList);
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'content', 'faqs', `[id].${ext}`), faqById);

  const { listContent: blogList, byIdContent: blogById } = mkContentCrud('Blog', 'blogs', [], 'title, slug, content');
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'content', 'blogs', `index.${ext}`), blogList);
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'content', 'blogs', `[id].${ext}`), blogById);

  const { listContent: catList, byIdContent: catById } = mkContentCrud('Category', 'categories', [], 'name, slug');
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'content', 'categories', `index.${ext}`), catList);
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'content', 'categories', `[id].${ext}`), catById);

  // ── Billing (admin) ───────────────────────────────────────────────────

  const { listContent: planList, byIdContent: planById } = mkContentCrud('Plan', 'plans', [], 'name, price, interval');
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'billing', 'plans', `index.${ext}`), planList);
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'billing', 'plans', `[id].${ext}`), planById);

  const { listContent: couponList, byIdContent: couponById } = mkContentCrud('Coupon', 'coupons', [], 'code, type, value');
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'billing', 'coupons', `index.${ext}`), couponList);
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'billing', 'coupons', `[id].${ext}`), couponById);

  // admin/billing/subscriptions/index.ts
  const adminSubsMeta = mkMeta(opts, 'List all subscriptions with filters.', `{ subscriptions: [], total: 0 }`);
  const adminSubsContent = ts
    ? `${RA}${rr4}import type { Request, Response } from 'express';
${adminSubsMeta}${mwAdmin4}
export const GET = async (req: Request, res: Response) => {
${roleGuard}  const { status, page = 1, limit = 20 } = req.query;
  // TODO: fetch all subscriptions with filters
  res.json({ subscriptions: [], total: 0, page: Number(page), limit: Number(limit) });
};
`
    : `${RA}${rr4}${adminSubsMeta}${mwAdmin4}
export const GET = async (req, res) => {
${roleGuard}  const { status, page = 1, limit = 20 } = req.query;
  // TODO: fetch all subscriptions with filters
  res.json({ subscriptions: [], total: 0, page: Number(page), limit: Number(limit) });
};
`;
  await fs.outputFile(path.join(dest, 'src', 'api', 'admin', 'billing', 'subscriptions', `index.${ext}`), adminSubsContent);
}
