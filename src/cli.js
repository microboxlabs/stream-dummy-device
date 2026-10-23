#!/usr/bin/env node

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { config } from 'dotenv';
import chalk from 'chalk';
import { DummyDevice } from './device.js';
import { loadConfig } from './config.js';
import { TrackDevice, loadTrackConfig, trackWarnings } from './track.js';

const { version } = createRequire(import.meta.url)('../package.json');

const program = new Command();

function loadEnv(envFile) {
  if (envFile) {
    config({ path: envFile });
  } else {
    config();
  }
}

program
  .name('dummy-device')
  .description('CLI tool for simulating IoT devices sending frames and GPS positions to StreamHub API')
  .version(version);

program
  .command('frames <directory>', { isDefault: true })
  .description('Send frame images from a directory (default command)')
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
      loadEnv(options.envFile);

      // Merge CLI options with environment variables
      const cfg = loadConfig(options);

      console.log(chalk.cyan.bold('\n\ud83c\udfac StreamHub Dummy Device\n'));
      console.log(chalk.gray('\u2500'.repeat(50)));
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
      console.log(chalk.gray('\u2500'.repeat(50)) + '\n');

      // Create and start device
      const device = new DummyDevice(directory, cfg);
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n\n\u26a0\ufe0f  Shutting down...'));
        device.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        device.stop();
        process.exit(0);
      });

      await device.start();

    } catch (error) {
      console.error(chalk.red(`\n\u274c Error: ${error.message}\n`));
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command('track')
  .description('Send GPS positions of one asset to a track endpoint')
  .option('-u, --track-url <url>', 'Track endpoint, e.g. https://iot.streamhub.cl/v1/asset/track')
  .option('-a, --asset-id <id>', 'Asset identifier (plate)')
  .option('-I, --interval <seconds>', 'Seconds between positions (default: 5)')
  .option('-c, --count <count>', 'Positions to send when no route is given (default: 10)')
  .option('-r, --route <file>', 'JSON array of [lat, lon] points or a GeoJSON LineString')
  .option('--latitude <deg>', 'Start latitude when no route is given')
  .option('--longitude <deg>', 'Start longitude when no route is given')
  .option('--speed <kmh>', 'Speed in km/h (default: 50)')
  .option('--heading <deg>', 'Heading in degrees when no route is given')
  .option('--replay <file>', 'Replay a recorded trip: NDJSON, one track payload per line')
  .option('--speedup <n>', 'Replay: divide the recorded gaps by n (default: 1)')
  .option('--max-gap <seconds>', 'Replay: longest single wait, for long stops (default: 300)')
  .option('--keep-timestamps', 'Replay: send the recorded timestamps instead of moving them to now')
  .option('--from <n>', 'Replay: first point to send (1-based)')
  .option('--to <n>', 'Replay: last point to send (1-based, inclusive)')
  .option('-t, --auth-token <token>', 'JWT or MIOT API key (miot_sk_...)')
  .option('--client-id <id>', 'OAuth2 client ID')
  .option('--client-secret <secret>', 'OAuth2 client secret')
  .option('--token-url <url>', 'OAuth2 token endpoint URL')
  .option('--audience <audience>', 'OAuth2 audience')
  .option('-e, --env-file <path>', 'Path to .env file for configuration')
  .option('-l, --loop', 'Repeat the positions indefinitely', false)
  .option('-v, --verbose', 'Print response bodies and request ids', false)
  .option('--dry-run', 'Print the positions without sending them', false)
  .option('--panic <positions>', 'Press the panic button on these positions (1-based; with --replay, point numbers in the file), e.g. 3 or 3,4')
  .action(async (options) => {
    try {
      loadEnv(options.envFile);
      const cfg = loadTrackConfig(options);

      console.log(chalk.cyan.bold('\n\ud83d\udccd StreamHub Dummy GPS\n'));
      console.log(chalk.gray('\u2500'.repeat(50)));
      console.log(chalk.white('  Track URL:     ') + chalk.yellow(cfg.trackUrl));
      console.log(chalk.white('  Asset ID:      ') + chalk.yellow(cfg.assetId));
      if (cfg.replay) {
        const slice = cfg.from || cfg.to ? ` points ${cfg.from ?? 1}-${cfg.to ?? 'end'}` : '';
        console.log(chalk.white('  Replay:        ') + chalk.yellow(`${cfg.replay}${slice}`));
        console.log(chalk.white('  Speedup:       ') + chalk.yellow(`x${cfg.speedup}, waits at most ${cfg.maxGap}s`));
        console.log(chalk.white('  Timestamps:    ') + chalk.yellow(cfg.keepTimestamps ? 'recorded' : 'moved to now'));
      } else {
        console.log(chalk.white('  Interval:      ') + chalk.yellow(`${cfg.interval}s`));
        console.log(chalk.white('  Route:         ') + chalk.yellow(cfg.route || `${cfg.count} points from ${cfg.latitude},${cfg.longitude}`));
      }
      console.log(chalk.white('  Auth:          ') + chalk.yellow(
        cfg.authToken ? (cfg.authToken.startsWith('miot_sk_') ? 'API key' : 'Token provided') :
        (cfg.clientId ? 'OAuth2 client credentials' : 'None')
      ));
      console.log(chalk.gray('\u2500'.repeat(50)) + '\n');
      for (const warning of trackWarnings(cfg)) {
        console.log(chalk.yellow(`\u26a0\ufe0f  ${warning}`));
      }

      const device = new TrackDevice(cfg);
      process.on('SIGINT', () => device.stop());
      process.on('SIGTERM', () => device.stop());

      const stats = await device.start();
      process.exit(stats.rejected > 0 ? 1 : 0);
    } catch (error) {
      console.error(chalk.red(`\n\u274c Error: ${error.message}\n`));
      process.exit(1);
    }
  });

program.parse();
