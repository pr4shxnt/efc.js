import type { Tutorial } from './tutorials';
import { quiz } from './practice';

const efcDocs = (path: string, title: string) => ({
  title,
  url: `https://github.com/siggold/express-file-cluster/blob/main/docs/${path}`,
});

type NewChapter = Omit<Tutorial, 'concept' | 'codeExample'>;

export const SETUP: NewChapter = {
  id: 'setup',
  title: 'Set up your computer',
  category: 'Start here',
  track: 'Web foundations',
  duration: '8 min',
  difficulty: 'Beginner',
  summary:
    'Install Node.js, open a terminal, and run your first command. Everything else builds on this.',
  diagram: 'runtime',
  takeaway:
    'You need three things: Node.js to run JavaScript, a terminal to type commands, and an editor to write code.',
  sections: [
    {
      title: 'Install Node.js',
      body: [
        'Node.js runs JavaScript outside the browser, which is what a backend needs. Download the LTS (long-term support) version from nodejs.org. LTS is the stable release most projects use; this course expects version 22 or newer.',
        'The installer also gives you npm, the tool that downloads packages such as Express. You will use both in almost every chapter.',
      ],
    },
    {
      title: 'Meet the terminal',
      body: [
        'A terminal is a window where you type commands instead of clicking. On macOS open Terminal, on Windows open PowerShell or Windows Terminal, and on Linux open your terminal app.',
        'You only need a handful of commands to start: pwd shows the folder you are in, ls (dir on Windows) lists its files, cd moves into a folder, and mkdir creates one. Check that Node is installed by asking for its version.',
      ],
      code: '# Each line is one command. Press Enter after each.\nnode -v      # prints something like v22.12.0\nnpm -v       # prints something like 10.9.0\n\nmkdir backend-course\ncd backend-course\npwd          # shows where you are',
      note: 'If node -v says “command not found”, close the terminal and open a new one. Installers only update terminals opened afterwards.',
    },
    {
      title: 'Pick an editor',
      body: [
        'Any code editor works. Visual Studio Code is free, popular, and has a built-in terminal (View → Terminal), so you can edit and run code in one window.',
        'Open your backend-course folder in the editor. Every project in this course lives in its own folder inside it.',
      ],
    },
    {
      title: 'Two habits that save hours',
      body: [
        'A server keeps running until you stop it. Press Ctrl+C in its terminal to stop it. If you start a second copy on the same port, you will see an “address already in use” error: stop the first one.',
        'Read error messages from the top. The first line usually names the problem, and the next lines point at the file and line number. Copying that first line into a search engine is a skill, not a failure.',
      ],
    },
  ],
  quiz: quiz(
    'You start a server and the terminal says “EADDRINUSE: address already in use :::3000”. What is the most likely cause?',
    [
      'Another program, probably an earlier copy of your server, is already using port 3000',
      'Node.js is not installed',
      'Your code has a typo',
      'Port 3000 is reserved for databases',
    ],
    'Only one program can listen on a port at a time. Stop the old one with Ctrl+C, or pick another port.',
  ),
  exercise: {
    goal: 'Run your first JavaScript file with Node.',
    steps: [
      'In your backend-course folder, create a file called hello.mjs.',
      "Put one line in it: console.log('Hello from Node', process.version);",
      'In the terminal, run node hello.mjs.',
    ],
    expected:
      'The terminal prints “Hello from Node” followed by your Node version. You just ran JavaScript without a browser.',
  },
  terms: [
    { term: 'Terminal', meaning: 'A text window where you type commands to your computer.' },
    { term: 'Node.js', meaning: 'The program that runs JavaScript outside the browser.' },
    { term: 'LTS', meaning: 'Long-term support: the stable Node version to install.' },
  ],
  sources: [
    { title: 'Node.js: download', url: 'https://nodejs.org/en/download' },
    {
      title: 'VS Code: get started',
      url: 'https://code.visualstudio.com/docs/getstarted/getting-started',
    },
  ],
};

