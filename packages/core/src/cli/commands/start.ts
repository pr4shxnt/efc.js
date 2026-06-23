import { Command } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import pc from 'picocolors';

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
        console.error(pc.red(`Unknown mode: ${mode}. Use 'dev' or 'prod'.`));
        process.exit(1);
      }
    });

  return cmd;
}

function parseDotenv(cwd: string): Record<string, string> {
  const envFile = path.join(cwd, '.env');
  if (!fs.existsSync(envFile)) return {};
  const vars: Record<string, string> = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    vars[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

function startDev(): void {
  const entry = resolveEntry();
  if (!entry) {
    console.error(pc.red('[EFC] Could not find entry point. Expected src/index.ts or index.ts'));
    process.exit(1);
  }

  console.log(pc.cyan('[EFC] Starting development server…'));
  console.log(pc.dim(`  Entry: ${entry}`));

  const cwd = process.cwd();
  const localTsx = path.join(cwd, 'node_modules', '.bin', 'tsx');
  const tsx = fs.existsSync(localTsx) ? localTsx : 'tsx';

  // .env values are base; existing process.env takes precedence (same as dotenv default)
  const env: NodeJS.ProcessEnv = { ...parseDotenv(cwd), ...process.env, NODE_ENV: 'development' };

  const child = spawn(tsx, ['watch', '--include', 'src', entry], { stdio: 'inherit', env });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function startProd(): void {
  const cwd = process.cwd();
  const distEntry = path.join(cwd, 'dist', 'index.js');

  if (!fs.existsSync(distEntry)) {
    console.error(pc.red('[EFC] dist/index.js not found. Run `efc build prod` first.'));
    process.exit(1);
  }

  console.log(pc.cyan('[EFC] Starting production server…'));

  // Production env comes exclusively from process.env — no .env file loading.
  // Platforms (Docker, Kubernetes, Railway, Heroku, etc.) inject vars directly.
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
