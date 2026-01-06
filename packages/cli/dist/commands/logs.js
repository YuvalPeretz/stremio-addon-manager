/**
 * Logs Command
 * View addon service logs
 */
import chalk from 'chalk';
import { logger, ConfigManager, ServiceManager, SSHManager } from '@stremio-addon-manager/core';
/**
 * Logs command handler
 */
export async function logsCommand(options) {
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
        const lines = parseInt(options.lines || '50', 10);
        const logs = await serviceManager.logs(lines, options.follow);
        console.log(chalk.bold.cyan('\n📋 Addon Service Logs\n'));
        console.log(chalk.gray('─'.repeat(80)));
        console.log(logs);
        console.log(chalk.gray('─'.repeat(80) + '\n'));
        if (ssh) {
            await ssh.disconnect();
        }
    }
    catch (error) {
        logger.error('Failed to get logs', error);
        console.log(chalk.red(`\n❌ Failed to get logs: ${error.message}\n`));
        process.exit(1);
    }
}
//# sourceMappingURL=logs.js.map