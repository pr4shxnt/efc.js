export interface RoutePreset {
  filePath: string;
  urlPath: string;
  methods: string[];
  code: string;
  description: string;
}

export interface TaskPreset {
  name: string;
  retries: number;
  cron?: string;
  backend: 'pg-boss' | 'bullmq';
  thread?: boolean;
}

export interface Quest {
  id: string;
  title: string;
  category: string;
  duration: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  summary: string;
  concept: string;
  codeExample: string;
  quiz: {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  };
}

export const INITIAL_ROUTES: RoutePreset[] = [
  {
    filePath: 'src/api/health.ts',
    urlPath: '/health',
    methods: ['GET'],
    description: 'System health check route with uptime and worker ID',
    code: `import type { Request, Response } from 'express';
import { workerCount } from 'express-file-cluster';

export async function GET(req: Request, res: Response) {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    workers: workerCount(),
    timestamp: new Date().toISOString()
  });
}`,
  },
  {
    filePath: 'src/api/users/index.ts',
    urlPath: '/users',
    methods: ['GET', 'POST'],
    description: 'Collection endpoint for listing and creating users',
    code: `import type { Request, Response } from 'express';
import { schema } from './schema';

export const middlewares = [];

export async function GET(req: Request, res: Response) {
  res.json({ users: [{ id: 'usr_1', email: 'alice@example.com' }] });
}

export async function POST(req: Request, res: Response) {
  res.status(201).json({ created: true, id: 'usr_2', ...req.body });
}`,
  },
  {
    filePath: 'src/api/users/me.ts',
    urlPath: '/users/me',
    methods: ['GET', 'PATCH'],
    description: 'Authenticated current user endpoint (Higher rank than /users/:id)',
    code: `import type { Request, Response } from 'express';
import { requireAuth } from 'express-file-cluster/auth';

export const middlewares = [requireAuth()];

export async function GET(req: Request, res: Response) {
  res.json({ user: req.user });
}`,
  },
  {
    filePath: 'src/api/users/[id].ts',
    urlPath: '/users/:id',
    methods: ['GET', 'DELETE'],
    description: 'Single user resource by dynamic ID parameter',
    code: `import type { Request, Response } from 'express';

export async function GET(req: Request, res: Response) {
  const { id } = req.params;
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid ID' });
  }
  res.json({ id, name: \`User \${id}\` });
}`,
  },
  {
    filePath: 'src/api/posts/[[id]].ts',
    urlPath: '/posts/:id?',
    methods: ['GET'],
    description: 'Optional ID parameter: matches both /posts and /posts/123',
    code: `import type { Request, Response } from 'express';

export async function GET(req: Request, res: Response) {
  const { id } = req.params;
  if (!id) {
    return res.json({ message: 'Viewing all posts' });
  }
  res.json({ message: \`Viewing specific post \${id}\` });
}`,
  },
  {
    filePath: 'src/api/docs/[...slug].ts',
    urlPath: '/docs/:slug*',
    methods: ['GET'],
    description:
      'Catch-all route: matches /docs/a/b (requires at least 1 segment; params.slug is string[])',
    code: `import type { Request, Response } from 'express';

export async function GET(req: Request, res: Response) {
  // Catch-all params arrive as string[]
  const slug = req.params.slug as unknown as string[];
  res.json({
    documentPath: slug.join('/'),
    segments: slug
  });
}`,
  },
];

