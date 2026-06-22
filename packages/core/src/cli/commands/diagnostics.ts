import { Command } from 'commander';
import { scanDir } from '../../router/scan.js';
import path from 'node:path';
import fs from 'node:fs';
import chalk from 'chalk';

export function diagnosticsCommands(): Command[] {
  return [routesCommand(), tasksCommand(), doctorCommand()];
}

function routesCommand(): Command {
  return new Command('routes')
    .description('Print the resolved route table')
    .action(() => {
      const apiDir = resolveApiDir();
      if (!apiDir) {
        console.error(chalk.red('[EFC] Could not find apiDir (expected src/api)'));
        process.exit(1);
      }

      const routes = scanDir(apiDir);
      if (routes.length === 0) {
        console.log(chalk.yellow('No routes found.'));
        return;
      }

      console.log(chalk.bold('\n  Route Table\n'));
      console.log(chalk.dim('  ' + '─'.repeat(60)));
      for (const route of routes) {
        const rel = path.relative(process.cwd(), route.filePath);
        console.log(`  ${chalk.cyan(route.urlPath.padEnd(35))} ${chalk.dim(rel)}`);
      }
      console.log(chalk.dim('  ' + '─'.repeat(60)));
      console.log(chalk.dim(`\n  ${routes.length} route(s) found\n`));
    });
}

function tasksCommand(): Command {
  return new Command('tasks')
    .description('List registered background tasks')
    .action(() => {
      const tasksDir = resolveTasksDir();
      if (!tasksDir || !fs.existsSync(tasksDir)) {
        console.log(chalk.yellow('No tasks directory found.'));
        return;
      }

      const files = fs.readdirSync(tasksDir).filter((f) => /\.(ts|js)$/.test(f));
      if (files.length === 0) {
        console.log(chalk.yellow('No tasks found.'));
        return;
      }

      console.log(chalk.bold('\n  Background Tasks\n'));
      for (const file of files) {
        console.log(`  ${chalk.cyan(path.basename(file, path.extname(file)))}`);
      }
      console.log();
    });
}

function doctorCommand(): Command {
  return new Command('doctor')
    .description('Validate config, env vars, and project setup')
    .action(() => {
      const cwd = process.cwd();
      const checks: { label: string; ok: boolean; hint?: string }[] = [
        {
          label: 'package.json exists',
          ok: fs.existsSync(path.join(cwd, 'package.json')),
        },
        {
          label: 'tsconfig.json exists',
          ok: fs.existsSync(path.join(cwd, 'tsconfig.json')),
          hint: 'Run `tsc --init` to create one',
        },
        {
          label: 'src/api directory exists',
          ok: fs.existsSync(path.join(cwd, 'src', 'api')),
          hint: 'Create src/api/ and add route files',
        },
        {
          label: 'DATABASE_URL set',
          ok: Boolean(process.env['DATABASE_URL']),
          hint: 'Add DATABASE_URL to .env',
        },
        {
          label: 'JWT_SECRET set',
          ok: Boolean(process.env['JWT_SECRET']),
          hint: 'Add JWT_SECRET to .env (generate: openssl rand -hex 64)',
        },
      ];

      console.log(chalk.bold('\n  EFC Doctor\n'));
      let allOk = true;
      for (const check of checks) {
        const icon = check.ok ? chalk.green('✓') : chalk.red('✗');
        console.log(`  ${icon}  ${check.label}`);
        if (!check.ok) {
          allOk = false;
          if (check.hint) console.log(chalk.dim(`       → ${check.hint}`));
        }
      }
      console.log();
      if (allOk) {
        console.log(chalk.green('  All checks passed!\n'));
      } else {
        console.log(chalk.yellow('  Some checks failed. Fix the issues above.\n'));
        process.exit(1);
      }
    });
}

function resolveApiDir(): string | null {
  const cwd = process.cwd();
  const candidates = [path.join(cwd, 'src', 'api'), path.join(cwd, 'api')];
  return candidates.find((d) => fs.existsSync(d)) ?? null;
}

function resolveTasksDir(): string | null {
  const cwd = process.cwd();
  const candidates = [path.join(cwd, 'src', 'tasks'), path.join(cwd, 'tasks')];
  return candidates.find((d) => fs.existsSync(d)) ?? null;
}
