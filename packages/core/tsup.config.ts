import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'auth/index': 'src/auth/index.ts',
    'tasks/index': 'src/tasks/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node18',
  banner: {
    js: '',
  },
  esbuildOptions(options, context) {
    if (context.format === 'esm') {
      options.banner = {
        js: context.entry === 'src/cli/index.ts' ? '#!/usr/bin/env node' : '',
      };
    }
  },
});