export const ENV_SECRETS: NewChapter = {
  id: 'env-secrets',
  title: 'Environment variables & secrets',
  category: 'Configuration',
  track: 'Node.js & Express',
  duration: '8 min',
  difficulty: 'Beginner',
  summary: 'Keep passwords and settings out of your code with process.env and a .env file.',
  diagram: 'runtime',
  takeaway:
    'Code goes in Git. Secrets go in environment variables. A .env.example file documents which variables exist.',
  sections: [
    {
      title: 'Why not just write the password in the code?',
      body: [
        'Code gets copied, shared, and pushed to GitHub. A database password written in server.mjs ends up everywhere the code goes, and bots scan public repositories for leaked keys within minutes.',
        'Settings also change between machines. Your laptop uses port 3000 and a local database; production uses another port and another database. The code should be the same in both places.',
      ],
    },
    {
      title: 'process.env',
      body: [
        'Every process receives a set of named text values called environment variables. Node exposes them as process.env. Values are always strings (or undefined), so convert numbers yourself.',
        'Node 22 can load variables from a file with the --env-file flag. Put them in a file called .env, one NAME=value per line, with no quotes or spaces around the equals sign.',
      ],
      code: '# .env  — never commit this file\nPORT=3000\nDATABASE_URL=postgresql://postgres:postgres@localhost:5432/notes\n\n# Run with the file loaded:\n#   node --env-file=.env server.mjs',
    },
    {
      title: 'Read it in your server',
      body: [
        'Read each variable once at startup, give it a sensible default when one exists, and fail early with a clear message when a required one is missing. A server that starts without its database URL will only fail later, at a worse moment.',
      ],
      code: "// server.mjs\nconst port = Number(process.env.PORT ?? 3000);\nconst databaseUrl = process.env.DATABASE_URL;\n\nif (!databaseUrl) {\n  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');\n}",
    },
    {
      title: 'Keep .env out of Git',
      body: [
        'Add .env to .gitignore before your first commit. Then create .env.example with the same names and placeholder values, and commit that instead. A teammate copies it to .env and fills in their own values.',
        'If a real secret is ever committed, deleting the file is not enough: it stays in the Git history. Change the password or rotate the key.',
      ],
      code: '# .gitignore\nnode_modules\n.env\n\n# .env.example  — safe to commit\nPORT=3000\nDATABASE_URL=postgresql://user:password@localhost:5432/notes',
    },
  ],
  comparison: {
    express:
      "// server.mjs — run with: node --env-file=.env server.mjs\nimport express from 'express';\n\nconst app = express();\nconst port = Number(process.env.PORT ?? 3000);\n\napp.listen(port, () => console.log('Listening on', port));",
    efc: "// efc.config.ts (generated by create-efc-app)\nimport type { EFCConfig } from 'express-file-cluster';\n\nconst config: EFCConfig = {\n  port: process.env.PORT ? Number(process.env.PORT) : undefined,\n  databaseUrl: process.env.DATABASE_URL,\n  jwtSecret: process.env.JWT_SECRET,\n};\n\nexport default config;",
    explanation:
      'In Express you read process.env wherever you need it. A scaffolded EFC app generates .env, .env.example and efc.config.ts for you; npm run dev loads .env, and efc.config.ts passes each value to ignite(). ignite() never reads process.env by itself.',
    same: 'Secrets live in the environment, not in source code, and both read them explicitly.',
  },
  quiz: quiz(
    'You accidentally pushed .env with a real database password to GitHub. What should you do?',
    [
      'Change the database password, then remove the file and add .env to .gitignore',
      'Delete the file in a new commit; that removes it everywhere',
      'Make the repository private and keep the password',
      'Nothing, environment files are encrypted',
    ],
    'Old commits still contain the file. The only safe fix is to make the leaked password useless by changing it.',
  ),
  exercise: {
    goal: 'Move your Express port into an environment variable.',
    steps: [
      'In your express-notes project, create .env with PORT=4000.',
      'Change app.listen to use Number(process.env.PORT ?? 3000).',
      'Run node --env-file=.env server.mjs, then run node server.mjs without the flag.',
    ],
    expected:
      'With the flag the server listens on 4000; without it, it falls back to 3000. Same code, different configuration.',
  },
  terms: [
    {
      term: 'Environment variable',
      meaning: 'A named text value given to a process from outside the code.',
    },
    {
      term: '.env file',
      meaning: 'A local file of NAME=value lines that holds your secrets. Never commit it.',
    },
    { term: '.gitignore', meaning: 'A list of files Git should never track.' },
  ],
  sources: [
    {
      title: 'Node.js: environment variables',
      url: 'https://nodejs.org/en/learn/command-line/how-to-read-environment-variables-from-nodejs',
    },
    efcDocs('guides/environment-variables.md', 'EFC: environment variables'),
  ],
};

