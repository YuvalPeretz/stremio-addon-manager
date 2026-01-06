/**
 * Install Command
 * Handles the installation flow for the Stremio addon
 */
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { logger, ConfigManager, InstallationType, AccessMethod, Provider, OSDetector, SSHManager, } from '@stremio-addon-manager/core';
/**
 * Install command handler
 */
export async function installCommand(options) {
    console.log(chalk.bold.cyan('\n🚀 Stremio Addon Manager - Installation Wizard\n'));
    try {
        // Initialize config manager
        const configManager = new ConfigManager(options.config);
        // Check if addon is already installed
        const configExists = await configManager.exists();
        if (configExists) {
            const { overwrite } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'overwrite',
                    message: 'Configuration already exists. Do you want to overwrite it?',
                    default: false,
                },
            ]);
            if (!overwrite) {
                console.log(chalk.yellow('\n⚠️  Installation cancelled.\n'));
                return;
            }
            await configManager.delete();
        }
        // Step 1: Determine installation type
        const installationType = options.remote
            ? InstallationType.REMOTE
            : await promptInstallationType();
        // Step 2: Setup SSH connection if remote
        let sshConnection;
        let targetOS = OSDetector.detect();
        if (installationType === InstallationType.REMOTE) {
            const sshConfig = await promptSSHConnection();
            const spinner = ora('Connecting to remote machine...').start();
            try {
                sshConnection = new SSHManager(sshConfig);
                await sshConnection.connect();
                targetOS = await OSDetector.detectRemote(sshConnection);
                spinner.succeed(chalk.green('Connected to remote machine'));
                console.log(chalk.gray(`  OS: ${OSDetector.getOSName(targetOS)}`));
            }
            catch (error) {
                spinner.fail(chalk.red('Failed to connect to remote machine'));
                throw error;
            }
        }
        // Step 3: Configure addon settings
        const addonConfig = await promptAddonConfiguration();
        // Step 4: Select access method
        const accessMethod = await promptAccessMethod();
        // Step 5: Configure features
        const features = await promptFeatures();
        // Step 6: Build complete configuration
        const config = {
            installation: {
                type: installationType,
                accessMethod,
                target: sshConnection
                    ? {
                        host: sshConnection['config'].host,
                        port: sshConnection['config'].port,
                        username: sshConnection['config'].username,
                        os: targetOS.os,
                        distro: targetOS.distro,
                    }
                    : undefined,
            },
            addon: addonConfig,
            features: {
                ...features,
                ssl: !options.skipSsl,
            },
            paths: {
                addonDirectory: '/opt/stremio-addon',
                nginxConfig: '/etc/nginx/sites-available/stremio-addon',
                serviceFile: '/etc/systemd/system/stremio-addon.service',
                logs: '/var/log/stremio-addon',
                backups: '/var/backups/stremio-addon',
            },
            secrets: {},
        };
        // Step 7: Save configuration
        await configManager.save(config);
        console.log(chalk.green('\n✅ Configuration saved successfully!\n'));
        // Step 8: Start installation
        const { startInstallation } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'startInstallation',
                message: 'Start installation now?',
                default: true,
            },
        ]);
        if (startInstallation) {
            console.log(chalk.cyan('\n📦 Starting installation...\n'));
            // Import InstallationManager dynamically to avoid circular dependencies
            const { InstallationManager } = await import('@stremio-addon-manager/core');
            // Create installation manager with progress callback
            const installManager = new InstallationManager({
                config,
                progressCallback: (progress) => {
                    const statusEmoji = {
                        pending: '⏳',
                        in_progress: '🔄',
                        completed: '✅',
                        failed: '❌',
                        skipped: '⏭️',
                    };
                    const emoji = statusEmoji[progress.status];
                    const color = progress.status === 'completed' ? chalk.green :
                        progress.status === 'failed' ? chalk.red :
                            progress.status === 'skipped' ? chalk.gray :
                                chalk.cyan;
                    console.log(color(`${emoji} [${progress.progress}%] ${progress.message}`));
                },
            });
            // Run installation
            const result = await installManager.install();
            if (result.success) {
                console.log(chalk.green.bold('\n🎉 Installation completed successfully!\n'));
                console.log(chalk.cyan('Addon URL:'), chalk.blue.underline(result.addonUrl));
                console.log(chalk.cyan('Install in Stremio:'), chalk.blue.underline(result.installManifestUrl));
                console.log(chalk.gray(`\nCompleted in ${Math.round(result.duration / 1000)}s\n`));
            }
            else {
                console.log(chalk.red.bold('\n❌ Installation failed!\n'));
                console.log(chalk.red(`Error: ${result.error?.message}\n`));
                process.exit(1);
            }
        }
        else {
            console.log(chalk.yellow('\n⚠️  Installation skipped. Run "stremio-addon-manager install" to start.\n'));
        }
        // Cleanup SSH connection
        if (sshConnection) {
            await sshConnection.disconnect();
        }
    }
    catch (error) {
        logger.error('Installation failed', error);
        console.log(chalk.red(`\n❌ Installation failed: ${error.message}\n`));
        process.exit(1);
    }
}
/**
 * Prompt for installation type
 */
async function promptInstallationType() {
    const { type } = await inquirer.prompt([
        {
            type: 'list',
            name: 'type',
            message: 'Where do you want to install the addon?',
            choices: [
                { name: 'On this machine (local)', value: InstallationType.LOCAL },
                { name: 'On a different machine (via SSH)', value: InstallationType.REMOTE },
            ],
        },
    ]);
    return type;
}
/**
 * Prompt for SSH connection details
 */
