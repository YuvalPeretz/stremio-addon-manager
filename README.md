# Stremio Addon Manager

A comprehensive CLI and GUI tool for installing, managing, and maintaining private Stremio addons with centralized Real-Debrid integration.

## 🎯 Project Goal

Enable users to set up a private Stremio addon on a Raspberry Pi (or any Linux server) that acts as middleware for Real-Debrid streaming. This ensures all Real-Debrid API calls originate from a single IP address (the server), allowing multiple Stremio users from different public IPs to stream content while Real-Debrid only sees the server's IP for authentication.

## ✨ Features

- **🚀 One-Command Installation** - Automated deployment with interactive setup wizard
- **🔐 Security First** - Built-in firewall, fail2ban, and HTTPS/SSL support
- **🌐 Flexible Access** - Support for custom domains, DuckDNS, static IPs, and local networks
- **📦 Multi-Server Support** - Install locally or on remote servers via SSH
- **⚙️ Full Management** - Start, stop, restart, configure, and monitor your addon
- **📊 Real-Time Progress** - Live installation progress with detailed status updates
- **🔄 Auto-Start** - Optional service auto-start on system boot
- **💾 Backup System** - Automated backups with configurable retention
- **🛡️ Rate Limiting** - Protect your addon and Real-Debrid account from abuse
- **🎨 Modern UI** - Beautiful CLI with colors, spinners, and progress indicators

## 📦 Monorepo Structure

```
stremio-addon-manager/
├── packages/
│   ├── core/              # Core shared logic
│   │   ├── os/            # OS detection
│   │   ├── ssh/           # SSH management
│   │   ├── service/       # Service control
│   │   ├── config/        # Configuration management
│   │   ├── installation/  # Automated deployment
│   │   └── utils/         # Logger and utilities
│   │
│   ├── cli/               # Command-line interface
│   │   └── commands/      # CLI commands
│   │
│   ├── electron/          # Desktop GUI (Planned)
│   └── addon-server/      # Addon server (To be refactored)
│
└── development/
    ├── todo-cli-electron.md    # Implementation roadmap
    └── commands-list.json      # Command reference
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Git
- SSH access to target server (for remote installations)

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/stremio-addon-manager.git
cd stremio-addon-manager

# Install dependencies
npm install

# Build all packages
npm run build

# Run CLI
npx lerna run dev --scope=@stremio-addon-manager/cli
```

## 📖 Usage

### Install Addon

```bash
stremio-addon-manager install
```

Interactive installation wizard that guides you through:

1. **Installation Type** - Local or remote (SSH)
2. **Addon Configuration** - Name, domain, password, provider
3. **Access Method** - Custom domain, DuckDNS, static IP, or local network
4. **Features Selection** - Firewall, fail2ban, caching, rate limiting, backups
5. **Automated Deployment** - Prerequisites, SSL, service setup, and verification

### Manage Addon

```bash
# Check addon status
stremio-addon-manager status

# Start/stop/restart service
stremio-addon-manager start
stremio-addon-manager stop
stremio-addon-manager restart

# View logs
stremio-addon-manager logs
stremio-addon-manager logs --follow
stremio-addon-manager logs --lines 100

# Manage configuration
stremio-addon-manager config --show
stremio-addon-manager config --get addon.domain
stremio-addon-manager config --set addon.torrentLimit=20
stremio-addon-manager config --reset

# Uninstall addon
stremio-addon-manager uninstall
stremio-addon-manager uninstall --keep-config --keep-backups
```

## 🔧 Core Package (`@stremio-addon-manager/core`)

### Modules

#### OSDetector

Detects local and remote operating systems, distributions, and architectures.

```typescript
import { OSDetector } from '@stremio-addon-manager/core';

// Detect local OS
const systemInfo = OSDetector.detect();

// Detect remote OS via SSH
const remoteInfo = await OSDetector.detectRemote(sshConnection);
```

#### SSHManager

