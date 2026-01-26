/**
 * Installation Manager
 * Orchestrates the complete addon installation process
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';
import { OSDetector } from '../os/detector.js';
import { SSHManager } from '../ssh/manager.js';
import { ServiceManager } from '../service/manager.js';
import { OperatingSystem, LinuxDistribution } from '../types/common.js';
import { AddonRegistryManager, generateServiceName, ConfigManager, EnvVarManager } from '../config/index.js';
import { ServiceFileManager } from '../service/file-manager.js';
import type {
  InstallationOptions,
  InstallationResult,
  InstallationProgress,
  PrerequisiteCheck,
  ProgressCallback,
  CertificateInfo,
} from './types.js';
import { InstallationStep, StepStatus } from './types.js';

const execAsync = promisify(exec);

// ESM equivalent of __dirname for path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Installation Manager class
 */
export class InstallationManager {
  private options: InstallationOptions;
  private ssh?: SSHManager;
  private os: OperatingSystem = OperatingSystem.UNKNOWN;
  private distro?: LinuxDistribution;
  private steps: InstallationProgress[] = [];
  private startTime: number = 0;
  private progressCallback?: ProgressCallback;

  constructor(options: InstallationOptions) {
    this.options = options;
    this.progressCallback = options.progressCallback;
  }

  /**
   * Execute the full installation process
   */
  public async install(): Promise<InstallationResult> {
    this.startTime = Date.now();
    
    // CRITICAL: Log addonId status at the start of installation
    logger.info('Starting addon installation', {
      type: this.options.config.installation.type,
      domain: this.options.config.addon.domain,
      addonId: this.options.config.addonId,
      hasAddonId: !!this.options.config.addonId,
      configKeys: Object.keys(this.options.config),
    });

    // CRITICAL: Try to generate addonId if missing (fallback safety net)
    // This should have been set in Electron main process, but if it wasn't, generate it here
    if (!this.options.config.addonId) {
      logger.warn('addonId is missing at start of installation - attempting to generate from addon name/domain', {
        hasAddonName: !!this.options.config.addon?.name,
        hasAddonDomain: !!this.options.config.addon?.domain,
      });
      
      // Generate addonId from name or domain
      let addonId: string | undefined;
      if (this.options.config.addon?.name) {
        addonId = this.options.config.addon.name
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, "")
          .replace(/[\s_-]+/g, "-")
          .replace(/^-+|-+$/g, "");
      } else if (this.options.config.addon?.domain) {
        addonId = this.options.config.addon.domain
          .toLowerCase()
          .replace(/\./g, "-")
          .replace(/[^\w-]/g, "")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "");
      }
      
      if (addonId) {
        // Ensure unique ID by checking registry
        try {
          const { AddonRegistryManager, generateServiceName } = await import('../config/registry-manager.js');
          const registryManager = new AddonRegistryManager();
          await registryManager.initialize();
          const registry = registryManager.getRegistry();
          await registry.load();
          
          let finalAddonId = addonId;
          let counter = 1;
          while (registry.exists(finalAddonId)) {
            finalAddonId = `${addonId}-${counter}`;
            counter++;
          }
          
          this.options.config.addonId = finalAddonId;
          this.options.config.serviceName = generateServiceName(finalAddonId);
          
          logger.info('Generated addonId as fallback', { addonId: finalAddonId });
        } catch (error) {
          logger.error('Failed to generate addonId as fallback', { error: (error as Error).message });
        }
      }
      