export const EFC_FIRST_PROJECT: NewChapter = {
  id: 'efc-first-project',
  title: 'Your first EFC project',
  category: 'EFC setup',
  track: 'EFC & databases',
  duration: '15 min',
  difficulty: 'Beginner',
  summary:
    'Start a database, generate an EFC app, tour every folder, and add your own route. By the end you have a running API.',
  diagram: 'http',
  takeaway:
    'create-efc-app gives you a working server. You add behaviour by adding files to src/api.',
  sections: [
    {
      title: 'Start a database first',
      body: [
        'An EFC app connects to its database before it accepts any request, so the database has to be running first. We will use PostgreSQL.',
        'The easiest way is Docker: install Docker Desktop, then run the command below once. It downloads PostgreSQL and starts it on port 5432 with the user and password postgres. Without Docker, you can create a free hosted PostgreSQL database (Neon and Supabase both have free tiers) and copy its connection string.',
      ],
      code: '# Start PostgreSQL in the background (run once)\ndocker run --name efc-postgres -d -p 5432:5432 \\\n  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=my-api \\\n  postgres:17\n\n# Later: docker stop efc-postgres / docker start efc-postgres',
    },
    {
      title: 'Generate the app',
      body: [
        'In your backend-course folder, run create-efc-app. It asks a few questions. For this course choose: TypeScript, PostgreSQL, defineTable, pg-boss, and no extra features for now. You can add features like login later with efc add.',
        'The generator writes the project, creates a .env file with your settings and a fresh secret, and installs everything. It takes a minute.',
      ],
      code: 'npx create-efc-app my-api\ncd my-api',
    },
    {
      title: 'Point it at your database',
      body: [
        'Open .env. The generator guessed a DATABASE_URL without a password. If you used the Docker command above, change it to include the user and password. If you used a hosted database, paste its connection string instead.',
      ],
      code: '# .env\nDATABASE_URL=postgresql://postgres:postgres@localhost:5432/my-api',
    },
    {
      title: 'Run it',
      body: [
        'npm run dev starts the server in development mode: it loads .env, connects to the database, finds your routes, and restarts when you save a file.',
        'Every route gets the /v1/api prefix by default, so the generated health check lives at /v1/api/health. Open it in your browser or with curl.',
      ],
      code: 'npm run dev\n\n# In a second terminal:\ncurl http://localhost:3000/v1/api/health\n# {"status":"OK","timestamp":"…"}',
      note: 'ECONNREFUSED or “password authentication failed” means the database is not running or DATABASE_URL is wrong. EADDRINUSE means something else is already on port 3000.',
    },
    {
      title: 'A tour of the folders',
      body: [
        'src/api holds your routes: every file is a URL. src/tasks holds background jobs (it starts with a SendEmail stub). src/model is where your database models go. src/index.ts starts the server, and efc.config.ts reads .env and passes the values to it.',
        '.env holds your secrets and is already in .gitignore; .env.example is the safe copy you commit. package.json has the scripts you will use: dev, build, start and test.',
      ],
      code: 'my-api/\n├── src/\n│   ├── api/\n│   │   └── health.ts      → GET /v1/api/health\n│   ├── tasks/\n│   │   └── SendEmail.ts   → task "SendEmail"\n│   ├── model/\n│   └── index.ts           → starts the server\n├── efc.config.ts          → reads .env, configures ignite()\n├── .env                   → your secrets (not in Git)\n└── .env.example           → template (in Git)',
    },
    {
      title: 'Add your own route',
      body: [
        'Create src/api/hello.ts. The file name gives the path, and the exported GET function handles GET requests. Save the file and the dev server picks it up.',
      ],
      code: "// src/api/hello.ts\nimport type { Request, Response } from 'express';\n\nexport const GET = async (_req: Request, res: Response) => {\n  res.json({ message: 'Hello from my first EFC route' });\n};\n\n// curl http://localhost:3000/v1/api/hello",
    },
  ],
  quiz: quiz(
    'You created src/api/hello.ts with a GET export. What URL serves it in a freshly generated app?',
    [
      'http://localhost:3000/v1/api/hello',
      'http://localhost:3000/hello',
      'http://localhost:3000/src/api/hello.ts',
      'http://localhost:3000/api/hello.ts',
    ],
    'The path comes from the file name, and EFC adds its default /v1/api prefix.',
  ),
  exercise: {
    goal: 'Add a route with a parameter.',
    steps: [
      'Create src/api/hello/[name].ts.',
      'Export a GET handler that responds with { message: `Hello, ${req.params.name}!` }.',
      'Request /v1/api/hello/Ada, then send a POST to the same URL.',
    ],
    expected:
      'GET returns {"message":"Hello, Ada!"}. POST returns 405 Method Not Allowed with an Allow: GET header, because you only exported GET.',
    hint: 'curl -i -X POST http://localhost:3000/v1/api/hello/Ada shows the status and headers.',
  },
  terms: [
    {
      term: 'Scaffold',
      meaning: 'Generate a starter project with the files and settings already in place.',
    },
    {
      term: 'npm run dev',
      meaning: 'Starts the server in development mode and restarts it when you save.',
    },
    {
      term: 'Docker',
      meaning: 'A tool that runs programs like PostgreSQL in isolated containers with one command.',
    },
  ],
  sources: [
    efcDocs('getting-started/index.md', 'EFC: getting started'),
    efcDocs('getting-started/project-structure.md', 'EFC: project structure'),
  ],
};