Manages SSH connections with file transfer and command execution.

```typescript
import { SSHManager } from '@stremio-addon-manager/core';

const ssh = new SSHManager({
  host: '192.168.0.50',
  port: 22,
  username: 'pi',
  privateKeyPath: '~/.ssh/id_rsa',
});

await ssh.connect();
const result = await ssh.execCommand('ls -la');
await ssh.transferFile('local.txt', '/remote/path/file.txt');
await ssh.disconnect();
```

#### ConfigManager

Manages YAML-based configuration with validation.

```typescript
import { ConfigManager } from '@stremio-addon-manager/core';

const configManager = new ConfigManager();
const config = await configManager.load();

configManager.setValue('addon', { name: 'My Addon', ...config.addon });
await configManager.save();
```

#### ServiceManager

Cross-platform service control (systemd/launchd/NSSM).

```typescript
import { ServiceManager } from '@stremio-addon-manager/core';

const service = new ServiceManager('stremio-addon');

await service.start();
await service.stop();
await service.restart();
const status = await service.status();
const logs = await service.logs(50);
```

#### InstallationManager

Orchestrates complete automated deployment.

```typescript
import { InstallationManager } from '@stremio-addon-manager/core';

const installManager = new InstallationManager({
  config,
  progressCallback: (progress) => {
    console.log(`[${progress.progress}%] ${progress.message}`);
  },
});

const result = await installManager.install();
```

#### Logger

Winston-based logging with file and console outputs.

```typescript
import { logger } from '@stremio-addon-manager/core';

logger.info('Installation started');
logger.error('Installation failed', error);
logger.debug('Checking prerequisites');
```

## 🎨 CLI Package (`@stremio-addon-manager/cli`)

### Commands

- `install` - Install addon with interactive wizard
- `status` - Check addon service status
- `start` - Start addon service
- `stop` - Stop addon service
- `restart` - Restart addon service
- `logs` - View service logs
- `config` - Manage configuration
- `uninstall` - Remove addon completely

### Features

- Interactive prompts with `inquirer`
- Beautiful spinners with `ora`
- Colored output with `chalk`
- Progress indicators
- Error handling with detailed messages

## 🔒 Security Features

### Firewall (UFW)

- Blocks all incoming traffic except SSH (22), HTTP (80), and HTTPS (443)
- Customizable rules for addon port
- Automatic configuration during installation

### fail2ban

- Protects SSH from brute-force attacks
- Bans IPs after 5 failed login attempts
- 1-hour ban duration
- Auto-starts on boot

### SSL/HTTPS

- **Mandatory for Stremio** - Stremio requires HTTPS for addon manifests
- Automated Let's Encrypt certificate generation
- Automatic renewal via Certbot
- Nginx reverse proxy with optimal settings

### Authentication

- Password-based addon access
- URL-embedded token for Stremio compatibility
- No special characters to avoid URL encoding issues

### Rate Limiting

- Stream endpoint: 50 requests per 15 minutes
- Stats endpoint: 120 requests per minute
- Protects Real-Debrid account from abuse

## 🌐 Network Configuration

### Access Methods

1. **Custom Domain** - Your own domain with HTTPS
2. **DuckDNS** - Free dynamic DNS with HTTPS
3. **Static IP + DuckDNS** - Static IP with DuckDNS domain
4. **Local Network** - LAN-only access (still requires HTTPS for Stremio)

### Requirements

- Domain pointing to server IP (A record)
- Ports 80 and 443 open for Let's Encrypt validation
- Port 443 open for HTTPS access
- Static IP (local) configured on router

## 📊 Installation Steps

The InstallationManager executes 17 automated steps:

