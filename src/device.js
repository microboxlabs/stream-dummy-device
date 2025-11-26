import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { ApiClient } from './api.js';
import { validateConfig } from './config.js';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

/**
 * DummyDevice - Simulates an IoT device sending frames to StreamHub
 */
export class DummyDevice {
  constructor(directory, config) {
    this.directory = path.resolve(directory);
    this.config = config;
    this.running = false;
    this.currentIndex = 0;
    this.images = [];
    this.api = new ApiClient(config);
    this.stats = {
      batches: 0,
      frames: 0,
      errors: 0,
      startTime: null,
    };
  }

  /**
   * Start the device simulation
   */
  async start() {
    // Validate configuration
    const errors = validateConfig(this.config);
    if (errors.length > 0) {
      throw new Error(`Configuration errors:\n  - ${errors.join('\n  - ')}`);
    }

    // Load images from directory
    await this.loadImages();

    if (this.images.length === 0) {
      throw new Error(`No images found in directory: ${this.directory}`);
    }

    console.log(chalk.green(`✓ Found ${this.images.length} images\n`));

    // Initialize API client (get initial token if using OAuth2)
    await this.api.initialize();

    this.running = true;
    this.stats.startTime = Date.now();

    console.log(chalk.green.bold('▶ Starting frame transmission...\n'));

    // Main loop
    while (this.running) {
      await this.sendBatch();
      
      if (!this.running) break;

      // Check if we've completed all images
      if (this.currentIndex >= this.images.length) {
        if (this.config.loop) {
          this.currentIndex = 0;
          console.log(chalk.cyan('\n🔄 Looping back to start...\n'));
        } else {
          console.log(chalk.green.bold('\n✓ All images sent successfully!\n'));
          this.printStats();
          break;
        }
      }

      // Wait for next interval
      await this.sleep(this.config.interval * 1000);
    }
  }

  /**
   * Stop the device simulation
   */
  stop() {
    this.running = false;
    this.printStats();
  }

  /**
   * Load images from the directory
   */
  async loadImages() {
    const spinner = ora('Scanning directory for images...').start();

    try {
      const entries = await fs.readdir(this.directory, { withFileTypes: true });
      
      this.images = entries
        .filter(entry => entry.isFile())
        .filter(entry => IMAGE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase()))
        .map(entry => path.join(this.directory, entry.name))
        .sort(); // Sort for consistent ordering

      spinner.succeed(`Found ${this.images.length} images`);
    } catch (error) {
      spinner.fail(`Failed to read directory: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send a batch of frames
   */
  async sendBatch() {
    const batchSize = Math.min(this.config.size, this.images.length - this.currentIndex);
    const batch = this.images.slice(this.currentIndex, this.currentIndex + batchSize);
    
    const batchNumber = this.stats.batches + 1;
    const timestamp = new Date().toISOString();
    
    const spinner = ora({
      text: `Batch #${batchNumber}: Sending ${batch.length} frame(s)...`,
      color: 'cyan',
    }).start();

    try {
      if (this.config.dryRun) {
        // Simulate delay in dry run mode
        await this.sleep(500);
        spinner.succeed(chalk.gray(`[DRY RUN] Batch #${batchNumber}: Would send ${batch.length} frame(s)`));
      } else {
        const result = await this.api.sendFrames(
          batch,
          this.config.deviceId,
          timestamp,
          this.config.secondaryKey
        );
        
        spinner.succeed(
          `Batch #${batchNumber}: Sent ${batch.length} frame(s) ` +
          chalk.gray(`[${result.frameCount} processed]`)
        );

        if (this.config.verbose) {
          console.log(chalk.gray(`   └─ Frames: ${batch.map(f => path.basename(f)).join(', ')}`));
          if (this.config.secondaryKey) {
            console.log(chalk.gray(`   └─ Secondary Key: ${this.config.secondaryKey}`));
          }
        }
      }

      this.stats.batches++;
      this.stats.frames += batch.length;
      this.currentIndex += batchSize;

    } catch (error) {
      spinner.fail(chalk.red(`Batch #${batchNumber}: Failed - ${error.message}`));
      this.stats.errors++;
      
      if (this.config.verbose) {
        console.error(chalk.red(`   └─ ${error.stack}`));
      }

      // Continue to next batch despite error
      this.currentIndex += batchSize;
    }
  }

  /**
   * Print statistics
   */
  printStats() {
    const duration = this.stats.startTime 
      ? Math.round((Date.now() - this.stats.startTime) / 1000)
      : 0;

    console.log(chalk.gray('\n─'.repeat(50)));
    console.log(chalk.cyan.bold('📊 Statistics'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.white('  Batches sent:  ') + chalk.green(this.stats.batches));
    console.log(chalk.white('  Frames sent:   ') + chalk.green(this.stats.frames));
    console.log(chalk.white('  Errors:        ') + chalk.red(this.stats.errors));
    console.log(chalk.white('  Duration:      ') + chalk.yellow(`${duration}s`));
    console.log(chalk.gray('─'.repeat(50)) + '\n');
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
