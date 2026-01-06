/**
 * Installation Manager
 * Orchestrates the complete addon installation process
 */
import type { InstallationOptions, InstallationResult } from './types.js';
/**
 * Installation Manager class
 */
export declare class InstallationManager {
    private options;
    private ssh?;
    private os;
    private distro?;
    private steps;
    private startTime;
    private progressCallback?;
    constructor(options: InstallationOptions);
    /**
     * Execute the full installation process
     */
    install(): Promise<InstallationResult>;
    /**
     * Execute a single installation step
     */
    private executeStep;
    /**
     * Skip a step
     */
    private skipStep;
    /**
     * Update installation progress
     */
    private updateProgress;
    /**
     * Calculate progress percentage
     */
    private calculateProgress;
    /**
     * Connect to remote server
     */
    private connectToRemote;
    /**
     * Detect operating system
     */
    private detectOperatingSystem;
    /**
     * Execute command (local or remote)
     */
    private execCommand;
    /**
     * Execute sudo command
     */
    private execSudo;
    /**
     * Check prerequisites
     */
    private checkPrerequisites;
    /**
     * Check if a command exists
     */
    private checkCommand;
    /**
     * Install missing prerequisites
     */
    private installPrerequisites;
    /**
     * Install a single prerequisite
     */
    private installPrerequisite;
    /**
     * Get Node.js install command based on distro
     */
    private getNodeInstallCommand;
    /**
     * Setup firewall (UFW)
     */
    private setupFirewall;
    /**
     * Setup fail2ban
     */
    private setupFail2ban;
    /**
     * Clone repository
     */
    private cloneRepository;
    /**
     * Install dependencies
     */
    private installDependencies;
    /**
     * Setup Nginx reverse proxy
     */
    private setupNginx;
    /**
     * Setup SSL with Let's Encrypt
     */
    private setupSSL;
    /**
     * Create systemd service
     */
    private createService;
    /**
     * Start the service
     */
    private startService;
    /**
     * Configure DuckDNS updater
     */
    private configureDuckDNS;
    /**
     * Create initial backup
     */
    private createBackup;
    /**
     * Verify installation
     */
    private verifyInstallation;
    /**
     * Cleanup temporary files
     */
    private cleanup;
}
//# sourceMappingURL=manager.d.ts.map