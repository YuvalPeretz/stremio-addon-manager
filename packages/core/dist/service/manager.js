/**
 * Service Manager
 * Manages system services across different operating systems
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';
import { OSDetector } from '../os/detector.js';
import { OperatingSystem } from '../types/common.js';
import { ServiceStatus } from './types.js';
const execAsync = promisify(exec);
/**
 * Service Manager class
 */
export class ServiceManager {
    serviceName;
    os;
    ssh;
    /**
     * Create a new ServiceManager instance
     * @param serviceName Name of the service
     * @param ssh Optional SSH connection for remote management
     */
    constructor(serviceName, ssh) {
        this.serviceName = serviceName;
        this.ssh = ssh;
        this.os = ssh ? OperatingSystem.UNKNOWN : OSDetector.detect().os;
    }
    /**
     * Detect OS for remote connection
     */
    async detectRemoteOS() {
        if (this.ssh && this.os === OperatingSystem.UNKNOWN) {
            const systemInfo = await OSDetector.detectRemote(this.ssh);
            this.os = systemInfo.os;
        }
    }
    /**
     * Execute a command (local or remote)
     */
    async executeCommand(command) {
        if (this.ssh) {
            return await this.ssh.execCommand(command);
        }
        else {
            try {
                const { stdout, stderr } = await execAsync(command);
                return { stdout, stderr, code: 0 };
            }
            catch (error) {
                const execError = error;
                return {
                    stdout: execError.stdout || '',
                    stderr: execError.stderr || error.message,
                    code: execError.code || 1,
                };
            }
        }
    }
    /**
     * Execute a sudo command (local or remote)
     */
    async executeSudoCommand(command) {
        if (this.ssh) {
            return await this.ssh.execSudo(command);
        }
        else {
            const sudoCommand = process.platform === 'win32' ? command : `sudo ${command}`;
            return await this.executeCommand(sudoCommand);
        }
    }
    /**
     * Start the service
     */
    async start() {
        await this.detectRemoteOS();
        try {
            logger.info('Starting service', { service: this.serviceName, os: this.os });
            let command;
            switch (this.os) {
                case OperatingSystem.LINUX:
                    command = `systemctl start ${this.serviceName}`;
                    break;
                case OperatingSystem.MACOS:
                    command = `launchctl start ${this.serviceName}`;
                    break;
                case OperatingSystem.WINDOWS:
                    command = `nssm start ${this.serviceName}`;
                    break;
                default:
                    throw new Error(`Unsupported operating system: ${this.os}`);
            }
            const result = await this.executeSudoCommand(command);
            if (result.code !== 0) {
                throw new Error(`Failed to start service: ${result.stderr}`);
            }
            logger.info('Service started successfully', { service: this.serviceName });
        }
        catch (error) {
            logger.error('Failed to start service', { service: this.serviceName, error });
            throw new Error(`Failed to start service: ${error.message}`);
        }
    }
    /**
     * Stop the service
     */
    async stop() {
        await this.detectRemoteOS();
        try {
            logger.info('Stopping service', { service: this.serviceName, os: this.os });
            let command;
            switch (this.os) {
                case OperatingSystem.LINUX:
                    command = `systemctl stop ${this.serviceName}`;
                    break;
                case OperatingSystem.MACOS:
                    command = `launchctl stop ${this.serviceName}`;
                    break;
                case OperatingSystem.WINDOWS:
                    command = `nssm stop ${this.serviceName}`;
                    break;
                default:
                    throw new Error(`Unsupported operating system: ${this.os}`);
            }
            const result = await this.executeSudoCommand(command);
            if (result.code !== 0) {
                throw new Error(`Failed to stop service: ${result.stderr}`);
            }
            logger.info('Service stopped successfully', { service: this.serviceName });
        }
        catch (error) {
            logger.error('Failed to stop service', { service: this.serviceName, error });
            throw new Error(`Failed to stop service: ${error.message}`);
        }
    }
    /**
     * Restart the service
     */
    async restart() {
        await this.detectRemoteOS();
        try {
            logger.info('Restarting service', { service: this.serviceName, os: this.os });
            let command;
            switch (this.os) {
                case OperatingSystem.LINUX:
                    command = `systemctl restart ${this.serviceName}`;
                    break;
                case OperatingSystem.MACOS:
                    await this.stop();
                    await this.start();
                    return;
                case OperatingSystem.WINDOWS:
                    command = `nssm restart ${this.serviceName}`;
                    break;
                default:
                    throw new Error(`Unsupported operating system: ${this.os}`);
            }
            const result = await this.executeSudoCommand(command);
            if (result.code !== 0) {
                throw new Error(`Failed to restart service: ${result.stderr}`);
            }
            logger.info('Service restarted successfully', { service: this.serviceName });
        }
        catch (error) {
            logger.error('Failed to restart service', { service: this.serviceName, error });
            throw new Error(`Failed to restart service: ${error.message}`);
        }
    }
    /**
     * Get service status
     */
    async status() {
        await this.detectRemoteOS();
        try {
            logger.debug('Getting service status', { service: this.serviceName, os: this.os });
            let statusCommand;
            let enabledCommand;
            switch (this.os) {
                case OperatingSystem.LINUX:
                    statusCommand = `systemctl is-active ${this.serviceName}`;
                    enabledCommand = `systemctl is-enabled ${this.serviceName}`;
                    break;
                case OperatingSystem.MACOS:
                    statusCommand = `launchctl list | grep ${this.serviceName}`;
                    enabledCommand = statusCommand;
                    break;
                case OperatingSystem.WINDOWS:
                    statusCommand = `nssm status ${this.serviceName}`;
                    enabledCommand = `nssm get ${this.serviceName} Start`;
                    break;
                default:
                    throw new Error(`Unsupported operating system: ${this.os}`);
            }
            const statusResult = await this.executeSudoCommand(statusCommand);
            const enabledResult = await this.executeSudoCommand(enabledCommand);
            const status = this.parseStatus(statusResult.stdout, this.os);
            const enabled = this.parseEnabled(enabledResult.stdout, this.os);
            return {
                status,
                enabled,
            };
        }
        catch (error) {
            logger.error('Failed to get service status', { service: this.serviceName, error });
            return {
                status: ServiceStatus.UNKNOWN,
                enabled: false,
            };
        }
    }
    /**
     * Enable service (auto-start on boot)
     */
    async enable() {
        await this.detectRemoteOS();
        try {
            logger.info('Enabling service', { service: this.serviceName, os: this.os });
            let command;
            switch (this.os) {
                case OperatingSystem.LINUX:
                    command = `systemctl enable ${this.serviceName}`;
                    break;
                case OperatingSystem.MACOS:
                    command = `launchctl load -w ~/Library/LaunchAgents/${this.serviceName}.plist`;
                    break;
                case OperatingSystem.WINDOWS:
                    command = `nssm set ${this.serviceName} Start SERVICE_AUTO_START`;
                    break;
                default:
                    throw new Error(`Unsupported operating system: ${this.os}`);
            }
            const result = await this.executeSudoCommand(command);
            if (result.code !== 0) {
                throw new Error(`Failed to enable service: ${result.stderr}`);
            }
            logger.info('Service enabled successfully', { service: this.serviceName });
        }
        catch (error) {
            logger.error('Failed to enable service', { service: this.serviceName, error });
            throw new Error(`Failed to enable service: ${error.message}`);
        }
    }
    /**
     * Disable service (no auto-start on boot)
     */
    async disable() {
        await this.detectRemoteOS();
        try {
            logger.info('Disabling service', { service: this.serviceName, os: this.os });
            let command;
            switch (this.os) {
                case OperatingSystem.LINUX:
                    command = `systemctl disable ${this.serviceName}`;
                    break;
                case OperatingSystem.MACOS:
                    command = `launchctl unload -w ~/Library/LaunchAgents/${this.serviceName}.plist`;
                    break;
                case OperatingSystem.WINDOWS:
                    command = `nssm set ${this.serviceName} Start SERVICE_DEMAND_START`;
                    break;
                default:
                    throw new Error(`Unsupported operating system: ${this.os}`);
            }
            const result = await this.executeSudoCommand(command);
            if (result.code !== 0) {
                throw new Error(`Failed to disable service: ${result.stderr}`);
            }
            logger.info('Service disabled successfully', { service: this.serviceName });
        }
        catch (error) {
            logger.error('Failed to disable service', { service: this.serviceName, error });
            throw new Error(`Failed to disable service: ${error.message}`);
        }
    }
    /**
     * Check if service is enabled
     */
    async isEnabled() {
        const info = await this.status();
        return info.enabled;
    }
    /**
     * Get service logs
     */
    async logs(lines = 50, follow = false) {
        await this.detectRemoteOS();
        try {
            logger.debug('Getting service logs', { service: this.serviceName, lines, follow });
            let command;
            switch (this.os) {
                case OperatingSystem.LINUX:
                    command = follow
                        ? `journalctl -u ${this.serviceName} -f`
                        : `journalctl -u ${this.serviceName} -n ${lines}`;
                    break;
                case OperatingSystem.MACOS:
                    // macOS logs are in a file specified in the plist
                    command = `tail -n ${lines} /tmp/${this.serviceName}.log`;
                    break;
                case OperatingSystem.WINDOWS:
                    // Windows logs would be in a file or Event Viewer
                    command = `type C:\\${this.serviceName}\\logs\\service.log`;
                    break;
                default:
                    throw new Error(`Unsupported operating system: ${this.os}`);
            }
            const result = await this.executeSudoCommand(command);
            return result.stdout;
        }
        catch (error) {
            logger.error('Failed to get service logs', { service: this.serviceName, error });
            throw new Error(`Failed to get service logs: ${error.message}`);
        }
    }
    /**
     * Parse service status from command output
     */
    parseStatus(output, os) {
        const trimmed = output.trim().toLowerCase();
        switch (os) {
            case OperatingSystem.LINUX:
                if (trimmed === 'active')
                    return ServiceStatus.ACTIVE;
                if (trimmed === 'inactive')
                    return ServiceStatus.INACTIVE;
                if (trimmed === 'failed')
                    return ServiceStatus.FAILED;
                return ServiceStatus.UNKNOWN;
            case OperatingSystem.MACOS:
                return trimmed.length > 0 ? ServiceStatus.ACTIVE : ServiceStatus.INACTIVE;
            case OperatingSystem.WINDOWS:
                if (trimmed.includes('running'))
                    return ServiceStatus.ACTIVE;
                if (trimmed.includes('stopped'))
                    return ServiceStatus.INACTIVE;
                return ServiceStatus.UNKNOWN;
            default:
                return ServiceStatus.UNKNOWN;
        }
    }
    /**
     * Parse enabled status from command output
     */
    parseEnabled(output, os) {
        const trimmed = output.trim().toLowerCase();
        switch (os) {
            case OperatingSystem.LINUX:
                return trimmed === 'enabled';
            case OperatingSystem.MACOS:
                return trimmed.length > 0;
            case OperatingSystem.WINDOWS:
                return trimmed.includes('auto_start');
            default:
                return false;
        }
    }
}
//# sourceMappingURL=manager.js.map