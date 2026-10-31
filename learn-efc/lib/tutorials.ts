import { QUESTS, type Quest } from './efc-data';
import type { ActiveTab } from '../components/Navbar';
import { EXTRAS, quiz, type Exercise, type Term } from './practice';
import {
  EFC_FIRST_PROJECT,
  EFC_TESTING,
  EFC_VALIDATION,
  ENV_SECRETS,
  SECURITY_BASICS,
  SETUP,
} from './new-chapters';

export interface ArticleSection {
  title: string;
  body: string[];
  code?: string;
  note?: string;
}
export interface Comparison {
  express: string;
  efc: string;
  explanation: string;
  same: string;
  expressLabel?: string;
  efcLabel?: string;
}
export interface Tutorial extends Quest {
  track: 'Web foundations' | 'Node.js & Express' | 'EFC & databases' | 'Production essentials';
  sections: ArticleSection[];
  diagram: 'web' | 'http' | 'middleware' | 'database' | 'runtime';
  takeaway: string;
  comparison?: Comparison;
  playground?: ActiveTab;
  checkpoint?: boolean;
  sources: { title: string; url: string }[];
  exercise?: Exercise;
  terms?: Term[];
}
const expressSource = {
  title: 'Express: getting started',
  url: 'https://expressjs.com/en/starter/hello-world/',
};
const middlewareSource = {
  title: 'Express: middleware',
  url: 'https://expressjs.com/en/guide/using-middleware/',
};
const efcSource = {
  title: 'EFC documentation',
  url: 'https://efc.prashantadhikari7.com.np/docs.html',
};
function tutorial(
  data: Omit<Tutorial, 'concept' | 'codeExample' | 'difficulty'> &
    Partial<Pick<Tutorial, 'concept' | 'codeExample' | 'difficulty'>>,
): Tutorial {
  return { difficulty: 'Beginner', concept: '', codeExample: '', ...data };
}
function efcLesson(
  index: number,
  data: Pick<Tutorial, 'track' | 'sections' | 'diagram' | 'takeaway'> & Partial<Tutorial>,
): Tutorial {
  return { ...QUESTS[index], sources: [efcSource], ...data };
}