      if (!this.options.config.addonId) {
        logger.error('CRITICAL: Could not generate addonId - registration will be skipped', {
          hasAddonName: !!this.options.config.addon?.name,
          hasAddonDomain: !!this.options.config.addon?.domain,
        });
      }
    }

    try {
      // Step 0: Check for conflicts (port, domain, name) - only if addonId is set
      if (this.options.config.addonId) {
        await this.checkConflicts();
      }

      // Step 1: Connect (if remote)
      await this.executeStep(InstallationStep.CONNECT, async () => {
        if (this.options.config.installation.type === 'remote') {
          await this.connectToRemote();
        }
      });

      // Step 2: Detect OS
      await this.executeStep(InstallationStep.DETECT_OS, async () => {
        await this.detectOperatingSystem();
      });

      // Step 3: Check prerequisites
      const prerequisites = await this.executeStep(
        InstallationStep.CHECK_PREREQUISITES,
        async () => {
          return await this.checkPrerequisites();
        }
      );

      // Step 4: Install missing prerequisites
      await this.executeStep(InstallationStep.INSTALL_PREREQUISITES, async () => {
        await this.installPrerequisites(prerequisites as PrerequisiteCheck[]);
      });

      // Step 5: Setup firewall
      if (this.options.config.features.firewall) {
        await this.executeStep(InstallationStep.SETUP_FIREWALL, async () => {
          await this.setupFirewall();
        });
      } else {
        this.skipStep(InstallationStep.SETUP_FIREWALL, 'Firewall disabled in configuration');
      }

      // Step 6: Setup fail2ban
      if (this.options.config.features.fail2ban) {
        await this.executeStep(InstallationStep.SETUP_FAIL2BAN, async () => {
          await this.setupFail2ban();
        });
      } else {
        this.skipStep(InstallationStep.SETUP_FAIL2BAN, 'Fail2ban disabled in configuration');
      }

      // Step 7: Copy addon-server from bundled packages
      await this.executeStep(InstallationStep.CLONE_REPOSITORY, async () => {
        await this.cloneRepository(); // Note: Despite the name, this copies bundled files
      });

      // Step 8: Install dependencies
      await this.executeStep(InstallationStep.INSTALL_DEPENDENCIES, async () => {
        await this.installDependencies();
      });

      // Step 9: Setup Nginx
      await this.executeStep(InstallationStep.SETUP_NGINX, async () => {
        await this.setupNginx();
      });

      // Step 9.5: Update DuckDNS BEFORE SSL setup (critical for DNS-based validation)
      // DuckDNS must be updated with the server IP before Let's Encrypt tries to verify the domain
      // This happens regardless of the duckdnsUpdater feature flag (which only controls cron job)
      const isDuckDNS = this.options.config.addon.domain.includes('duckdns.org');
      const hasDuckDNSToken = !!this.options.config.secrets.duckdnsToken;
      
      if (isDuckDNS && hasDuckDNSToken && (this.options.config.features.ssl && !this.options.skipSSL)) {
        // Update DuckDNS immediately before SSL setup
        // This is NOT wrapped in executeStep because it's a critical prerequisite for SSL
        logger.info('Updating DuckDNS IP before SSL setup (required for certificate validation)', {
          domain: this.options.config.addon.domain,
        });
        
        try {
          const domain = this.options.config.addon.domain.replace('.duckdns.org', '');
          const duckdnsToken = this.options.config.secrets.duckdnsToken;
          
          // Trigger immediate DuckDNS update
          const updateResult = await this.execCommand(
            `curl -k "https://www.duckdns.org/update?domains=${domain}&token=${duckdnsToken}&ip=" 2>&1`
          );
          
          if (updateResult.stdout.includes('OK')) {
            logger.info('DuckDNS IP updated successfully before SSL setup', { 
              domain: `${domain}.duckdns.org`,
              response: updateResult.stdout.trim(),
            });
            
            // Wait for DNS propagation after updating DuckDNS
            // This is critical for SSL certificate validation
            logger.info('Waiting for DNS propagation after DuckDNS update (60 seconds)...');
            logger.info('This wait ensures Let\'s Encrypt can resolve the domain for SSL certificate validation');
            await new Promise(resolve => setTimeout(resolve, 60000)); // 60 seconds
            logger.info('DNS propagation wait complete, proceeding with SSL setup');
          } else if (updateResult.stdout.includes('KO')) {
            logger.error('DuckDNS IP update failed before SSL setup', {
              domain,
              response: updateResult.stdout.trim(),
            });
            throw new Error(`DuckDNS update failed: Invalid token or domain name. SSL setup cannot proceed without valid DNS. Please verify your DuckDNS token and domain name.`);
          } else {
            logger.warn('DuckDNS update response unclear, proceeding with SSL setup anyway', {
              response: updateResult.stdout.trim(),
              stderr: updateResult.stderr.trim(),
            });
          }
        } catch (error) {
          logger.error('Failed to update DuckDNS before SSL setup', error);
          throw new Error(`Failed to update DuckDNS: ${(error as Error).message}. SSL setup cannot proceed.`);
        }
      } else if (isDuckDNS && !hasDuckDNSToken) {
        logger.warn('Domain is DuckDNS but no token provided - SSL may fail if DNS is not already configured', {
          domain: this.options.config.addon.domain,
          hasToken: hasDuckDNSToken,
        });
      }

      // Step 10: Setup SSL
      if (this.options.config.features.ssl && !this.options.skipSSL) {
        await this.executeStep(InstallationStep.SETUP_SSL, async () => {
          await this.setupSSL();
        });
      } else {
        this.skipStep(InstallationStep.SETUP_SSL, 'SSL setup skipped');
      }

      // Step 11: Create systemd service
      await this.executeStep(InstallationStep.CREATE_SERVICE, async () => {
        await this.createService();
      });

      // Step 12: Start service
      await this.executeStep(InstallationStep.START_SERVICE, async () => {
        await this.startService();
      });

      // Step 13: Configure DuckDNS cron job (if enabled)
      // This sets up periodic updates to keep the IP current
      // Note: The initial DuckDNS update was already done before SSL setup (if needed)
      if (this.options.config.features.duckdnsUpdater && isDuckDNS && hasDuckDNSToken) {
        await this.executeStep(InstallationStep.CONFIGURE_DUCKDNS, async () => {
          // Only set up the cron job, since immediate update was already done before SSL
          await this.configureDuckDNSCronJob();
        });
      } else if (!this.options.config.features.duckdnsUpdater) {
        this.skipStep(InstallationStep.CONFIGURE_DUCKDNS, 'DuckDNS periodic updater disabled (initial update may have been done before SSL)');
      } else if (!isDuckDNS) {
        this.skipStep(InstallationStep.CONFIGURE_DUCKDNS, 'Not a DuckDNS domain');
      } else if (!hasDuckDNSToken) {
        this.skipStep(InstallationStep.CONFIGURE_DUCKDNS, 'No DuckDNS token provided');
      }

      // Step 14: Create initial backup
      if (this.options.config.features.backups.enabled) {
        await this.executeStep(InstallationStep.CREATE_BACKUP, async () => {
          await this.createBackup();
        });
      } else {
        this.skipStep(InstallationStep.CREATE_BACKUP, 'Backups disabled');
      }

      // Step 15: Verify installation
      await this.executeStep(InstallationStep.VERIFY_INSTALLATION, async () => {
        await this.verifyInstallation();
      });

      // Step 16: Register addon in registry (if addonId is set)
      // Note: Not wrapped in executeStep to avoid adding a new step type, but still executed
      if (this.options.config.addonId) {
        logger.info('Step 16: Registering addon in registry', { 
          addonId: this.options.config.addonId,
          name: this.options.config.addon?.name,
          domain: this.options.config.addon?.domain,
          port: this.options.config.addon?.port,
        });
        try {
          await this.registerAddon();
          logger.info('Step 16: Addon registration completed', { addonId: this.options.config.addonId });
        } catch (error) {
          logger.error('Step 16: Addon registration failed', { 
            addonId: this.options.config.addonId, 
            error: (error as Error).message,
            stack: (error as Error).stack,
          });
          // Don't throw - registration failure shouldn't fail the installation
        }
      } else {
        logger.error('Step 16: CRITICAL - Skipping addon registration - addonId not set', {
          hasAddonName: !!this.options.config.addon?.name,
          hasAddonDomain: !!this.options.config.addon?.domain,
          configKeys: Object.keys(this.options.config),
          addonKeys: this.options.config.addon ? Object.keys(this.options.config.addon) : [],
        });
      }

      // Step 17: Cleanup temporary files only (not the installed addon)
      await this.executeStep(InstallationStep.CLEANUP, async () => {
        await this.cleanupTemporaryFiles();
      });

      // Mark as complete
      this.updateProgress(InstallationStep.COMPLETE, StepStatus.COMPLETED, 'Installation complete!', 100);

      const duration = Date.now() - this.startTime;
      const protocol = this.options.config.features.ssl ? 'https' : 'http';
      const addonUrl = `${protocol}://${this.options.config.addon.domain}`;
      const installManifestUrl = `${addonUrl}/${this.options.config.addon.password}/manifest.json`;

      logger.info('Installation completed successfully', { duration, addonUrl, addonId: this.options.config.addonId });

      return {
        success: true,
        config: this.options.config,
        addonId: this.options.config.addonId,
        addonUrl,
        installManifestUrl,
        steps: this.steps,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - this.startTime;
      logger.error('Installation failed', error);

      // Cleanup after failure
      try {
        await this.cleanup();
      } catch (cleanupError) {
        logger.error('Error during failure cleanup', cleanupError);
        // Don't throw - cleanup errors shouldn't mask the original error
      }

      return {
        success: false,
        config: this.options.config,
        addonUrl: '',
        installManifestUrl: '',
        steps: this.steps,
        error: error as Error,
        duration,
      };
    } finally {
      if (this.ssh) {
        await this.ssh.disconnect();
      }
    }
  }

  /**
   * Execute a single installation step
   */
  private async executeStep<T>(
    step: InstallationStep,
    action: () => Promise<T>
  ): Promise<T | undefined> {
    this.updateProgress(step, StepStatus.IN_PROGRESS, `Starting ${step}...`, this.calculateProgress(step));

    try {
      const result = await action();
      this.updateProgress(step, StepStatus.COMPLETED, `${step} completed`, this.calculateProgress(step));
      return result;
    } catch (error) {
      this.updateProgress(
        step,
        StepStatus.FAILED,
        `${step} failed: ${(error as Error).message}`,
        this.calculateProgress(step),
        error as Error
      );
      throw error;
    }
  }

  /**
   * Skip a step
   */
  private skipStep(step: InstallationStep, reason: string): void {
    this.updateProgress(step, StepStatus.SKIPPED, reason, this.calculateProgress(step));
  }

  /**
   * Update installation progress
   */
  private updateProgress(
    step: InstallationStep,
    status: StepStatus,
    message: string,
    progress: number,
    error?: Error
  ): void {
    const progressUpdate: InstallationProgress = {
      step,
      status,
      message,
      progress,
      error,
      timestamp: new Date(),
    };

    this.steps.push(progressUpdate);

    if (this.progressCallback) {
      this.progressCallback(progressUpdate);
    }

    logger.info('Installation progress', { step, status, progress });
  }

  /**
   * Calculate progress percentage
   */
  private calculateProgress(step: InstallationStep): number {
    const stepOrder = Object.values(InstallationStep);
    const currentIndex = stepOrder.indexOf(step);
    return Math.round((currentIndex / stepOrder.length) * 100);
  }

  /**
   * Check for conflicts (port, domain, name) before installation
   */
  private async checkConflicts(): Promise<void> {
    if (!this.options.config.addonId) {
      return; // Skip if no addonId (legacy mode)
    }

    logger.info('Checking for conflicts', { addonId: this.options.config.addonId });

    const registryManager = new AddonRegistryManager();
    await registryManager.initialize();

    const addonName = this.options.config.addon.name;
    const port = this.options.config.addon.port || 7000;
    const domain = this.options.config.addon.domain;
    const serviceName = this.getServiceName();

    // Check name availability
    if (!(await registryManager.isNameAvailable(addonName, this.options.config.addonId))) {
      const existingAddon = registryManager.getRegistry().getByName(addonName);
      const suggestion = existingAddon
        ? `Try a different name like '${addonName} 2' or '${addonName}-backup'`
        : `Try a different name`;
      throw new Error(
        `Addon name '${addonName}' is already in use by addon '${existingAddon?.id || "unknown"}'. ${suggestion}`
      );
    }

    // Check port availability
    if (!(await registryManager.isPortAvailable(port, this.options.config.addonId))) {
      const existingAddon = registryManager.getRegistry().list().find((a) => a.port === port);
      const availablePort = await registryManager.findAvailablePort(port + 1, 10).catch(() => port + 1);
      throw new Error(
        `Port ${port} is already in use by addon '${existingAddon?.name || existingAddon?.id || "unknown"}'. ` +
          `Suggested alternative: ${availablePort}`
      );
    }

    // Check domain availability
    if (domain && !(await registryManager.isDomainAvailable(domain, this.options.config.addonId))) {
      const existingAddon = registryManager.getRegistry().list().find((a) => a.domain === domain);
      throw new Error(
        `Domain '${domain}' is already in use by addon '${existingAddon?.name || existingAddon?.id || "unknown"}'. ` +
          `Each addon must have a unique domain. If you're using the same domain, consider using subdomains or different ports.`
      );
    }

    // Check service name conflicts (service exists but not in registry)
    const { OSDetector } = await import('../os/index.js');
    const systemInfo = OSDetector.detect();
    if (systemInfo.os === 'linux') {
      try {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(`systemctl list-units --type=service --no-legend ${serviceName}.service`);
        if (stdout.trim()) {
          // Service exists - check if it's in registry
          const allAddons = await registryManager.listAddons();
          const serviceInRegistry = allAddons.some((a) => a.serviceName === serviceName);
          if (!serviceInRegistry) {
            logger.warn(
              `Service '${serviceName}' exists but is not registered in addon registry. ` +
                `This may be an orphaned service from a previous installation.`
            );
            // Don't throw - allow installation to proceed, but warn
          }
        }
      } catch (error) {
        // Service doesn't exist or error checking - that's fine
        logger.debug('Service conflict check completed', { serviceName, error });
      }
    }

    logger.info('No conflicts detected', { addonId: this.options.config.addonId });
  }

  /**
   * Connect to remote server
   */
  private async connectToRemote(): Promise<void> {
    if (!this.options.config.installation.target) {
      throw new Error('Remote target not configured');
    }

    const target = this.options.config.installation.target;

    this.ssh = new SSHManager({
      host: target.host || '',
      port: target.port || 22,
      username: target.username || '',
    });

    await this.ssh.connect();
    logger.info('Connected to remote server', { host: target.host });
  }

  /**
   * Detect operating system
   */
  private async detectOperatingSystem(): Promise<void> {
    const systemInfo = this.ssh
      ? await OSDetector.detectRemote(this.ssh)
      : OSDetector.detect();

    this.os = systemInfo.os;
    this.distro = systemInfo.distro;

    logger.info('Operating system detected', {
      os: this.os,
      distro: this.distro,
      platform: systemInfo.platform,
    });

    if (this.os !== OperatingSystem.LINUX) {
      throw new Error(`Unsupported operating system: ${this.os}. Only Linux is supported.`);
    }
  }

  /**
   * Execute command (local or remote)
   */
  private async execCommand(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    if (this.ssh) {
      return await this.ssh.execCommand(command);
    } else {
      try {
        const { stdout, stderr } = await execAsync(command);
        return { stdout, stderr, code: 0 };
      } catch (error) {
        const execError = error as { stdout?: string; stderr?: string; code?: number };
        return {
          stdout: execError.stdout || '',
          stderr: execError.stderr || (error as Error).message,
          code: execError.code || 1,
        };
      }
    }
  }

  /**
   * Execute sudo command
   */
  private async execSudo(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    if (this.ssh) {
      return await this.ssh.execSudo(command);
    } else {
      return await this.execCommand(`sudo ${command}`);
    }
  }

  /**
   * Check prerequisites
   */
  private async checkPrerequisites(): Promise<PrerequisiteCheck[]> {
    const checks: PrerequisiteCheck[] = [];

    // Check Node.js
    const nodeCheck = await this.checkCommand('node --version', 'Node.js', true, 'v16.0.0');
    checks.push(nodeCheck);

    // Check npm
    const npmCheck = await this.checkCommand('npm --version', 'npm', true, '8.0.0');
    checks.push(npmCheck);

    // Check Git
    const gitCheck = await this.checkCommand('git --version', 'Git', true);
    checks.push(gitCheck);

    // Check Nginx
    const nginxCheck = await this.checkCommand('nginx -v', 'Nginx', true);
    checks.push(nginxCheck);

    // Check Certbot (for SSL)
    if (this.options.config.features.ssl) {
      const certbotCheck = await this.checkCommand('certbot --version', 'Certbot', true);
      checks.push(certbotCheck);
    }

    // Check UFW (firewall)
    if (this.options.config.features.firewall) {
      const ufwCheck = await this.checkCommand('ufw --version', 'UFW', true);
      checks.push(ufwCheck);
    }

    // Check fail2ban
    if (this.options.config.features.fail2ban) {
      const fail2banCheck = await this.checkCommand('fail2ban-client --version', 'fail2ban', true);
      checks.push(fail2banCheck);
    }

    logger.info('Prerequisites checked', {
      total: checks.length,
      installed: checks.filter((c) => c.installed).length,
      missing: checks.filter((c) => !c.installed).length,
    });

    return checks;
  }

  /**
   * Check if a command exists
   */
  private async checkCommand(
    command: string,
    name: string,
    required: boolean,
    requiredVersion?: string
  ): Promise<PrerequisiteCheck> {
    try {
      const result = await this.execCommand(command);
      const installed = result.code === 0;
      const version = result.stdout.trim() || result.stderr.trim();

      return {
        name,
        required,
        installed,
        version: installed ? version : undefined,
        requiredVersion,
      };
    } catch (error) {
      return {
        name,
        required,
        installed: false,
        requiredVersion,
      };
    }
  }

  /**
   * Install missing prerequisites
   */
  private async installPrerequisites(checks: PrerequisiteCheck[]): Promise<void> {
    const missing = checks.filter((c) => !c.installed && c.required);

    if (missing.length === 0) {
      logger.info('All prerequisites already installed');
      return;
    }

    logger.info('Installing missing prerequisites', { count: missing.length });

    // Update package manager
    if (this.distro === LinuxDistribution.UBUNTU || this.distro === LinuxDistribution.DEBIAN || this.distro === LinuxDistribution.RASPBERRY_PI) {
      await this.execSudo('apt-get update -y');
    } else if (this.distro === LinuxDistribution.FEDORA || this.distro === LinuxDistribution.CENTOS) {
      await this.execSudo('yum update -y');
    }

    // Install each missing prerequisite
    for (const check of missing) {
      await this.installPrerequisite(check.name);
    }
  }

  /**
   * Install a single prerequisite
   */
  private async installPrerequisite(name: string): Promise<void> {
    logger.info('Installing prerequisite', { name });

    const installCommands: Record<string, string> = {
      'Node.js': this.getNodeInstallCommand(),
      npm: 'apt-get install -y npm',
      Git: 'apt-get install -y git',
      Nginx: 'apt-get install -y nginx',
      Certbot: 'apt-get install -y certbot python3-certbot-nginx',
      UFW: 'apt-get install -y ufw',
      fail2ban: 'apt-get install -y fail2ban',
    };

    const command = installCommands[name];
    if (!command) {
      logger.warn('No install command for prerequisite', { name });
      return;
    }

    const result = await this.execSudo(command);
    if (result.code !== 0) {
      throw new Error(`Failed to install ${name}: ${result.stderr}`);
    }

    logger.info('Prerequisite installed', { name });
  }

  /**
   * Get Node.js install command based on distro
   */
  private getNodeInstallCommand(): string {
    if (this.distro === LinuxDistribution.UBUNTU || this.distro === LinuxDistribution.DEBIAN || this.distro === LinuxDistribution.RASPBERRY_PI) {
      return 'curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && apt-get install -y nodejs';
    } else if (this.distro === LinuxDistribution.FEDORA || this.distro === LinuxDistribution.CENTOS) {
      return 'curl -fsSL https://rpm.nodesource.com/setup_18.x | bash - && yum install -y nodejs';
    }
    return 'apt-get install -y nodejs npm';
  }

  /**
   * Setup firewall (UFW)
   */
  private async setupFirewall(): Promise<void> {
    logger.info('Setting up firewall');

    // Allow SSH
    await this.execSudo('ufw allow 22/tcp');

    // Allow HTTP and HTTPS
    await this.execSudo('ufw allow 80/tcp');
    await this.execSudo('ufw allow 443/tcp');

    // Allow addon port
    if (this.options.config.addon.port) {
      await this.execSudo(`ufw allow ${this.options.config.addon.port}/tcp`);
    }

    // Enable UFW (with --force to skip confirmation)
    await this.execSudo('ufw --force enable');

    logger.info('Firewall configured');
  }

  /**
   * Setup fail2ban
   */
  private async setupFail2ban(): Promise<void> {
    logger.info('Setting up fail2ban');

    // Create SSH jail configuration
    const jailConfig = `
[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
findtime = 600
`;

    // Write jail configuration
    const jailPath = '/etc/fail2ban/jail.d/sshd.conf';
    // Use temp file approach to avoid permission issues
    const tempJailPath = `/tmp/stremio-addon-fail2ban.${Date.now()}.conf`;
    await this.execCommand(`cat > ${tempJailPath} << 'EOF'\n${jailConfig}\nEOF`);
    await this.execSudo(`mv ${tempJailPath} ${jailPath}`);

    // Restart fail2ban
    await this.execSudo('systemctl restart fail2ban');
    await this.execSudo('systemctl enable fail2ban');

    logger.info('Fail2ban configured');
  }

  /**
   * Copy addon-server from bundled resources
   */
  private async cloneRepository(): Promise<void> {
    const targetDir = this.options.config.paths.addonDirectory;
    
    // Get bundled addon-server path
    const bundledPath = await this.getBundledAddonServerPath();
    if (!bundledPath) {
      throw new Error(
        'Bundled addon-server not found. ' +
        'Make sure you run "npm run build" to bundle the packages before installation. ' +
        'The addon-server package should be in the resources/ directory.'
      );
    }
    
    logger.info('Using bundled addon-server', { bundledPath, targetDir });
    await this.copyBundledAddonServer(bundledPath, targetDir);
  }

  /**
   * Get path to bundled addon-server if available
   * Checks paths in priority order: Electron resources -> CLI resources -> monorepo
   * 
   * Option 2 Structure:
   * - Electron: resources/cli/resources/addon-server (CLI bundled in Electron)
   * - CLI: resources/addon-server (addon-server bundled in CLI)
   * - Monorepo: packages/addon-server (development)
   */
  private async getBundledAddonServerPath(): Promise<string | null> {
    // Detect execution context for better logging
    const executionContext = this.detectExecutionContext();
    logger.debug('Detected execution context for addon-server path resolution', { executionContext });
    
    // Get base paths for resolution
    // Use __dirname (core package location) as reference point for relative paths
    const corePackageDir = __dirname; // This is core/dist/installation/manager.js location
    const coreDistDir = path.dirname(corePackageDir); // core/dist/installation -> core/dist
    const coreRootDir = path.dirname(coreDistDir); // core/dist -> core
    const packagesDir = path.dirname(coreRootDir); // core -> packages
    
    // Define paths in priority order (as specified in Phase 3.1)
    const pathChecks: Array<{ path: string; description: string; context: string }> = [];
    
    // 1. Electron packaged: Check environment variables first (set by Electron main process)
    if (process.env.ELECTRON_RESOURCES_PATH) {
      const resourcesPath = process.env.ELECTRON_RESOURCES_PATH;
      pathChecks.push({
        path: path.join(resourcesPath, 'cli', 'resources', 'addon-server'),
        description: 'Electron packaged (from env, Option 2)',
        context: 'Electron (packaged from env)'
      });
      // Also check legacy location
      pathChecks.push({
        path: path.join(resourcesPath, 'addon-server'),
        description: 'Electron packaged (from env, legacy)',
        context: 'Electron (legacy packaged from env)'
      });
    }
    
    // 2. Electron packaged: process.resourcesPath + '/cli/resources/addon-server'
    if (typeof (process as any).resourcesPath !== 'undefined') {
      const resourcesPath = (process as any).resourcesPath;
      pathChecks.push({
        path: path.join(resourcesPath, 'cli', 'resources', 'addon-server'),
        description: 'Electron packaged (Option 2)',
        context: 'Electron (packaged)'
      });
      // Also check legacy location
      pathChecks.push({
        path: path.join(resourcesPath, 'addon-server'),
        description: 'Electron packaged (legacy)',
        context: 'Electron (legacy packaged)'
      });
    }
    
    // 3. Electron dev: Check from ELECTRON_APP_PATH environment variable
    if (process.env.ELECTRON_APP_PATH) {
      const appPath = process.env.ELECTRON_APP_PATH;
      pathChecks.push({
        path: path.join(appPath, 'resources', 'cli', 'resources', 'addon-server'),
        description: 'Electron dev (from env, Option 2)',
        context: 'Electron (dev from env)'
      });
      pathChecks.push({
        path: path.join(appPath, 'resources', 'addon-server'),
        description: 'Electron dev (from env, legacy)',
        context: 'Electron (dev from env, legacy)'
      });
    }
    
    // 4. Electron dev: Check relative to core package location
    // When core is bundled in Electron, it's at: electron/dist/node_modules/@stremio-addon-manager/core/dist/...
    // So we need to go up to find electron/resources/
    // Try: core -> node_modules -> electron -> resources
    const electronResourcesFromCore = path.join(coreRootDir, '..', '..', 'electron', 'resources', 'cli', 'resources', 'addon-server');
    pathChecks.push({
      path: electronResourcesFromCore,
      description: 'Electron dev (from core, Option 2)',
      context: 'Electron (dev from core)'
    });
    
    // 5. Electron dev: Check from process.cwd() (fallback for different execution contexts)
    pathChecks.push({
      path: path.join(process.cwd(), 'resources', 'cli', 'resources', 'addon-server'),
      description: 'Electron dev (from cwd, Option 2)',
      context: 'Electron (dev from cwd)'
    });
    
    // 4. Electron direct: resources/addon-server (legacy fallback)
    pathChecks.push({
      path: path.join(process.cwd(), 'resources', 'addon-server'),
      description: 'Electron direct (legacy fallback)',
      context: 'Electron (legacy)'
    });
    
    // 5. CLI packaged: resources/addon-server (CLI's own resources)
    // When core is bundled in CLI, it's at: cli/resources/core/dist/...
    // So we need to go up to find cli/resources/addon-server
    const cliResourcesFromCore = path.join(coreRootDir, '..', 'addon-server');
    pathChecks.push({
      path: cliResourcesFromCore,
      description: 'CLI packaged (from core)',
      context: 'CLI (packaged from core)'
    });
    
    // 6. CLI packaged: Check from process.cwd()
    pathChecks.push({
      path: path.join(process.cwd(), 'resources', 'addon-server'),
      description: 'CLI packaged (from cwd)',
      context: 'CLI (packaged from cwd)'
    });
    
    // 7. CLI dev: Check relative to core package (monorepo structure)
    // core -> packages -> cli -> resources -> addon-server
    const cliDevFromCore = path.join(packagesDir, 'cli', 'resources', 'addon-server');
    pathChecks.push({
      path: cliDevFromCore,
      description: 'CLI dev (from core, monorepo)',
      context: 'CLI (dev from core)'
    });
    
    // 8. CLI dev: Check from process.cwd()
    pathChecks.push({
      path: path.join(process.cwd(), '..', 'cli', 'resources', 'addon-server'),
      description: 'CLI dev (from cwd, monorepo)',
      context: 'CLI (dev from cwd)'
    });
    
    // 9. Monorepo: packages/addon-server (development)
    const monorepoAddonServer = path.join(packagesDir, 'addon-server');
    pathChecks.push({
      path: monorepoAddonServer,
      description: 'Monorepo (from core)',
      context: 'Monorepo (from core)'
    });
    pathChecks.push({
      path: path.join(process.cwd(), 'packages', 'addon-server'),
      description: 'Monorepo (from cwd)',
      context: 'Monorepo (from cwd)'
    });
    
    // 10. Additional fallbacks for Electron package in monorepo
    const electronMonorepoPath = path.join(packagesDir, 'electron', 'resources', 'cli', 'resources', 'addon-server');
    pathChecks.push({
      path: electronMonorepoPath,
      description: 'Electron package in monorepo (from core, Option 2)',
      context: 'Electron (monorepo from core)'
    });
    pathChecks.push({
      path: path.join(process.cwd(), 'packages', 'electron', 'resources', 'cli', 'resources', 'addon-server'),
      description: 'Electron package in monorepo (from cwd, Option 2)',
      context: 'Electron (monorepo from cwd)'
    });

    logger.debug('Checking for bundled addon-server', { 
      totalPaths: pathChecks.length,
      executionContext,
      cwd: process.cwd(),
      electronAppPath: process.env.ELECTRON_APP_PATH,
      electronResourcesPath: process.env.ELECTRON_RESOURCES_PATH,
      processResourcesPath: typeof (process as any).resourcesPath !== 'undefined' ? (process as any).resourcesPath : undefined,
      corePackageDir,
      coreRootDir,
      packagesDir
    });
    
    for (const check of pathChecks) {
      try {
        // Resolve to absolute path for better logging
        const absolutePath = path.isAbsolute(check.path) ? check.path : path.resolve(check.path);
        logger.debug(`Checking path: ${check.description}`, { 
          path: check.path,
          absolutePath,
          context: check.context
        });
        const packageJsonPath = path.join(check.path, 'package.json');
        const distPath = path.join(check.path, 'dist');
        
        // Check if both package.json and dist exist
        // Bundled resources are always on local machine, so force local check
        const packageExists = await this.checkPathExists(packageJsonPath, true);
        const distExists = await this.checkPathExists(distPath, true);
        
        if (packageExists && distExists) {
          logger.info('Found bundled addon-server', { 
            path: check.path,
            absolutePath,
            context: check.context,
            description: check.description
          });
          return check.path;
        } else {
          logger.debug(`Path not found: ${check.description}`, { 
            path: check.path,
            absolutePath,
            packageExists,
            distExists
          });
        }
      } catch (error) {
        // Continue checking other paths
        logger.debug(`Path check failed: ${check.description}`, { 
          path: check.path, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    logger.warn('Bundled addon-server not found in any expected location', {
      checkedPaths: pathChecks.length,
      executionContext,
      cwd: process.cwd(),
      electronAppPath: process.env.ELECTRON_APP_PATH,
      electronResourcesPath: process.env.ELECTRON_RESOURCES_PATH
    });
    return null;
  }

  /**
   * Get path to bundled core package if available
   * Similar to getBundledAddonServerPath but for core package
   * 
   * @internal Available for future use when core package needs to be accessed directly
   */
  // @ts-ignore - Intentionally unused, available for future use
  private async _getBundledCorePath(): Promise<string | null> {
    const pathChecks: Array<{ path: string; description: string; context: string }> = [];
    
    // 1. Electron packaged: process.resourcesPath + '/cli/resources/core'
    if (typeof (process as any).resourcesPath !== 'undefined') {
      pathChecks.push({
        path: path.join((process as any).resourcesPath, 'cli', 'resources', 'core'),
        description: 'Electron packaged (Option 2)',
        context: 'Electron (packaged)'
      });
    }
    
    // 2. Electron dev: resources/cli/resources/core
    pathChecks.push({
      path: path.join(process.cwd(), 'resources', 'cli', 'resources', 'core'),
      description: 'Electron dev (Option 2)',
      context: 'Electron (dev)'
    });
    
    // 3. Electron direct: resources/core (fallback)
    pathChecks.push({
      path: path.join(process.cwd(), 'resources', 'core'),
      description: 'Electron direct (legacy fallback)',
      context: 'Electron (legacy)'
    });
    
    // 4. CLI packaged: resources/core
    pathChecks.push({
      path: path.join(process.cwd(), 'resources', 'core'),
      description: 'CLI packaged',
      context: 'CLI (packaged)'
    });
    
    // 5. CLI dev: ../cli/resources/core
    pathChecks.push({
      path: path.join(process.cwd(), '..', 'cli', 'resources', 'core'),
      description: 'CLI dev (monorepo)',
      context: 'CLI (dev)'
    });
    
    // 6. Monorepo: packages/core (development)
    pathChecks.push({
      path: path.join(process.cwd(), 'packages', 'core'),
      description: 'Monorepo (development)',
      context: 'Monorepo'
    });
    pathChecks.push({
      path: path.join(process.cwd(), '..', '..', 'core'),
      description: 'Monorepo (alternative)',
      context: 'Monorepo'
    });
    
    // Additional fallbacks
    pathChecks.push({
      path: path.join(process.cwd(), 'packages', 'electron', 'resources', 'cli', 'resources', 'core'),
      description: 'Electron package in monorepo (Option 2)',
      context: 'Electron (monorepo)'
    });
    
    if (typeof (process as any).resourcesPath !== 'undefined') {
      pathChecks.push({
        path: path.join((process as any).resourcesPath, 'core'),
        description: 'Electron packaged (legacy)',
        context: 'Electron (legacy packaged)'
      });
    }

    logger.debug('Checking for bundled core', { totalPaths: pathChecks.length });
    
    for (const check of pathChecks) {
      try {
        logger.debug(`Checking path: ${check.description}`, { path: check.path });
        const packageJsonPath = path.join(check.path, 'package.json');
        const distPath = path.join(check.path, 'dist');
        
        const packageExists = await this.checkPathExists(packageJsonPath);
        const distExists = await this.checkPathExists(distPath);
        
        if (packageExists && distExists) {
          logger.info('Found bundled core', { 
            path: check.path, 
            context: check.context,
            description: check.description
          });
          return check.path;
        }
      } catch (error) {
        logger.debug(`Path check failed: ${check.description}`, { 
          path: check.path, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    logger.debug('Bundled core not found in any expected location');
    return null;
  }

  /**
   * Get path to bundled CLI package if available
   * Used by Electron to access CLI functionality
   * 
   * @internal Available for future use when CLI package needs to be accessed directly
   */
  // @ts-ignore - Intentionally unused, available for future use
  private async _getBundledCliPath(): Promise<string | null> {
    const pathChecks: Array<{ path: string; description: string; context: string }> = [];
    
    // 1. Electron packaged: process.resourcesPath + '/cli'
    if (typeof (process as any).resourcesPath !== 'undefined') {
      pathChecks.push({
        path: path.join((process as any).resourcesPath, 'cli'),
        description: 'Electron packaged',
        context: 'Electron (packaged)'
      });
    }
    
    // 2. Electron dev: resources/cli
    pathChecks.push({
      path: path.join(process.cwd(), 'resources', 'cli'),
      description: 'Electron dev',
      context: 'Electron (dev)'
    });
    
    // 3. Monorepo: packages/cli (development)
    pathChecks.push({
      path: path.join(process.cwd(), 'packages', 'cli'),
      description: 'Monorepo (development)',
      context: 'Monorepo'
    });
    pathChecks.push({
      path: path.join(process.cwd(), '..', 'cli'),
      description: 'Monorepo (alternative)',
      context: 'Monorepo'
    });
    
    // Additional fallback
    pathChecks.push({
      path: path.join(process.cwd(), 'packages', 'electron', 'resources', 'cli'),
      description: 'Electron package in monorepo',
      context: 'Electron (monorepo)'
    });

    logger.debug('Checking for bundled CLI', { totalPaths: pathChecks.length });
    
    for (const check of pathChecks) {
      try {
        logger.debug(`Checking path: ${check.description}`, { path: check.path });
        const packageJsonPath = path.join(check.path, 'package.json');
        const distPath = path.join(check.path, 'dist');
        
        const packageExists = await this.checkPathExists(packageJsonPath);
        const distExists = await this.checkPathExists(distPath);
        
        if (packageExists && distExists) {
          logger.info('Found bundled CLI', { 
            path: check.path, 
            context: check.context,
            description: check.description
          });
          return check.path;
        }
      } catch (error) {
        logger.debug(`Path check failed: ${check.description}`, { 
          path: check.path, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    logger.debug('Bundled CLI not found in any expected location');
    return null;
  }

  /**
   * Detect execution context (CLI vs Electron vs Monorepo)
   * This helps determine which bundled paths to prioritize
   */
  private detectExecutionContext(): 'electron' | 'cli' | 'monorepo' | 'unknown' {
    // Check if running in Electron (packaged app)
    if (typeof (process as any).resourcesPath !== 'undefined') {
      logger.debug('Detected execution context: Electron (packaged)', {
        resourcesPath: (process as any).resourcesPath
      });
      return 'electron';
    }
    
    const cwd = process.cwd();
    
    // Check if running from CLI package directory
    if (cwd.includes('packages/cli') || cwd.includes('cli/dist') || cwd.includes('cli\\dist')) {
      logger.debug('Detected execution context: CLI', { cwd });
      return 'cli';
    }
    
    // Check if running from Electron package directory
    if (cwd.includes('packages/electron') || cwd.includes('electron/dist') || cwd.includes('electron\\dist')) {
      logger.debug('Detected execution context: Electron (dev)', { cwd });
      return 'electron';
    }
    
    // Check if running from monorepo root
    try {
      const packagesPath = path.join(cwd, 'packages');
      if (fs.existsSync(packagesPath) && fs.statSync(packagesPath).isDirectory()) {
        logger.debug('Detected execution context: Monorepo', { cwd });
        return 'monorepo';
      }
    } catch {
      // Ignore errors when checking
    }
    
    logger.debug('Detected execution context: Unknown', { cwd });
    return 'unknown';
  }

  /**
   * Check if a path exists (works for both local and remote)
   * 
   * @param filePath - Path to check
   * @param forceLocal - If true, always check locally (used for bundled resources)
   */
  private async checkPathExists(filePath: string, forceLocal: boolean = false): Promise<boolean> {
    // Bundled resources are always on the local machine, even when installing remotely
    if (this.ssh && !forceLocal) {
      const result = await this.execCommand(`test -f "${filePath}" || test -d "${filePath}"`);
      return result.code === 0;
    } else {
      const fs = await import('fs');
      return fs.existsSync(filePath);
    }
  }

  /**
   * Copy bundled addon-server to target directory
   */
  private async copyBundledAddonServer(sourcePath: string, targetDir: string): Promise<void> {
    // Get current username for ownership
    const whoamiResult = await this.execCommand('whoami');
    const username = whoamiResult.stdout.trim() || whoamiResult.stderr.trim() || 'root';

    // Remove existing directory if present
    const dirExists = await this.execCommand(`test -d ${targetDir}`);
    if (dirExists.code === 0) {
      logger.info('Removing existing directory', { targetDir });
      const removeResult = await this.execSudo(`rm -rf ${targetDir}`);
      if (removeResult.code !== 0) {
        const fallbackResult = await this.execCommand(`rm -rf ${targetDir}`);
        if (fallbackResult.code !== 0) {
          throw new Error(`Failed to remove existing directory: ${fallbackResult.stderr}`);
        }
      }
    }

    // Copy files
    if (this.ssh) {
      // Remote copy via SSH using NodeSSH's putDirectory
      // IMPORTANT: Copy to a temp directory first (owned by SSH user), then move with sudo
      // This avoids permission issues when target directory is owned by root
      // Use /tmp/ instead of /opt/ for temp directory so SSH user can write to it
      const tempTargetDir = `/tmp/stremio-addon-install.${Date.now()}`;
      logger.info('Copying bundled addon-server via SSH', { sourcePath, tempTargetDir });
      
      // Verify source directory exists and has content
      const fs = await import('fs');
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source directory does not exist: ${sourcePath}`);
      }
      const sourceFiles = fs.readdirSync(sourcePath);
      logger.info('Source directory contents', { sourcePath, fileCount: sourceFiles.length, files: sourceFiles.slice(0, 10) });
      
      try {
        // Create temp directory first (as SSH user, in /tmp/ which is user-writable)
        await this.execCommand(`mkdir -p ${tempTargetDir}`);
        
        // Access the underlying NodeSSH instance to use putDirectory with options
        // This allows us to exclude node_modules and get better error handling
        const sshInstance = (this.ssh as any).ssh; // Access private ssh property from SSHManager
        if (sshInstance && typeof sshInstance.putDirectory === 'function') {
          let filesTransferred = 0;
          let transferErrors: string[] = [];
          
          logger.info('Starting putDirectory transfer', { sourcePath, tempTargetDir });
          await sshInstance.putDirectory(sourcePath, tempTargetDir, {
            recursive: true,
            concurrency: 5,
            validate: (itemPath: string) => {
              // Skip node_modules directory (will be installed via npm install on remote)
              const relativePath = path.relative(sourcePath, itemPath);
              const shouldInclude = !relativePath.includes('node_modules');
              if (!shouldInclude) {
                logger.debug('Skipping node_modules item', { itemPath, relativePath });
              }
              return shouldInclude;
            },
            tick: (localPath: string, remotePath: string, error?: Error) => {
              if (error) {
                transferErrors.push(`${localPath} -> ${remotePath}: ${error.message}`);
                logger.debug('File transfer error', { localPath, remotePath, error: error.message });
              } else {
                filesTransferred++;
              }
            },
          });
          
          logger.info('putDirectory completed', { filesTransferred, errors: transferErrors.length });
          
          if (transferErrors.length > 0) {
            logger.warn('Some files failed to transfer', { errors: transferErrors.slice(0, 5) });
          }
          
          // Verify temp directory has content
          logger.info('Verifying temp directory contents', { tempTargetDir });
          const listResult = await this.execCommand(`ls -la ${tempTargetDir}`);
          const fileCountResult = await this.execCommand(`find ${tempTargetDir} -type f | wc -l`);
          const dirCountResult = await this.execCommand(`find ${tempTargetDir} -type d | wc -l`);
          
          logger.debug('Temp directory verification', {
            tempTargetDir,
            listing: listResult.stdout,
            fileCount: fileCountResult.stdout.trim(),
            dirCount: dirCountResult.stdout.trim()
          });
          
          const fileCount = parseInt(fileCountResult.stdout.trim()) || 0;
          if (fileCount === 0) {
            throw new Error(`Temp directory is empty after copy. putDirectory reported success but no files were transferred. Listing: ${listResult.stdout}`);
          }
          
          logger.info('Successfully copied bundled addon-server to temp directory via SSH', {
            filesTransferred,
            fileCount,
            dirCount: dirCountResult.stdout.trim()
          });
          
          // Create final target directory with sudo
          logger.info('Creating target directory', { targetDir });
          const mkdirResult = await this.execSudo(`mkdir -p ${targetDir}`);
          if (mkdirResult.code !== 0) {
            throw new Error(`Failed to create target directory: ${mkdirResult.stderr}`);
          }
          
          // Move temp directory to final location with sudo
          logger.info('Moving temp directory to final location', { tempTargetDir, targetDir });
          
          // Remove target directory if it exists (should be empty at this point)
          await this.execSudo(`rm -rf ${targetDir}`);
          
          // Move entire temp directory to target location
          const moveResult = await this.execSudo(`mv ${tempTargetDir} ${targetDir}`);
          if (moveResult.code !== 0) {
            // Fallback: copy contents recursively
            logger.warn('Direct move failed, trying copy approach', { error: moveResult.stderr });
            await this.execSudo(`mkdir -p ${targetDir}`);
            const copyResult = await this.execSudo(`cp -r ${tempTargetDir}/. ${targetDir}/ && rm -rf ${tempTargetDir}`);
            if (copyResult.code !== 0) {
              throw new Error(`Failed to move files to target directory: ${copyResult.stderr}`);
            }
          }
          logger.info('Successfully moved bundled addon-server to target directory');
        } else {
          // Fallback: use transferDirectory method (simpler but less control)
          logger.warn('putDirectory not available, using transferDirectory fallback');
          // Create temp directory for transfer
          await this.execCommand(`mkdir -p ${tempTargetDir}`);
          await (this.ssh as any).transferDirectory(sourcePath, tempTargetDir);
          // Create final directory and move
          await this.execSudo(`rm -rf ${targetDir}`);
          await this.execSudo(`mv ${tempTargetDir} ${targetDir}`);
          logger.info('Successfully copied bundled addon-server via SSH (using transferDirectory)');
        }
      } catch (error) {
        // Clean up temp directory on error
        await this.execCommand(`rm -rf ${tempTargetDir}`).catch(() => {});
        logger.error('Failed to copy bundled addon-server via SSH', { 
          error: (error as Error).message,
          sourcePath,
          targetDir
        });
        throw new Error(`Failed to copy bundled addon-server: ${(error as Error).message}`);
      }
    } else {
      // Local copy
      // Create target directory first
      logger.info('Creating target directory', { targetDir });
      const fs = await import('fs');
      fs.mkdirSync(targetDir, { recursive: true });
      // Local copy
      logger.info('Copying bundled addon-server locally', { sourcePath, targetDir });
      
      // Copy directory recursively, excluding node_modules
      const copyRecursive = (src: string, dest: string) => {
        const entries = fs.readdirSync(src, { withFileTypes: true });
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of entries) {
          // Skip node_modules (will be installed via npm install)
          if (entry.name === 'node_modules') continue;
          
          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);
          if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      };
      
      copyRecursive(sourcePath, targetDir);
    }

    // Fix ownership and permissions after copying
    // The directory was created with sudo (root), but files were copied as SSH user
    // We need to change ownership so the user can access files and npm can install dependencies
    logger.info('Fixing ownership and permissions', { targetDir, username });
    const chownResult = await this.execSudo(`chown -R ${username}:${username} ${targetDir}`);
    if (chownResult.code !== 0) {
      logger.warn('Failed to change ownership, continuing anyway', { error: chownResult.stderr });
    }
    // Ensure directory permissions are correct
    const chmodResult = await this.execSudo(`chmod -R u+rwX,go+rX ${targetDir}`);
    if (chmodResult.code !== 0) {
      logger.warn('Failed to set permissions, continuing anyway', { error: chmodResult.stderr });
    }

    // Create server.js in root (service file expects it)
    // Always recreate server.js to ensure it's correct (in case of updates or corruption)
    // Use posix.join for remote paths (Unix), regular join for local paths
    const serverJsPath = this.ssh ? path.posix.join(targetDir, 'server.js') : path.join(targetDir, 'server.js');
    // Create server.js that imports from bin/server.js
    const serverJsContent = `#!/usr/bin/env node

/**
 * Stremio Addon Server Entry Point
 * This file is created during installation from bundled addon-server
 */

import "./bin/server.js";
`;
    
    if (this.ssh) {
      // Write via SSH using sudo - create temp file first, then move with sudo
      const tempPath = `/tmp/server.js.${Date.now()}`;
      const echoResult = await this.execCommand(
        `cat > "${tempPath}" << 'EOFMARKER'\n${serverJsContent}EOFMARKER`
      );
      if (echoResult.code !== 0) {
        throw new Error(`Failed to create temporary server.js: ${echoResult.stderr}`);
      }
      
      // Move temp file to target location with sudo and set permissions
      const moveResult = await this.execSudo(`mv "${tempPath}" "${targetDir}/server.js" && chmod +x "${targetDir}/server.js" && chown ${username}:${username} "${targetDir}/server.js"`);
      if (moveResult.code !== 0) {
        // Clean up temp file
        await this.execCommand(`rm -f "${tempPath}"`);
        throw new Error(`Failed to move server.js to target location: ${moveResult.stderr}`);
      }
      logger.info('Successfully created/updated server.js', { path: serverJsPath });
    } else {
      // Local write
      const fs = await import('fs');
      fs.writeFileSync(serverJsPath, serverJsContent);
      fs.chmodSync(serverJsPath, 0o755); // Make executable
      logger.info('Successfully created/updated server.js', { path: serverJsPath });
    }

    // Verify server.js exists and is executable
    const verifyResult = await this.execCommand(`test -f "${serverJsPath}" && test -x "${serverJsPath}" && echo "OK" || echo "MISSING_OR_NOT_EXECUTABLE"`);
    if (verifyResult.stdout.includes('MISSING_OR_NOT_EXECUTABLE')) {
      throw new Error(`server.js verification failed: ${verifyResult.stdout}`);
    }
    logger.info('server.js verified', { path: serverJsPath, executable: true });

    // Verify landing.html was copied (if it exists in source)
    if (this.ssh) {
      const landingHtmlPath = path.posix.join(targetDir, 'landing.html');
      const landingExists = await this.checkPathExists(landingHtmlPath, false);
      if (landingExists) {
        logger.info('landing.html found in installed directory', { path: landingHtmlPath });
      } else {
        logger.warn('landing.html not found in installed directory - landing page may not work', { 
          path: landingHtmlPath,
          expectedAt: 'package root'
        });
      }
    }

    logger.info('Bundled addon-server copied successfully', { targetDir });
  }

  /**
   * Install dependencies
   */
  private async installDependencies(): Promise<void> {
    logger.info('Installing dependencies');

    const targetDir = this.options.config.paths.addonDirectory;
    
    // Verify package.json exists before attempting npm install
    // Use posix.join for remote paths (Unix), regular join for local paths
    const packageJsonPath = this.ssh ? path.posix.join(targetDir, 'package.json') : path.join(targetDir, 'package.json');
    const packageJsonExists = await this.checkPathExists(packageJsonPath, !this.ssh);
    if (!packageJsonExists) {
      // List directory contents for debugging
      const lsResult = await this.execCommand(`ls -la ${targetDir}`);
      logger.error('package.json not found', { 
        targetDir, 
        packageJsonPath,
        directoryContents: lsResult.stdout || lsResult.stderr
      });
      throw new Error(`package.json not found at ${packageJsonPath}. Files may not have been copied correctly. Directory contents: ${lsResult.stdout || lsResult.stderr}`);
    }
    
    logger.info('package.json found, proceeding with npm install', { targetDir });
    const result = await this.execCommand(`cd ${targetDir} && npm install --production`);

    if (result.code !== 0) {
      throw new Error(`Failed to install dependencies: ${result.stderr}`);
    }

    logger.info('Dependencies installed');
  }

  /**
   * Setup Nginx reverse proxy
   * Proxies all requests to the backend addon server on port 7000
   * - Root path (/) serves the landing page HTML
   * - Stats endpoint (/stats) serves stats JSON
   * - Manifest endpoint (/:password/manifest.json) serves Stremio manifest
   * - Stream endpoint (/:password/stream/*) serves stream data
   * 
   * Note: When SSL is enabled:
   * - If an existing certificate is found, configures SSL directly
   * - Otherwise, certbot will be called in setupSSL() to:
   *   - Replace the HTTP server block (port 80) with a redirect to HTTPS
   *   - Create/modify the HTTPS server block (port 443) and preserve these location blocks
   */
  private async setupNginx(): Promise<void> {
    logger.info('Setting up Nginx');

    const domain = this.options.config.addon.domain;
    const port = this.options.config.addon.port || 7000;
    
    // Check if SSL is enabled and if a certificate already exists
    let existingCert: CertificateInfo | null = null;
    if (this.options.config.features.ssl) {
      existingCert = await this.checkExistingCertificate(domain);
      if (existingCert && existingCert.isValid) {
        logger.info('Found existing SSL certificate, configuring Nginx with SSL from the start', {
          domain,
          certificatePath: existingCert.certificatePath,
        });
        // Configure Nginx with SSL using existing certificate
        await this.configureNginxWithExistingCertificate(
          domain,
          port,
          existingCert.certificatePath,
          existingCert.privateKeyPath,
          this.options.config.paths.nginxConfig,
          this.getServiceName()
        );
        
        // Test and reload Nginx
        const testResult = await this.execSudo('nginx -t');
        if (testResult.code !== 0) {
          throw new Error(`Nginx configuration test failed: ${testResult.stderr}`);
        }
        await this.execSudo('systemctl reload nginx');
        logger.info('Nginx configured with existing SSL certificate');
        return; // SSL is already configured, skip HTTP-only config
      }
    }

    const nginxConfig = `
server {
    listen 80;
    server_name ${domain};

    # Let's Encrypt ACME challenge - must come BEFORE catch-all location
    # This allows certbot to verify domain ownership even when backend isn't running
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }

    # Root path - proxy to backend landing page
    location = / {
        proxy_pass http://localhost:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Error handling for backend connection failures
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }

    # Stats endpoint - proxy to backend stats API
    location = /stats {
        proxy_pass http://localhost:${port}/stats;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Error handling for backend connection failures
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }

    # Stremio addon manifest endpoint
    # Matches: /:password/manifest.json
    location ~ ^/([^/]+)/manifest\\.json$ {
        # Handle OPTIONS preflight requests FIRST (before proxy_pass)
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin * always;
            add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
            add_header Access-Control-Max-Age 86400 always;
            add_header Content-Length 0;
            add_header Content-Type text/plain;
            return 204;
        }
        
        # Proxy actual GET requests to backend
        proxy_pass http://localhost:${port}/$1/manifest.json;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Error handling for backend connection failures
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
        
        # CORS headers for actual response (backend also sets these, but ensure they're present)
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    }

    # Stremio stream endpoint
    # Matches: /:password/stream/:type/:id.json
    location ~ ^/([^/]+)/stream/(.+)$ {
        # Handle OPTIONS preflight requests FIRST (before proxy_pass)
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin * always;
            add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
            add_header Access-Control-Max-Age 86400 always;
            add_header Content-Length 0;
            add_header Content-Type text/plain;
            return 204;
        }
        
        # Proxy actual GET requests to backend
        proxy_pass http://localhost:${port}/$1/stream/$2;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Timeout settings for long-running stream requests
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        proxy_send_timeout 300s;
        
        # CORS headers for actual response (backend also sets these, but ensure they're present)
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    }

    # Catch-all: proxy all other paths to backend
    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Error handling for backend connection failures
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }
}
`;

    // Write Nginx config
    const configPath = this.options.config.paths.nginxConfig;
    // Use temp file approach to avoid permission issues
    const tempConfigPath = `/tmp/stremio-addon-nginx.${Date.now()}.conf`;
    await this.execCommand(`cat > ${tempConfigPath} << 'EOF'\n${nginxConfig}\nEOF`);
    await this.execSudo(`mv ${tempConfigPath} ${configPath}`);

    // Create symbolic link with addon-specific name
    const serviceName = this.getServiceName();
    const symlinkName = serviceName; // Use service name for nginx symlink
    await this.execSudo(`ln -sf ${configPath} /etc/nginx/sites-enabled/${symlinkName}`);

    // Test Nginx configuration
    const testResult = await this.execSudo('nginx -t');
    if (testResult.code !== 0) {
      throw new Error(`Nginx configuration test failed: ${testResult.stderr}`);
    }

    // Reload Nginx
    await this.execSudo('systemctl reload nginx');

    logger.info('Nginx configured');
  }

  /**
   * Check if a valid SSL certificate already exists for the domain
   */
  private async checkExistingCertificate(domain: string): Promise<CertificateInfo | null> {
    logger.info('Checking for existing SSL certificate', { domain });

    try {
      // First, check if certificate files exist directly in /etc/letsencrypt/live/
      // This is more reliable than parsing certbot output, especially if certbot database is missing
      const certDir = `/etc/letsencrypt/live/${domain}`;
      const certPath = `${certDir}/fullchain.pem`;
      const keyPath = `${certDir}/privkey.pem`;
      
      logger.debug('Checking for certificate files directly', { certDir, certPath, keyPath });
      
      const certFileExists = await this.execCommand(`test -f "${certPath}" && echo "EXISTS" || echo "MISSING"`);
      const keyFileExists = await this.execCommand(`test -f "${keyPath}" && echo "EXISTS" || echo "MISSING"`);
      
      if (!certFileExists.stdout.includes('MISSING') && !keyFileExists.stdout.includes('MISSING')) {
        logger.info('Found certificate files directly in filesystem', { certPath, keyPath });
        
        // Verify certificate is valid by checking expiry date using openssl
        const certInfoResult = await this.execCommand(`openssl x509 -in "${certPath}" -noout -dates -subject 2>&1`);
        
        if (certInfoResult.code === 0) {
          // Parse expiry date from openssl output
          // Format: notAfter=Jan 21 12:00:00 2026 GMT
          const notAfterMatch = certInfoResult.stdout.match(/notAfter=([^\n]+)/i);
          if (notAfterMatch) {
            const expiryDateStr = notAfterMatch[1].trim();
            const expiryDate = new Date(expiryDateStr);
            
            if (!isNaN(expiryDate.getTime())) {
              const now = new Date();
              const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              const isValid = daysUntilExpiry > 30;
              
              if (isValid) {
                logger.info('Found valid existing certificate via filesystem check', {
                  domain,
                  certPath,
                  keyPath,
                  expiryDate: expiryDate.toISOString(),
                  daysUntilExpiry,
                });
                
                return {
                  domain,
                  expiryDate,
                  certificatePath: certPath,
                  privateKeyPath: keyPath,
                  isValid: true,
                  daysUntilExpiry,
                };
              } else {
                logger.info('Certificate files exist but are expired or expiring soon', {
                  domain,
                  expiryDate: expiryDate.toISOString(),
                  daysUntilExpiry,
                });
              }
            }
          }
        }
      }
      
      // Fallback: Try certbot certificates command to list all certificates
      logger.debug('Certificate files not found, checking certbot database', { domain });
      const result = await this.execSudo('certbot certificates 2>&1');
      
      if (result.code !== 0) {
        // Certbot might not be installed or accessible
        logger.warn('Could not check for existing certificates (certbot may not be installed or accessible)', {
          exitCode: result.code,
          stderr: result.stderr,
          stdout: result.stdout,
        });
        return null;
      }

      const output = result.stdout + result.stderr;
      
      // Log the full certbot output for debugging
      logger.debug('Certbot certificates output', { 
        domain,
        outputLength: output.length,
        outputPreview: output.substring(0, 500),
      });
      
      // Parse certbot certificates output
      // Certbot can store certificates with the domain as the certificate name
      // Try multiple patterns to find the certificate
      const domainEscaped = domain.replace(/\./g, '\\.');
      
      // Pattern 1: Certificate Name matches domain exactly
      let domainRegex = new RegExp(`Certificate Name:\\s*${domainEscaped}`, 'i');
      let domainMatch = output.match(domainRegex);
      
      // Pattern 2: Domain appears in the Domains list (certificate might have a different name)
      if (!domainMatch) {
        logger.debug('Certificate name does not match domain, checking domains list', { domain });
        // Look for any certificate that includes this domain in its domains list
        const domainsPattern = new RegExp(`Domains:\\s*([^\\n]+)`, 'gi');
        let match;
        while ((match = domainsPattern.exec(output)) !== null) {
          const domainsList = match[1].trim().split(/\s+/);
          if (domainsList.includes(domain)) {
            // Found a certificate that covers this domain, now find its certificate name
            const beforeMatch = output.substring(0, match.index);
            const certNameMatch = beforeMatch.match(/Certificate Name:\s*([^\n]+)/gi);
            if (certNameMatch && certNameMatch.length > 0) {
              // Get the last certificate name before this domains line (most recent)
              const lastCertName = certNameMatch[certNameMatch.length - 1];
              domainMatch = [lastCertName];
              logger.info('Found certificate covering domain in domains list', { 
                domain,
                certificateName: lastCertName,
              });
              break;
            }
          }
        }
      }
      
      if (!domainMatch) {
        logger.info('No existing certificate found for domain', { domain });
        return null;
      }

      // Extract certificate information from the output
      // Find the certificate block starting from the match
      const certStartIndex = output.indexOf(domainMatch[0]);
      const certBlock = output.substring(certStartIndex);
      
      // Extract domains covered by this certificate
      const domainsMatch = certBlock.match(/Domains:\s*([^\n]+)/i);
      if (!domainsMatch) {
        logger.warn('Found certificate entry but could not parse domains', { domain });
        return null;
      }
      
      const domains = domainsMatch[1].trim().split(/\s+/);
      if (!domains.includes(domain)) {
        logger.info('Certificate exists but does not cover this domain', { domain, certificateDomains: domains });
        return null;
      }

      // Extract expiry date
      const expiryMatch = certBlock.match(/Expiry Date:\s*([^\n(]+)\s*\(([^)]+)\)/i);
      if (!expiryMatch) {
        logger.warn('Found certificate but could not parse expiry date', { domain });
        return null;
      }

      const expiryDateStr = expiryMatch[1].trim();
      const validityStatus = expiryMatch[2].trim();
      
      // Parse expiry date (format: YYYY-MM-DD HH:MM:SS+00:00)
      const expiryDate = new Date(expiryDateStr);
      if (isNaN(expiryDate.getTime())) {
        logger.warn('Found certificate but could not parse expiry date format', { domain, expiryDateStr });
        return null;
      }

      // Check if certificate is valid (not expired and has sufficient time remaining)
      const now = new Date();
      const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const isValid = validityStatus.toLowerCase().includes('valid') && daysUntilExpiry > 30;

      if (!isValid) {
        logger.info('Certificate exists but is expired or expiring soon', {
          domain,
          expiryDate: expiryDate.toISOString(),
          daysUntilExpiry,
          validityStatus,
        });
        return null;
      }

      // Extract certificate paths
      const certPathMatch = certBlock.match(/Certificate Path:\s*([^\n]+)/i);
      const keyPathMatch = certBlock.match(/Private Key Path:\s*([^\n]+)/i);

      if (!certPathMatch || !keyPathMatch) {
        logger.warn('Found certificate but could not parse file paths', { domain });
        return null;
      }

      const certificatePath = certPathMatch[1].trim();
      const privateKeyPath = keyPathMatch[1].trim();

      // Verify certificate files exist
      const certExists = await this.execCommand(`test -f "${certificatePath}" && echo "EXISTS" || echo "MISSING"`);
      const keyExists = await this.execCommand(`test -f "${privateKeyPath}" && echo "EXISTS" || echo "MISSING"`);

      if (certExists.stdout.includes('MISSING') || keyExists.stdout.includes('MISSING')) {
        logger.warn('Certificate files are missing', {
          domain,
          certificatePath,
          privateKeyPath,
          certExists: !certExists.stdout.includes('MISSING'),
          keyExists: !keyExists.stdout.includes('MISSING'),
        });
        return null;
      }

      logger.info('Found valid existing certificate', {
        domain,
        expiryDate: expiryDate.toISOString(),
        daysUntilExpiry,
        certificatePath,
        privateKeyPath,
      });

      return {
        domain,
        expiryDate,
        certificatePath,
        privateKeyPath,
        isValid: true,
        daysUntilExpiry,
      };
    } catch (error) {
      logger.warn('Error checking for existing certificate', {
        domain,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Verify and configure Nginx to use the SSL certificate
   */
  private async verifyNginxSSLConfig(domain: string, certificatePath: string, privateKeyPath: string): Promise<void> {
    logger.info('Verifying and configuring Nginx SSL configuration', { domain, certificatePath, privateKeyPath });

    try {
      const port = this.options.config.addon.port || 7000;
      const serviceName = this.getServiceName();
      const nginxConfigPath = this.options.config.paths.nginxConfig;
      
      // Check if Nginx config exists
      const configExists = await this.execCommand(`test -f "${nginxConfigPath}" && echo "EXISTS" || echo "MISSING"`);
      
      if (configExists.stdout.includes('MISSING')) {
        logger.warn('Nginx config file not found, will need to configure SSL', {
          domain,
          nginxConfigPath,
        });
        // Config will be created by setupNginx, but we need to add SSL to it
        await this.configureNginxWithExistingCertificate(domain, port, certificatePath, privateKeyPath, nginxConfigPath, serviceName);
        return;
      }

      // Read current config
      const configContentResult = await this.execCommand(`cat "${nginxConfigPath}"`);
      const configContent = configContentResult.stdout;
      
      // Check if SSL is already configured
      const hasSSLBlock = configContent.includes('listen 443') || configContent.includes('ssl_certificate');
      const hasCertPath = configContent.includes(certificatePath);
      const hasKeyPath = configContent.includes(privateKeyPath);

      if (!hasSSLBlock || !hasCertPath || !hasKeyPath) {
        logger.info('Nginx config exists but SSL is not properly configured, updating configuration', {
          domain,
          hasSSLBlock,
          hasCertPath,
          hasKeyPath,
        });
        
        // Configure Nginx to use the existing certificate
        await this.configureNginxWithExistingCertificate(domain, port, certificatePath, privateKeyPath, nginxConfigPath, serviceName);
      } else {
        logger.info('Nginx configuration already uses the SSL certificate', { domain });
      }

      // Test Nginx configuration
      const nginxTest = await this.execSudo('nginx -t 2>&1');
      if (nginxTest.code !== 0) {
        throw new Error(`Nginx configuration test failed: ${nginxTest.stdout} ${nginxTest.stderr}`);
      }

      // Reload Nginx to apply changes
      await this.execSudo('systemctl reload nginx');
      logger.info('Nginx configured and reloaded with SSL certificate', { domain });
    } catch (error) {
      logger.error('Error configuring Nginx SSL', {
        domain,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error; // Fail if we can't configure SSL properly
    }
  }

  /**
   * Configure Nginx to use an existing SSL certificate
   */
  private async configureNginxWithExistingCertificate(
    domain: string,
    port: number,
    certificatePath: string,
    privateKeyPath: string,
    nginxConfigPath: string,
    serviceName: string
  ): Promise<void> {
    logger.info('Configuring Nginx to use existing SSL certificate', {
      domain,
      certificatePath,
      privateKeyPath,
    });

    // Read existing config if it exists
    let existingConfig = '';
    const configExists = await this.execCommand(`test -f "${nginxConfigPath}" && echo "EXISTS" || echo "MISSING"`);
    if (configExists.stdout.includes('EXISTS')) {
      const configContentResult = await this.execCommand(`cat "${nginxConfigPath}"`);
      existingConfig = configContentResult.stdout;
    }

    // Check if config already has SSL configured
    if (existingConfig.includes('listen 443') && existingConfig.includes(certificatePath)) {
      logger.info('Nginx config already has SSL configured with this certificate', { domain });
      return;
    }

    // Build complete Nginx config with SSL
    const nginxConfig = `
# HTTP server - redirect to HTTPS
server {
    listen 80;
    server_name ${domain};

    # Let's Encrypt ACME challenge - must come BEFORE catch-all location
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }

    # Redirect all HTTP traffic to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS server with SSL certificate
server {
    listen 443 ssl http2;
    server_name ${domain};

    # SSL certificate configuration
    ssl_certificate ${certificatePath};
    ssl_certificate_key ${privateKeyPath};
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Root path - proxy to backend landing page
    location = / {
        proxy_pass http://localhost:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Error handling for backend connection failures
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }

    # Stats endpoint - proxy to backend stats API
    location = /stats {
        proxy_pass http://localhost:${port}/stats;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Error handling for backend connection failures
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }

    # Stremio addon manifest endpoint
    # Matches: /:password/manifest.json
    location ~ ^/([^/]+)/manifest\\.json$ {
        # Handle OPTIONS preflight requests FIRST (before proxy_pass)
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin * always;
            add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
            add_header Access-Control-Max-Age 86400 always;
            add_header Content-Length 0;
            add_header Content-Type text/plain;
            return 204;
        }
        
        # Proxy actual GET requests to backend
        proxy_pass http://localhost:${port}/$1/manifest.json;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Error handling for backend connection failures
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
        
        # CORS headers for actual response (backend also sets these, but ensure they're present)
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    }

    # Stremio stream endpoint
    # Matches: /:password/stream/:type/:id.json
    location ~ ^/([^/]+)/stream/(.+)$ {
        # Handle OPTIONS preflight requests FIRST (before proxy_pass)
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin * always;
            add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
            add_header Access-Control-Max-Age 86400 always;
            add_header Content-Length 0;
            add_header Content-Type text/plain;
            return 204;
        }
        
        # Proxy actual GET requests to backend
        proxy_pass http://localhost:${port}/$1/stream/$2;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Timeout settings for long-running stream requests
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        proxy_send_timeout 300s;
        
        # CORS headers for actual response (backend also sets these, but ensure they're present)
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    }

    # Catch-all: proxy all other paths to backend
    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Error handling for backend connection failures
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }
}
`;

    // Write Nginx config using temp file approach
    const tempConfigPath = `/tmp/stremio-addon-nginx-ssl.${Date.now()}.conf`;
    await this.execCommand(`cat > ${tempConfigPath} << 'EOF'\n${nginxConfig}\nEOF`);
    await this.execSudo(`mv ${tempConfigPath} ${nginxConfigPath}`);

    // Create/update symbolic link
    await this.execSudo(`ln -sf ${nginxConfigPath} /etc/nginx/sites-enabled/${serviceName}`);

    logger.info('Nginx configuration updated with SSL certificate', { domain, nginxConfigPath });
  }

  /**
   * Setup SSL with Let's Encrypt
   */
  private async setupSSL(): Promise<void> {
    logger.info('Setting up SSL with Let\'s Encrypt');

    const domain = this.options.config.addon.domain;
    const sslEmail = this.options.config.features.sslEmail;

    if (!sslEmail) {
      throw new Error('SSL email address is required for Let\'s Encrypt certificate registration. Please provide an email address in the features configuration.');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sslEmail)) {
      throw new Error(`Invalid email address format: ${sslEmail}`);
    }

    logger.info('Using SSL email for certificate registration', { email: sslEmail });

    // Check if a valid certificate already exists
    const existingCert = await this.checkExistingCertificate(domain);
    
    if (existingCert && existingCert.isValid) {
      logger.info('Found existing valid SSL certificate, reusing it', {
        domain,
        expiryDate: existingCert.expiryDate.toISOString(),
        daysUntilExpiry: existingCert.daysUntilExpiry,
        certificatePath: existingCert.certificatePath,
      });

      // Verify Nginx is configured to use this certificate
      await this.verifyNginxSSLConfig(domain, existingCert.certificatePath, existingCert.privateKeyPath);
      
      logger.info('SSL certificate setup complete (using existing certificate)', { domain });
      return;
    }

    if (existingCert && !existingCert.isValid) {
      logger.info('Existing certificate found but is expired or expiring soon, creating new certificate', {
        domain,
        expiryDate: existingCert.expiryDate.toISOString(),
        daysUntilExpiry: existingCert.daysUntilExpiry,
      });
    }

    // Ensure webroot directory exists for ACME challenges (certbot --nginx uses this)
    // This is needed even though certbot --nginx modifies nginx config automatically
    const webrootDir = '/var/www/html';
    const mkdirResult = await this.execSudo(`mkdir -p ${webrootDir}`);
    if (mkdirResult.code !== 0) {
      logger.warn('Failed to create webroot directory, continuing anyway', { 
        error: mkdirResult.stderr 
      });
    }

    // Verify Nginx is running and accessible
    const nginxStatus = await this.execCommand('systemctl is-active nginx');
    if (nginxStatus.stdout.trim() !== 'active') {
      throw new Error('Nginx is not running. Please start Nginx before SSL setup.');
    }

    // Verify domain is accessible (basic check)
    logger.info('Verifying domain accessibility for SSL setup', { domain });
    
    // Pre-check DNS resolution to catch DNS issues early
    logger.info('Checking DNS resolution for domain', { domain });
    
    // Try dig first, then nslookup as fallback
    let dnsCheck = await this.execCommand(`command -v dig >/dev/null 2>&1 && dig ${domain} +short 2>&1`);
    
    if (dnsCheck.code !== 0 || !dnsCheck.stdout.trim()) {
      // dig failed or not installed, try nslookup
      logger.info('dig command not available or failed, trying nslookup');
      dnsCheck = await this.execCommand(`nslookup ${domain} 2>&1`);
      
      if (dnsCheck.code === 0 && dnsCheck.stdout) {
        // Parse nslookup output
        const addressMatch = dnsCheck.stdout.match(/Address:\s*(\d+\.\d+\.\d+\.\d+)/g);
        if (addressMatch && addressMatch.length > 0) {
          // Extract IPs (skip the first one which is usually the DNS server)
          const ips = addressMatch.slice(1).map(m => m.replace('Address:', '').trim());
          logger.info('DNS resolution check passed (nslookup)', {
            domain,
            resolvedIPs: ips,
          });
        } else {
          logger.warn('DNS resolution check: domain found but no IP addresses', {
            domain,
            nslookupOutput: dnsCheck.stdout,
          });
        }
      } else {
        logger.warn('DNS resolution check failed with both dig and nslookup', {
          domain,
          nslookupOutput: dnsCheck.stdout,
          nslookupStderr: dnsCheck.stderr,
        });
        // Don't fail here - certbot will provide better error messages
      }
    } else {
      // dig succeeded
      const resolvedIPs = dnsCheck.stdout.trim().split('\n').filter(line => line.trim());
      logger.info('DNS resolution check passed (dig)', {
        domain,
        resolvedIPs: resolvedIPs.length > 0 ? resolvedIPs : ['No IPs found'],
      });
    }

    // Run certbot with better error handling
    logger.info('Running certbot to obtain SSL certificate', { domain, email: sslEmail });
    const result = await this.execSudo(
      `certbot --nginx -d ${domain} --non-interactive --agree-tos --email ${sslEmail} --redirect`
    );

    if (result.code !== 0) {
      // Get more detailed error information
      const certbotLog = await this.execCommand('sudo tail -100 /var/log/letsencrypt/letsencrypt.log 2>/dev/null || echo "Log file not accessible"');
      const nginxTest = await this.execSudo('nginx -t 2>&1');
      
      logger.error('SSL setup failed', {
        exitCode: result.code,
        stderr: result.stderr,
        stdout: result.stdout,
        nginxConfigTest: nginxTest.stdout + nginxTest.stderr,
        certbotLog: certbotLog.stdout,
      });

      // Provide helpful error message
      let errorMessage = `SSL setup failed: ${result.stderr || result.stdout}`;
      
      // Check for DNS/CAA errors
      if (result.stderr.includes('CAA') || result.stdout.includes('CAA') ||
          result.stderr.includes('DNS problem') || result.stdout.includes('DNS problem') ||
          result.stderr.includes('query timed out') || result.stdout.includes('query timed out') ||
          result.stderr.includes('caa') || result.stdout.includes('caa')) {
        errorMessage += '\n\n⚠️  DNS/CAA Record Error:';
        errorMessage += '\nLet\'s Encrypt could not verify DNS records for your domain.';
        errorMessage += '\n\nPossible causes:';
        errorMessage += '\n1. DNS server timeout or connectivity issues';
        errorMessage += '\n2. DNS propagation delay (new domain/subdomain)';
        errorMessage += '\n3. Firewall blocking DNS queries from Let\'s Encrypt servers';
        errorMessage += '\n4. DNS provider issues';
        errorMessage += '\n\nTroubleshooting steps:';
        errorMessage += '\n1. Verify DNS resolution:';
        errorMessage += `\n   dig ${domain} +short`;
        errorMessage += `\n   nslookup ${domain}`;
        errorMessage += '\n2. Check CAA records:';
        errorMessage += `\n   dig ${domain} CAA +short`;
        errorMessage += '\n3. Verify domain points to this server:';
        errorMessage += '\n   curl -I http://' + domain;
        errorMessage += '\n4. Wait a few minutes and retry (DNS propagation)';
        errorMessage += '\n5. Check DNS provider status page';
        errorMessage += '\n\nIf DNS is working but CAA lookup fails, try:';
        errorMessage += '\n- Wait 5-10 minutes and retry (DNS propagation delay)';
        errorMessage += '\n- Check if your DNS provider has CAA record restrictions';
        errorMessage += '\n- Verify your DNS provider allows Let\'s Encrypt certificates';
        errorMessage += '\n- Try using DNS validation instead of HTTP validation (requires DNS API access)';
        errorMessage += '\n\nNote: This error often occurs when:';
        errorMessage += '\n- The domain was recently created or DNS was recently changed';
        errorMessage += '\n- Your DNS provider\'s CAA lookup servers are slow or unreachable';
        errorMessage += '\n- There are network connectivity issues between Let\'s Encrypt and DNS servers';
        errorMessage += '\n\nRetry after waiting 10-15 minutes for DNS propagation.';
      }
      // Check for rate limit errors
      else if (result.stderr.includes('too many certificates') || result.stdout.includes('too many certificates') ||
          result.stderr.includes('rateLimited') || result.stdout.includes('rateLimited')) {
        errorMessage += '\n\n⚠️  Let\'s Encrypt Rate Limit Error:';
        errorMessage += '\nYou have requested too many certificates for this domain recently.';
        errorMessage += '\n\nThe installation checked for existing certificates but none were found.';
        errorMessage += '\nLet\'s Encrypt allows a maximum of 5 certificates per domain per week.';
        errorMessage += '\n\nPossible solutions:';
        errorMessage += '\n1. Wait until the rate limit expires (usually 7 days from first request)';
        errorMessage += '\n2. Use a different domain/subdomain for this addon';
        errorMessage += '\n3. If you have certificates elsewhere, copy them to:';
        errorMessage += `\n   /etc/letsencrypt/live/${domain}/fullchain.pem`;
        errorMessage += `\n   /etc/letsencrypt/live/${domain}/privkey.pem`;
        errorMessage += '\n\nTo check existing certificates: sudo certbot certificates';
        errorMessage += '\nTo view certificate details: sudo certbot certificates -d ' + domain;
        
        // Try to extract retry-after date from error message
        const retryMatch = result.stderr.match(/retry after ([^\n]+)/i) || result.stdout.match(/retry after ([^\n]+)/i);
        if (retryMatch) {
          errorMessage += '\n\nYou can retry after: ' + retryMatch[1];
        } else {
          // Try to extract from the detailed error
          const retryAfterMatch = result.stderr.match(/Retry-After: (\d+)/i) || result.stdout.match(/Retry-After: (\d+)/i);
          if (retryAfterMatch) {
            const seconds = parseInt(retryAfterMatch[1]);
            const hours = Math.floor(seconds / 3600);
            const days = Math.floor(hours / 24);
            if (days > 0) {
              errorMessage += `\n\nApproximate retry time: ${days} day(s) from now`;
            } else if (hours > 0) {
              errorMessage += `\n\nApproximate retry time: ${hours} hour(s) from now`;
            }
          }
        }
      } else if (result.stderr.includes('Some challenges have failed') || result.stdout.includes('Some challenges have failed')) {
        errorMessage += '\n\nPossible causes:';
        errorMessage += '\n1. Domain DNS is not pointing to this server';
        errorMessage += '\n2. Port 80 is not accessible from the internet (check firewall/router)';
        errorMessage += '\n3. Nginx configuration issue preventing challenge verification';
        errorMessage += '\n\nCheck the certbot logs: sudo tail -100 /var/log/letsencrypt/letsencrypt.log';
      }

      throw new Error(errorMessage);
    }

    logger.info('SSL certificate obtained successfully', { domain });
  }

  /**
   * Create systemd service
   */
  private async createService(): Promise<void> {
    logger.info('Creating systemd service');

    const targetDir = this.options.config.paths.addonDirectory;
    const port = this.options.config.addon.port || 7000;
    const addonName = this.options.config.addon.name;
    const serviceName = this.getServiceName();

    const domain = this.options.config.addon.domain;
    
    // Verify server.js exists before creating service file
    const serverJsPath = this.ssh ? path.posix.join(targetDir, 'server.js') : path.join(targetDir, 'server.js');
    const serverJsCheck = await this.execCommand(`test -f "${serverJsPath}" && echo "EXISTS" || echo "MISSING"`);
    if (serverJsCheck.stdout.includes('MISSING')) {
      throw new Error(`server.js not found at ${serverJsPath}. Cannot create service file.`);
    }
    logger.info('Verified server.js exists before creating service', { path: serverJsPath });
    
    // Verify node is available and get correct path
    const nodeCheck = await this.execCommand(`which node 2>/dev/null || which /usr/bin/node 2>/dev/null || echo "/usr/bin/node"`);
    const nodePath = nodeCheck.stdout.trim() || '/usr/bin/node';
    logger.info('Using node path for service', { nodePath });
    
    // Prepare Real-Debrid token - trim whitespace and validate
    const rdToken = this.options.config.secrets.realDebridToken?.trim() || '';
    const hasRdToken = rdToken.length > 0;
    
    if (!hasRdToken) {
      logger.warn('Real-Debrid token is missing or empty - addon will show as disconnected', {
        hasToken: !!this.options.config.secrets.realDebridToken,
        tokenLength: this.options.config.secrets.realDebridToken?.length || 0,
      });
    } else {
      logger.info('Real-Debrid token configured for service', { 
        tokenLength: rdToken.length,
        tokenPrefix: rdToken.substring(0, 4) + '...',
      });
    }
    
    const serviceConfig = `
[Unit]
Description=Stremio Private Addon: ${addonName}
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${targetDir}
ExecStart=${nodePath} ${targetDir}/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=${port}
Environment=RD_API_TOKEN=${rdToken}
Environment=ADDON_PASSWORD=${this.options.config.addon.password}
Environment=ADDON_DOMAIN=${domain}
Environment=TORRENT_LIMIT=${this.options.config.addon.torrentLimit}
${this.options.config.addon.availabilityCheckLimit ? `Environment=AVAILABILITY_CHECK_LIMIT=${this.options.config.addon.availabilityCheckLimit}` : ''}
${this.options.config.addon.maxStreams ? `Environment=MAX_STREAMS=${this.options.config.addon.maxStreams}` : ''}
${this.options.config.addon.maxConcurrency ? `Environment=MAX_CONCURRENCY=${this.options.config.addon.maxConcurrency}` : ''}

[Install]
WantedBy=multi-user.target
`;

    // Determine service file path - use config path if available, otherwise generate from service name
    // CRITICAL: Ensure service file path matches service name to avoid "Unit not found" errors
    let servicePath = this.options.config.paths.serviceFile;
    if (!servicePath || !servicePath.endsWith(`${serviceName}.service`)) {
      // Generate path from service name to ensure consistency
      servicePath = `/etc/systemd/system/${serviceName}.service`;
      logger.warn('Service file path mismatch detected, using generated path', {
        configPath: this.options.config.paths.serviceFile,
        generatedPath: servicePath,
        serviceName,
      });
      // Update config path for consistency
      this.options.config.paths.serviceFile = servicePath;
    }
    
    logger.info('Creating service file', { serviceName, servicePath });
    // Use temp file approach to avoid permission issues (same pattern as updateServiceFile)
    if (this.ssh) {
      // Remote: write via SSH
      const tempPath = `/tmp/${serviceName}.service.${Date.now()}`;
      await this.execCommand(`cat > ${tempPath} << 'EOF'\n${serviceConfig}\nEOF`);
      await this.execSudo(`mv ${tempPath} ${servicePath}`);
    } else {
      // Local: write to temp then move with sudo
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      const tempPath = `/tmp/${serviceName}.service.${Date.now()}`;
      const fs = await import('node:fs/promises');
      await fs.writeFile(tempPath, serviceConfig, 'utf-8');
      await execAsync(`sudo mv ${tempPath} ${servicePath}`);
    }

    // Verify service file was created successfully
    const verifyResult = await this.execCommand(`test -f "${servicePath}" && echo "EXISTS" || echo "MISSING"`);
    if (verifyResult.stdout.includes('MISSING')) {
      throw new Error(`Service file was not created at ${servicePath}. Check permissions and disk space.`);
    }
    logger.info('Service file created and verified', { servicePath });

    // Reload systemd daemon to recognize the new service
    logger.info('Reloading systemd daemon', { serviceName });
    const reloadResult = await this.execSudo('systemctl daemon-reload');
    if (reloadResult.code !== 0) {
      throw new Error(`Failed to reload systemd daemon: ${reloadResult.stderr || reloadResult.stdout}`);
    }

    // Verify systemd recognizes the service after reload
    const verifyServiceResult = await this.execCommand(`systemctl list-unit-files | grep -q "^${serviceName}.service" && echo "FOUND" || echo "NOT_FOUND"`);
    if (verifyServiceResult.stdout.includes('NOT_FOUND')) {
      logger.error('Service not recognized by systemd after reload', {
        serviceName,
        servicePath,
        reloadOutput: reloadResult.stdout + reloadResult.stderr,
      });
      throw new Error(`Service '${serviceName}' was created but systemd does not recognize it. Service file: ${servicePath}`);
    }
    logger.info('Service recognized by systemd', { serviceName });

    // Enable service
    if (this.options.config.features.autoStart) {
      await this.execSudo(`systemctl enable ${serviceName}`);
    }

    logger.info('Systemd service created successfully', { serviceName, servicePath });
  }

  /**
   * Start the service
   */
  private async startService(): Promise<void> {
    logger.info('Starting addon service');

    const serviceName = this.getServiceName();
    const serviceManager = new ServiceManager(serviceName, this.ssh);
    
    // Check if service is already running and stop it first
    const existingStatus = await serviceManager.status();
    if (existingStatus.status === 'active') {
      logger.info('Service is already running, stopping it first to ensure fresh start', {
        serviceName,
        existingPid: existingStatus.pid,
        uptime: existingStatus.uptime,
      });
      try {
        await serviceManager.stop();
        // Wait a moment for service to fully stop
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        logger.warn('Failed to stop existing service, continuing anyway', { error: (error as Error).message });
      }
    }

    // Start the service
    await serviceManager.start();

    // Wait for service to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify service started successfully
    const status = await serviceManager.status();
    if (status.status !== 'active') {
      // Get recent logs to help diagnose
      if (this.ssh) {
        const logsResult = await this.execCommand(`sudo journalctl -u ${serviceName} -n 30 --no-pager`);
        logger.error('Service failed to start - recent logs', { logs: logsResult.stdout });
      }
      throw new Error(`Service '${serviceName}' failed to start. Status: ${status.status}`);
    }

    // Verify port is listening (critical check)
    const port = this.options.config.addon.port || 7000;
    const portCheckResult = await this.execCommand(
      `netstat -tuln 2>/dev/null | grep :${port} || ss -tuln 2>/dev/null | grep :${port} || echo "NOT_LISTENING"`
    );
    
    if (portCheckResult.stdout.includes('NOT_LISTENING')) {
      // Get recent logs to see why server didn't start
      let errorDetails = '';
      if (this.ssh) {
        const logsResult = await this.execCommand(`sudo journalctl -u ${serviceName} -n 50 --no-pager`);
        const errorLogsResult = await this.execCommand(`sudo journalctl -u ${serviceName} -p err -n 20 --no-pager`);
        logger.error('Service is active but port is not listening - recent logs', { 
          allLogs: logsResult.stdout,
          errorLogs: errorLogsResult.stdout,
          port,
          servicePid: status.pid,
          serviceStatus: status.status,
        });
        errorDetails = `\n\nRecent error logs:\n${errorLogsResult.stdout}\n\nAll recent logs:\n${logsResult.stdout}`;
      }
      
      // Check if server.js exists and is executable
      const serverJsPath = this.ssh ? path.posix.join(this.options.config.paths.addonDirectory, 'server.js') : path.join(this.options.config.paths.addonDirectory, 'server.js');
      const serverJsCheck = await this.execCommand(`test -f "${serverJsPath}" && test -x "${serverJsPath}" && echo "OK" || echo "PROBLEM"`);
      const serverJsStatus = serverJsCheck.stdout.includes('OK') ? 'exists and executable' : 'missing or not executable';
      
      throw new Error(
        `Service '${serviceName}' is active but not listening on port ${port}. ` +
        `This usually means the Node.js server failed to start or crashed immediately.\n` +
        `Service PID: ${status.pid}\n` +
        `server.js status: ${serverJsStatus}\n` +
        `Check logs with: sudo journalctl -u ${serviceName} -f${errorDetails}`
      );
    }

    logger.info('Addon service started successfully', { 
      serviceName,
      pid: status.pid,
      port,
      portStatus: portCheckResult.stdout.trim(),
    });
  }

  /**
   * Configure DuckDNS cron job only (assumes immediate update was already done)
   */
  private async configureDuckDNSCronJob(): Promise<void> {
    logger.info('Setting up DuckDNS cron job for periodic IP updates');

    const duckdnsToken = this.options.config.secrets.duckdnsToken;
    if (!duckdnsToken) {
      logger.warn('DuckDNS token not provided, skipping cron job setup');
      return;
    }

    const domain = this.options.config.addon.domain.replace('.duckdns.org', '');

    // Create update script for cron job
    const updateScript = `#!/bin/bash
echo url="https://www.duckdns.org/update?domains=${domain}&token=${duckdnsToken}&ip=" | curl -k -o ~/duckdns.log -K -
`;

    await this.execCommand('echo \'' + updateScript + '\' > ~/duckdns.sh');
    await this.execCommand('chmod +x ~/duckdns.sh');

    // Add to crontab (run every 5 minutes)
    await this.execCommand('(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns.sh >/dev/null 2>&1") | crontab -');

    logger.info('DuckDNS cron job configured (runs every 5 minutes)');
  }

  /**
   * Create initial backup
   */
  private async createBackup(): Promise<void> {
    logger.info('Creating initial backup');

    const backupDir = this.options.config.paths.backups;
    const targetDir = this.options.config.paths.addonDirectory;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${backupDir}/backup-${timestamp}.tar.gz`;

    // Create backup directory
    await this.execSudo(`mkdir -p ${backupDir}`);

    // Create backup
    await this.execSudo(`tar -czf ${backupPath} -C ${targetDir} .`);

    logger.info('Backup created', { backupPath });
  }

  /**
   * Verify installation
   */
  private async verifyInstallation(): Promise<void> {
    logger.info('Verifying installation');

    // Check if service is running
    const serviceName = this.getServiceName();
    const serviceManager = new ServiceManager(serviceName, this.ssh);
    const status = await serviceManager.status();

    if (status.status !== 'active') {
      throw new Error(`Service '${serviceName}' is not running`);
    }

    // Check if Nginx is serving the addon
    const protocol = this.options.config.features.ssl ? 'https' : 'http';
    const domain = this.options.config.addon.domain;

    const curlResult = await this.execCommand(`curl -sI ${protocol}://${domain}`);

    if (curlResult.code !== 0 || !curlResult.stdout.includes('200')) {
      logger.warn('Addon may not be accessible', { output: curlResult.stdout });
      
      // If we got a 502, check service status and logs
      if (curlResult.stdout.includes('502')) {
        logger.error('502 Bad Gateway detected - checking service status');
        const serviceStatus = await serviceManager.status();
        logger.error('Service status', { 
          status: serviceStatus.status,
          enabled: serviceStatus.enabled,
          uptime: serviceStatus.uptime,
          pid: serviceStatus.pid
        });
        
        // Try to get recent logs
        if (this.ssh) {
          const logsResult = await this.execCommand(`sudo journalctl -u ${serviceName} -n 20 --no-pager`);
          logger.error('Recent service logs', { logs: logsResult.stdout });
        }
        
        // Check if port is listening
        const port = this.options.config.addon.port || 7000;
        const portCheckResult = await this.execCommand(`netstat -tuln 2>/dev/null | grep :${port} || ss -tuln 2>/dev/null | grep :${port} || echo "Port not listening"`);
        logger.error('Port listening check', { output: portCheckResult.stdout });
        
        throw new Error(`502 Bad Gateway: Backend service is not responding. Check service logs with: sudo journalctl -u ${serviceName} -f`);
      }
    }

    logger.info('Installation verified', { serviceName });
  }

  /**
   * Cleanup temporary files only (called after successful installation)
   */
  private async cleanupTemporaryFiles(): Promise<void> {
    logger.info('Cleaning up temporary files');

    try {
      // Remove any temporary files only (not the installed addon)
      const serviceName = this.getServiceName();
      await this.execCommand(`rm -f /tmp/${serviceName}-*`);
      await this.execCommand(`rm -f /tmp/stremio-addon-install.*`);
      await this.execCommand(`rm -f /tmp/stremio-addon-nginx.*.conf`);
      await this.execCommand(`rm -f /tmp/server.js.*`);
      
      logger.info('Temporary files cleaned up');
    } catch (error) {
      logger.error('Error during temporary file cleanup', error);
      // Don't throw - cleanup errors shouldn't prevent successful installation
    }

    logger.info('Temporary file cleanup complete');
  }

  /**
   * Cleanup after installation failure (removes installed addon)
   */
  private async cleanup(): Promise<void> {
    logger.info('Cleaning up after installation failure');

    try {
      // Remove any temporary files
      const serviceName = this.getServiceName();
      await this.execCommand(`rm -f /tmp/${serviceName}-*`);

      // If addonId is set, try to clean up partial installation
      if (this.options.config.addonId) {
        // Remove from registry if it was registered
        try {
          const registryManager = new AddonRegistryManager();
          await registryManager.initialize();
          if (await registryManager.getAddon(this.options.config.addonId)) {
            await registryManager.deleteAddon(this.options.config.addonId);
            logger.info('Removed addon from registry after failed installation', {
              addonId: this.options.config.addonId,
            });
          }
        } catch (error) {
          logger.warn('Failed to remove addon from registry during cleanup', error);
        }

        // Try to remove config file if it was created
        try {
          const configManager = new ConfigManager(this.options.config.addonId);
          if (await configManager.exists()) {
            await configManager.delete();
            logger.info('Removed config file after failed installation', {
              addonId: this.options.config.addonId,
            });
          }
        } catch (error) {
          logger.warn('Failed to remove config file during cleanup', error);
        }

        // Try to stop and remove service if it was created
        try {
          const serviceManager = new ServiceManager(serviceName, this.ssh);
          const status = await serviceManager.status();
          const { ServiceStatus } = await import('../service/types.js');
          if (status.status === ServiceStatus.ACTIVE) {
            await serviceManager.stop();
            await serviceManager.disable();
            logger.info('Stopped and disabled service after failed installation', { serviceName });
          }

          // Try to remove service file
          if (this.options.config.paths.serviceFile) {
            await this.execSudo(`rm -f ${this.options.config.paths.serviceFile}`);
            await this.execSudo('systemctl daemon-reload');
            logger.info('Removed service file after failed installation', {
              serviceFile: this.options.config.paths.serviceFile,
            });
          }
        } catch (error) {
          logger.warn('Failed to clean up service during cleanup', error);
        }

        // Try to remove addon directory if it was created but installation failed
        // Only remove if it's empty or contains only minimal files
        try {
          if (this.options.config.paths.addonDirectory) {
            // Check if directory exists and is mostly empty (just cloned, not fully installed)
            const dirExists = await this.execCommand(`test -d ${this.options.config.paths.addonDirectory}`);
            if (dirExists.code === 0) {
              // Only remove if it looks like a failed installation (no server.js or minimal files)
              const hasServerJs = await this.execCommand(
                `test -f ${this.options.config.paths.addonDirectory}/server.js`
              );
              if (hasServerJs.code !== 0) {
                // No server.js, likely a failed installation
                await this.execSudo(`rm -rf ${this.options.config.paths.addonDirectory}`);
                logger.info('Removed addon directory after failed installation', {
                  directory: this.options.config.paths.addonDirectory,
                });
              }
            }
          }
        } catch (error) {
          logger.warn('Failed to clean up addon directory during cleanup', error);
        }
      }
    } catch (error) {
      logger.error('Error during cleanup', error);
      // Don't throw - cleanup errors shouldn't prevent error reporting
    }

    logger.info('Cleanup complete');
  }

  /**
   * Register addon in registry after successful installation
   */
  private async registerAddon(): Promise<void> {
    if (!this.options.config.addonId) {
      return; // Skip if no addonId (legacy mode)
    }

    logger.info('Registering addon in registry', { addonId: this.options.config.addonId });

    try {
      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();

      const addonId = this.options.config.addonId;
      const addonName = this.options.config.addon.name;
      const port = this.options.config.addon.port || 7000;
      const domain = this.options.config.addon.domain;
      const serviceName = this.options.config.serviceName || generateServiceName(addonId);
      const configPath = ConfigManager.getConfigPathForAddon(addonId);

      // Check if addon already exists in registry
      const registry = registryManager.getRegistry();
      await registry.load();
      
      if (registry.exists(addonId)) {
        logger.warn('Addon already exists in registry, skipping registration', { addonId });
        return;
      }

      // Create addon metadata directly with the correct ID (not generate a new one)
      // Generate slug from name (same logic as registry-manager)
      const slug = addonName
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      
      registry.create({
        id: addonId,
        name: addonName,
        slug,
        configPath,
        serviceName,
        port,
        domain,
      });

      // Save registry
      await registry.save();

      logger.info('Addon registered successfully', { addonId, name: addonName });

      // Set as default addon if it's the first one
      const allAddons = await registryManager.listAddons();
      if (allAddons.length === 1) {
        await registryManager.setDefaultAddon(addonId);
        logger.info('Set as default addon', { addonId });
      }
    } catch (error) {
      logger.error('Failed to register addon in registry', error);
      // Don't throw - registration failure shouldn't fail the installation
      // The addon is already installed and working
    }
  }

  /**
   * Get service name from config or generate from addonId
   */
  private getServiceName(): string {
    if (this.options.config.serviceName) {
      return this.options.config.serviceName;
    }
    if (this.options.config.addonId) {
      return generateServiceName(this.options.config.addonId);
    }
    // Fallback to legacy name
    return 'stremio-addon';
  }

  /**
   * Update service file with current configuration
   * This allows updating environment variables without reinstalling
   */
  public async updateServiceFile(options?: { restartService?: boolean }): Promise<void> {
    logger.info('Updating systemd service file', { addonId: this.options.config.addonId });

    try {
      const serviceName = this.getServiceName();
      const targetDir = this.options.config.paths.addonDirectory;
      const addonName = this.options.config.addon.name;

      // Get environment variables from config (with overrides if any)
      // Pass overrides directly - mergeEnvVars handles null values
      const envVars = EnvVarManager.mergeEnvVars(
        this.options.config,
        this.options.config.addon.environmentVariables
      );

      // Generate service file content
      const serviceConfig = ServiceFileManager.generateServiceFile({
        serviceName,
        addonName,
        addonDirectory: targetDir,
        port: this.options.config.addon.port || 7000,
        envVars,
        autoStart: this.options.config.features.autoStart,
      });

      // Backup existing service file
      try {
        await ServiceFileManager.backupServiceFile(serviceName, this.ssh);
      } catch (error) {
        logger.warn('Failed to backup service file, continuing anyway', error);
      }

      // Write service file
      const servicePath = this.options.config.paths.serviceFile;
      
      if (this.ssh) {
        // Remote: write via SSH
        const tempPath = `/tmp/${serviceName}.service.${Date.now()}`;
        await this.execCommand(`cat > ${tempPath} << 'EOF'\n${serviceConfig}\nEOF`);
        await this.execSudo(`mv ${tempPath} ${servicePath}`);
      } else {
        // Local: write to temp then move with sudo
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const tempPath = `/tmp/${serviceName}.service.${Date.now()}`;
        const fs = await import('node:fs/promises');
        await fs.writeFile(tempPath, serviceConfig, 'utf-8');
        await execAsync(`sudo mv ${tempPath} ${servicePath}`);
      }

      // Reload systemd
      await this.execSudo('systemctl daemon-reload');

      // Restart service if requested
      if (options?.restartService) {
        const serviceManager = new ServiceManager(serviceName, this.ssh);
        await serviceManager.restart();
        logger.info('Service restarted after service file update');
      }

      logger.info('Service file updated successfully', { serviceName });
    } catch (error) {
      logger.error('Failed to update service file', error);
      throw new Error(`Failed to update service file: ${(error as Error).message}`);
    }
  }
}

