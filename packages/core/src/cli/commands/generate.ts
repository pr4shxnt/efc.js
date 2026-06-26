import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';

export function generateCommand(): Command {
  const cmd = new Command('generate').alias('g').description('Scaffold EFC modules');

  cmd
    .command('route <routePath>')
    .description('Scaffold a route module, e.g. users/[id]')
    .action((routePath: string) => generateRoute(routePath));

  cmd
    .command('task <name>')
    .description('Scaffold a background task module')
    .action((name: string) => generateTask(name));

  cmd
    .command('middleware <name>')
    .description('Scaffold a middleware module')
    .action((name: string) => generateMiddleware(name));

  return cmd;
}

function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(filePath)) {
    console.error(pc.red(`File already exists: ${filePath}`));
    process.exit(1);
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(pc.green(`  created  ${path.relative(process.cwd(), filePath)}`));
}

function generateRoute(routePath: string): void {
  const cwd = process.cwd();
  const filePath = path.join(cwd, 'src', 'api', `${routePath}.ts`);
  const content = `import type { Request, Response } from 'express';
import type { RouteMeta } from 'express-file-cluster';

export const meta: RouteMeta = {
  description: 'TODO: describe this endpoint.',
};

export const GET = async (req: Request, res: Response) => {
  res.json({ message: 'OK' });
};

export const POST = async (req: Request, res: Response) => {
  res.status(201).json({ message: 'Created' });
};
`;

  writeFile(filePath, content);
  console.log(pc.cyan(`[EFC] Route scaffolded`));
}

function generateTask(name: string): void {
  const cwd = process.cwd();
  const filePath = path.join(cwd, 'src', 'tasks', `${name}.ts`);

  const content = `import { defineTask } from 'express-file-cluster/tasks';

interface ${name}Payload {
  // TODO: define payload fields
}

export default defineTask<${name}Payload>(async (payload) => {
  // TODO: implement task logic
  console.log('[Task:${name}]', payload);
});
`;

  writeFile(filePath, content);
  console.log(pc.cyan(`[EFC] Task scaffolded`));
}

function generateMiddleware(name: string): void {
  const cwd = process.cwd();
  const filePath = path.join(cwd, 'src', 'middlewares', `${name}.ts`);

  const content = `import type { Request, Response, NextFunction } from 'express';

export function ${name}(req: Request, res: Response, next: NextFunction): void {
  // TODO: implement middleware logic
  next();
}
`;

  writeFile(filePath, content);
  console.log(pc.cyan(`[EFC] Middleware scaffolded`));
}
