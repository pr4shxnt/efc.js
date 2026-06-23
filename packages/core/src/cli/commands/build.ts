import { Command } from 'commander';
import { spawn } from 'node:child_process';
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

function buildProd(): void {
  console.log(pc.cyan('[EFC] Building for production…'));

  // Type-check first
  const tsc = spawn('npx', ['tsc', '--noEmit'], { stdio: 'inherit' });

  tsc.on('exit', (code) => {
    if (code !== 0) {
      console.error(pc.red('[EFC] TypeScript errors found. Fix them before building.'));
      process.exit(1);
    }

    const tsup = spawn('npx', ['tsup'], { stdio: 'inherit' });
    tsup.on('exit', (tsupCode) => {
      if (tsupCode === 0) {
        console.log(pc.green('[EFC] Build complete → dist/'));
      } else {
        process.exit(tsupCode ?? 1);
      }
    });
  });
}