export const EFC_VALIDATION: NewChapter = {
  id: 'efc-validation',
  title: 'Validate input with schema',
  category: 'Validation',
  track: 'EFC & databases',
  duration: '10 min',
  difficulty: 'Beginner',
  summary:
    'Describe what a valid request looks like once, and let EFC reject everything else with a clear 400.',
  diagram: 'middleware',
  checkpoint: true,
  takeaway:
    'Never trust request data. Export a schema and your handler only ever sees input that passed it.',
  sections: [
    {
      title: 'Hand-written checks get long',
      body: [
        'In the Express chapters you checked typeof title !== "string" by hand. That works for one field. With five fields, nested objects, lengths and formats, the checks bury the real logic, and one missing check is a bug.',
        'A schema library lets you describe the shape instead: “title is a string of 1 to 120 characters”. Zod is the most popular one. Install it in your EFC project.',
      ],
      code: 'npm install zod',
    },
    {
      title: 'Export a schema next to your handler',
      body: [
        'Add an export called schema to a route file. Key it by method, then say which part of the request to check: params, query, or body. EFC runs it after middlewares and before your handler.',
        'If the request is valid, req.body (or params, or query) is replaced by the parsed result, so trims, defaults and number conversions are already applied when your handler runs.',
      ],
      code: "// src/api/notes/index.ts\nimport type { Request, Response } from 'express';\nimport { z } from 'zod';\n\nexport const schema = {\n  POST: {\n    body: z.object({\n      title: z.string().trim().min(1, 'A title is required').max(120),\n    }),\n  },\n};\n\nexport const POST = async (req: Request, res: Response) => {\n  // req.body.title is a trimmed, non-empty string here\n  res.status(201).json({ title: req.body.title });\n};",
    },
    {
      title: 'What a rejected request looks like',
      body: [
        'Invalid requests never reach your handler. EFC answers 400 with every problem it found, each with its location and field, so a frontend can show the message next to the right input.',
      ],
      code: 'curl -i -X POST http://localhost:3000/v1/api/notes \\\n  -H \'Content-Type: application/json\' -d \'{"title":""}\'\n\n# HTTP/1.1 400 Bad Request\n# {"error":"Validation failed","statusCode":400,\n#  "issues":[{"location":"body","path":"title",\n#             "message":"A title is required"}]}',
    },
    {
      title: 'Numbers in the URL are still strings',
      body: [
        'Everything in params and query arrives as text: /notes/42 gives "42", not 42. Use z.coerce.number() to convert and check in one step.',
      ],
      code: '// src/api/notes/[id].ts\nexport const schema = {\n  params: z.object({ id: z.coerce.number().int().positive() }),\n};\n// GET /v1/api/notes/42   → req.params.id === 42\n// GET /v1/api/notes/abc  → 400 before your handler runs',
    },
  ],
  comparison: {
    express:
      "app.post('/notes', (req, res) => {\n  const title = req.body?.title;\n  if (typeof title !== 'string' || !title.trim()) {\n    return res.status(400).json({ error: 'A title is required' });\n  }\n  if (title.length > 120) {\n    return res.status(400).json({ error: 'Title is too long' });\n  }\n  res.status(201).json({ title: title.trim() });\n});",
    efc: "export const schema = {\n  POST: {\n    body: z.object({\n      title: z.string().trim().min(1, 'A title is required').max(120),\n    }),\n  },\n};\n\nexport const POST = async (req: Request, res: Response) => {\n  res.status(201).json({ title: req.body.title });\n};",
    explanation:
      'Express leaves validation to you; you can also use zod there by calling safeParse yourself. EFC runs the exported schema for you and sends the 400.',
    same: 'Both refuse bad input with 400 before doing any work.',
  },
  quiz: quiz(
    'A route exports schema = { params: z.object({ id: z.coerce.number() }) }. A request arrives for /v1/api/notes/7. What is req.params.id inside the handler?',
    ['The number 7', 'The string "7"', 'undefined', 'An object { id: 7 }'],
    'On success, EFC replaces req.params with the parsed output, and coerce turned the text "7" into the number 7.',
  ),
  exercise: {
    goal: 'Validate a query string.',
    steps: [
      'In src/api/notes/index.ts, add a GET entry to schema with query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).',
      'In the GET handler, respond with { limit: req.query.limit }.',
      'Request /v1/api/notes, then ?limit=5, then ?limit=500.',
    ],
    expected:
      'No limit gives 20 (the default), ?limit=5 gives 5, and ?limit=500 is rejected with a 400 that names the limit field.',
  },
  terms: [
    {
      term: 'Validation',
      meaning: 'Checking that incoming data has the shape and values you expect.',
    },
    {
      term: 'Schema',
      meaning: 'A description of valid data, such as “title is a string up to 120 characters”.',
    },
    { term: 'Zod', meaning: 'A popular library for writing schemas in TypeScript.' },
  ],
  sources: [
    efcDocs('guides/validation.md', 'EFC: request validation'),
    { title: 'Zod documentation', url: 'https://zod.dev' },
  ],
};

