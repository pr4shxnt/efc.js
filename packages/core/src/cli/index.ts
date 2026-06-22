#!/usr/bin/env node
import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { buildCommand } from './commands/build.js';
import { runCommand } from './commands/run.js';
import { generateCommand } from './commands/generate.js';
import { diagnosticsCommands } from './commands/diagnostics.js';

const program = new Command('efc')
  .description('Express File Cluster CLI')
  .version('0.1.0');

program.addCommand(startCommand());
program.addCommand(buildCommand());
program.addCommand(runCommand());
program.addCommand(generateCommand());

for (const cmd of diagnosticsCommands()) {
  program.addCommand(cmd);
}

program.parse(process.argv);
