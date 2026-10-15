# Installation Manager

The Installation Manager orchestrates the complete automated deployment process for the Stremio addon. It handles all aspects of installation from prerequisites checking to SSL setup.

## Features

- **Local and Remote Installation**: Support for both local machine and remote SSH-based deployments
- **OS Detection**: Automatic detection of operating system and distribution
- **Prerequisites Management**: Checks and installs required software (Node.js, npm, Git, Nginx, Certbot, UFW, fail2ban)
- **Firewall Configuration**: Automated UFW setup with proper port rules
- **fail2ban Setup**: SSH protection with automatic configuration
- **Bundled Package Management**: Copies addon-server from bundled resources
- **Nginx Configuration**: Reverse proxy setup with optimal settings
- **SSL/HTTPS Setup**: Automated Let's Encrypt certificate generation with Certbot
- **Service Management**: Creates and configures systemd service with auto-start
- **DuckDNS Integration**: Optional DuckDNS updater for dynamic DNS
- **Backup System**: Creates initial backup after installation
- **Progress Tracking**: Real-time progress updates via callbacks
- **Error Handling**: Comprehensive error handling with detailed messages
- **Rollback Support**: Tracks all steps for potential rollback on failure

## Installation Steps

The InstallationManager executes the following steps in order:

1. **CONNECT** - Establishes SSH connection (for remote installations)
2. **DETECT_OS** - Detects operating system and distribution
3. **CHECK_PREREQUISITES** - Checks for required software
4. **INSTALL_PREREQUISITES** - Installs missing prerequisites
5. **SETUP_FIREWALL** - Configures UFW firewall
6. **SETUP_FAIL2BAN** - Sets up fail2ban for SSH protection
7. **CLONE_REPOSITORY** - Copies addon-server from bundled packages (no GitHub cloning)
8. **INSTALL_DEPENDENCIES** - Runs npm install for dependencies
9. **SETUP_NGINX** - Configures Nginx reverse proxy
10. **SETUP_SSL** - Obtains and configures SSL certificates
11. **CREATE_SERVICE** - Creates systemd service file
12. **START_SERVICE** - Starts the addon service
13. **CONFIGURE_DUCKDNS** - Sets up DuckDNS updater (if enabled)
14. **CREATE_BACKUP** - Creates initial backup
15. **VERIFY_INSTALLATION** - Verifies the installation is working
16. **CLEANUP** - Removes temporary files
17. **COMPLETE** - Marks installation as complete

## Usage

### Basic Usage

```typescript
import { InstallationManager, ConfigManager } from '@stremio-addon-manager/core';

// Load configuration
const configManager = new ConfigManager();
const config = await configManager.load();

// Create installation manager
const installManager = new InstallationManager({
  config,
  progressCallback: (progress) => {
    console.log(`[${progress.progress}%] ${progress.message}`);
  },
});

// Run installation
const result = await installManager.install();

if (result.success) {
  console.log('Installation successful!');
  console.log('Addon URL:', result.addonUrl);
  console.log('Install URL:', result.installManifestUrl);
} else {
  console.error('Installation failed:', result.error);
}
```

### With Progress Tracking

```typescript
const installManager = new InstallationManager({
  config,
  progressCallback: (progress) => {
    console.log(`[${progress.step}] ${progress.message}`);
    console.log(`Progress: ${progress.progress}%`);
  },
});

await installManager.install();
```

### Dry Run Mode

```typescript
const installManager = new InstallationManager({
  config,
  dryRun: true, // Won't make actual changes
  progressCallback: (progress) => {
    console.log(`[DRY RUN] ${progress.message}`);
  },
});

await installManager.install();
```

### Skip SSL Setup

```typescript
const installManager = new InstallationManager({
  config,
  skipSSL: true, // Not recommended for Stremio
});

await installManager.install();
```

## Progress Tracking

The InstallationManager provides real-time progress updates via the `progressCallback`:

```typescript
interface InstallationProgress {
  step: InstallationStep;
  status: StepStatus; // 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
  message: string;
  progress: number; // 0-100
  error?: Error;
  timestamp: Date;
}
```

### Example Progress Callback