async function promptSSHConnection() {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'host',
            message: 'Enter the remote machine IP address or hostname:',
            validate: (input) => (input ? true : 'Host is required'),
        },
        {
            type: 'number',
            name: 'port',
            message: 'Enter SSH port:',
            default: 22,
        },
        {
            type: 'input',
            name: 'username',
            message: 'Enter SSH username:',
            validate: (input) => (input ? true : 'Username is required'),
        },
        {
            type: 'list',
            name: 'authMethod',
            message: 'Select authentication method:',
            choices: [
                { name: 'Password', value: 'password' },
                { name: 'Private Key (recommended)', value: 'key' },
            ],
        },
    ]);
    if (answers.authMethod === 'password') {
        const { password } = await inquirer.prompt([
            {
                type: 'password',
                name: 'password',
                message: 'Enter SSH password:',
                mask: '*',
            },
        ]);
        return {
            host: answers.host,
            port: answers.port,
            username: answers.username,
            password,
        };
    }
    else {
        const { privateKeyPath } = await inquirer.prompt([
            {
                type: 'input',
                name: 'privateKeyPath',
                message: 'Enter path to private key:',
                default: '~/.ssh/id_rsa',
            },
        ]);
        return {
            host: answers.host,
            port: answers.port,
            username: answers.username,
            privateKeyPath,
        };
    }
}
/**
 * Prompt for addon configuration
 */
async function promptAddonConfiguration() {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: 'Enter addon name:',
            default: 'My_Private_Addon',
            validate: (input) => /^[a-zA-Z0-9_-]+$/.test(input) ? true : 'Only alphanumeric, dash, and underscore allowed',
        },
        {
            type: 'input',
            name: 'domain',
            message: 'Enter your domain (e.g., yourdomain.duckdns.org):',
            validate: (input) => (input ? true : 'Domain is required'),
        },
        {
            type: 'password',
            name: 'password',
            message: 'Enter addon password (for access control):',
            mask: '*',
            validate: (input) => input.length >= 8 ? true : 'Password must be at least 8 characters',
        },
        {
            type: 'list',
            name: 'provider',
            message: 'Select streaming provider:',
            choices: [
                { name: 'Real-Debrid', value: Provider.REAL_DEBRID },
                { name: 'AllDebrid', value: Provider.ALL_DEBRID },
                { name: 'Premiumize', value: Provider.PREMIUMIZE },
                { name: 'TorBox', value: Provider.TORBOX },
            ],
            default: Provider.REAL_DEBRID,
        },
        {
            type: 'number',
            name: 'torrentLimit',
            message: 'Number of torrent options to show (5-25):',
            default: 15,
            validate: (input) => input >= 5 && input <= 25 ? true : 'Must be between 5 and 25',
        },
    ]);
    return {
        name: answers.name,
        domain: answers.domain,
        password: answers.password,
        provider: answers.provider,
        torrentLimit: answers.torrentLimit,
        version: '1.0.0',
        port: 7000,
    };
}
/**
 * Prompt for access method
 */
async function promptAccessMethod() {
    const { method } = await inquirer.prompt([
        {
            type: 'list',
            name: 'method',
            message: 'How will users access your addon?',
            choices: [
                { name: 'Custom Domain (HTTPS required)', value: AccessMethod.CUSTOM_DOMAIN },
                { name: 'DuckDNS (Free Dynamic DNS with HTTPS)', value: AccessMethod.DUCKDNS },
                {
                    name: 'Static IP + DuckDNS (HTTPS)',
                    value: AccessMethod.STATIC_IP_WITH_DOMAIN,
                },
                {
                    name: 'Local Network Only (Still requires HTTPS)',
                    value: AccessMethod.LOCAL_NETWORK,
                },
            ],
        },
    ]);
    return method;
}
/**
 * Prompt for features configuration
 */
async function promptFeatures() {
    const answers = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'firewall',
            message: 'Enable firewall (UFW)?',
            default: true,
        },
        {
            type: 'confirm',
            name: 'fail2ban',
            message: 'Enable fail2ban (SSH protection)?',
            default: true,
        },
        {
            type: 'confirm',
            name: 'cachingEnabled',
            message: 'Enable caching?',
            default: true,
        },
        {
            type: 'confirm',
            name: 'rateLimitingEnabled',
            message: 'Enable rate limiting?',
            default: true,
        },
        {
            type: 'confirm',
            name: 'authentication',
            message: 'Enable password authentication?',
            default: true,
        },
        {
            type: 'confirm',
            name: 'backupsEnabled',
            message: 'Enable automatic backups?',
            default: true,
        },
        {
            type: 'confirm',
            name: 'autoStart',
            message: 'Enable auto-start on boot?',
            default: true,
        },
    ]);
    return {
        firewall: answers.firewall,
        fail2ban: answers.fail2ban,
        caching: {
            enabled: answers.cachingEnabled,
            ttl: 7200,
            maxSize: 100,
        },
        rateLimiting: {
            enabled: answers.rateLimitingEnabled,
            stream: 50,
            stats: 120,
        },
        authentication: answers.authentication,
        backups: {
            enabled: answers.backupsEnabled,
            frequency: 'weekly',
            retention: 7,
        },
        ssl: true,
        duckdnsUpdater: false,
        autoStart: answers.autoStart,
    };
}
//# sourceMappingURL=install.js.map