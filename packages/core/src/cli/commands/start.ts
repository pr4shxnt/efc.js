import { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import chalk from 'chalk';

export function startCommand(): Command {
  const cmd = new Command('start');

  cmd
    .argument('<mode>', 'dev | prod')
    .description('Start the EFC server')
    .action((mode: string) => {
      if (mode === 'dev') {
        startDev();
      } else if (mode === 'prod') {
        startProd();
      } else {
        console.error(chalk.red(`Unknown mode: ${mode}. Use 'dev' or 'prod'.`));
        process.exit(1);
      }
    });

  return cmd;
}

function startDev(): void {
  const entry = resolveEntry();
  if (!entry) {
    console.error(chalk.red('[EFC] Could not find entry point. Expected src/index.ts or index.ts'));
    process.exit(1);
  }

  console.log(chalk.cyan('[EFC] Starting development server…'));
  console.log(chalk.dim(`  Entry: ${entry}`));

  const child = spawn(
    'node',
    ['--import', 'tsx/esm', '--watch', entry],
    { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } },
  );

  child.on('exit', (code) => process.exit(code ?? 0));
}

function startProd(): void {
  const cwd = process.cwd();
  const distEntry = path.join(cwd, 'dist', 'index.js');

  if (!fs.existsSync(distEntry)) {
    console.error(chalk.red('[EFC] dist/index.js not found. Run `efc build prod` first.'));
    process.exit(1);
  }

  console.log(chalk.cyan('[EFC] Starting production server…'));

  const child = spawn('node', [distEntry], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  child.on('exit', (code) => process.exit(code ?? 0));
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
