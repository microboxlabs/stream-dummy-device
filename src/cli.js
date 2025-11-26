#!/usr/bin/env node

import { Command } from 'commander';
import { config } from 'dotenv';
import chalk from 'chalk';
import { DummyDevice } from './device.js';
import { loadConfig } from './config.js';

const program = new Command();

program
  .name('dummy-device')
  .description('CLI tool for simulating IoT devices sending frames to StreamHub API')
  .version('1.1.0')
  .argument('<directory>', 'Directory containing frame images to send')
  .option('-I, --interval <seconds>', 'Interval between frame batches in seconds', '5')
  .option('-s, --size <count>', 'Number of frames to send per batch', '1')
  .option('-b, --base-url <url>', 'StreamHub API base URL', 'http://localhost:8080')
  .option('-d, --device-id <id>', 'Device identifier', `device-${Date.now()}`)
  .option('-k, --secondary-key <key>', 'Secondary index key for frame lookup')
  .option('-t, --auth-token <token>', 'JWT authentication token')
  .option('--client-id <id>', 'OAuth2 client ID for automatic token refresh')
  .option('--client-secret <secret>', 'OAuth2 client secret for automatic token refresh')
  .option('--token-url <url>', 'OAuth2 token endpoint URL')
  .option('--audience <audience>', 'OAuth2 audience (for Auth0)')
  .option('-e, --env-file <path>', 'Path to .env file for configuration')
  .option('-l, --loop', 'Loop through images indefinitely', false)
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--dry-run', 'Simulate sending without making HTTP requests', false)
  .action(async (directory, options) => {
    try {
      // Load .env file if specified
      if (options.envFile) {
        config({ path: options.envFile });
      } else {
        // Try loading from default .env
        config();
      }

      // Merge CLI options with environment variables
      const cfg = loadConfig(options);

      console.log(chalk.cyan.bold('\n🎬 StreamHub Dummy Device\n'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.white('  Directory:     ') + chalk.yellow(directory));
      console.log(chalk.white('  Device ID:     ') + chalk.yellow(cfg.deviceId));
      if (cfg.secondaryKey) {
        console.log(chalk.white('  Secondary Key: ') + chalk.yellow(cfg.secondaryKey));
      }
      console.log(chalk.white('  Base URL:      ') + chalk.yellow(cfg.baseUrl));
      console.log(chalk.white('  Interval:      ') + chalk.yellow(`${cfg.interval}s`));
      console.log(chalk.white('  Batch size:    ') + chalk.yellow(cfg.size));
      console.log(chalk.white('  Loop:          ') + chalk.yellow(cfg.loop ? 'yes' : 'no'));
      console.log(chalk.white('  Auth:          ') + chalk.yellow(
        cfg.authToken ? 'Token provided' : 
        (cfg.clientId ? 'OAuth2 client credentials' : 'None')
      ));
      console.log(chalk.gray('─'.repeat(50)) + '\n');

      // Create and start device
      const device = new DummyDevice(directory, cfg);
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n\n⚠️  Shutting down...'));
        device.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        device.stop();
        process.exit(0);
      });

      await device.start();

    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program.parse();