const CHAPTERS: Tutorial[] = [
  tutorial({
    id: 'web-intro',
    title: 'How the web works',
    category: 'Start here',
    track: 'Web foundations',
    duration: '6 min',
    summary:
      'Follow a page request from your browser to a server and back. No framework knowledge needed.',
    diagram: 'web',
    takeaway:
      'A browser asks for a resource. A server processes that request and sends a response.',
    sections: [
      {
        title: 'Two sides of a conversation',
        body: [
          'When you open a website, your browser acts as a client: a program asking another program for something. The server is the program that receives that request and decides what to return.',
          'The frontend is the part you see and interact with. The backend handles work such as looking up a product, checking a password, or saving a note. A backend can serve browsers, mobile apps, and other servers.',
        ],
      },
      {
        title: 'What happens after you enter a URL?',
        body: [
          'For a fresh network request, the browser resolves the hostname to an address, opens a connection, and sends an HTTP request. With HTTPS, the connection also uses TLS to protect data in transit.',
          'The server reads the requested path, runs the matching application code, and returns a status, headers, and usually a body. The browser then uses that response. Caches and existing connections can skip some of these steps.',
        ],
        code: 'Browser: GET /hello\nServer:  200 OK\nBody:    Hello from the backend!',
      },
      {
        title: 'Where Express and EFC fit',
        body: [
          'Node.js lets JavaScript run outside the browser. Express adds tools for handling HTTP requests in Node.js. EFC builds on Express and supplies conventions for organizing routes and other backend work.',
          'You will learn the shared request-and-response ideas first. Later, you will write the same behavior in Express and EFC, so every shortcut has an explanation.',
        ],
      },
    ],
    quiz: quiz(
      'Which program usually starts a web request?',
      ['The client, such as a browser', 'The database', 'A route file', 'A response header'],
      'The client sends a request; the server returns a response.',
    ),
    sources: [
      {
        title: 'MDN: how the web works',
        url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Web_standards/How_the_web_works',
      },
    ],
  }),
  tutorial({
    id: 'servers-ports',
    title: 'What is a server? Hosts, ports & localhost',
    category: 'Servers',
    track: 'Web foundations',
    duration: '7 min',
    summary: 'Understand the difference between a machine, a server program, and a listening port.',
    diagram: 'runtime',
    takeaway:
      'The hostname identifies where to connect. The port identifies which service to contact there.',
    sections: [
      {
        title: 'A machine and a program are different things',
        body: [
          'People use “server” for both a computer and the program running on it. Your laptop can run a server program while also running the browser that sends requests to it.',
          'A server program listens for connections. It does not need a visible window, and it keeps running until it is stopped or crashes.',
        ],
      },
      {
        title: 'Read a development URL',
        body: [
          'In http://localhost:3000/notes, http is the protocol, localhost is the hostname, 3000 is the port, and /notes is the path. localhost refers to your own machine.',
          'A port is a numbered endpoint used by the operating system. Two programs usually cannot listen on the same address and port at the same time. An address-in-use error means you should stop the other program or choose another port.',
        ],
        code: 'http://localhost:3000/notes\n       └─ host ─┘ │    └ path\n                  └ port',
      },
      {
        title: 'Listening is not the same as responding',
        body: [
          'Starting a listener makes a service reachable. A route handler still needs to decide what to send for each request. A missing route commonly produces a 404 response.',
          'During this course, examples use port 3000. You will meet public hostnames, proxies, environment variables, and production startup later.',
        ],
      },
    ],
    quiz: quiz(
      'What does localhost refer to?',
      [
        'The machine making the connection',
        'A public production database',
        'Every server on the internet',
        'The path of your source code',
      ],
      'localhost resolves to a loopback address on the machine making the request.',
    ),
    sources: [
      {
        title: 'MDN: URLs',
        url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Web_mechanics/What_is_a_URL',
      },
    ],
  }),
  tutorial({
    id: 'http-basics',
    title: 'HTTP requests & responses',
    category: 'HTTP',
    track: 'Web foundations',
    duration: '9 min',
    summary: 'Read methods, paths, status codes, headers, and bodies before writing a route.',
    diagram: 'http',
    checkpoint: true,
    takeaway:
      'HTTP describes the conversation. Your framework helps you implement each side of it.',
    sections: [
      {
        title: 'Anatomy of a request',
        body: [
          'A request describes an operation. GET commonly reads a resource; POST commonly submits data or creates something. The path identifies the resource. Headers describe the message, and an optional body carries data.',
          'GET /notes and POST /notes can use the same path but do different work. The combination of method and path matters.',
        ],
        code: 'POST /notes HTTP/1.1\nHost: localhost:3000\nContent-Type: application/json\n\n{"title":"Learn HTTP"}',
      },
      {
        title: 'Anatomy of a response',
        body: [
          'A response contains a status code, headers, and possibly a body. 200 indicates success, 201 indicates creation, and 204 indicates success with no response body.',
          '400 signals a bad request, 401 missing or invalid authentication, 403 a refusal despite knowing who the caller is, 404 a missing resource, and 500 an unexpected server problem. These codes are useful to clients, not just to developers.',
        ],
        code: 'HTTP/1.1 201 Created\nContent-Type: application/json\n\n{"id":"note-1","title":"Learn HTTP"}',
      },
      {
        title: 'The same response in both frameworks',
        body: [
          'In Express and EFC, res.status(201).json(data) sets the status and sends a JSON response. Sending ends the response; do not try to send a second one.',
          'A POST request does not become successful just because its body is valid JSON. Your application still checks the data and decides whether the operation is allowed.',
        ],
      },
    ],
    quiz: quiz(
      'Which response best describes a newly created note?',
      [
        '201 Created, with the new note in the body',
        '404 Not Found',
        '500 Internal Server Error',
        'Always 200, regardless of the result',
      ],
      '201 tells the caller that a new resource was created.',
    ),
    sources: [
      {
        title: 'MDN: HTTP messages',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Messages',
      },
    ],
  }),
  tutorial({
    id: 'apis-json',
    title: 'APIs, JSON & the frontend–backend boundary',
    category: 'APIs',
    track: 'Web foundations',
    duration: '7 min',
    summary: 'See how a frontend asks a backend for structured data instead of a complete page.',
    diagram: 'http',
    takeaway:
      'An API is an agreement about requests and responses; JSON is one way to represent its data.',
    sections: [
      {
        title: 'What makes something an API?',
        body: [
          'An API is an interface another program can use. For a web API, that agreement includes URLs, methods, input data, responses, and error behavior.',
          'A note-taking frontend might request GET /notes, render the returned notes, and send POST /notes when someone saves a new one. The backend never needs to know which button was clicked.',
        ],
      },
      {
        title: 'JSON is data, not JavaScript code',
        body: [
          'JSON can represent objects, arrays, strings, numbers, booleans, and null. Object keys and strings use double quotes. Functions, undefined, and comments are not JSON values.',
          'The server receives bytes. A JSON parser turns those bytes into a JavaScript value. A successful parse does not prove that the value has the shape your application expects.',
        ],
        code: '{\n  "id": "note-1",\n  "title": "My first API",\n  "published": false\n}',
      },
      {
        title: 'Keep the boundary deliberate',
        body: [
          'Return only data the client needs. Database records can contain password hashes, tokens, or internal fields that must stay on the server.',
          'Later you will validate incoming values and choose safe response fields. For now, separate “valid JSON” from “valid application input.”',
        ],
      },
    ],
    quiz: quiz(
      'Does valid JSON guarantee a valid note?',
      [
        'No; the application must check the expected fields and types',
        'Yes; JSON automatically validates all fields',
        'Only for GET requests',
        'Only if the server uses Express',
      ],
      'Parsing checks JSON syntax. Validation checks your application’s rules.',
    ),
    sources: [
      {
        title: 'MDN: JSON',
        url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/First_steps/Client-Server_overview',
      },
    ],
  }),
  tutorial({
    id: 'javascript-backend',
    title: 'The JavaScript you need for a backend',
    category: 'JavaScript',
    track: 'Node.js & Express',
    duration: '10 min',
    summary: 'Get comfortable with objects, functions, modules, promises, and async/await.',
    diagram: 'runtime',
    takeaway:
      'await pauses one async function while other work can continue. It does not make CPU-heavy work nonblocking.',
    sections: [
      {
        title: 'Objects and functions carry your data',
        body: [
          'A request handler is a function. It reads values from a request object and uses a response object to send a result. const gives a binding a stable name; it does not freeze an object.',
          'Check a value’s type before using it. A property called title is not necessarily a string just because its name looks right.',
        ],
        code: "const note = { title: 'Learn backends', published: false };\n\nfunction isValidTitle(value) {\n  return typeof value === 'string' && value.trim().length > 0;\n}",
      },
      {
        title: 'Promises represent future results',
        body: [
          'File reads, database operations, and network calls can finish later. A promise represents that future result. An async function returns a promise, and await waits for its result within that function.',
          'Use try/catch when you can handle a failure. Otherwise let it reach the framework’s error handling. Do not silently turn every failure into a successful response.',
        ],
        code: "import { readFile } from 'node:fs/promises';\n\nasync function readNotes() {\n  const contents = await readFile('./notes.json', 'utf8');\n  return JSON.parse(contents);\n}",
      },
      {
        title: 'Modules organize a backend',
        body: [
          'An export makes a value available to another file. An import brings it into the current file. The Express examples in this course use .mjs files so Node treats them as ES modules.',
          'EFC examples use TypeScript in a scaffolded project. TypeScript checks types during development; runtime validation is still needed for data from users.',
        ],
      },
    ],
    quiz: quiz(
      'What does await do?',
      [
        'Waits for a promise inside the current async function',
        'Moves all code to another CPU core',
        'Makes any loop nonblocking',
        'Validates the response body',
      ],
      'await works with promises. CPU-intensive synchronous code still occupies the JavaScript thread.',
    ),
    sources: [
      {
        title: 'MDN: async functions',
        url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function',
      },
    ],
  }),
  tutorial({
    id: 'node-http',
    title: 'Your first server with Node.js',
    category: 'Node.js',
    track: 'Node.js & Express',
    duration: '9 min',
    summary: 'Use the built-in HTTP module to understand what a framework is doing for you.',
    diagram: 'runtime',
    takeaway:
      'Node provides the HTTP listener. Frameworks add routing, parsing, and application conventions.',
    sections: [
      {
        title: 'Run JavaScript without a browser',
        body: [
          'Node.js is a JavaScript runtime. It supplies server-side capabilities such as file access and HTTP networking. Browser-only features such as document are not part of this runtime.',
          'With Node installed, save the following as server.mjs and run node server.mjs in your terminal. Keep the process running while testing it.',
        ],
      },
      {
        title: 'Create a listener',
        body: [
          'createServer receives a function that Node calls for incoming requests. res.end sends the response and finishes it. listen starts accepting connections on the selected address and port.',
        ],
        code: "import { createServer } from 'node:http';\n\nconst server = createServer((req, res) => {\n  res.writeHead(200, { 'Content-Type': 'application/json' });\n  res.end(JSON.stringify({ message: 'Hello from Node' }));\n});\n\nserver.listen(3000, '127.0.0.1', () => {\n  console.log('Open http://127.0.0.1:3000');\n});",
      },
      {
        title: 'Test it and notice what is missing',
        body: [
          'Open http://127.0.0.1:3000 in a browser, or run curl http://127.0.0.1:3000 in another terminal. Stop the server with Ctrl+C.',
          'This server returns the same data for every path because we did not add routing. Express gives us app.get and app.post to handle that next. EFC later derives route paths from files.',
        ],
      },
    ],
    quiz: quiz(
      'Why does this server respond identically to every path?',
      [
        'Its handler does not inspect the path or method',
        'Node only supports one URL',
        'JSON disables routing',
        'Port 3000 ignores paths',
      ],
      'The application must choose different behavior for different requests.',
    ),
    sources: [
      {
        title: 'Node.js: introduction',
        url: 'https://nodejs.org/en/learn/getting-started/introduction-to-nodejs',
      },
    ],
  }),
  tutorial({
    id: 'express-first',
    title: 'Build your first Express server',
    category: 'Express',
    track: 'Node.js & Express',
    duration: '10 min',
    summary: 'Install Express, register a route, and send your first JSON response.',
    diagram: 'http',
    takeaway:
      'app.get registers behavior for a method and path. app.listen starts accepting connections.',
    sections: [
      {
        title: 'Make a small project',
        body: [
          'In a new directory, initialize an npm project and install Express 5. npm records the dependency in package.json. Use server.mjs for the example below.',
          'Express is deliberately small. You create an app, attach routes and middleware, and start a listener. No database is needed for this lesson.',
        ],
        code: 'mkdir express-notes\ncd express-notes\nnpm init -y\nnpm install express@5',
      },
      {
        title: 'Register one route',
        body: [
          'The handler receives req and res. req describes the incoming request; res lets you create the response. res.json serializes a JavaScript value and sends JSON.',
          'Run node server.mjs and visit http://127.0.0.1:3000/hello. A request for a path you did not register gets a 404.',
        ],
        code: "// server.mjs\nimport express from 'express';\n\nconst app = express();\n\napp.get('/hello', (req, res) => {\n  res.json({ message: 'Hello from Express' });\n});\n\napp.listen(3000, '127.0.0.1');",
      },
      {
        title: 'Separate registration from execution',
        body: [
          'app.get does not call your handler immediately. It registers the handler so Express can call it when a matching request arrives.',
          'You will keep using the same handler idea in EFC. The difference is how the method and path are registered, not how HTTP works.',
        ],
      },
    ],
    quiz: quiz(
      'What does app.get do during startup?',
      [
        'Registers a handler for matching GET requests',
        'Sends a GET request to another server',
        'Starts a database',
        'Runs the handler once and exits',
      ],
      'Registration stores the behavior. An incoming request triggers it.',
    ),
    sources: [expressSource],
  }),
  tutorial({
    id: 'express-routes',
    title: 'Routes, parameters & a tiny REST API',
    category: 'Express routing',
    track: 'Node.js & Express',
    duration: '12 min',
    summary: 'Build GET and POST endpoints, read path parameters, and validate a request body.',
    diagram: 'http',
    checkpoint: true,
    playground: 'router',
    takeaway:
      'Path parameters identify resources. A body carries input. Both are untrusted request data.',
    sections: [
      {
        title: 'Choose resources and methods',
        body: [
          'A small notes API can use GET /notes to list notes, GET /notes/:id to read one, and POST /notes to create one. Route parameters are named portions of a path.',
          'req.params.id comes from the path. req.query comes from the query string, such as ?limit=5. req.body comes from a parsed body. Keep those three locations distinct.',
        ],
      },
      {
        title: 'Parse JSON, then validate it',
        body: [
          'express.json() must run before handlers that read a JSON body. It parses requests with an appropriate JSON content type. Check for a nonempty string title before storing it.',
          'This runnable example uses memory so you can focus on HTTP. Restarting the process loses every note; each process has a separate array. We will add durable storage in later chapters.',
        ],
        code: "// server.mjs — npm install express@5\nimport express from 'express';\nimport { randomUUID } from 'node:crypto';\nconst app = express();\napp.use(express.json());\nconst notes = [];\n\napp.get('/notes', (req, res) => res.json(notes));\napp.post('/notes', (req, res) => {\n  const title = req.body?.title;\n  if (typeof title !== 'string' || !title.trim()) {\n    return res.status(400).json({ error: 'A title is required' });\n  }\n  const note = { id: randomUUID(), title: title.trim() };\n  notes.push(note);\n  res.status(201).json(note);\n});\napp.listen(3000, '127.0.0.1');",
      },
      {
        title: 'Make the request yourself',
        body: [
          'Send a body with Content-Type: application/json. Try removing title, sending a number, and then sending a valid string. Watch how the status and body change.',
        ],
        code: 'curl -i -X POST http://127.0.0.1:3000/notes \\\n  -H \'Content-Type: application/json\' \\\n  -d \'{"title":"My first note"}\'',
        note: 'The route simulator below uses sample routes in your browser. It does not start this Express server.',
      },
    ],
    quiz: quiz(
      'Where should POST /notes read a submitted title?',
      [
        'req.body, after parsing and validation',
        'req.params, regardless of the URL',
        'res.headers',
        'process.env',
      ],
      'The body holds submitted JSON. It still needs runtime validation.',
    ),
    sources: [
      { title: 'Express: routing', url: 'https://expressjs.com/en/guide/routing/' },
      middlewareSource,
    ],
  }),
  tutorial({
    id: 'express-middleware',
    title: 'Middleware, validation & errors',
    category: 'Express middleware',
    track: 'Node.js & Express',
    duration: '11 min',
    summary:
      'Follow next() through a request pipeline and see how the same middleware works in EFC.',
    diagram: 'middleware',
    checkpoint: true,
    takeaway: 'A middleware either responds, forwards an error, or calls next() to continue.',
    sections: [
      {
        title: 'One request, several steps',
        body: [
          'Middleware runs between an incoming request and its final response. It can log a request, parse data, check permissions, or reject invalid input. Order matters: put parsing before code that reads the parsed body.',
          'Call next() when the next step should run. If you send a response, return instead. Forgetting both leaves the client waiting.',
        ],
      },
      {
        title: 'Write middleware once',
        body: [
          'EFC accepts ordinary Express RequestHandler functions. Express attaches them with app.use or a route registration; EFC supports a middlewares export for a route file and compose for one method.',
          'The two examples below use a small request logger. They produce the same response and demonstrate the same control flow. The EFC route assumes the scaffolded app is already running.',
        ],
      },
      {
        title: 'Errors belong in an error path',
        body: [
          'In Express 5, a thrown error or rejected promise returned by an async handler is passed to error handling. An error middleware has four arguments: err, req, res, next. Register it after normal routes.',
          'EFC also forwards handler and middleware errors and provides HttpError for intentional HTTP failures. Avoid returning internal exception messages or secrets to clients.',
        ],
        code: "// Express 5: register after your routes\napp.use((err, req, res, next) => {\n  if (res.headersSent) return next(err);\n  console.error(err);\n  res.status(500).json({ error: 'Something went wrong' });\n});",
      },
    ],
    comparison: {
      express:
        "// In an Express app\nconst logRequest = (req, res, next) => {\n  console.log(req.method, req.path);\n  next();\n};\napp.get('/v1/api/hello', logRequest, (req, res) => {\n  res.json({ message: 'Hello' });\n});",
      efc: "// src/api/hello.ts\nimport type { RequestHandler } from 'express';\n\nconst logRequest: RequestHandler = (req, res, next) => {\n  console.log(req.method, req.path);\n  next();\n};\nexport const middlewares = [logRequest];\nexport const GET: RequestHandler = (req, res) => {\n  res.json({ message: 'Hello' });\n};",
      explanation:
        'Express attaches middleware when registering a route. EFC reads the middlewares array from the route file. EFC uses /v1/api as its default prefix, so this route is GET /v1/api/hello.',
      same: 'The req, res, next contract and middleware order are the same.',
    },
    quiz: quiz(
      'A middleware has not responded. What lets the next handler run?',
      [
        'Calling next()',
        'Returning an empty object',
        'Adding another import',
        'Changing the filename',
      ],
      'next() passes control to the next step in the middleware chain.',
    ),
    sources: [
      middlewareSource,
      { title: 'Express: error handling', url: 'https://expressjs.com/en/guide/error-handling/' },
      efcSource,
    ],
  }),
  efcLesson(1, {
    title: 'From Express routes to EFC files',
    track: 'EFC & databases',
    diagram: 'http',
    checkpoint: true,
    playground: 'router',
    takeaway:
      'Your handler is still Express code. EFC derives registration from the filename and uppercase method export.',
    sections: [
      {
        title: 'Keep the handler. Change the registration.',
        body: [
          'In Express, you choose a method and path with app.get. In EFC, a file under src/api supplies the path and its GET export supplies the method. A file does not send a response by itself; its handler still does that work.',
          'For local setup, run npx create-efc-app my-api, enter the generated directory, follow the CLI prompts, and run npm run dev. We will explain startup and service configuration in later chapters.',
        ],
      },
      {
        title: 'Read the filename as a URL',
        body: [
          'src/api/users/index.ts maps to /users. src/api/users/[id].ts maps to /users/:id. EFC’s default prefix makes the public URL /v1/api/users/:id unless the startup configuration changes basePath.',
          'Static segments are more specific than dynamic ones, so users/me.ts wins over users/[id].ts. Unlike manual Express registration, you do not control precedence by rearranging app.get calls.',
        ],
      },
      {
        title: 'Use the right method export',
        body: [
          'Exports are uppercase: GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS. If a path matches but a method is not implemented, EFC supplies a 405 response with an Allow header.',
          'You still validate request values and choose safe response fields. File routing replaces registration boilerplate, not the application’s responsibilities.',
        ],
      },
    ],
    comparison: {
      express:
        "// In an Express app\napp.get('/v1/api/users/:id', (req, res) => {\n  const id = req.params.id;\n  if (typeof id !== 'string') {\n    return res.status(400).json({ error: 'Invalid ID' });\n  }\n  res.json({ id });\n});",
      efc: "// src/api/users/[id].ts\nimport type { RequestHandler } from 'express';\n\nexport const GET: RequestHandler = (req, res) => {\n  const id = req.params.id;\n  if (typeof id !== 'string') {\n    res.status(400).json({ error: 'Invalid ID' });\n    return;\n  }\n  res.json({ id });\n};",
      explanation:
        'Both examples handle GET /v1/api/users/42. The Express version declares the path explicitly; EFC discovers it from users/[id].ts and the default prefix.',
      same: 'The incoming ID, validation, and JSON response have the same purpose.',
    },
    sources: [
      { title: 'Express: routing', url: 'https://expressjs.com/en/guide/routing/' },
      efcSource,
    ],
  }),
  tutorial({
    id: 'database-basics',
    title: 'Why backends need a database',
    category: 'Database fundamentals',
    track: 'EFC & databases',
    duration: '8 min',
    summary: 'Move from temporary arrays to durable records, tables, collections, and queries.',
    diagram: 'database',
    takeaway:
      'A database stores durable data. Your HTTP handler controls which operations a client can perform.',
    sections: [
      {
        title: 'Memory disappears with the process',
        body: [
          'The notes array from our earlier Express server exists only inside that process. A restart erases it. Multiple server processes would each see a different array.',
          'A database is a separate system that stores data and supports operations such as inserting, reading, updating, and deleting records. Backups, permissions, indexes, and transactions become part of operating that system.',
        ],
      },
      {
        title: 'Tables and documents',
        body: [
          'PostgreSQL organizes data into tables with typed columns and supports relations enforced by foreign keys. MongoDB stores documents in collections. Both require thoughtful schemas, indexes, and validation.',
          'EFC offers defineTable for PostgreSQL, defineCollection for MongoDB, and defineModel for a shared subset. They are different APIs; do not mix Prisma-style and MongoDB-style method names.',
        ],
        code: 'notes\n┌────────┬───────────────────┬─────────────┐\n│ id     │ title             │ published   │\n├────────┼───────────────────┼─────────────┤\n│ note-1 │ Learn persistence │ false       │\n└────────┴───────────────────┴─────────────┘',
      },
      {
        title: 'Keep the database behind your API',
        body: [
          'A browser should not receive the database password or connect using a privileged backend account. It asks your server for an operation. The server validates the request, applies permissions, and talks to the database.',
          'A framework does not make every query safe automatically. Use parameterized SQL or the model’s supported filter API, and validate request values before building a query.',
        ],
      },
    ],
    quiz: quiz(
      'What happens to an in-memory notes array after a restart?',
      [
        'It is lost unless saved elsewhere',
        'Express automatically writes it to PostgreSQL',
        'It becomes a shared global database',
        'HTTP restores it',
      ],
      'Process memory is temporary; durable storage needs a persistence mechanism.',
    ),
    sources: [efcSource],
  }),
  tutorial({
    id: 'database-connections',
    title: 'Connect the database before serving requests',
    category: 'Connections & pools',
    track: 'EFC & databases',
    duration: '11 min',
    summary:
      'Learn connection strings, pools, environment variables, and readiness after understanding queries.',
    diagram: 'database',
    takeaway:
      'Create a shared pool per process, verify readiness, and keep connection credentials on the server.',
    sections: [
      {
        title: 'A connection has a lifecycle',
        body: [
          'Your application opens connections to a running database. A connection string tells the driver where the database is and how to authenticate. Treat a real connection string as a secret.',
          'A pool reuses a limited number of connections. Opening a new pool for every request wastes resources. Each process has its own pool, so total connections grow with the number of workers.',
        ],
      },
      {
        title: 'Express leaves startup wiring to you',
        body: [
          'Express does not bundle a database driver. In a traditional Express app, install pg, create a pool, check the database, and then call app.listen. The example assumes a running PostgreSQL instance and DATABASE_URL set in the environment.',
          'EFC supports database initialization through ignite. Set databaseUrl explicitly; ignite does not automatically read DATABASE_URL for you. EFC initializes its configured database during Pre-Flight before the listener serves requests.',
        ],
      },
      {
        title: 'Configuration is not a database',
        body: [
          'A URL does not create a reachable database service, grant permissions, or guarantee that your schema exists. Check host, credentials, driver dependencies, and schema setup separately.',
          'For EFC PostgreSQL models, install the required pg and drizzle-orm peers. Later you can tune databasePool and choose a migration workflow. Start with one process while learning.',
        ],
      },
    ],
    comparison: {
      express:
        "// server.mjs — npm install express@5 pg\nimport express from 'express';\nimport pg from 'pg';\nconst pool = new pg.Pool({\n  connectionString: process.env.DATABASE_URL\n});\nawait pool.query('SELECT 1');\nconst app = express();\napp.get('/health', (req, res) => res.json({ ok: true }));\napp.listen(3000, '127.0.0.1');\n// Production also needs shutdown handling for pool.end().",
      efc: "// src/index.ts in a scaffolded EFC app\nimport { ignite, gracefulShutdown } from 'express-file-cluster';\n\nignite({\n  port: 3000,\n  cluster: false,\n  database: 'postgresql',\n  databaseUrl: process.env.DATABASE_URL,\n}).then(gracefulShutdown).catch(console.error);\n// Add src/api/health.ts separately.\n// Its default URL is /v1/api/health.",
      explanation:
        'Express lets you choose the driver and boot sequence. EFC initializes configured services as part of its boot sequence. Both still need a reachable database and valid credentials.',
      same: 'Both examples use a PostgreSQL connection string supplied by the application environment.',
    },
    quiz: quiz(
      'Where should a shared database pool usually be created?',
      [
        'Once per application process, outside request handlers',
        'Inside every GET handler',
        'Inside browser JavaScript with the password',
        'In every JSON response',
      ],
      'A pool reuses connections; recreating it per request defeats that purpose.',
    ),
    sources: [
      {
        title: 'node-postgres: connection pools',
        url: 'https://node-postgres.com/features/pooling',
      },
      efcSource,
    ],
  }),
  efcLesson(2, {
    title: 'Read & write data: SQL and EFC models',
    track: 'EFC & databases',
    diagram: 'database',
    checkpoint: true,
    playground: 'database',
    takeaway:
      'Express needs a persistence library of your choice. EFC’s defineTable adds a typed PostgreSQL model API.',
    sections: [
      {
        title: 'Keep routing and persistence separate',
        body: [
          'Express handles HTTP; it does not supply an ORM. An Express application can use pg, Drizzle, Prisma, or another library. EFC also supports access to the native database client and provides its own model APIs.',
          'The comparison uses pg in Express and defineTable in EFC to perform the same filtered read. The SQL table in the Express example must already exist.',
        ],
      },
      {
        title: 'Define a model, then query it',
        body: [
          'A defineTable schema describes declared fields; EFC supplies the primary key. findMany uses where, orderBy, and take. findUnique reads a uniquely identified record. PostgreSQL-native methods differ from defineCollection’s MongoDB vocabulary.',
          'EFC’s autoSync reconciles model schema on first use by default. If you turn it off, create the table through schema sync or migrations before querying it.',
        ],
      },
      {
        title: 'Select safe fields and bound your reads',
        body: [
          'A list endpoint should have a limit. Select fields clients need, rather than sending an entire user record. Never expose passwords or session and challenge tokens.',
          'A relation such as posts needs matching model definitions and relation configuration. Explore include in the playground after you understand a simple read.',
        ],
      },
      {
        title: 'Create and update a record',
        body: [
          'With the User model shown below, create takes a data object and returns the new record. update identifies a record with a unique where filter and applies the data changes. These calls require the same configured PostgreSQL connection as the read example.',
          'In a route, validate the input first, create the record, and then send a 201 response. A model call does not send an HTTP response by itself. SQL clients express the same operations with INSERT and UPDATE statements.',
        ],
        code: "// Using the User model from the comparison below\nconst created = await User.create({\n  data: { email: 'reader@example.com', role: 'member' },\n});\n\nconst updated = await User.update({\n  where: { id: created.id },\n  data: { role: 'author' },\n});",
      },
    ],
    comparison: {
      express:
        "// In an Express app with a shared pg pool\napp.get('/v1/api/users', async (req, res) => {\n  const result = await pool.query(\n    'SELECT id, email FROM users WHERE role = $1 LIMIT $2',\n    ['member', 10]\n  );\n  res.json(result.rows);\n});",
      efc: "// src/api/users/index.ts\nimport type { RequestHandler } from 'express';\nimport { defineTable } from 'express-file-cluster';\nconst User = defineTable('User', {\n  email: { type: 'string', required: true, unique: true },\n  role: { type: 'string', default: 'member' },\n});\nexport const GET: RequestHandler = async (req, res) => {\n  res.json(await User.findMany({\n    where: { role: 'member' }, take: 10,\n    select: { id: true, email: true },\n  }));\n};",
      explanation:
        'SQL placeholders separate values from SQL text. EFC model filters express supported query operations. Neither example should accept unchecked user input as arbitrary SQL or filter structure.',
      same: 'Both read at most ten members and return only an ID and email.',
    },
    sources: [
      { title: 'node-postgres: queries', url: 'https://node-postgres.com/features/queries' },
      efcSource,
    ],
  }),
  efcLesson(4, {
    title: 'Authentication, authorization & safe responses',
    track: 'Production essentials',
    diagram: 'middleware',
    playground: 'guard',
    takeaway:
      'Authentication establishes identity. Authorization checks permission. CORS does neither.',
    sections: [
      {
        title: 'Identity is different from permission',
        body: [
          'Authentication answers who is calling. Authorization answers what that identity may do. A logged-in member should not automatically gain access to an administrator endpoint.',
          'Clients can submit any values they choose. Never trust a role sent in a request body as proof of permission. Verify a credential and evaluate server-controlled permissions.',
        ],
      },
      {
        title: 'Express supplies the middleware contract',
        body: [
          'In Express you select and configure an authentication solution and attach its middleware. The function name authenticate in the comparison is an application-defined integration, not an Express export.',
          "EFC provides requireAuth for verified tokens. Use it directly for authentication, or requireAuth('admin') for a role check. Configure a strong jwtSecret before using it.",
        ],
      },
      {
        title: 'Return deliberate response objects',
        body: [
          'Passwords must be securely hashed, and password hashes still belong on the server. EFC supplies scrypt password helpers. Token issuance, storage, expiration, and revocation all need an explicit design.',
          'Send a safe response shape. Strip password, refreshToken, resetToken, verifyToken, and their expiry fields from returned records. EFC does not automatically sanitize arbitrary res.json calls.',
        ],
      },
    ],
    comparison: {
      express:
        "// authenticate is YOUR configured auth middleware.\n// Express does not export an authentication function.\napp.get('/v1/api/admin', authenticate, (req, res) => {\n  if (req.user?.role !== 'admin') {\n    return res.status(403).json({ error: 'Forbidden' });\n  }\n  res.json({ message: 'Admin access granted' });\n});",
      efc: "// src/api/admin/index.ts\nimport type { RequestHandler } from 'express';\nimport { requireAuth } from 'express-file-cluster/auth';\n\nexport const middlewares = [requireAuth('admin')];\nexport const GET: RequestHandler = (req, res) => {\n  res.json({ message: 'Admin access granted' });\n};",
      explanation:
        'The EFC example uses configured EFC JWT authentication. The Express example is a wiring sketch: authenticate must be implemented with your chosen auth library.',
      same: 'Both reject callers who lack the required permission before sending protected data.',
    },
  }),
  efcLesson(3, {
    title: 'Background work, retries & queues',
    track: 'Production essentials',
    diagram: 'runtime',
    checkpoint: true,
    playground: 'tasks',
    takeaway:
      'Sending 202 acknowledges accepted work. It does not mean the background job has finished.',
    sections: [
      {
        title: 'Some work should outlive the request',
        body: [
          'A welcome email or report can take longer than a caller should wait. A queue stores a job so a worker can handle it separately. Merely using async does not make work durable.',
          'Express does not ship with a job queue. You choose a backend and wire producers and consumers. EFC supports BullMQ with Redis and pg-boss with PostgreSQL.',
        ],
      },
      {
        title: 'Define the task and enqueue it',
        body: [
          'An EFC task file default-exports defineTask(options, handler). The filename becomes the task name. Routes use enqueue(name, payload) after the configured task backend is ready.',
          'A schedule is an option on defineTask; scheduled runs receive an empty payload. Do not assume a cron invocation has the email field supplied by an API request.',
        ],
        code: "// src/tasks/send-digest.ts\nimport { defineTask } from 'express-file-cluster/tasks';\nexport default defineTask<{ email: string }>(\n  { retries: 3, backoff: 'exponential' },\n  async ({ email }) => {\n    // Send using your app's configured email client.\n    console.log('Deliver digest to', email);\n  }\n);",
      },
      {
        title: 'Design for retries',
        body: [
          'With retries: 3, a job can run once plus three additional attempts. Make handlers idempotent so a retry does not duplicate a payment, email, or other side effect.',
          'After attempts are exhausted, inspect failures with efc tasks failed and requeue a selected job with efc tasks retry <jobId>. The simulator below models the workflow; it does not connect to a real queue.',
        ],
      },
    ],
    comparison: {
      express:
        "// Sketch: queue is your configured queue client.\napp.post('/v1/api/digest', async (req, res) => {\n  await queue.add('send-digest', { email: 'reader@example.com' });\n  res.status(202).json({ queued: true });\n});\n// Configure queue workers and retry policies separately.",
      efc: "// src/api/digest.ts\nimport type { RequestHandler } from 'express';\nimport { enqueue } from 'express-file-cluster/tasks';\nexport const POST: RequestHandler = async (req, res) => {\n  await enqueue('send-digest', { email: 'reader@example.com' });\n  res.status(202).json({ queued: true });\n};\n// Requires tasks configured in ignite and a task file.",
      explanation:
        'Both submit work to a separate queue and acknowledge it. EFC discovers the task definition and wires the selected backend. Express requires your own queue integration.',
      same: 'The HTTP response acknowledges acceptance, while the worker performs the actual task.',
    },
  }),
  efcLesson(0, {
    title: 'Application initialization & worker lifecycle',
    track: 'Production essentials',
    diagram: 'runtime',
    takeaway:
      'Initialize required services before accepting requests. Each worker has its own process state and connection pool.',
    sections: [
      {
        title: 'Startup has an order',
        body: [
          'A production backend should not advertise readiness before its required dependencies are ready. Load configuration, initialize services, register routes and tasks, and then accept HTTP traffic.',
          'In a traditional Express app, your entrypoint owns that sequence. In EFC, ignite coordinates its configured services through Pre-Flight. An efc.config.ts file is not automatically loaded; your entrypoint imports and passes configuration.',
        ],
      },
      {
        title: 'One machine can run several workers',
        body: [
          'A Node process has its own event loop and memory. A cluster runs multiple worker processes. They do not automatically share an in-memory array or an in-process session store.',
          'EFC enables clustering by default in production. cluster is a boolean, and workers sets a count. The cluster primary gets undefined from ignite; serving workers get an HTTP server. Bound your database connections with the number of workers in mind.',
        ],
      },
      {
        title: 'Shutdown is part of startup design',
        body: [
          'Deployments stop old processes. Graceful shutdown stops accepting new work and lets in-flight work drain before resources close. Your platform needs a sufficient termination window.',
          'Use gracefulShutdown with ignite’s result. Configure real secrets and dependency URLs explicitly. A minimal local app does not need every option; add services when your application requires them.',
        ],
        code: "// src/index.ts\nimport { ignite, gracefulShutdown } from 'express-file-cluster';\n\nignite({\n  port: 3000,\n  cluster: process.env.NODE_ENV === 'production',\n  workers: 2,\n  databaseUrl: process.env.DATABASE_URL,\n}).then(gracefulShutdown).catch(console.error);",
      },
    ],
    comparison: {
      express:
        '// Application-owned startup sequence (sketch)\nawait connectDatabase();\nawait startQueue();\nregisterRoutes(app);\nconst server = app.listen(3000);\n// Add signal handling and drain resources on shutdown.',
      efc: "// Framework-owned boot sequence\nignite({\n  databaseUrl: process.env.DATABASE_URL,\n  tasks: { backend: 'pg-boss' },\n}).then(gracefulShutdown).catch(console.error);\n// Import ignite and gracefulShutdown from the core package.",
      explanation:
        'The Express functions are placeholders for app-owned integrations. EFC coordinates configured service boot, file discovery, and worker lifecycle.',
      same: 'Required dependencies must be ready before requests use them.',
    },
  }),
  tutorial({
    id: 'cors-origins',
    title: 'CORS: when your frontend lives elsewhere',
    category: 'Browser security',
    track: 'Production essentials',
    duration: '10 min',
    summary: 'Now that you have a working API, connect a frontend on a different origin.',
    diagram: 'web',
    takeaway:
      'CORS controls whether a browser may expose a cross-origin response to JavaScript. It is not authentication.',
    sections: [
      {
        title: 'What makes an origin different?',
        body: [
          'An origin is the combination of scheme, hostname, and port. http://localhost:5173 and http://localhost:3000 are different origins because their ports differ.',
          'A browser enforces the same-origin policy. An API can opt into sharing responses with selected origins using CORS headers. A command-line HTTP client does not enforce the browser’s CORS policy.',
        ],
      },
      {
        title: 'Preflight happens before some requests',
        body: [
          'Some cross-origin requests first send an OPTIONS preflight asking which methods and headers are permitted. This is a browser check, distinct from EFC’s service startup Pre-Flight.',
          'CORS does not guarantee that a request cannot reach your server. Continue to validate, authenticate, authorize, and protect state-changing endpoints appropriately.',
        ],
      },
      {
        title: 'Configure the allowed frontend',
        body: [
          'An Express app can use the separate cors package. EFC includes CORS configuration in ignite. Avoid adding a second cors middleware on top of EFC’s built-in handling.',
          'If you use cookies across origins, review credentials, cookie SameSite and Secure settings, and CSRF protection as a complete design. Allowing an origin does not by itself make cookies flow correctly.',
        ],
      },
    ],
    comparison: {
      express:
        "// npm install cors\nimport cors from 'cors';\napp.use(cors({\n  origin: 'http://localhost:5173',\n}));\n// Register before your routes.",
      efc: "import { ignite } from 'express-file-cluster';\n\nignite({\n  cors: { origin: 'http://localhost:5173' },\n}).catch(console.error);",
      explanation:
        'Both permit a specified frontend origin. Express uses a separate middleware package; EFC exposes configuration for its built-in CORS handling.',
      same: 'CORS is a browser response-sharing policy, independent of authorization.',
    },
    quiz: quiz(
      'Will enabling CORS authenticate a user?',
      [
        'No; authentication is a separate concern',
        'Yes; the Origin header proves identity',
        'Yes, for every POST request',
        'Only when using EFC',
      ],
      'An allowed browser origin is not proof of an authenticated identity.',
    ),
    sources: [
      {
        title: 'Express: CORS middleware',
        url: 'https://expressjs.com/en/resources/middleware/cors.html',
      },
      { title: 'MDN: CORS', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS' },
      efcSource,
    ],
  }),
  tutorial({
    id: 'deployment',
    title: 'From localhost to a deployed backend',
    category: 'Deployment',
    track: 'Production essentials',
    duration: '9 min',
    summary:
      'Bring together builds, configuration, health checks, migrations, and graceful shutdown.',
    diagram: 'runtime',
    takeaway:
      'Deployment changes where the process runs, not the fundamentals of the request–response cycle.',
    sections: [
      {
        title: 'A deployed server is still a running program',
        body: [
          'A hosting platform runs your process, connects it to a network, and usually restarts it after a failure. Your app still needs the right port, dependencies, configuration, and a listener.',
          'A reverse proxy can terminate HTTPS and forward traffic to the application. Configure trustProxy according to your real proxy setup before relying on client IP addresses for rate limiting.',
        ],
      },
      {
        title: 'Build and keep route files',
        body: [
          'For a scaffolded EFC app, npm run build invokes efc build prod. The build preserves files under dist/src because EFC discovers route and task files at runtime.',
          'npm start runs the production entrypoint through the EFC CLI. Configure required environment variables in the hosting platform. Keep secrets out of source control and public frontend bundles.',
        ],
        code: '# In a scaffolded EFC application\nnpm run build\nnpm start\n\n# If your application uses pending data migrations:\nnpx efc db migrate --dist',
      },
      {
        title: 'Verify behavior after deployment',
        body: [
          'Check a real health endpoint, a normal request, an expected error, and a protected endpoint. Verify logs and service connectivity. A successful build alone does not prove the database is reachable.',
          'Decide how many workers or containers to run, budget connection pools, and make shutdown deadlines match your platform. Return to the earlier chapters whenever a deployment symptom turns out to be an HTTP or lifecycle issue.',
        ],
      },
    ],
    quiz: quiz(
      'Why must EFC production builds preserve route files?',
      [
        'The framework discovers routes from files at runtime',
        'HTTP requires TypeScript files',
        'Browsers import the backend source directly',
        'Every file is a database migration',
      ],
      'File-based discovery requires the emitted route tree to exist in the deployed output.',
    ),
    sources: [efcSource],
  }),
];

const ORDER = [
  // Web foundations
  'setup',
  'web-intro',
  'servers-ports',
  'http-basics',
  'apis-json',
  // Node.js & Express
  'javascript-backend',
  'node-http',
  'express-first',
  'express-routes',
  'express-middleware',
  'env-secrets',
  // EFC & databases
  'quest-2',
  'database-basics',
  'efc-first-project',
  'efc-validation',
  'database-connections',
  'quest-3',
  // Production essentials
  'quest-5',
  'quest-4',
  'quest-1',
  'cors-origins',
  'efc-testing',
  'security-basics',
  'deployment',
];

// Quiz options are authored with the right answer first. Shuffle them deterministically
// (seeded by the question) so the answer position varies but server and client agree.
function shuffleQuiz(q: Quest['quiz']): Quest['quiz'] {
  let seed = [...q.question].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    correctIndex: order.indexOf(q.correctIndex),
  };
}

const ALL: Tutorial[] = [
  ...CHAPTERS,
  ...[SETUP, ENV_SECRETS, EFC_FIRST_PROJECT, EFC_VALIDATION, EFC_TESTING, SECURITY_BASICS].map(
    (c) => tutorial(c),
  ),
];

export const TUTORIALS: Tutorial[] = ORDER.map((id) => {
  const chapter = ALL.find((c) => c.id === id);
  if (!chapter) throw new Error(`Unknown chapter id in ORDER: ${id}`);
  const extras = EXTRAS[chapter.id];
  const merged = extras ? { ...chapter, ...extras, quiz: extras.quiz ?? chapter.quiz } : chapter;
  return { ...merged, quiz: shuffleQuiz(merged.quiz) };
});

export const tutorialIndex = (id: string) => TUTORIALS.findIndex((t) => t.id === id);

export const TRACKS = [
  'Web foundations',
  'Node.js & Express',
  'EFC & databases',
  'Production essentials',
] as const;