export const EFC_TESTING: NewChapter = {
  id: 'efc-testing',
  title: 'Test your API automatically',
  category: 'Testing',
  track: 'Production essentials',
  duration: '10 min',
  difficulty: 'Beginner',
  summary:
    'Replace clicking around with tests that send requests to your real routes and check the answers in milliseconds.',
  diagram: 'http',
  takeaway:
    'A test sends a request and checks the response. Run them before every change you ship.',
  sections: [
    {
      title: 'Why test?',
      body: [
        'So far you checked your API by hand with curl. That is fine once. After ten routes, you will not re-check all of them every time you change something, and that is exactly when old routes break.',
        'An automated test does the checking for you: send this request, expect that status and body. npm test runs all of them in a second or two.',
      ],
    },
    {
      title: 'Install the tools',
      body: [
        'A generated EFC project already includes Vitest, the test runner behind npm test. Add supertest, a library that sends HTTP requests to an app without starting a real server.',
      ],
      code: 'npm install -D supertest @types/supertest',
    },
    {
      title: 'Write your first test',
      body: [
        'createTestApp from express-file-cluster/testing loads your real route files into an app, with the same validation, error handling and 405 behaviour as production. It does not connect to a database or start the queue, which keeps simple tests fast.',
        'Create a tests folder and the file below. Test files end in .test.ts so Vitest finds them.',
      ],
      code: "// tests/hello.test.ts\nimport { describe, expect, it } from 'vitest';\nimport request from 'supertest';\nimport path from 'node:path';\nimport { createTestApp } from 'express-file-cluster/testing';\n\ndescribe('GET /hello', () => {\n  it('says hello', async () => {\n    const app = await createTestApp({ apiDir: path.resolve('src/api') });\n    const res = await request(app).get('/v1/api/hello');\n\n    expect(res.status).toBe(200);\n    expect(res.body.message).toContain('Hello');\n  });\n\n  it('rejects POST with 405', async () => {\n    const app = await createTestApp({ apiDir: path.resolve('src/api') });\n    const res = await request(app).post('/v1/api/hello');\n    expect(res.status).toBe(405);\n  });\n});",
    },
    {
      title: 'Run it',
      body: [
        'npm test runs every test file once and prints a summary. A green “passed” means every expectation held. A failure shows what was expected and what actually came back.',
        'Test the unhappy paths too: missing fields, wrong types, unknown ids. Those are the cases users hit and you forget to try by hand.',
      ],
      code: 'npm test\n\n#  ✓ tests/hello.test.ts (2 tests)\n#  Test Files  1 passed (1)\n#       Tests  2 passed (2)',
      note: 'apiDir is an option of createTestApp only. ignite() always finds src/api by convention.',
    },
  ],
  quiz: quiz(
    'What does createTestApp give you?',
    [
      'An app with your real route files, without starting a server or connecting services',
      'A fake app with mocked routes you write by hand',
      'A copy of production, including its database',
      'A browser that clicks through your frontend',
    ],
    'It mounts your actual src/api files with production HTTP behaviour, but skips listen(), clustering, databases and queues.',
  ),
  exercise: {
    goal: 'Test your validation.',
    steps: [
      'Create tests/notes.test.ts for the notes route from the validation chapter.',
      'Send POST /v1/api/notes with { title: "" } and expect status 400 and res.body.issues[0].path to be "title".',
      'Send a valid title and expect 201. Run npm test.',
    ],
    expected:
      'Both tests pass. Now break the schema on purpose (remove .min(1)) and run npm test again: the first test fails and tells you why.',
    hint: 'Send a JSON body with request(app).post(url).send({ title: "" }).',
  },
  terms: [
    { term: 'Test', meaning: 'Code that runs your code and checks the result automatically.' },
    { term: 'Vitest', meaning: 'The test runner that npm test uses in an EFC project.' },
    {
      term: 'Assertion',
      meaning: 'One expectation in a test, such as expect(res.status).toBe(200).',
    },
  ],
  sources: [
    efcDocs('guides/testing.md', 'EFC: testing routes'),
    { title: 'Vitest: getting started', url: 'https://vitest.dev/guide/' },
  ],
};