export const QUESTS: Quest[] = [
  {
    id: 'quest-1',
    title: '1. Booting with ignite() & Worker Clustering',
    category: 'Core Architecture',
    duration: '5 min',
    difficulty: 'Beginner',
    summary: 'Master how EFC boots multi-core worker clusters and the exact Pre-Flight lifecycle.',
    concept: `EFC scales across CPU cores automatically using Node.js cluster.
- \`ignite(config)\` starts the master process, which forks workers.
- The master returns \`undefined\`; workers return the \`http.Server\` instance.
- **Pre-Flight Hook**: Database connections and background task listeners boot inside worker Pre-Flight *before* traffic is accepted.
- **Anti-Hallucination**: \`ignite()\` does **not** auto-load \`efc.config.ts\`. You pass the config object manually. Also, \`apiDir\` and \`tasksDir\` are NOT config options — \`src/api\` and \`src/tasks\` are fixed conventions!`,
    codeExample: `// src/server.ts
import { ignite } from 'express-file-cluster';

async function main() {
  const server = await ignite({
    port: 3000,
    database: 'postgresql',
    databaseUrl: process.env.DATABASE_URL,
    tasks: {
      backend: 'pg-boss'
    }
  });

  if (server) {
    console.log('[Worker] Server listening on port 3000');
  }
}

main().catch(console.error);`,
    quiz: {
      question: 'Where does EFC look for API routes by default when ignite() starts?',
      options: [
        'src/api by convention (apiDir is not an ignite option)',
        'Whatever path you set in ignite({ apiDir: "..." })',
        'Auto-read from the apiDir export in efc.config.ts',
        'src/routes or src/controllers',
      ],
      correctIndex: 0,
      explanation:
        'src/api and src/tasks are strictly found by convention. ignite() has no apiDir option, and ignite() does not read efc.config.ts automatically.',
    },
  },
  {
    id: 'quest-2',
    title: '2. File Routing & Specificity Rules',
    category: 'Routing',
    duration: '7 min',
    difficulty: 'Beginner',
    summary: 'Understand file naming, param formats, and segment-by-segment specificity ranking.',
    concept: `EFC scans files in \`src/api\` and compiles them into Express routes:
1. Extension (.ts/.js) is stripped.
2. Trailing \`/index\` is stripped: \`/users/index.ts\` -> \`/users\` (no trailing slash!).
3. Segment transformations:
   - \`[id]\` -> \`:id\` (required dynamic param)
   - \`[[id]]\` -> \`:id?\` (optional dynamic param)
   - \`[...slug]\` -> \`:slug*\` (catch-all, >= 1 segment, returned as \`string[]\`)
   - \`[[...slug]]\` -> \`:slug*?\` (optional catch-all, >= 0 segments)
4. Specificity Ranking:
   Static segments (Rank 0) > \`[id]\` (Rank 1) > \`[[id]]\` (Rank 2) > \`[...slug]\` (Rank 3) > \`[[...slug]]\` (Rank 4).
   Therefore, \`/users/me\` always matches before \`/users/:id\`!
5. Method Dispatch & 405:
   EFC only recognizes uppercase method exports: \`GET\`, \`POST\`, \`PUT\`, \`PATCH\`, \`DELETE\`, \`HEAD\`, \`OPTIONS\`. If a route exists but a method isn't exported, EFC returns 405 Method Not Allowed with an \`Allow\` header!`,
    codeExample: `// src/api/users/[id].ts
import type { Request, Response } from 'express';

// EFC only dispatches uppercase method functions
export async function GET(req: Request, res: Response) {
  const { id } = req.params;
  // Rule: check request value types to prevent injection
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid ID' });
  }
  res.json({ id, name: 'Alice' });
}

export async function DELETE(req: Request, res: Response) {
  res.status(204).end();
}
// Calling POST on /users/123 returns 405 Method Not Allowed with Allow: GET, DELETE`,
    quiz: {
      question:
        'If you have both src/api/users/me.ts and src/api/users/[id].ts, which handles GET /users/me?',
      options: [
        'src/api/users/me.ts because static segments (Rank 0) have higher specificity than dynamic [id] (Rank 1)',
        'src/api/users/[id].ts because dynamic routes are evaluated first',
        'It throws a conflicting route error at startup',
        'Whichever file was created first on disk',
      ],
      correctIndex: 0,
      explanation:
        'EFC ranks routes segment-by-segment: static (0) beats dynamic [id] (1). /users/me cleanly and deterministically wins over /users/:id.',
    },
  },
  {
    id: 'quest-3',
    title: '3. PostgreSQL-Native Models with defineTable',
    category: 'Database & ORM',
    duration: '8 min',
    difficulty: 'Intermediate',
    summary:
      'Build type-safe PostgreSQL tables with Prisma-style queries, relations, and nested writes.',
    concept: `EFC provides two distinct model APIs:
- \`defineTable\`: PostgreSQL-native using Prisma-style vocabulary (\`findMany\`, \`findUnique\`, \`where\`, \`include\`, \`createManyAndReturn\`, nested writes).
- \`defineCollection\`: MongoDB-native using Mongoose vocabulary (\`find\`, \`aggregate\`, BSON types).
- (Wait: \`defineModel\` is the cross-engine adapter, but \`defineTable\` gives full relational power!)

Key \`defineTable\` features:
- Types: \`integer\`, \`bigint\`, \`decimal\`, \`uuid\`, \`string\`, \`json\`, \`array\`.
- Foreign Keys: \`ref: 'TargetTable'\`, \`onDelete: 'cascade' | 'restrict' | 'setNull'\`.
- Relations: \`options.relations\` enables \`include: { posts: true, author: true }\` in one query.
- Nested writes: \`connect\`, \`create\`, \`connectOrCreate\` inside a single automatic transaction.`,
    codeExample: `import { defineTable } from 'express-file-cluster';

export const User = defineTable('User', {
  email: { type: 'string', unique: true, maxLength: 255 },
  role: { type: 'string', default: 'member' }
}, {
  relations: {
    posts: { hasMany: 'Post', foreignKey: 'authorId' }
  }
});

export const Post = defineTable('Post', {
  title: { type: 'string', maxLength: 200 },
  content: { type: 'string' },
  authorId: { type: 'uuid', ref: 'User', onDelete: 'cascade' }
});

// Prisma-style queries with include
const usersWithPosts = await User.findMany({
  where: { role: 'member' },
  include: { posts: true },
  orderBy: { email: 'asc' },
  take: 10
});`,
    quiz: {
      question: 'Which query method is valid on a model created with defineTable?',
      options: [
        'User.findMany({ where: { role: "admin" }, include: { posts: true } })',
        'User.find({ role: { $eq: "admin" } })',
        'User.findById("usr_123")',
        'User.updateOne({ role: "admin" }, { $set: { active: true } }, { upsert: true })',
      ],
      correctIndex: 0,
      explanation:
        'defineTable uses Prisma-style methods (findMany, findUnique, findFirst). find(), findById(), and $ operators belong to MongoDB/defineCollection.',
    },
  },
  {
    id: 'quest-4',
    title: '4. Resilient Background Tasks & Dead Letters',
    category: 'Async Processing',
    duration: '6 min',
    difficulty: 'Intermediate',
    summary:
      'Schedule cron jobs, enqueue retryable background tasks, and inspect the dead-letter queue.',
    concept: `EFC includes built-in background tasks:
- Subpath: \`import { defineTask, enqueue } from 'express-file-cluster/tasks'\`.
- Backends: **pg-boss** (PostgreSQL) or **BullMQ** (Redis).
- Cron: pass \`schedule: '*/5 * * * *'\` directly to \`defineTask\`.
- Multi-threading: set \`thread: true\` to execute CPU-intensive jobs on \`worker_threads\` without blocking the event loop.
- Dead Letters: Failed tasks exhaust retries and land in the dead-letter queue. The CLI provides \`efc tasks failed\` and \`efc tasks retry <id>\`!`,
    codeExample: `// src/tasks/send-digest.ts
import { defineTask } from 'express-file-cluster/tasks';

export default defineTask<{ email?: string }>({
  retries: 3,
  schedule: '0 9 * * 1', // Runs every Monday at 9:00 AM
  thread: false
}, async (data) => {
  console.log(\`Sending digest to \${data.email ?? 'subscribers'}\`);
  // If this throws, EFC will retry 3 times with exponential backoff
});

// In an API route:
import { enqueue } from 'express-file-cluster/tasks';

export async function POST(req, res) {
  await enqueue('send-digest', { email: 'user@example.com' });
  res.status(202).json({ queued: true });
}`,
    quiz: {
      question: 'How do you schedule a recurring cron task in EFC?',
      options: [
        'Pass schedule: "<cron-expression>" in the defineTask options object',
        'Call scheduleTask("<cron>", handler)',
        'Export const cron = "..." from the task file',
        'Configure the task schedule in efc.config.ts',
      ],
      correctIndex: 0,
      explanation:
        'defineTask takes options as its first argument with schedule: "<cron-expression>". scheduleTask() does not exist in EFC.',
    },
  },
  {
    id: 'quest-5',
    title: '5. Authentication, RBAC & Security Rules',
    category: 'Security',
    duration: '6 min',
    difficulty: 'Advanced',
    summary: 'Protect routes with requireAuth, manage roles, and enforce token sanitization.',
    concept: `EFC provides full authentication via \`express-file-cluster/auth\`:
- Functions: \`issueToken\`, \`signToken\`, \`revokeSession\`, \`hashPassword\`, \`verifyPassword\`, \`requireAuth\`.
- Supports dual storage: **HTTP-only cookies** and **Bearer tokens**.
- Password hashing uses built-in **scrypt** with cryptographically secure salts.
- **Mandatory EFC Security Rule**: Never return sensitive fields in API responses! Always strip \`password\`, \`refreshToken\`, \`resetToken\`, and \`verifyToken\` before sending records to clients.`,
    codeExample: `// src/api/admin/users.ts
import type { Request, Response } from 'express';
import { requireAuth } from 'express-file-cluster/auth';

// Protect route: must be logged in with "admin" role
export const middlewares = [
  requireAuth('admin')
];

export async function GET(req: Request, res: Response) {
  // Safe sanitized user query
  res.json({
    adminUser: req.user,
    message: 'Welcome to restricted admin console'
  });
}`,
    quiz: {
      question:
        'Which fields must be stripped from database records before returning them in generated routes?',
      options: [
        'password, refreshToken, resetToken, verifyToken (+ expiries)',
        'Only password',
        'None, EFC filters responses automatically via regex',
        'id, createdAt, updatedAt',
      ],
      correctIndex: 0,
      explanation:
        'EFC ground rules mandate stripping password, refreshToken, resetToken, verifyToken (+ expiries) from all client-returned records.',
    },
  },
];