```typescript
const progressCallback = (progress: InstallationProgress) => {
  const emoji = {
    pending: '⏳',
    in_progress: '🔄',
    completed: '✅',
    failed: '❌',
    skipped: '⏭️',
  }[progress.status];

  console.log(`${emoji} [${progress.progress}%] ${progress.message}`);
  
  if (progress.error) {
    console.error('Error:', progress.error.message);
  }
};
```

## Installation Result

The `install()` method returns a comprehensive result object:

```typescript
interface InstallationResult {
  success: boolean;
  config: AddonManagerConfig;
  addonUrl: string; // e.g., 'https://yourdomain.duckdns.org'
  installManifestUrl: string; // e.g., 'https://yourdomain.duckdns.org/password/manifest.json'
  steps: InstallationProgress[]; // All executed steps
  error?: Error; // If installation failed
  duration: number; // Total time in milliseconds
}
```

## Prerequisites

The InstallationManager automatically checks and installs:

- **Node.js** (v16.0.0 or higher)
- **npm** (v8.0.0 or higher)
- **Git**
- **Nginx**
- **Certbot** (with nginx plugin)
- **UFW** (if firewall is enabled)
- **fail2ban** (if enabled)

## Supported Operating Systems

Currently supports Linux distributions:

- Ubuntu / Debian
- Raspberry Pi OS
- Fedora / CentOS
- Arch Linux

## Error Handling

The InstallationManager provides comprehensive error handling:

- Each step is wrapped in try-catch
- Errors include context and step information
- Failed steps are recorded in the result
- SSH connections are automatically cleaned up
- Service rollback on critical failures

## Logging

All installation activities are logged using Winston:

```typescript
import { logger } from '@stremio-addon-manager/core';

// Logs are automatically written to:
// ~/.stremio-addon-manager/logs/stremio-addon-manager.log
// ~/.stremio-addon-manager/logs/error.log
```

## Configuration

The InstallationManager uses the `AddonManagerConfig` from ConfigManager:

```typescript
interface AddonManagerConfig {
  installation: {
    type: 'local' | 'remote';
    accessMethod: 'custom_domain' | 'duckdns' | 'static_ip_domain' | 'local_network';
    target?: {
      host: string;
      port: number;
      username: string;
    };
  };
  addon: {
    name: string;
    version: string;
    domain: string;
    password: string;
    provider: 'real-debrid' | 'alldebrid' | 'premiumize' | 'torbox';
    torrentLimit: number;
    port: number;
  };
  features: {
    firewall: boolean;
    fail2ban: boolean;
    caching: { enabled: boolean; ttl: number; maxSize: number };
    rateLimiting: { enabled: boolean; stream: number; stats: number };
    authentication: boolean;
    backups: { enabled: boolean; frequency: string; retention: number };
    ssl: boolean;
    duckdnsUpdater: boolean;
    autoStart: boolean;
  };
  paths: {
    addonDirectory: string;
    nginxConfig: string;
    serviceFile: string;
    logs: string;
    backups: string;
  };
  secrets: {
    realDebridToken?: string;
    duckdnsToken?: string;
  };
}
```

## Security Considerations

- SSH connections use key-based authentication when available
- Passwords are never logged
- fail2ban protects against brute-force attacks
- UFW firewall restricts incoming connections
- SSL/HTTPS is mandatory for Stremio compatibility
- Service runs with appropriate permissions

## Troubleshooting

### SSL Certificate Fails

```typescript
// Check if port 80 is accessible from the internet
// Ensure DNS is pointing to the correct IP
// Verify email address for Let's Encrypt notifications
```

### Service Won't Start

```typescript
// Check logs: await serviceManager.logs()
// Verify all environment variables are set
// Check if port is already in use
```

### Prerequisites Installation Fails

```typescript
// Ensure package manager is up to date
// Check internet connectivity
// Verify sudo/root permissions
```

## Best Practices

1. **Always use SSL/HTTPS** - Required for Stremio
2. **Enable fail2ban** - Protects against SSH attacks
3. **Enable firewall** - Restricts unnecessary access
4. **Use strong passwords** - For addon authentication
5. **Enable backups** - Allows recovery from failures
6. **Monitor logs** - Check for errors and issues
7. **Test on local first** - Before remote deployment
8. **Keep software updated** - Security patches

## Future Enhancements

- Docker-based installation option
- Multi-server deployment support
- Automatic backup rotation
- Health monitoring integration
- Custom installation hooks
- Rollback on failure
- Installation resume capability

