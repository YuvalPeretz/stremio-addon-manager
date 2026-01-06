/**
 * Installation Manager
 * Orchestrates the complete addon installation process
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';
import { OSDetector } from '../os/detector.js';
import { SSHManager } from '../ssh/manager.js';
import { ServiceManager } from '../service/manager.js';
import { OperatingSystem, LinuxDistribution } from '../types/common.js';
import type {
  InstallationOptions,
  InstallationResult,
  InstallationProgress,
  PrerequisiteCheck,
  ProgressCallback,
} from './types.js';
import { InstallationStep, StepStatus } from './types.js';

const execAsync = promisify(exec);

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
    logger.info('Starting addon installation', {
      type: this.options.config.installation.type,
      domain: this.options.config.addon.domain,
    });

    try {
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

      // Step 16: Cleanup
      await this.executeStep(InstallationStep.CLEANUP, async () => {
        await this.cleanup();
      });

      // Mark as complete
      this.updateProgress(InstallationStep.COMPLETE, StepStatus.COMPLETED, 'Installation complete!', 100);

      const duration = Date.now() - this.startTime;
      const protocol = this.options.config.features.ssl ? 'https' : 'http';
      const addonUrl = `${protocol}://${this.options.config.addon.domain}`;
      const installManifestUrl = `${addonUrl}/${this.options.config.addon.password}/manifest.json`;

      logger.info('Installation completed successfully', { duration, addonUrl });

      return {
        success: true,
        config: this.options.config,
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
    await this.execSudo(`echo '${jailConfig}' > ${jailPath}`);

    // Restart fail2ban
    await this.execSudo('systemctl restart fail2ban');
    await this.execSudo('systemctl enable fail2ban');

    logger.info('Fail2ban configured');
  }

  /**
   * Clone repository
   */
  private async cloneRepository(): Promise<void> {
    logger.info('Cloning repository');

    const repoUrl = this.options.repoUrl || 'https://github.com/yourusername/stremio-addon-server.git';
    const branch = this.options.repoBranch || 'main';
    const targetDir = this.options.config.paths.addonDirectory;

    // Remove existing directory if present
    await this.execCommand(`rm -rf ${targetDir}`);

    // Clone repository
    const result = await this.execCommand(`git clone -b ${branch} ${repoUrl} ${targetDir}`);

    if (result.code !== 0) {
      throw new Error(`Failed to clone repository: ${result.stderr}`);
    }

    logger.info('Repository cloned', { targetDir });
  }

  /**
   * Install dependencies
   */
  private async installDependencies(): Promise<void> {
    logger.info('Installing dependencies');

    const targetDir = this.options.config.paths.addonDirectory;
    const result = await this.execCommand(`cd ${targetDir} && npm install --production`);

    if (result.code !== 0) {
      throw new Error(`Failed to install dependencies: ${result.stderr}`);
    }

    logger.info('Dependencies installed');
  }

  /**
   * Setup Nginx reverse proxy
   */
  private async setupNginx(): Promise<void> {
    logger.info('Setting up Nginx');

    const domain = this.options.config.addon.domain;
    const port = this.options.config.addon.port || 7000;

    const nginxConfig = `
server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;

    // Write Nginx config
    const configPath = this.options.config.paths.nginxConfig;
    await this.execSudo(`echo '${nginxConfig}' > ${configPath}`);

    // Create symbolic link
    await this.execSudo(`ln -sf ${configPath} /etc/nginx/sites-enabled/stremio-addon`);

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

    const serviceConfig = `
[Unit]
Description=Stremio Private Addon
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${targetDir}
ExecStart=/usr/bin/node ${targetDir}/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=${port}
Environment=RD_API_TOKEN=${this.options.config.secrets.realDebridToken || ''}
Environment=ADDON_PASSWORD=${this.options.config.addon.password}
Environment=TORRENT_LIMIT=${this.options.config.addon.torrentLimit}

[Install]
WantedBy=multi-user.target
`;

    // Write service file
    const servicePath = this.options.config.paths.serviceFile;
    await this.execSudo(`echo '${serviceConfig}' > ${servicePath}`);

    // Reload systemd
    await this.execSudo('systemctl daemon-reload');

    // Enable service
    if (this.options.config.features.autoStart) {
      await this.execSudo('systemctl enable stremio-addon');
    }

    logger.info('Systemd service created');
  }

  /**
   * Start the service
   */
  private async startService(): Promise<void> {
    logger.info('Starting addon service');

    const serviceManager = new ServiceManager('stremio-addon', this.ssh);
    await serviceManager.start();

    // Wait a moment for service to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check if service is running
    const status = await serviceManager.status();
    if (status.status !== 'active') {
      throw new Error('Service failed to start');
    }

    logger.info('Addon service started');
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
    const serviceManager = new ServiceManager('stremio-addon', this.ssh);
    const status = await serviceManager.status();

    if (status.status !== 'active') {
      throw new Error('Service is not running');
    }

    // Check if Nginx is serving the addon
    const protocol = this.options.config.features.ssl ? 'https' : 'http';
    const domain = this.options.config.addon.domain;

    const curlResult = await this.execCommand(`curl -sI ${protocol}://${domain}`);

    if (curlResult.code !== 0 || !curlResult.stdout.includes('200')) {
      logger.warn('Addon may not be accessible', { output: curlResult.stdout });
    }

    logger.info('Installation verified');
  }

  /**
   * Cleanup temporary files
   */
  private async cleanup(): Promise<void> {
    logger.info('Cleaning up');

    // Remove any temporary files
    await this.execCommand('rm -f /tmp/stremio-addon-*');

    logger.info('Cleanup complete');
  }
}

