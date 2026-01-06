/**
 * Status Command
 * Check the status of the addon service
 */
import chalk from 'chalk';
import { logger, ConfigManager, ServiceManager, SSHManager, ServiceStatus, } from '@stremio-addon-manager/core';
/**
 * Status command handler
 */
export async function statusCommand(_options) {
    try {
        const configManager = new ConfigManager();
        const config = await configManager.load();
        // Setup SSH connection if needed
        let ssh;
        if (config.installation.type === 'remote' && config.installation.target) {
            ssh = new SSHManager({
                host: config.installation.target.host || '',
                port: config.installation.target.port || 22,
                username: config.installation.target.username || '',
            });
            await ssh.connect();
        }
        // Create service manager
        const serviceManager = new ServiceManager('stremio-addon', ssh);
        const serviceInfo = await serviceManager.status();
        // Display status
        console.log(chalk.bold.cyan('\n📊 Addon Service Status\n'));
        console.log(chalk.gray('─'.repeat(50)));
        const statusColor = serviceInfo.status === ServiceStatus.ACTIVE
            ? chalk.green
            : serviceInfo.status === ServiceStatus.FAILED
                ? chalk.red
                : chalk.yellow;
        console.log(`Status:    ${statusColor(serviceInfo.status)}`);
        console.log(`Enabled:   ${serviceInfo.enabled ? chalk.green('Yes') : chalk.red('No')}`);
        if (serviceInfo.uptime) {
            console.log(`Uptime:    ${chalk.cyan(serviceInfo.uptime)}`);
        }
        if (serviceInfo.memory) {
            console.log(`Memory:    ${chalk.cyan(serviceInfo.memory)}`);
        }
        if (serviceInfo.cpu) {
            console.log(`CPU:       ${chalk.cyan(serviceInfo.cpu)}`);
        }
        if (serviceInfo.pid) {
            console.log(`PID:       ${chalk.cyan(serviceInfo.pid)}`);
        }
        console.log(chalk.gray('─'.repeat(50)));
        console.log(`\nAddon URL: ${chalk.blue.underline(`https://${config.addon.domain}`)}\n`);
        // Cleanup
        if (ssh) {
            await ssh.disconnect();
        }
    }
    catch (error) {
        logger.error('Failed to get status', error);
        console.log(chalk.red(`\n❌ Failed to get status: ${error.message}\n`));
        process.exit(1);
    }
}
//# sourceMappingURL=status.js.map