export const HALLUCINATION_RULES = [
  {
    type: 'import',
    pattern:
      /from ['"]express-file-cluster\/(db|router|cluster|middleware|errors|config|models)['"]/,
    badSnippet: "import { db } from 'express-file-cluster/db';",
    goodSnippet: "import { db } from 'express-file-cluster';",
    reason:
      "There is NO /db subpath! Only 4 import paths exist: 'express-file-cluster', 'express-file-cluster/auth', 'express-file-cluster/tasks', and 'express-file-cluster/testing'.",
  },
  {
    type: 'config',
    pattern: /apiDir|tasksDir|migrationsDir/,
    badSnippet: "ignite({ apiDir: 'src/routes', tasksDir: 'src/jobs' })",
    goodSnippet: 'ignite({ port: 3000, databaseUrl: process.env.DATABASE_URL })',
    reason:
      'apiDir and tasksDir are NOT ignite options. EFC locates src/api and src/tasks by convention.',
  },
  {
    type: 'config',
    pattern: /plugins\s*:/,
    badSnippet: 'ignite({ plugins: [myPlugin()] })',
    goodSnippet: '// Plugins are not implemented in Phase 2 EFC',
    reason: 'Plugins system is not implemented in EFC v0.12.0 (Phase 3+ roadmap).',
  },
  {
    type: 'function',
    pattern: /createApp\(\)|createServer\(\)/,
    badSnippet: 'const app = createApp();',
    goodSnippet: 'const server = await ignite({ ... });',
    reason: 'EFC does not export createApp() or createServer(). Use ignite(config).',
  },
  {
    type: 'function',
    pattern: /createModel\(/,
    badSnippet: "const User = createModel('User', { ... });",
    goodSnippet: "const User = defineModel('User', { ... }); // or defineTable for Postgres",
    reason:
      'The function is named defineModel (or defineTable / defineCollection), NOT createModel.',
  },
  {
    type: 'function',
    pattern: /createTask\(|scheduleTask\(/,
    badSnippet: "createTask('email', handler);",
    goodSnippet: "export default defineTask({ schedule: '0 * * * *' }, handler);",
    reason:
      "Tasks are defined using defineTask from 'express-file-cluster/tasks', not createTask or scheduleTask.",
  },
  {
    type: 'method',
    pattern: /defineTable.*\.find\(|\.findById\(/,
    badSnippet: "UserTable.find({ email: 'test@example.com' });",
    goodSnippet: "UserTable.findMany({ where: { email: 'test@example.com' } });",
    reason:
      'defineTable uses Prisma-style methods (findMany, findUnique, findFirst). find() and findById() are MongoDB / defineCollection vocabulary.',
  },
];

export const CHEAT_SHEET_ITEMS = [
  {
    module: 'express-file-cluster',
    name: 'ignite(config)',
    type: 'function',
    description: 'Starts master cluster and boots workers through Pre-Flight.',
  },
  {
    module: 'express-file-cluster',
    name: 'gracefulShutdown(server, timeoutMs?)',
    type: 'function',
    description: 'Gracefully drains connections and terminates worker.',
  },
  {
    module: 'express-file-cluster',
    name: 'compose(...handlers)',
    type: 'function',
    description: 'Combines multiple Express middleware into a single handler.',
  },
  {
    module: 'express-file-cluster',
    name: 'defineModel(name, schema, options?)',
    type: 'function',
    description: 'Cross-engine model with inferred record and create types.',
  },
  {
    module: 'express-file-cluster',
    name: 'defineTable(name, schema, options?)',
    type: 'function',
    description: 'PostgreSQL-native model with Prisma-style queries and relations.',
  },
  {
    module: 'express-file-cluster',
    name: 'defineCollection(name, schema, options?)',
    type: 'function',
    description: 'MongoDB-native model with Mongoose queries and BSON types.',
  },
  {
    module: 'express-file-cluster',
    name: 'transaction(fn)',
    type: 'function',
    description: 'Executes a block within an atomic database transaction.',
  },
  {
    module: 'express-file-cluster',
    name: 'db',
    type: 'value',
    description: 'Native database client proxy (pg Pool or mongoose Connection).',
  },
  {
    module: 'express-file-cluster',
    name: 'logger',
    type: 'value',
    description: 'Structured Pino logger proxy with request-scoped child ID.',
  },
  {
    module: 'express-file-cluster',
    name: 'cache',
    type: 'value',
    description: 'Cache client with get, set, wrap, del, incr, and clear.',
  },
  {
    module: 'express-file-cluster',
    name: 'cacheResponse(ttlOrOptions)',
    type: 'function',
    description: 'Route middleware to cache 200 JSON responses.',
  },
  {
    module: 'express-file-cluster',
    name: 'rateLimit(options)',
    type: 'function',
    description: 'Fixed-window rate limiter backed by cache.',
  },
  {
    module: 'express-file-cluster',
    name: 'HttpError',
    type: 'class',
    description: 'Standard HTTP error with status code.',
  },
  {
    module: 'express-file-cluster',
    name: 'workerCount()',
    type: 'function',
    description: 'Returns current number of active cluster workers.',
  },

  {
    module: 'express-file-cluster/auth',
    name: 'issueToken(res, payload)',
    type: 'function',
    description: 'Generates signed JWT / Bearer token for authentication.',
  },
  {
    module: 'express-file-cluster/auth',
    name: 'signToken(payload)',
    type: 'function',
    description: 'Signs a token without setting a cookie.',
  },
  {
    module: 'express-file-cluster/auth',
    name: 'revokeToken(res)',
    type: 'function',
    description: 'Clears the authentication cookie.',
  },
  {
    module: 'express-file-cluster/auth',
    name: 'hashPassword(password)',
    type: 'function',
    description: 'Scrypt-based secure password hashing with salt.',
  },
  {
    module: 'express-file-cluster/auth',
    name: 'verifyPassword(password, hash)',
    type: 'function',
    description: 'Constant-time verification of scrypt password hash.',
  },
  {
    module: 'express-file-cluster/auth',
    name: 'requireAuth',
    type: 'function',
    description: 'Route middleware enforcing valid session or token.',
  },
  {
    module: 'express-file-cluster/auth',
    name: 'revokeSession(req, res?)',
    type: 'function',
    description: 'Revokes the current session using the configured cache.',
  },

  {
    module: 'express-file-cluster/tasks',
    name: 'defineTask(options, handler)',
    type: 'function',
    description: 'Registers background task with retries, cron, or worker thread.',
  },
  {
    module: 'express-file-cluster/tasks',
    name: 'enqueue(name, payload)',
    type: 'function',
    description: 'Pushes a job into BullMQ or pg-boss queue.',
  },

  {
    module: 'express-file-cluster/testing',
    name: 'createTestApp(options?)',
    type: 'function',
    description: 'Mounts route tree without opening port or booting full services.',
  },
];
