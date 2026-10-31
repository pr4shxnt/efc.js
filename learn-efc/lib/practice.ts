// Hands-on exercises, key terms and quiz rewrites for each chapter, keyed by chapter id.
// tutorials.ts merges these into the chapter list.

export interface Exercise {
  goal: string;
  steps: string[];
  expected: string;
  hint?: string;
}
export interface Term {
  term: string;
  meaning: string;
}
export interface Quiz {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}
export interface ChapterExtras {
  exercise: Exercise;
  terms: Term[];
  quiz?: Quiz;
}

/** Options are written with the correct answer first; tutorials.ts shuffles them. */
export const quiz = (question: string, options: string[], explanation: string): Quiz => ({
  question,
  options,
  correctIndex: 0,
  explanation,
});

export const EXTRAS: Record<string, ChapterExtras> = {
  'web-intro': {
    terms: [
      {
        term: 'Client',
        meaning: 'The program that asks for something, such as your browser or a mobile app.',
      },
      {
        term: 'Server',
        meaning: 'The program that receives requests and decides what to send back.',
      },
      {
        term: 'Backend',
        meaning:
          'The server-side part of an application: data, rules, and work the user never sees directly.',
      },
    ],
    exercise: {
      goal: 'Watch a real request and response in your own browser.',
      steps: [
        'Open any website, then open the developer tools (F12, or right-click → Inspect).',
        'Go to the Network tab and reload the page.',
        'Click the first row in the list. Find the request method, the URL, and the status code.',
      ],
      expected:
        'You see a GET request to the page URL with status 200, followed by more requests for images, styles and scripts. Each row is one request and one response.',
    },
  },
  'servers-ports': {
    terms: [
      {
        term: 'Port',
        meaning:
          'A number that picks which program on a machine receives a connection, such as 3000.',
      },
      { term: 'localhost', meaning: 'A name that always means “this computer”.' },
      { term: 'Listening', meaning: 'A server program waiting for connections on a port.' },
    ],
    exercise: {
      goal: 'Break a URL into its parts.',
      steps: [
        'Take this URL: http://localhost:8080/api/notes?limit=5',
        'Write down the protocol, the hostname, the port, the path, and the query string.',
      ],
      expected:
        'Protocol http, hostname localhost, port 8080, path /api/notes, query string limit=5.',
      hint: 'The query string is everything after the question mark.',
    },
  },
  'http-basics': {
    terms: [
      {
        term: 'Method',
        meaning: 'The verb of a request: GET reads, POST creates, PATCH changes, DELETE removes.',
      },
      {
        term: 'Status code',
        meaning:
          'A three-digit number in the response saying how it went: 2xx success, 4xx caller mistake, 5xx server problem.',
      },
      {
        term: 'Header',
        meaning: 'A named piece of information about the message, such as Content-Type.',
      },
      { term: 'Body', meaning: 'The data carried by a request or response, often JSON.' },
    ],
    exercise: {
      goal: 'Match each situation to a status code.',
      steps: [
        'A user asks for note 99, which does not exist.',
        'A user sends a new note without a title.',
        'A user creates a note successfully.',
        'Your code crashes with an unexpected error.',
      ],
      expected: '404 Not Found, 400 Bad Request, 201 Created, 500 Internal Server Error.',
      hint: 'Use the request lab above to see a few of these happen.',
    },
  },
  'apis-json': {
    terms: [
      {
        term: 'API',
        meaning: 'An agreement about which requests a program accepts and what it answers.',
      },
      {
        term: 'JSON',
        meaning: 'A text format for data: objects, arrays, strings, numbers, true/false and null.',
      },
      { term: 'Endpoint', meaning: 'One method + path your API supports, such as GET /notes.' },
    ],
    exercise: {
      goal: 'Spot the invalid JSON.',
      steps: [
        "Look at this: { title: 'Buy milk', done: false, }",
        'Find the three things that make it invalid JSON, then write the corrected version.',
      ],
      expected:
        '{ "title": "Buy milk", "done": false } — keys need double quotes, strings need double quotes, and trailing commas are not allowed.',
    },
  },
  'javascript-backend': {
    terms: [
      {
        term: 'Promise',
        meaning: 'A value that will be ready later, such as the result of a database query.',
      },
      {
        term: 'async / await',
        meaning:
          'Syntax for waiting on a promise inside a function without blocking everything else.',
      },
      { term: 'Module', meaning: 'A file that exports values other files can import.' },
    ],
    exercise: {
      goal: 'Write and run your first async function in Node.',
      steps: [
        'Create a file called wait.mjs.',
        'Write an async function that awaits new Promise((resolve) => setTimeout(resolve, 1000)) and then logs "done".',
        'Call it, log "started" right after the call, and run node wait.mjs.',
      ],
      expected:
        '“started” prints first, then “done” one second later. Calling an async function does not stop the rest of the file.',
    },
  },
  'node-http': {
    terms: [
      {
        term: 'Runtime',
        meaning: 'The program that runs your code. Node.js is a JavaScript runtime for servers.',
      },
      {
        term: 'Handler',
        meaning: 'The function that receives a request and produces the response.',
      },
      {
        term: 'Ctrl+C',
        meaning: 'The keyboard shortcut that stops a running server in the terminal.',
      },
    ],
    exercise: {
      goal: 'Make the Node server answer differently per path.',
      steps: [
        'Start from the server.mjs in this chapter.',
        "Inside the handler, check req.url. If it is '/hello', send { message: 'Hello' }; otherwise use status 404 and send { error: 'Not found' }.",
        'Restart the server (Ctrl+C, then node server.mjs) and try both paths.',
      ],
      expected:
        'http://127.0.0.1:3000/hello returns the message; any other path returns a 404 with the error. You just wrote a router by hand.',
      hint: 'Node does not reload your file automatically. Restart after every change.',
    },
  },
  'express-first': {
    terms: [
      {
        term: 'npm',
        meaning: 'The tool that installs JavaScript packages and records them in package.json.',
      },
      { term: 'Route', meaning: 'A method and path paired with a handler, such as GET /hello.' },
      { term: 'res.json', meaning: 'Sends a JavaScript value as a JSON response.' },
    ],
    exercise: {
      goal: 'Add a second route to your Express server.',
      steps: [
        "Add app.get('/time', …) that responds with { now: new Date().toISOString() }.",
        'Restart the server and open http://127.0.0.1:3000/time.',
        'Refresh a few times.',
      ],
      expected: 'You get a JSON object with the current time, and it changes on every refresh.',
    },
  },
  'express-routes': {
    terms: [
      {
        term: 'Route parameter',
        meaning: 'A named part of the path, such as :id in /notes/:id. Read it from req.params.',
      },
      {
        term: 'Query string',
        meaning: 'Extra options after ? in the URL, such as ?limit=5. Read them from req.query.',
      },
      { term: 'REST', meaning: 'A common style for APIs: resources as paths, methods as actions.' },
    ],
    exercise: {
      goal: 'Add GET /notes/:id to the notes API.',
      steps: [
        'Add a route that finds a note whose id equals req.params.id.',
        'If none is found, respond with status 404 and { error: "Note not found" }.',
        'Create a note with the curl command, copy its id, and request it.',
      ],
      expected:
        'Requesting the copied id returns that note with status 200. A made-up id returns 404.',
      hint: 'notes.find((n) => n.id === req.params.id) returns undefined when nothing matches.',
    },
  },
  'express-middleware': {
    terms: [
      {
        term: 'Middleware',
        meaning:
          'A function that runs before your handler and can inspect, change, or stop the request.',
      },
      { term: 'next()', meaning: 'Hands the request to the next middleware or handler.' },
      {
        term: 'Error handler',
        meaning:
          'Middleware with four arguments (err, req, res, next) that turns errors into responses.',
      },
    ],
    exercise: {
      goal: 'Time every request.',
      steps: [
        'Write a middleware that saves Date.now() before calling next().',
        "Inside it, listen for res.on('finish', …) and log the method, path, status code and elapsed milliseconds.",
        'Register it with app.use before your routes and send a few requests.',
      ],
      expected: 'Each request prints a line like GET /notes 200 3ms in the terminal.',
    },
  },
  'quest-2': {
    terms: [
      {
        term: 'File-based routing',
        meaning: 'The folder and file names decide the URL, instead of app.get calls.',
      },
      { term: 'basePath', meaning: 'A prefix EFC adds to every route. The default is /v1/api.' },
      {
        term: '405 Method Not Allowed',
        meaning: 'The path exists, but not for this method. EFC sends it automatically.',
      },
    ],
    quiz: quiz(
      'You have src/api/users/me.ts and src/api/users/[id].ts. Which file answers GET /v1/api/users/me?',
      [
        'users/me.ts',
        'users/[id].ts, with id set to "me"',
        'Neither; EFC refuses to start',
        'Whichever file was created first',
      ],
      'A fixed segment like “me” is more specific than a dynamic [id], so me.ts wins every time.',
    ),
    exercise: {
      goal: 'Predict the URL for each file.',
      steps: [
        'src/api/health.ts',
        'src/api/notes/index.ts',
        'src/api/notes/[id].ts',
        'src/api/docs/[...slug].ts',
      ],
      expected:
        '/v1/api/health, /v1/api/notes, /v1/api/notes/:id, and /v1/api/docs/* (one or more segments). Check yourself in the route simulator.',
    },
  },
  'database-basics': {
    terms: [
      {
        term: 'Database',
        meaning: 'A separate program that stores data safely so it survives restarts.',
      },
      {
        term: 'Table / collection',
        meaning: 'Where records of one kind live: a table in PostgreSQL, a collection in MongoDB.',
      },
      { term: 'Query', meaning: 'A request to the database to read or change records.' },
    ],
    exercise: {
      goal: 'Design a table on paper.',
      steps: [
        'Think about a notes app with users.',
        'List the columns you would need for a notes table and a users table, with a type for each (text, number, true/false, date).',
        'Mark which column connects a note to its user.',
      ],
      expected:
        'Something like notes(id, title, done, createdAt, userId) and users(id, email, passwordHash). userId on notes points at users.id.',
    },
  },
  'database-connections': {
    terms: [
      {
        term: 'Connection string',
        meaning: 'A URL that says where the database is and how to log in. Treat it as a secret.',
      },
      {
        term: 'Pool',
        meaning:
          'A small set of open connections that requests share, instead of opening one per request.',
      },
      {
        term: 'Pre-Flight',
        meaning: 'EFC’s startup steps: connect services first, then accept requests.',
      },
    ],
    exercise: {
      goal: 'Read a connection string.',
      steps: [
        'Take postgresql://app:s3cret@db.example.com:5432/notes',
        'Name the user, password, host, port and database.',
        'Decide where this string should live in your project.',
      ],
      expected:
        'User app, password s3cret, host db.example.com, port 5432, database notes. It belongs in .env (never in your code or in Git).',
    },
  },
  'quest-3': {
    terms: [
      {
        term: 'Model',
        meaning: 'A JavaScript object that represents a table and gives you methods to query it.',
      },
      {
        term: 'defineTable',
        meaning: 'EFC’s PostgreSQL model API, with Prisma-style methods like findMany.',
      },
      {
        term: 'select',
        meaning: 'Choose which fields come back, so secrets never leave the server.',
      },
    ],
    quiz: quiz(
      'Which call is valid on a model created with defineTable?',
      [
        "User.findMany({ where: { role: 'admin' }, take: 10 })",
        "User.find({ role: 'admin' })",
        "User.findById('42')",
        "User.aggregate([{ $match: { role: 'admin' } }])",
      ],
      'defineTable speaks Prisma: findMany, findUnique, create, update. find, findById and aggregate are MongoDB vocabulary.',
    ),
    exercise: {
      goal: 'Build a real notes API backed by PostgreSQL.',
      steps: [
        "In your EFC project, create src/model/Note.ts with defineTable('Note', { title: { type: 'string', required: true }, done: { type: 'boolean', default: false } }).",
        'In src/api/notes/index.ts, add GET (findMany with take: 20) and POST (create with the validated title).',
        'Restart npm run dev, create two notes with curl, then stop and start the server again.',
      ],
      expected:
        'GET /v1/api/notes still returns both notes after the restart. That is the difference a database makes.',
      hint: 'Reuse the schema export from the validation chapter for the POST body.',
    },
  },
  'quest-5': {
    terms: [
      {
        term: 'Authentication',
        meaning: 'Proving who the caller is, for example with a password or a token.',
      },
      { term: 'Authorization', meaning: 'Deciding what that caller is allowed to do.' },
      {
        term: 'JWT',
        meaning:
          'A signed token the server gives after login; the client sends it back on later requests.',
      },
    ],
    quiz: quiz(
      'A logged-in member calls an admin-only endpoint protected by requireAuth("admin"). What happens?',
      [
        'They get 403 Forbidden',
        'They get 401 Unauthorized',
        'The request succeeds because they are logged in',
        'EFC logs them out',
      ],
      '401 means “we don’t know who you are”. 403 means “we know who you are, and you’re not allowed”.',
    ),
    exercise: {
      goal: 'Add login to your project and protect a route.',
      steps: [
        'In your EFC project, run efc add auth and follow the prompts.',
        'Register a user with POST /v1/api/auth/register, then log in with POST /v1/api/auth/login.',
        'Call GET /v1/api/auth/me with and without the login cookie or token.',
      ],
      expected:
        'Without credentials you get 401. After logging in, /auth/me returns your user — without a password field.',
      hint: 'With curl, save cookies with -c cookies.txt on login and send them with -b cookies.txt.',
    },
  },
  'quest-4': {
    terms: [
      {
        term: 'Background task',
        meaning: 'Work that runs after the response is sent, such as sending an email.',
      },
      {
        term: 'Queue',
        meaning: 'A waiting line of jobs, stored in Redis or PostgreSQL so they survive restarts.',
      },
      {
        term: 'Retry',
        meaning: 'Running a failed job again, automatically, a set number of times.',
      },
      {
        term: 'Dead-letter queue',
        meaning: 'Where jobs go after every retry has failed, so you can inspect and replay them.',
      },
    ],
    quiz: quiz(
      'How do you make an EFC task run every night at 2am?',
      [
        "Pass schedule: '0 2 * * *' in the defineTask options",
        "Call scheduleTask('0 2 * * *', handler)",
        "Export const cron = '0 2 * * *' from the task file",
        'Add the schedule to package.json',
      ],
      'Schedules are a defineTask option. Scheduled runs receive an empty payload {}.',
    ),
    exercise: {
      goal: 'Send work to the background.',
      steps: [
        'Open src/tasks/SendEmail.ts in your project and add a console.log of the payload.',
        "In a route handler, call await enqueue('SendEmail', { to: 'you@example.com' }) and respond with status 202.",
        'Call the route and watch the terminal running npm run dev.',
      ],
      expected:
        'The HTTP response comes back immediately with 202. A moment later the task’s log line appears — the work happened outside the request.',
      hint: 'The task name is the file name without its extension: SendEmail.',
    },
  },
  'quest-1': {
    terms: [
      { term: 'Process', meaning: 'One running copy of your program, with its own memory.' },
      { term: 'Worker', meaning: 'One of several processes that serve requests side by side.' },
      {
        term: 'Graceful shutdown',
        meaning: 'Finishing in-flight requests before the process exits.',
      },
    ],
    quiz: quiz(
      'Where does EFC find your route files?',
      [
        'In src/api, by convention',
        'Wherever ignite({ apiDir }) points',
        'In efc.config.ts, which ignite loads automatically',
        'In src/routes',
      ],
      'src/api and src/tasks are fixed conventions. ignite() has no apiDir option and does not load efc.config.ts by itself.',
    ),
    exercise: {
      goal: 'See the startup order for yourself.',
      steps: [
        'Run npm run dev in your project and read the log lines from the top.',
        'Find where the database connects, where tasks register, and where the port starts listening.',
        'Stop the database (for example docker stop efc-postgres) and start the server again.',
      ],
      expected:
        'Normally the listener line comes last. With the database stopped, startup fails before the port opens, so no request ever hits a half-ready server. Start the database again afterwards.',
    },
  },
  'cors-origins': {
    terms: [
      { term: 'Origin', meaning: 'Protocol + hostname + port, such as http://localhost:5173.' },
      {
        term: 'CORS',
        meaning: 'Headers that tell the browser which other origins may read your API’s responses.',
      },
      {
        term: 'Preflight',
        meaning: 'An OPTIONS request the browser sends first to ask what is allowed.',
      },
    ],
    exercise: {
      goal: 'Trigger a CORS error on purpose.',
      steps: [
        'With your API running on port 3000, open any other website in your browser.',
        "In its console, run fetch('http://localhost:3000/v1/api/health').then((r) => r.json()).then(console.log)",
        'Read the error, then compare with running curl http://localhost:3000/v1/api/health in a terminal.',
      ],
      expected:
        'The browser blocks the response with a CORS error, but curl gets it fine. CORS is a browser rule, not a firewall.',
    },
  },
  deployment: {
    terms: [
      {
        term: 'Build',
        meaning: 'Turning your TypeScript source into the JavaScript that production runs.',
      },
      {
        term: 'Environment',
        meaning: 'Where the app runs: development on your laptop, production for real users.',
      },
      {
        term: 'Health check',
        meaning: 'A simple endpoint the hosting platform calls to see if your app is alive.',
      },
    ],
    exercise: {
      goal: 'Run your project the way production does.',
      steps: [
        'Stop npm run dev, then run npm run build.',
        'Look inside dist/src and find your route files.',
        'Run npm start and request /v1/api/health.',
      ],
      expected:
        'The build creates dist/src/api with one .js file per route, and the production server answers the health check. That folder is what you deploy.',
    },
  },
};
