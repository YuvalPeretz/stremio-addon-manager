/**
 * Service Manager
 * Manages system services across different operating systems
 */
import type { ServiceInfo } from './types.js';
import type { SSHConnection } from '../ssh/types.js';
/**
 * Service Manager class
 */
export declare class ServiceManager {
    private serviceName;
    private os;
    private ssh?;
    /**
     * Create a new ServiceManager instance
     * @param serviceName Name of the service
     * @param ssh Optional SSH connection for remote management
     */
    constructor(serviceName: string, ssh?: SSHConnection);
    /**
     * Detect OS for remote connection
     */
    private detectRemoteOS;
    /**
     * Execute a command (local or remote)
     */
    private executeCommand;
    /**
     * Execute a sudo command (local or remote)
     */
    private executeSudoCommand;
    /**
     * Start the service
     */
    start(): Promise<void>;
    /**
     * Stop the service
     */
    stop(): Promise<void>;
    /**
     * Restart the service
     */
    restart(): Promise<void>;
    /**
     * Get service status
     */
    status(): Promise<ServiceInfo>;
    /**
     * Enable service (auto-start on boot)
     */
    enable(): Promise<void>;
    /**
     * Disable service (no auto-start on boot)
     */
    disable(): Promise<void>;
    /**
     * Check if service is enabled
     */
    isEnabled(): Promise<boolean>;
    /**
     * Get service logs
     */
    logs(lines?: number, follow?: boolean): Promise<string>;
    /**
     * Parse service status from command output
     */
    private parseStatus;
    /**
     * Parse enabled status from command output
     */
    private parseEnabled;
}
//# sourceMappingURL=manager.d.ts.map