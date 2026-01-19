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

    // Verify addonId is set - if not, this is a critical error
    if (!this.options.config.addonId) {
      logger.error('CRITICAL: addonId is missing in options.config at start of installation', {
        hasAddonName: !!this.options.config.addon?.name,
        hasAddonDomain: !!this.options.config.addon?.domain,
        configKeys: Object.keys(this.options.config),
      });
      // Don't throw - allow installation to proceed but registration will be skipped
      // This helps identify the issue without breaking existing installations
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

      // Step 7: Clone repository
      await this.executeStep(InstallationStep.CLONE_REPOSITORY, async () => {
        await this.cloneRepository();
      });

      // Step 8: Install dependencies
      await this.executeStep(InstallationStep.INSTALL_DEPENDENCIES, async () => {
        await this.installDependencies();
      });

      // Step 9: Setup Nginx
      await this.executeStep(InstallationStep.SETUP_NGINX, async () => {
        await this.setupNginx();
      });

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

      // Step 13: Configure DuckDNS updater (if enabled)
      if (this.options.config.features.duckdnsUpdater) {
        await this.executeStep(InstallationStep.CONFIGURE_DUCKDNS, async () => {
          await this.configureDuckDNS();
        });
      } else {
        this.skipStep(InstallationStep.CONFIGURE_DUCKDNS, 'DuckDNS updater disabled');
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

      // Step 17: Cleanup
      await this.executeStep(InstallationStep.CLEANUP, async () => {
        await this.cleanup();
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
   * Copy addon-server from bundled resources or clone repository
   */
  private async cloneRepository(): Promise<void> {
    const targetDir = this.options.config.paths.addonDirectory;
    
    // Try to use bundled addon-server first (faster, no network required)
    const bundledPath = await this.getBundledAddonServerPath();
    if (bundledPath) {
      logger.info('Using bundled addon-server', { bundledPath, targetDir });
      await this.copyBundledAddonServer(bundledPath, targetDir);
      return;
    }
    
    // Fallback to cloning from repository
    logger.info('Bundled addon-server not found, cloning from repository');
    await this.cloneFromRepository(targetDir);
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
   * Clone repository from GitHub
   */
  private async cloneFromRepository(targetDir: string): Promise<void> {
    logger.info('Cloning repository');

    let repoUrl = this.options.repoUrl || 'https://github.com/yourusername/stremio-addon-server.git';
    const branch = this.options.repoBranch || 'main';
    
    // Convert HTTPS GitHub URLs to SSH format if possible (avoids credential prompts)
    // This only works if SSH keys are set up, but prevents interactive prompts
    if (repoUrl.startsWith('https://github.com/') && !repoUrl.includes('@')) {
      const sshUrl = repoUrl.replace('https://github.com/', 'git@github.com:');
      logger.info('Converted HTTPS URL to SSH format to avoid credential prompts', { 
        original: repoUrl, 
        converted: sshUrl 
      });
      repoUrl = sshUrl;
    }

    // Get current username for ownership
    const whoamiResult = await this.execCommand('whoami');
    const username = whoamiResult.stdout.trim() || whoamiResult.stderr.trim() || 'root';

    // Remove existing directory if present (try with sudo first, fallback to regular)
    const dirExists = await this.execCommand(`test -d ${targetDir}`);
    if (dirExists.code === 0) {
      logger.info('Removing existing directory', { targetDir });
      const removeResult = await this.execSudo(`rm -rf ${targetDir}`);
      if (removeResult.code !== 0) {
        logger.warn('Failed to remove existing directory with sudo, trying without', { error: removeResult.stderr });
        const fallbackResult = await this.execCommand(`rm -rf ${targetDir}`);
        if (fallbackResult.code !== 0) {
          throw new Error(`Failed to remove existing directory: ${fallbackResult.stderr}`);
        }
      }
    }

    // Create the target directory with sudo and set ownership
    // This ensures the directory can be created with correct permissions
    // Git clone will fail if the directory exists, so we'll remove it after setting up permissions
    logger.info('Preparing target directory with correct permissions', { targetDir });
    const mkdirResult = await this.execSudo(`mkdir -p ${targetDir}`);
    if (mkdirResult.code !== 0) {
      throw new Error(`Failed to create target directory: ${mkdirResult.stderr}`);
    }
    
    // Set ownership to current user so they can write to it
    const chownResult = await this.execSudo(`chown -R ${username}:${username} ${targetDir}`);
    if (chownResult.code !== 0) {
      throw new Error(`Failed to set ownership of target directory: ${chownResult.stderr}`);
    }
    
    // Remove the directory so git clone can create it (git clone requires the directory to not exist)
    const removePrepResult = await this.execCommand(`rm -rf ${targetDir}`);
    if (removePrepResult.code !== 0) {
      logger.warn('Failed to remove prepared directory, git clone may fail', { error: removePrepResult.stderr });
    }

    // Clone repository
    // Set GIT_TERMINAL_PROMPT=0 to prevent interactive credential prompts in non-interactive sessions
    // Set GIT_ASKPASS=echo to prevent password prompts
    const gitEnv = 'GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=echo';
    
    // If the directory was prepared above, git clone will fail because it exists
    // So we need to clone to a temp location first, then move it
    let cloneSuccess = false;
    let tempDir: string | undefined;
    
    const result = await this.execCommand(`${gitEnv} git clone -b ${branch} ${repoUrl} ${targetDir}`);
    
    if (result.code === 0) {
      cloneSuccess = true;
    } else if (result.stderr.includes('Permission denied') || result.stderr.includes('could not create work tree')) {
      // Clone failed due to permissions - use temp directory approach
      logger.info('Clone failed due to permissions, using temp directory approach', { targetDir });
      tempDir = `${targetDir}.tmp.${Date.now()}`;
      
      // Clone to temp location (in user's home or /tmp)
      const tempCloneResult = await this.execCommand(`${gitEnv} git clone -b ${branch} ${repoUrl} ${tempDir}`);
      if (tempCloneResult.code !== 0) {
        // Check if it's an authentication error
        if (tempCloneResult.stderr.includes('Permission denied') || 
            tempCloneResult.stderr.includes('could not read Username') ||
            tempCloneResult.stderr.includes('Authentication failed')) {
          throw new Error(
            `Failed to clone repository: Authentication required. ` +
            `Please ensure:\n` +
            `1. The repository is public, or\n` +
            `2. SSH keys are configured for private repositories, or\n` +
            `3. Use an SSH URL format (git@github.com:user/repo.git) instead of HTTPS\n` +
            `Original error: ${tempCloneResult.stderr}`
          );
        }
        throw new Error(`Failed to clone repository to temp location: ${tempCloneResult.stderr}`);
      }
      
      // Move temp directory to target with sudo
      const moveResult = await this.execSudo(`mv ${tempDir} ${targetDir}`);
      if (moveResult.code !== 0) {
        // Clean up temp directory
        await this.execCommand(`rm -rf ${tempDir}`);
        throw new Error(`Failed to move cloned repository: ${moveResult.stderr}`);
      }
      
      // Set ownership of moved directory
      const chownResult = await this.execSudo(`chown -R ${username}:${username} ${targetDir}`);
      if (chownResult.code !== 0) {
        logger.warn('Failed to set ownership of cloned directory', { error: chownResult.stderr });
      }
      
      cloneSuccess = true;
    } else {
      // Check if it's an authentication error
      if (result.stderr.includes('could not read Username') || 
          result.stderr.includes('Authentication failed') ||
          result.stderr.includes('Permission denied (publickey)')) {
        throw new Error(
          `Failed to clone repository: Authentication required. ` +
          `Please ensure:\n` +
          `1. The repository is public, or\n` +
          `2. SSH keys are configured for private repositories, or\n` +
          `3. Use an SSH URL format (git@github.com:user/repo.git) instead of HTTPS\n` +
          `Original error: ${result.stderr}`
        );
      }
      throw new Error(`Failed to clone repository: ${result.stderr}`);
    }
    
    if (!cloneSuccess) {
      throw new Error('Failed to clone repository');
    }
    
    // Ensure final ownership is correct (in case clone succeeded but ownership is wrong)
    const finalChownResult = await this.execSudo(`chown -R ${username}:${username} ${targetDir}`);
    if (finalChownResult.code !== 0) {
      logger.warn('Failed to set final ownership of cloned directory', { error: finalChownResult.stderr });
    }

    logger.info('Repository cloned', { targetDir });
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
   * Note: When SSL is enabled, certbot will:
   * - Replace the HTTP server block (port 80) with a redirect to HTTPS
   * - Create/modify the HTTPS server block (port 443) and preserve these location blocks
   */
  private async setupNginx(): Promise<void> {
    logger.info('Setting up Nginx');

    const domain = this.options.config.addon.domain;
    const port = this.options.config.addon.port || 7000;

    const nginxConfig = `
server {
    listen 80;
    server_name ${domain};

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
        
        # CORS headers (if needed)
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
        
        # Handle OPTIONS requests for CORS
        if ($request_method = OPTIONS) {
            return 204;
        }
    }

    # Stremio stream endpoint
    # Matches: /:password/stream/:type/:id.json
    location ~ ^/([^/]+)/stream/(.+)$ {
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
        
        # CORS headers (if needed)
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
        
        # Handle OPTIONS requests for CORS
        if ($request_method = OPTIONS) {
            return 204;
        }
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
   * Setup SSL with Let's Encrypt
   */
  private async setupSSL(): Promise<void> {
    logger.info('Setting up SSL with Let\'s Encrypt');

    const domain = this.options.config.addon.domain;

    // Run certbot
    const result = await this.execSudo(
      `certbot --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain} --redirect`
    );

    if (result.code !== 0) {
      throw new Error(`SSL setup failed: ${result.stderr}`);
    }

    logger.info('SSL certificate obtained');
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
Environment=RD_API_TOKEN=${this.options.config.secrets.realDebridToken || ''}
Environment=ADDON_PASSWORD=${this.options.config.addon.password}
Environment=ADDON_DOMAIN=${domain}
Environment=TORRENT_LIMIT=${this.options.config.addon.torrentLimit}
${this.options.config.addon.availabilityCheckLimit ? `Environment=AVAILABILITY_CHECK_LIMIT=${this.options.config.addon.availabilityCheckLimit}` : ''}
${this.options.config.addon.maxStreams ? `Environment=MAX_STREAMS=${this.options.config.addon.maxStreams}` : ''}
${this.options.config.addon.maxConcurrency ? `Environment=MAX_CONCURRENCY=${this.options.config.addon.maxConcurrency}` : ''}

[Install]
WantedBy=multi-user.target
`;

    // Write service file
    const servicePath = this.options.config.paths.serviceFile;
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

    // Reload systemd
    await this.execSudo('systemctl daemon-reload');

    // Enable service
    if (this.options.config.features.autoStart) {
      await this.execSudo(`systemctl enable ${serviceName}`);
    }

    logger.info('Systemd service created', { serviceName });
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
   * Configure DuckDNS updater
   */
  private async configureDuckDNS(): Promise<void> {
    logger.info('Configuring DuckDNS updater');

    const duckdnsToken = this.options.config.secrets.duckdnsToken;
    if (!duckdnsToken) {
      logger.warn('DuckDNS token not provided, skipping updater setup');
      return;
    }

    const domain = this.options.config.addon.domain.replace('.duckdns.org', '');

    // Create update script
    const updateScript = `#!/bin/bash
echo url="https://www.duckdns.org/update?domains=${domain}&token=${duckdnsToken}&ip=" | curl -k -o ~/duckdns.log -K -
`;

    await this.execCommand('echo \'' + updateScript + '\' > ~/duckdns.sh');
    await this.execCommand('chmod +x ~/duckdns.sh');

    // Add to crontab (run every 5 minutes)
    await this.execCommand('(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns.sh >/dev/null 2>&1") | crontab -');

    logger.info('DuckDNS updater configured');
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
   * Cleanup temporary files
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

