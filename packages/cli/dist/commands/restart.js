/**
 * Restart Command
 * Restart the addon service
 */
import ora from 'ora';
import chalk from 'chalk';
import { logger, ConfigManager, ServiceManager, SSHManager } from '@stremio-addon-manager/core';
/**
 * Restart command handler
 */
export async function restartCommand(_options) {
    const spinner = ora('Restarting addon service...').start();
    try {
        const configManager = new ConfigManager();
        const config = await configManager.load();
        let ssh;
        if (config.installation.type === 'remote' && config.installation.target) {
            ssh = new SSHManager({
                host: config.installation.target.host || '',
                port: config.installation.target.port || 22,
                username: config.installation.target.username || '',
            });
            await ssh.connect();
        }
        const serviceManager = new ServiceManager('stremio-addon', ssh);
        await serviceManager.restart();
        spinner.succeed(chalk.green('Addon service restarted successfully!'));
        if (ssh) {
            await ssh.disconnect();
        }
    }
    catch (error) {
        spinner.fail(chalk.red('Failed to restart addon service'));
        logger.error('Failed to restart service', error);
        console.log(chalk.red(`\n❌ ${error.message}\n`));
        process.exit(1);
    }
}
//# sourceMappingURL=restart.js.map