import { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import pc from 'picocolors';

export function buildCommand(): Command {
  const cmd = new Command('build');

  cmd
    .argument('<mode>', 'prod')
    .description('Build the application for production')
    .action((mode: string) => {
      if (mode !== 'prod') {
        console.error(pc.red(`Unknown build mode: ${mode}. Use 'prod'.`));
        process.exit(1);
      }
      buildProd();
    });

  return cmd;
}

function findBin(name: string): string {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, 'node_modules', '.bin', name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return name; // fell off root, hope it's on PATH
    dir = parent;
  }
}

function resolveEntry(): string | null {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'src', 'index.ts'),
    path.join(cwd, 'index.ts'),
    path.join(cwd, 'src', 'index.js'),
    path.join(cwd, 'index.js'),
  ];
  return candidates.find((f) => fs.existsSync(f)) ?? null;
}

function hasTsupConfig(): boolean {
  const cwd = process.cwd();
  return ['tsup.config.ts', 'tsup.config.js', 'tsup.config.mjs', 'tsup.config.cjs'].some((f) =>
    fs.existsSync(path.join(cwd, f)),
  );
}

function findTsConfig(): string | null {
  const cwd = process.cwd();
  const tsconfig = path.join(cwd, 'tsconfig.json');
  return fs.existsSync(tsconfig) ? tsconfig : null;
}

function buildProd(): void {
  console.log(pc.cyan('[EFC] Building for production…'));

  const tsconfig = findTsConfig();
  if (!tsconfig) {
    console.error(pc.red('[EFC] No tsconfig.json found in the current directory.'));
    process.exit(1);
  }

  const tsc = spawn(findBin('tsc'), ['--noEmit', '--project', tsconfig], { stdio: 'inherit' });

  tsc.on('exit', (code) => {
    if (code !== 0) {
      console.error(pc.red('[EFC] TypeScript errors found. Fix them before building.'));
      process.exit(1);
    }

    let tsupArgs: string[];
    if (hasTsupConfig()) {
      tsupArgs = [];
    } else {
      const entry = resolveEntry();
      if (!entry) {
        console.error(
          pc.red('[EFC] Could not find entry point. Expected src/index.ts or index.ts'),
        );
        process.exit(1);
        return;
      }
      tsupArgs = [entry, '--format', 'cjs,esm', '--clean', '--target', 'node18'];
    }

    const tsup = spawn(findBin('tsup'), tsupArgs, { stdio: 'inherit' });
    tsup.on('exit', (tsupCode) => {
      if (tsupCode === 0) {
        console.log(pc.green('[EFC] Build complete → dist/'));
      } else {
        process.exit(tsupCode ?? 1);
      }
    });
  });
}