1. **Connect** - SSH connection (remote only)
2. **Detect OS** - Operating system detection
3. **Check Prerequisites** - Verify required software
4. **Install Prerequisites** - Install missing software
5. **Setup Firewall** - Configure UFW
6. **Setup fail2ban** - SSH protection
7. **Clone Repository** - Download addon server
8. **Install Dependencies** - npm install
9. **Setup Nginx** - Reverse proxy configuration
10. **Setup SSL** - Let's Encrypt certificates
11. **Create Service** - systemd service file
12. **Start Service** - Launch addon
13. **Configure DuckDNS** - Dynamic DNS updater
14. **Create Backup** - Initial backup
15. **Verify Installation** - Health checks
16. **Cleanup** - Remove temporary files
17. **Complete** - Installation summary

## 🛠️ Development

### Build Commands

```bash
# Build all packages
npm run build

# Build specific package
npm run build:core

# Watch mode
npm run dev:cli

# Type checking
npm run type-check

# Linting
npm run lint

# Clean build artifacts
npm run clean
```

### Project Scripts

- `build` - Build all packages with Lerna
- `build:core` - Build core package only
- `dev:cli` - Watch mode for CLI
- `dev:electron` - Watch mode for Electron (planned)
- `type-check` - TypeScript type checking
- `lint` - ESLint code quality check
- `clean` - Remove build artifacts

## 📝 Configuration

Configuration is stored in `~/.stremio-addon-manager/config.yaml`:

```yaml
installation:
  type: local
  accessMethod: duckdns

addon:
  name: My_Private_Addon
  version: 1.0.0
  domain: mydomain.duckdns.org
  password: MySecurePassword123
  provider: real-debrid
  torrentLimit: 15
  port: 7000

features:
  firewall: true
  fail2ban: true
  caching:
    enabled: true
    ttl: 7200
    maxSize: 100
  rateLimiting:
    enabled: true
    stream: 50
    stats: 120
  authentication: true
  backups:
    enabled: true
    frequency: weekly
    retention: 7
  ssl: true
  duckdnsUpdater: false
  autoStart: true

paths:
  addonDirectory: /opt/stremio-addon
  nginxConfig: /etc/nginx/sites-available/stremio-addon
  serviceFile: /etc/systemd/system/stremio-addon.service
  logs: /var/log/stremio-addon
  backups: /var/backups/stremio-addon

secrets:
  realDebridToken: YOUR_RD_TOKEN
  duckdnsToken: YOUR_DUCKDNS_TOKEN
```

## 📚 Documentation

- [Core Package](packages/core/README.md) - Core modules documentation
- [Installation Manager](packages/core/src/installation/README.md) - Deployment guide
- [Development Roadmap](development/todo-cli-electron.md) - Implementation plan
- [Command Reference](development/commands-list.json) - All commands

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper TypeScript types
4. Add tests if applicable
5. Run linting and type checking
6. Submit a pull request

## 📄 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

- Stremio Addon SDK
- Real-Debrid API
- Node-SSH
- Commander.js
- Inquirer.js
- Winston Logger
- Lerna + npm workspaces

## 🗺️ Roadmap

### Phase 1: Core & CLI ✅
- [x] Monorepo structure with Lerna
- [x] TypeScript with strict mode
- [x] Core modules (OS, SSH, Service, Config, Installation)
- [x] CLI with all commands
- [x] InstallationManager with full automation

### Phase 2: Testing & Polish 🔄
- [ ] Unit tests for core modules
- [ ] Integration tests for installation
- [ ] CLI testing and bug fixes
- [ ] Documentation improvements

### Phase 3: Electron GUI 📅
- [ ] Electron app structure
- [ ] UI design and implementation
- [ ] Integration with core and CLI
- [ ] Packaged installers for Windows/Mac/Linux

### Phase 4: Advanced Features 🔮
- [ ] Docker-based installation
- [ ] Multi-server management
- [ ] Health monitoring dashboard
- [ ] Automatic updates
- [ ] Plugin system for custom providers

## 💬 Support

- Issues: [GitHub Issues](https://github.com/yourusername/stremio-addon-manager/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/stremio-addon-manager/discussions)

---

**Made with ❤️ for the Stremio community**