export const SECURITY_BASICS: NewChapter = {
  id: 'security-basics',
  title: 'Security basics every backend needs',
  category: 'Security',
  track: 'Production essentials',
  duration: '11 min',
  difficulty: 'Beginner',
  summary:
    'The handful of habits that prevent most real-world breaches: distrust input, hash passwords, hide secrets, limit abuse.',
  diagram: 'middleware',
  takeaway:
    'Assume every request could be hostile. Validate it, store only hashes of passwords, return only safe fields, and limit repeated attempts.',
  sections: [
    {
      title: 'Every request is untrusted',
      body: [
        'Anyone can send anything to your API: not just your frontend, but curl, scripts and attackers. A field your form never sends can still arrive. A field that should be a string can arrive as an object.',
        'That matters for databases. A login handler that passes req.body.email straight into a filter can receive { "$ne": "" } instead of an email, which some query APIs read as “any email”. Check that values are plain strings (or validate with a schema) before they reach a query.',
      ],
      code: "// Before using a request value in a query:\nconst email = req.body?.email;\nif (typeof email !== 'string') {\n  return res.status(400).json({ error: 'Invalid email' });\n}",
    },
    {
      title: 'Never build SQL from strings',
      body: [
        'Gluing user input into SQL text lets the input change the query itself; this is SQL injection, one of the oldest and most damaging bugs. Use placeholders ($1, $2) with a SQL client, or model methods like findMany, which send values separately from the query.',
      ],
      code: "// ❌ Dangerous: input becomes part of the SQL\npool.query(`SELECT * FROM users WHERE email = '${email}'`);\n\n// ✅ Safe: the value is sent separately\npool.query('SELECT id, email FROM users WHERE email = $1', [email]);\n\n// ✅ Safe: model methods do the same for you\nawait User.findFirst({ where: { email } });",
    },
    {
      title: 'Store password hashes, never passwords',
      body: [
        'If your database leaks, plain passwords let attackers into your users’ other accounts too. Store a slow, salted hash instead and compare hashes at login. EFC ships hashPassword and verifyPassword for this.',
        'Then never send the hash back. Strip password, refreshToken, resetToken, verifyToken and their expiry fields from every record you return.',
      ],
      code: "import { hashPassword, verifyPassword } from 'express-file-cluster/auth';\n\n// Sign-up\nconst passwordHash = await hashPassword(req.body.password);\n\n// Login\nconst ok = await verifyPassword(req.body.password, user.passwordHash);\nif (!ok) return res.status(401).json({ error: 'Wrong email or password' });",
    },
    {
      title: 'Limit repeated attempts',
      body: [
        'Without a limit, a script can try thousands of passwords a minute. rateLimit counts requests per client and answers 429 Too Many Requests over the limit. It needs a cache configured (generated apps have one).',
      ],
      code: "// src/api/auth/login.ts\nimport { rateLimit } from 'express-file-cluster';\n\nexport const middlewares = [rateLimit({ window: '15m', max: 5 })];",
    },
    {
      title: 'Small habits, big difference',
      body: [
        'Send generic error messages to clients (“Something went wrong”) and keep stack traces in your logs. Serve production only over HTTPS; hosting platforms handle the certificate for you. Run npm audit regularly and update dependencies with known vulnerabilities.',
      ],
    },
  ],
  quiz: quiz(
    'Which is the safe way to store a user’s password?',
    [
      'Store hashPassword(password) and compare with verifyPassword at login',
      'Store the password as written, in a column only admins can read',
      'Encrypt it with a key saved in the same database',
      'Store it in the JWT so the database never sees it',
    ],
    'A slow, salted hash cannot be turned back into the password, so a leak does not expose it.',
  ),
  exercise: {
    goal: 'Find the five problems in this handler.',
    steps: [
      "app.post('/login', async (req, res) => {",
      "  const user = await pool.query(`SELECT * FROM users WHERE email = '${req.body.email}'`);",
      '  if (user.rows[0].password === req.body.password) res.json(user.rows[0]);',
      '  else res.status(500).json({ error: err.stack });',
      '});',
    ],
    expected:
      'SQL built from input (injection); no check that email is a string; plain-text password comparison (should be verifyPassword on a hash); the full user row, password included, is returned; a wrong password returns 500 with internals instead of 401 with a generic message. Bonus: no rate limit.',
  },
  terms: [
    {
      term: 'SQL injection',
      meaning: 'An attack where input changes the meaning of a database query.',
    },
    {
      term: 'Hash',
      meaning:
        'A one-way scramble of a password; you can check a guess against it but not reverse it.',
    },
    {
      term: 'Rate limit',
      meaning: 'A cap on how many requests one client may make in a time window.',
    },
  ],
  sources: [
    { title: 'OWASP Top 10', url: 'https://owasp.org/www-project-top-ten/' },
    efcDocs('api-reference/auth.md', 'EFC: auth API (password helpers)'),
  ],
};
