import { Command } from 'commander';
import { spawn } from 'node:child_process';
import chalk from 'chalk';

export function buildCommand(): Command {
  const cmd = new Command('build');

  cmd
    .argument('<mode>', 'prod')
    .description('Build the application for production')
    .action((mode: string) => {
      if (mode !== 'prod') {
        console.error(chalk.red(`Unknown build mode: ${mode}. Use 'prod'.`));
        process.exit(1);
      }
      buildProd();
    });

  return cmd;
}

function buildProd(): void {
  console.log(chalk.cyan('[EFC] Building for production…'));

  // Type-check first
  const tsc = spawn('npx', ['tsc', '--noEmit'], { stdio: 'inherit' });

  tsc.on('exit', (code) => {
    if (code !== 0) {
      console.error(chalk.red('[EFC] TypeScript errors found. Fix them before building.'));
      process.exit(1);
    }

    const tsup = spawn('npx', ['tsup'], { stdio: 'inherit' });
    tsup.on('exit', (tsupCode) => {
      if (tsupCode === 0) {
        console.log(chalk.green('[EFC] Build complete → dist/'));
      } else {
        process.exit(tsupCode ?? 1);
      }
    });
  });
}
