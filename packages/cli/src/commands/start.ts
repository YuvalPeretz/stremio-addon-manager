/**
 * Start Command
 * Start the addon service
 */

import ora from 'ora';
import chalk from 'chalk';
import { logger, ConfigManager, ServiceManager, SSHManager } from '@stremio-addon-manager/core';

interface StartOptions {
  remote?: boolean;
}

/**
 * Start command handler
 */
export async function startCommand(_options: StartOptions): Promise<void> {
  const spinner = ora('Starting addon service...').start();

  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();

    // Setup SSH connection if needed
    let ssh: SSHManager | undefined;

    if (config.installation.type === 'remote' && config.installation.target) {
      ssh = new SSHManager({
        host: config.installation.target.host || '',
        port: config.installation.target.port || 22,
        username: config.installation.target.username || '',
      });
      await ssh.connect();
    }

    // Start service
    const serviceManager = new ServiceManager('stremio-addon', ssh);
    await serviceManager.start();

    spinner.succeed(chalk.green('Addon service started successfully!'));

    // Cleanup
    if (ssh) {
      await ssh.disconnect();
    }
  } catch (error) {
    spinner.fail(chalk.red('Failed to start addon service'));
    logger.error('Failed to start service', error);
    console.log(chalk.red(`\n❌ ${(error as Error).message}\n`));
    process.exit(1);
  }
}

