import { defineConfig } from 'tsup';
import { copyFile, appendFile } from 'node:fs/promises';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'auth/index': 'src/auth/index.ts',
    testing: 'src/testing.ts',
    'tasks/index': 'src/tasks/index.ts',
    // Loaded by path into worker_threads (runInThread: new URL('./thread-runner.js')),
    // so it must exist as its own file next to the chunks.
    'thread-runner': 'src/tasks/thread-runner.ts',
    'cli/index': 'src/cli/index.ts',
    'cli/db-runner': 'src/cli/db-runner.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: true,
  // Copy verbatim: bundling rewrites native import() to require() in CJS chunks.
  onSuccess: async () => {
    await copyFile('src/testing-cjs.cjs', 'dist/testing-cjs.cjs');
    await copyFile('src/openapi-cjs.cjs', 'dist/openapi-cjs.cjs');
    await appendFile(
      'dist/index.cjs',
      '\nexports.generateOpenAPI = require("./openapi-cjs.cjs").generateOpenAPI;\n',
    );
  },
  // CJS entrypoints share modules that resolve workers/CLI files via import.meta.url.
  shims: true,
  sourcemap: true,
  target: 'node18',
  banner: {
    js: '',
  },
});
