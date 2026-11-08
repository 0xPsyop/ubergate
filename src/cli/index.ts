#!/usr/bin/env node
// CLI entry point with commander
// Control plane component

import 'dotenv/config';
import { Command } from 'commander';
import { crawlCommand, type CrawlOptions } from './crawl.js';
import { validateCommand, type ValidateOptions } from './validate.js';
import { createGateway } from '../gateway/createGateway.js';

const program = new Command();

program
  .name('ubergate')
  .description('OpenAPI-to-governed-MCP gateway')
  .version('0.1.0');

program
  .command('crawl')
  .description('Crawl an OpenAPI spec and merge with existing tools')
  .argument('<specPath>', 'Path to OpenAPI spec file')
  .option('--server <name>', 'Server name for tools', 'default')
  .option('--out <path>', 'Output file path', 'config/tools.yaml')
  .option('--owner <team>', 'Default owner for new tools', 'unassigned')
  .option('--enrich', 'Enrich descriptions with AI', false)
  .action(async (specPath, options) => {
    const opts: CrawlOptions = {
      specPath,
      server: options.server,
      out: options.out,
      owner: options.owner,
      enrich: options.enrich,
    };
    await crawlCommand(opts);
  });

program
  .command('validate')
  .description('Validate configuration files')
  .option('--config-dir <path>', 'Configuration directory', 'config')
  .action(async (options) => {
    const opts: ValidateOptions = {
      configDir: options.configDir,
    };
    await validateCommand(opts);
  });

program
  .command('serve')
  .description('Start the gateway server')
  .option('--config-dir <path>', 'Configuration directory', 'config')
  .option('--port <number>', 'Port to listen on')
  .option('--no-watch', 'Disable config hot-reload')
  .action(async (options) => {
    const configDir = options.configDir;
    const port = options.port ? parseInt(options.port, 10) : undefined;
    const watch = options.watch;

    const gateway = createGateway({
      configDir,
      port,
      watch,
    });

    console.log(`Gateway started at ${gateway.url}`);

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('Shutting down...');
      await gateway.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      await gateway.close();
      process.exit(0);
    });
  });

program.parse();
