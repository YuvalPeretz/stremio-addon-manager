/**
 * Stop Command
 * Stop the addon service
 */
import ora from 'ora';
import chalk from 'chalk';
import { logger, ConfigManager, ServiceManager, SSHManager } from '@stremio-addon-manager/core';
/**
 * Stop command handler
 */
export async function stopCommand(_options) {
    const spinner = ora('Stopping addon service...').start();
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
        await serviceManager.stop();
        spinner.succeed(chalk.green('Addon service stopped successfully!'));
        if (ssh) {
            await ssh.disconnect();
        }
    }
    catch (error) {
        spinner.fail(chalk.red('Failed to stop addon service'));
        logger.error('Failed to stop service', error);
        console.log(chalk.red(`\n❌ ${error.message}\n`));
        process.exit(1);
    }
}
//# sourceMappingURL=stop.js.map