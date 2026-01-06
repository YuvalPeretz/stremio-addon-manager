#!/usr/bin/env node
/**
 * Stremio Addon Manager CLI
 * Main entry point
 */
import { Command } from 'commander';
import { logger } from '@stremio-addon-manager/core';
import { installCommand } from './commands/install.js';
import { statusCommand } from './commands/status.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { restartCommand } from './commands/restart.js';
import { logsCommand } from './commands/logs.js';
import { configCommand } from './commands/config.js';
import { uninstallCommand } from './commands/uninstall.js';
const program = new Command();
/**
 * CLI Version and description
 */
program
    .name('stremio-addon-manager')
    .description('Stremio Addon Manager - Install and manage your private Stremio addon')
    .version('1.0.0');
/**
 * Install command - Main installation flow
 */
program
    .command('install')
    .description('Install the Stremio addon on local or remote machine')
    .option('-r, --remote', 'Install on a remote machine via SSH')
    .option('-c, --config <path>', 'Use a specific configuration file')
    .option('--skip-ssl', 'Skip SSL/HTTPS setup (not recommended for Stremio)')
    .action(installCommand);
/**
 * Status command - Check addon status
 */
program
    .command('status')
    .description('Check the status of the addon service')
    .option('-r, --remote', 'Check status on a remote machine')
    .action(statusCommand);
/**
 * Start command - Start the addon service
 */
program
    .command('start')
    .description('Start the addon service')
    .option('-r, --remote', 'Start service on a remote machine')
    .action(startCommand);
/**
 * Stop command - Stop the addon service
 */
program
    .command('stop')
    .description('Stop the addon service')
    .option('-r, --remote', 'Stop service on a remote machine')
    .action(stopCommand);
/**
 * Restart command - Restart the addon service
 */
program
    .command('restart')
    .description('Restart the addon service')
    .option('-r, --remote', 'Restart service on a remote machine')
    .action(restartCommand);
/**
 * Logs command - View addon logs
 */
program
    .command('logs')
    .description('View addon service logs')
    .option('-n, --lines <number>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow log output')
    .option('-r, --remote', 'View logs from a remote machine')
    .action(logsCommand);
/**
 * Config command - Manage configuration
 */
program
    .command('config')
    .description('Manage addon configuration')
    .option('--show', 'Show current configuration')
    .option('--edit', 'Edit configuration interactively')
    .option('--set <key=value>', 'Set a configuration value')
    .option('--get <key>', 'Get a configuration value')
    .option('--reset', 'Reset configuration to defaults')
    .action(configCommand);
/**
 * Uninstall command - Remove addon
 */
program
    .command('uninstall')
    .description('Uninstall the addon and remove all files')
    .option('-r, --remote', 'Uninstall from a remote machine')
    .option('--keep-config', 'Keep configuration file')
    .option('--keep-backups', 'Keep backup files')
    .action(uninstallCommand);
/**
 * Parse and execute commands
 */
async function main() {
    try {
        await program.parseAsync(process.argv);
    }
    catch (error) {
        logger.error('CLI error', error);
        process.exit(1);
    }
}
main();
export { program };
//# sourceMappingURL=index.js.map