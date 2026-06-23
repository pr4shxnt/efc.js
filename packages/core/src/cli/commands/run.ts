import { Command } from 'commander';
import { spawn } from 'node:child_process';
import pc from 'picocolors';

export function runCommand(): Command {
  const cmd = new Command('run');

  cmd
    .argument('<runner>', 'tests')
    .description('Run EFC sub-commands (tests)')
    .allowUnknownOption()
    .action((runner: string) => {
      if (runner === 'tests') {
        runTests(cmd.args.slice(1));
      } else {
        console.error(pc.red(`Unknown runner: ${runner}. Use 'tests'.`));
        process.exit(1);
      }
    });

  return cmd;
}

function runTests(extraArgs: string[]): void {
  console.log(pc.cyan('[EFC] Running tests via Vitest…'));
  const child = spawn('npx', ['vitest', 'run', ...extraArgs], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
