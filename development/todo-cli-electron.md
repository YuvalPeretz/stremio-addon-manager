# Stremio Addon Manager - CLI & Electron App

## Project Overview

**Goal:** Create a comprehensive CLI tool and Electron GUI application that enables users to deploy, configure, and manage their own private Stremio addon with Real-Debrid (and future providers) on any machine.

**Current Status:** Planning Phase

**Password Reference:** YuvalStremio1313 (current implementation)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Components](#core-components)
3. [User Journey](#user-journey)
4. [Technical Stack](#technical-stack)
5. [Features & Modules](#features--modules)
6. [Installation Flow](#installation-flow)
7. [Management Interface](#management-interface)
8. [Error Handling Strategy](#error-handling-strategy)
9. [Multi-OS Support](#multi-os-support)
10. [Security Considerations](#security-considerations)
11. [Development Phases](#development-phases)
12. [Testing Strategy](#testing-strategy)
13. [Future Enhancements](#future-enhancements)

---

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User's Computer                          │
│  ┌────────────────────┐      ┌──────────────────────┐      │
│  │   CLI Tool         │      │   Electron App       │      │
│  │  (Node.js)         │◄─────┤   (GUI Wrapper)      │      │
│  └────────┬───────────┘      └──────────────────────┘      │
│           │                                                  │
│           ├─► Local Installation (Same Machine)             │
│           │                                                  │
│           └─► Remote Installation (SSH)                     │
│                      │                                       │
└──────────────────────┼───────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Target Server (Local or Remote)                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Stremio Addon (Node.js)                              │  │
│  │  ├─ Express Server                                    │  │
│  │  ├─ Real-Debrid Integration                           │  │
│  │  ├─ Torrentio Integration                             │  │
│  │  ├─ Caching Layer (node-cache)                        │  │
│  │  └─ Authentication Middleware                         │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Nginx (Reverse Proxy + SSL)                          │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  System Services                                      │  │
│  │  ├─ systemd/Windows Service/launchd                  │  │
│  │  ├─ UFW/Windows Firewall                             │  │
│  │  ├─ fail2ban (Linux)                                 │  │
│  │  └─ Certbot (SSL Management)                         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Stremio Client → HTTPS (443) → Nginx → Node.js Addon → Real-Debrid API
                                    ↓
                              Cache Layer
                                    ↓
                              Torrentio API
```

---

## Core Components

### 1. CLI Tool (`stremio-addon-manager`)

**Technology:** Node.js with Commander.js

**Features:**

- Interactive installation wizard
- Configuration management
- Service management (start, stop, restart, status)
- Log viewing and monitoring
- Backup and restore
- Update management
- Uninstallation

**Commands Structure:**

```bash
stremio-addon-manager install      # Start installation wizard
stremio-addon-manager start        # Start the addon service
stremio-addon-manager stop         # Stop the addon service
stremio-addon-manager restart      # Restart the addon service
stremio-addon-manager status       # Check addon status
stremio-addon-manager logs         # View logs (with tail support)
stremio-addon-manager config       # Manage configuration
stremio-addon-manager backup       # Create backup
stremio-addon-manager restore      # Restore from backup
stremio-addon-manager update       # Update addon
stremio-addon-manager uninstall    # Remove addon
stremio-addon-manager info         # Display addon info
```

### 2. Electron App (`Stremio Addon Manager`)

**Technology:** Electron + React + Tailwind CSS

**Features:**

- Visual installation wizard
- Real-time status dashboard
- Log viewer with search/filter
- Configuration editor (GUI forms)
- One-click service controls
- Statistics and analytics
- Backup/restore interface
- Update notifications

**Screens:**

1. **Welcome Screen** - Introduction and quick start
2. **Installation Wizard** - Step-by-step setup
3. **Dashboard** - Status overview, quick actions
4. **Logs** - Real-time log viewer
5. **Configuration** - Settings management
6. **Statistics** - Usage analytics, cache stats
7. **Backups** - Backup management
8. **Settings** - App preferences

### 3. Addon Server (Git Repository)

**Technology:** Node.js + Express + Stremio SDK

**Structure:**

```
stremio-addon-server/
├── src/
│   ├── server.js              # Main server file
│   ├── providers/             # Provider integrations
│   │   ├── base-provider.js   # Abstract provider class
│   │   ├── real-debrid.js     # Real-Debrid implementation
│   │   └── [future-providers] # Extensible for more
│   ├── services/
│   │   ├── cache.js           # Caching service
│   │   ├── torrent-search.js  # Torrentio integration
│   │   └── metadata.js        # Cinemeta integration
│   ├── middleware/
│   │   ├── auth.js            # Authentication
│   │   ├── rate-limit.js      # Rate limiting
│   │   └── error-handler.js   # Error handling
│   ├── routes/
│   │   ├── addon.js           # Stremio addon routes
│   │   ├── stats.js           # Statistics endpoint
│   │   └── landing.js         # Landing page
│   └── config/
│       └── default.js         # Default configuration
├── public/
│   └── landing.html           # Landing page
├── package.json
└── README.md
```

---

## User Journey

### Installation Flow

#### Step 1: Machine Selection

```
┌─────────────────────────────────────────┐
│  Where do you want to install?          │
│  ○ This machine (local)                 │
│  ○ Remote machine (SSH)                 │
└─────────────────────────────────────────┘
```

**If Remote Selected:**

```
┌─────────────────────────────────────────┐
│  Remote Machine Details                 │
│  ┌─────────────────────────────────┐   │
│  │ Host/IP: _________________      │   │
│  │ Port:    ___22___               │   │
│  │ Username: ________________      │   │
│  │ Password: ________________      │   │
│  └─────────────────────────────────┘   │
│                                         │
│  What OS is the remote machine?         │
│  ○ Linux (Ubuntu/Debian)                │
│  ○ Raspberry Pi OS                      │
│  ○ Windows                              │
│  ○ macOS                                │
└─────────────────────────────────────────┘
```

**SSH Setup Process:**

1. Test SSH connection
2. Detect OS automatically (if possible)
3. Generate SSH key pair on user's machine
4. Copy public key to remote machine
5. Test passwordless SSH access
6. Display instructions if manual steps needed

#### Step 2: Prerequisites Check

**System Requirements:**

- Node.js (v18 or higher)
- npm (v9 or higher)
- nginx
- Git
- systemd (Linux) / Windows Service / launchd (macOS)
- certbot + certbot-dns-duckdns
- Python 3 (for certbot)
- 500MB free disk space
- 512MB RAM minimum

**Check & Install:**

```
Checking prerequisites...
✓ Node.js 18.17.0 detected
✗ nginx not found → Installing...
✓ Git 2.34.1 detected
...
```

#### Step 3: Network Configuration

**3.1 Choose Access Method:**

```
┌─────────────────────────────────────────┐
│  How will users access your addon?     │
│                                         │
│  ○ Custom Domain (I own a domain)       │
│  ○ DuckDNS (Free dynamic DNS)           │
│  ○ Static Public IP (No domain)         │
│  ○ Local Network Only (No internet)     │
└─────────────────────────────────────────┘
```

**Option A: Custom Domain**

```
┌─────────────────────────────────────────┐
│  Custom Domain Configuration            │
│  ┌─────────────────────────────────┐   │
│  │ Domain:                          │   │
│  │ addon.example.com                │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Current Machine IP: 192.168.0.50       │
│  Public IP: 203.0.113.45                │
│                                         │
│  ⚠ Ensure DNS is configured:            │
│  □ A record points to 203.0.113.45      │
│  □ Port forward 80 → 192.168.0.50:80    │
│  □ Port forward 443 → 192.168.0.50:443  │
│                                         │
│  [ ] I have completed these steps       │
└─────────────────────────────────────────┘
```

**Option B: DuckDNS (Recommended)**

```
┌─────────────────────────────────────────┐
│  DuckDNS Configuration                  │
│  ┌─────────────────────────────────┐   │
│  │ DuckDNS Domain:                  │   │
│  │ _______________.duckdns.org      │   │
│  │                                  │   │
│  │ DuckDNS Token:                   │   │
│  │ _________________________        │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Current Machine IP: 192.168.0.50       │
│                                         │
│  ⚠ Important Steps (Manual):            │
│  □ Set static IP in router              │
│  □ Port forward 80 → 192.168.0.50:80    │
│  □ Port forward 443 → 192.168.0.50:443  │
│                                         │
│  ✓ DuckDNS will auto-update your IP     │
│                                         │
│  [ ] I have completed these steps       │
└─────────────────────────────────────────┘
```

**Option C: Static Public IP**

```
┌─────────────────────────────────────────┐
│  Static IP Configuration                │
│                                         │
│  Public IP: 203.0.113.45                │
│  Local IP: 192.168.0.50                 │
│                                         │
│  ⚠ IMPORTANT: Stremio requires HTTPS    │
│  • SSL certificates require a domain    │
│  • We recommend using DuckDNS (free)    │
│  • Your DuckDNS will point to this IP   │
│                                         │
│  Use DuckDNS for SSL certificate?       │
│  ● Yes, setup DuckDNS (Recommended)     │
│  ○ No, I have my own domain             │
│                                         │
│  [If Yes selected, show DuckDNS fields] │
│  ┌─────────────────────────────────┐   │
│  │ DuckDNS Domain:                  │   │
│  │ _______________.duckdns.org      │   │
│  │ DuckDNS Token: ________________  │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

**Option D: Local Network Only**

```
┌─────────────────────────────────────────┐
│  Local Network Configuration            │
│                                         │
│  Local IP: 192.168.0.50                 │
│                                         │
│  ⚠ IMPORTANT: Stremio requires HTTPS    │
│  • Even for local network access        │
│  • We'll use DuckDNS for free SSL       │
│  • DNS challenge (no public access)     │
│                                         │
│  DuckDNS Configuration (Required):      │
│  ┌─────────────────────────────────┐   │
│  │ DuckDNS Domain:                  │   │
│  │ _______________.duckdns.org      │   │
│  │                                  │   │
│  │ DuckDNS Token:                   │   │
│  │ _________________________        │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ✓ No port forwarding (local only)      │
│  ✓ Valid SSL certificate (DNS challenge)│
│  ✓ Only accessible from local network   │
│                                         │
│  Access URL: https://mydomain.duckdns.org│
│  (resolves to 192.168.0.50)             │
│                                         │
│  [ Continue ]                           │
└─────────────────────────────────────────┘
```

**Validation:**

- **Custom Domain**: Test DNS resolution, verify A record, confirm HTTPS accessibility
- **DuckDNS**: Test token, verify domain registration, check DNS propagation, confirm DNS challenge works
- **Static IP + Domain**: Verify IP is accessible, test port forwarding, verify domain points to IP
- **Local Network + Domain**: Verify local IP is reachable on LAN, confirm DNS challenge works without port forwarding

**Critical Note:** All validation must confirm HTTPS accessibility with valid certificate. HTTP-only setups will be rejected.

#### Step 4: Provider Configuration

```
┌─────────────────────────────────────────┐
│  Streaming Provider Selection           │
│  ┌─────────────────────────────────┐   │
│  │ ● Real-Debrid                    │   │
│  │ ○ AllDebrid (Coming Soon)        │   │
│  │ ○ Premiumize (Coming Soon)       │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Real-Debrid API Token:                 │
│  ┌─────────────────────────────────┐   │
│  │ ___________________________     │   │
│  └─────────────────────────────────┘   │
│  [?] How to get your API token          │
└─────────────────────────────────────────┘
```

**Token Validation:**

- Test API token with Real-Debrid
- Check account status
- Verify subscription

#### Step 5: Addon Configuration

```
┌─────────────────────────────────────────┐
│  Addon Settings                         │
│  ┌─────────────────────────────────┐   │
│  │ Addon Name:                      │   │
│  │ My_Private_Addon                 │   │
│  │                                  │   │
│  │ Addon Password:                  │   │
│  │ _______________                  │   │
│  │ (For installation protection)    │   │
│  │                                  │   │
│  │ Torrent Fetch Limit:             │   │
│  │ [5] [10] [●15] [20] [25]         │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

#### Step 6: Feature Selection

```
┌─────────────────────────────────────────┐
│  Features & Security                    │
│                                         │
│  [✓] Firewall (UFW/Windows Firewall)   │
│      └─ Port 22, 80, 443 only           │
│                                         │
│  [✓] Intrusion Prevention (fail2ban)    │
│      └─ Linux only                      │
│                                         │
│  [✓] Caching (In-Memory)                │
│      ├─ Cache TTL: [1h] [●2h] [6h]      │
│      └─ Max Cache Size: [50MB] [●100MB] │
│                                         │
│  [✓] Rate Limiting                      │
│      ├─ Stream: [●50] per 15 min        │
│      └─ Stats: [●120] per minute        │
│                                         │
│  [✓] Authentication                     │
│      └─ Required for addon access       │
│                                         │
│  [✓] Automated Backups                  │
│      ├─ Frequency: [Daily] [●Weekly]    │
│      └─ Retention: [●7] backups         │
│                                         │
│  [✓] HTTPS/SSL (REQUIRED - cannot disable)│
│      ├─ Custom Domain: Let's Encrypt    │
│      ├─ DuckDNS: Let's Encrypt + Auto   │
│      ├─ Static IP: Let's Encrypt        │
│      └─ Local: Let's Encrypt (DNS)      │
│                                         │
│  ⚠ Stremio requires valid HTTPS          │
│                                         │
│  [✓] Auto-start on Boot                 │
│      └─ Start addon when server boots   │
│                                         │
│  [✓] IP Auto-Update (DuckDNS only)      │
│      └─ Update IP every 5 minutes       │
└─────────────────────────────────────────┘
```

**Dynamic Feature Notes:**

- **Firewall**: Only relevant if external access is enabled (not for Local Network Only)
- **SSL**: **ALWAYS REQUIRED** - Stremio will not work without valid HTTPS. Automatically configured via Let's Encrypt for all setups
- **IP Auto-Update**: Only shown/enabled when DuckDNS is selected
- **Port Forwarding**: Not needed for Local Network Only setup
- **DNS Challenge**: Used for Local Network Only (SSL without public access)
- **HTTP Challenge**: Used for publicly accessible setups (Custom Domain, DuckDNS with port forwarding, Static IP)

#### Step 7: Installation Process

```
┌─────────────────────────────────────────┐
│  Installing Stremio Addon...            │
│                                         │
│  [████████████████████░░] 85%           │
│                                         │
│  Current: Installing SSL certificate    │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ $ certbot certonly \             │   │
│  │     --non-interactive \          │   │
│  │     --agree-tos \                │   │
│  │     --email user@example.com \   │   │
│  │     --preferred-challenges dns \ │   │
│  │     --authenticator dns-duckdns \│   │
│  │     -d example.duckdns.org       │   │
│  │                                  │   │
│  │ ✓ Certificate obtained            │   │
│  │ ✓ Nginx configured                │   │
│  └─────────────────────────────────┘   │
│                                         │
│  [Show Details ▼]                       │
└─────────────────────────────────────────┘
```

**Installation Steps:**

1. ✓ Connect to target machine
2. ✓ Install prerequisites
3. ✓ Clone addon repository
4. ✓ Install npm dependencies
5. ✓ Configure environment variables
6. ✓ Setup firewall rules
7. ✓ Configure fail2ban (if Linux)
8. ✓ Setup Nginx reverse proxy
9. ✓ Obtain SSL certificate
10. ✓ Create systemd service
11. ✓ Start addon service
12. ✓ Configure DuckDNS updater
13. ✓ Create initial backup
14. ✓ Test addon endpoints

#### Step 8: Completion

```
┌─────────────────────────────────────────┐
│  ✓ Installation Complete!               │
│                                         │
│  Your addon is ready to use:            │
│                                         │
│  📍 Addon URL:                          │
│  https://example.duckdns.org/           │
│  /YourPassword/manifest.json            │
│                                         │
│  📋 Installation URL for Stremio:       │
│  ┌─────────────────────────────────┐   │
│  │ https://example.duckdns.org/     │   │
│  │ YourPassword/manifest.json       │   │
│  │                         [Copy]   │   │
│  └─────────────────────────────────┘   │
│                                         │
│  🎬 To install in Stremio:              │
│  1. Open Stremio                        │
│  2. Go to Addons                        │
│  3. Click "Install from URL"            │
│  4. Paste the URL above                 │
│                                         │
│  [ Open Dashboard ]  [ Open Addon URL ] │
└─────────────────────────────────────────┘
```

---

## Technical Stack

### CLI Tool

**Core:**

- Node.js v18+
- Commander.js (CLI framework)
- Inquirer.js (Interactive prompts)
- Ora (Spinners)
- Chalk (Colors)
- Boxen (Boxes)
- node-ssh (SSH operations)

**Utilities:**

- axios (HTTP requests)
- fs-extra (File operations)
- js-yaml (Config files)
- winston (Logging)
- semver (Version management)

### Electron App

**Frontend:**

- Electron v28+
- React 18
- Tailwind CSS
- Electron Store (Settings)
- Chart.js (Statistics)

**Backend (Main Process):**

- Node.js
- Same utilities as CLI
- electron-log (Logging)
- electron-updater (Auto-updates)

### Addon Server

**Runtime:**

- Node.js v18+
- Express.js
- Stremio Addon SDK
- node-cache
- express-rate-limit
- cors
- axios

**Services:**

- Nginx (Reverse proxy)
- Certbot + certbot-dns-duckdns (SSL)
- systemd / Windows Service / launchd
- UFW / Windows Firewall
- fail2ban (Linux only)

---

## Features & Modules

### Module 1: Installation Manager

**Responsibilities:**

- Detect target OS
- Install prerequisites
- Clone repository
- Configure addon
- Setup services

**Functions:**

```javascript
class InstallationManager {
  async detectOS()
  async checkPrerequisites()
  async installPrerequisites()
  async cloneRepository()
  async installDependencies()
  async configureEnvironment()
  async setupFirewall()
  async setupFail2ban()
  async configureNginx()
  async obtainSSLCertificate()
  async createService()
  async startService()
  async testEndpoints()
  async createBackup()
}
```

### Module 2: SSH Manager

**Responsibilities:**

- Establish SSH connections
- Execute remote commands
- Transfer files (SCP)
- Setup SSH keys
- Handle connection errors

**Functions:**

```javascript
class SSHManager {
  async connect(host, port, username, password)
  async executeCommand(command)
  async executeSudo(command)
  async transferFile(localPath, remotePath)
  async setupSSHKey()
  async testConnection()
  async disconnect()
}
```

### Module 3: Configuration Manager

**Responsibilities:**

- Load/save configuration
- Validate settings
- Update configuration
- Manage secrets

**Configuration Structure:**

```yaml
# ~/.stremio-addon-manager/config.yaml
installation:
  type: remote # local or remote
  target:
    host: 192.168.0.50
    port: 22
    username: yuval
    os: linux
addon:
  name: My_Private_Addon
  version: 1.0.0
  domain: example.duckdns.org
  password: YourPassword
  provider: real-debrid
  torrent_limit: 15
features:
  firewall: true
  fail2ban: true
  caching:
    enabled: true
    ttl: 7200
    max_size: 100
  rate_limiting:
    enabled: true
    stream: 50
    stats: 120
  authentication: true
  backups:
    enabled: true
    frequency: weekly
    retention: 7
  ssl: true
  duckdns_updater: true
paths:
  addon_directory: /home/yuval/stremio-addon
  nginx_config: /etc/nginx/sites-available/stremio-addon
  service_file: /etc/systemd/system/stremio-addon.service
  logs: /var/log/stremio-addon
  backups: /home/yuval/stremio-addon-backups
secrets:
  real_debrid_token: encrypted_token
  duckdns_token: encrypted_token
```

### Module 4: Service Manager

**Responsibilities:**

- Start/stop/restart services
- Check service status
- View logs
- Auto-restart on failure

**Functions:**

```javascript
class ServiceManager {
  async start()
  async stop()
  async restart()
  async status()
  async enable() // Start on boot
  async disable()
  async logs(lines, follow)
}
```

### Module 5: Backup Manager

**Responsibilities:**

- Create backups
- Restore from backups
- Schedule automatic backups
- Manage backup retention

**Backup Contents:**

- Configuration files
- Environment variables
- Nginx configuration
- SSL certificates
- Service files
- Custom landing page

**Functions:**

```javascript
class BackupManager {
  async createBackup(name)
  async listBackups()
  async restoreBackup(name)
  async deleteBackup(name)
  async scheduleBackups(frequency)
}
```

### Module 6: Update Manager

**Responsibilities:**

- Check for updates
- Download updates
- Apply updates
- Rollback if needed

**Functions:**

```javascript
class UpdateManager {
  async checkForUpdates()
  async downloadUpdate(version)
  async applyUpdate()
  async rollback()
}
```

### Module 7: Monitoring Manager

**Responsibilities:**

- Collect statistics
- Monitor system resources
- Track API usage
- Alert on issues

**Metrics:**

- Uptime
- Request count
- Cache hit rate
- Response times
- Error rates
- Memory usage
- CPU usage
- Disk space

### Module 8: SSL Manager

**Responsibilities:**

- Obtain certificates
- Renew certificates
- Configure auto-renewal
- Handle DNS validation

**Functions:**

```javascript
class SSLManager {
  async obtainCertificate(domain, email, duckdnsToken)
  async renewCertificate()
  async setupAutoRenewal()
  async validateCertificate()
}
```

### Module 9: Provider Manager

**Responsibilities:**

- Manage provider integrations
- Validate API tokens
- Switch providers
- Add new providers

**Supported Providers:**

- Real-Debrid (Current)
- AllDebrid (Future)
- Premiumize (Future)
- Torbox (Future)

**Provider Interface:**

```javascript
class BaseProvider {
  constructor(apiToken) {}
  async validateToken()
  async addMagnet(magnetLink)
  async getTorrentInfo(torrentId)
  async selectFiles(torrentId, fileIds)
  async unrestrictLink(link)
  async getCachedAvailability(infoHashes)
}
```

---

## Installation Flow

### Detailed Step-by-Step Process

#### Phase 1: Pre-Installation

**1.1 Welcome & Introduction**

- Display welcome message
- Explain what the tool does
- Show prerequisites
- Confirm user wants to continue

**1.2 Machine Selection**

- Ask: Local or Remote?
- If remote: Collect SSH details
- Test SSH connection
- Detect OS

**1.3 SSH Key Setup (if remote)**

- Generate SSH key pair
- Copy public key to remote
- Test passwordless access
- Store connection details

#### Phase 2: Prerequisites

**2.1 System Check**

- Check OS version
- Check architecture (x64, ARM)
- Check available disk space
- Check RAM

**2.2 Software Check**

```javascript
const prerequisites = {
  node: { version: ">=18.0.0", command: "node --version" },
  npm: { version: ">=9.0.0", command: "npm --version" },
  nginx: { version: ">=1.18.0", command: "nginx -v" },
  git: { version: ">=2.0.0", command: "git --version" },
  python3: { version: ">=3.7.0", command: "python3 --version" },
  pip3: { version: ">=20.0.0", command: "pip3 --version" },
  certbot: { version: ">=1.0.0", command: "certbot --version" },
};
```

**2.3 Install Missing Prerequisites**

- Ubuntu/Debian: `apt-get install`
- Raspberry Pi: `apt-get install`
- macOS: `brew install`
- Windows: Use Chocolatey or manual download

**Error Handling:**

- If installation fails, provide manual instructions
- Log all errors
- Allow retry
- Allow skip (with warning)

#### Phase 3: Network Configuration

**3.1 Collect DuckDNS Details**

- Domain name
- Token
- Validate token

**3.2 Network Detection**

- Detect machine's local IP
- Check if IP is static
- Test internet connectivity

**3.3 Manual Steps Checklist**

- Explain each step clearly
- Provide router-specific guides (if possible)
- Wait for user confirmation
- Offer help/documentation links

**3.4 Port Testing**

- Test if port 80 is accessible
- Test if port 443 is accessible
- If not accessible, guide troubleshooting

**Error Handling:**

- DuckDNS token invalid → Ask to re-enter
- Ports not accessible → Show troubleshooting guide
- Domain doesn't resolve → Check DNS propagation

#### Phase 4: Provider Configuration

**4.1 Select Provider**

- Display available providers
- Show "Coming Soon" for future providers
- Collect provider-specific details

**4.2 Real-Debrid Setup**

- Collect API token
- Validate token
- Check account status
- Verify premium subscription

**4.3 Test Provider Connection**

- Make test API call
- Verify authentication
- Check rate limits

**Error Handling:**

- Invalid token → Ask to re-enter
- API unreachable → Check internet
- Account expired → Show upgrade instructions

#### Phase 5: Addon Configuration

**5.1 Basic Settings**

- Addon name (alphanumeric, no spaces)
- Addon password (for installation protection)
- Torrent fetch limit (5-25)

**5.2 Feature Selection**

- Display feature list
- Explain each feature
- Set default values
- Allow customization

**5.3 Advanced Settings (Optional)**

- Cache TTL
- Rate limit values
- Backup frequency
- Log retention

**Error Handling:**

- Invalid addon name → Show format requirements
- Weak password → Suggest stronger password
- Invalid limits → Show min/max values

#### Phase 6: Installation Execution

**6.1 Create Installation Plan**

- Generate step-by-step plan
- Estimate time
- Show to user for confirmation

**6.2 Execute Steps (with progress bar)**

**Step 1: Clone Repository**

```bash
cd /home/user
git clone https://github.com/yourusername/stremio-addon-server.git
cd stremio-addon-server
```

**Step 2: Install Dependencies**

```bash
npm install --production
```

**Step 3: Create Environment File**

```bash
cat > .env << EOL
RD_API_TOKEN=your_token
ADDON_PASSWORD=YourPassword
PORT=7000
EOL
```

**Step 4: Setup Firewall (Linux)**

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

**Step 5: Setup fail2ban (Linux)**

```bash
sudo apt-get install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

**Step 6: Configure Nginx**

```bash
sudo cat > /etc/nginx/sites-available/stremio-addon << 'EOL'
server {
    listen 80;
    server_name example.duckdns.org;
    location / {
        proxy_pass http://localhost:7000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOL
sudo ln -s /etc/nginx/sites-available/stremio-addon /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Step 7: Install Certbot DuckDNS Plugin**

```bash
sudo pip3 install certbot-dns-duckdns
```

**Step 8: Obtain SSL Certificate**

```bash
# Create credentials file
mkdir -p /home/user/.secrets/certbot
cat > /home/user/.secrets/certbot/duckdns.ini << EOL
dns_duckdns_token=your_duckdns_token
EOL
chmod 600 /home/user/.secrets/certbot/duckdns.ini

# Obtain certificate
sudo certbot certonly \
  --non-interactive \
  --agree-tos \
  --email user@example.com \
  --preferred-challenges dns \
  --authenticator dns-duckdns \
  --dns-duckdns-credentials /home/user/.secrets/certbot/duckdns.ini \
  --dns-duckdns-propagation-seconds 60 \
  -d example.duckdns.org
```

**Step 9: Update Nginx for HTTPS**

```bash
sudo cat > /etc/nginx/sites-available/stremio-addon << 'EOL'
server {
    listen 80;
    server_name example.duckdns.org;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.duckdns.org;

    ssl_certificate /etc/letsencrypt/live/example.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.duckdns.org/privkey.pem;

    location / {
        proxy_pass http://localhost:7000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOL
sudo nginx -t
sudo systemctl reload nginx
```

**Step 10: Setup Auto-Renewal**

```bash
# Certbot already sets up a systemd timer for renewal
sudo systemctl status certbot.timer
```

**Step 11: Create Systemd Service**

```bash
sudo cat > /etc/systemd/system/stremio-addon.service << EOL
[Unit]
Description=Stremio Addon Server
After=network.target

[Service]
Type=simple
User=user
WorkingDirectory=/home/user/stremio-addon-server
Environment="NODE_ENV=production"
Environment="RD_API_TOKEN=your_token"
Environment="ADDON_PASSWORD=YourPassword"
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOL

sudo systemctl daemon-reload
sudo systemctl enable stremio-addon
sudo systemctl start stremio-addon
```

**Step 12: Setup DuckDNS Updater (Cron)**

```bash
# Create update script
cat > /home/user/duckdns-update.sh << 'EOL'
#!/bin/bash
curl "https://www.duckdns.org/update?domains=example&token=your_token&ip="
EOL
chmod +x /home/user/duckdns-update.sh

# Add to crontab (every 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * /home/user/duckdns-update.sh >/dev/null 2>&1") | crontab -
```

**Step 13: Test Endpoints**

```bash
# Test HTTP redirect
curl -I http://example.duckdns.org

# Test HTTPS
curl -I https://example.duckdns.org

# Test manifest
curl https://example.duckdns.org/YourPassword/manifest.json

# Test stats
curl https://example.duckdns.org/stats
```

**Step 14: Create Initial Backup**

```bash
mkdir -p /home/user/stremio-addon-backups
tar -czf /home/user/stremio-addon-backups/initial-backup-$(date +%Y%m%d-%H%M%S).tar.gz \
  /home/user/stremio-addon-server \
  /etc/nginx/sites-available/stremio-addon \
  /etc/systemd/system/stremio-addon.service \
  /home/user/.secrets/certbot/duckdns.ini
```

**6.3 Error Handling for Each Step**

- Log all commands and outputs
- On error: Show error message
- Offer options: Retry, Skip, Abort
- Provide troubleshooting hints
- Save progress state

**6.4 Rollback on Failure**

- Keep track of changes made
- If critical step fails, rollback
- Remove installed packages
- Delete created files
- Restore previous state

#### Phase 7: Post-Installation

**7.1 Verification**

- Check service status
- Test all endpoints
- Verify SSL certificate
- Check firewall rules
- Test DuckDNS resolution

**7.2 Generate Report**

- Installation summary
- Addon URL
- Service status
- Next steps

**7.3 Setup Dashboard**

- Save configuration
- Initialize monitoring
- Setup log rotation

---

## Management Interface

### CLI Management Commands

#### 1. Service Control

```bash
# Start addon
stremio-addon-manager start
  → Starting Stremio Addon...
  → ✓ Service started successfully
  → Status: Active (running)

# Stop addon
stremio-addon-manager stop
  → Stopping Stremio Addon...
  → ✓ Service stopped
  → Status: Inactive (dead)

# Restart addon
stremio-addon-manager restart
  → Restarting Stremio Addon...
  → ✓ Service restarted
  → Uptime: 2 seconds

# Enable auto-start on boot
stremio-addon-manager enable
  → Enabling Stremio Addon to start on boot...
  → ✓ Auto-start enabled
  → The addon will now start automatically when the system boots

# Disable auto-start on boot
stremio-addon-manager disable
  → Disabling auto-start...
  → ✓ Auto-start disabled
  → The addon will NOT start automatically on system boot

# Status check
stremio-addon-manager status
  → Stremio Addon Status
  → ─────────────────────────────
  → Status: Active (running)
  → Auto-start: Enabled
  → Uptime: 2d 14h 32m
  → Memory: 145MB
  → CPU: 2.3%
  → Requests: 1,234
  → Cache Hit Rate: 87%
```

#### 2. Log Viewing

```bash
# View logs (last 50 lines)
stremio-addon-manager logs

# Follow logs (tail -f)
stremio-addon-manager logs --follow

# View specific number of lines
stremio-addon-manager logs --lines 100

# Filter logs
stremio-addon-manager logs --level error
stremio-addon-manager logs --grep "Real-Debrid"
```

#### 3. Configuration Management

```bash
# Show current config
stremio-addon-manager config show

# Edit config interactively
stremio-addon-manager config edit

# Update specific setting
stremio-addon-manager config set torrent_limit 20
stremio-addon-manager config set features.rate_limiting.stream 100

# Reset to defaults
stremio-addon-manager config reset
```

#### 4. Backup & Restore

```bash
# Create backup
stremio-addon-manager backup create
  → Creating backup...
  → ✓ Backup created: backup-20260104-153045.tar.gz

# List backups
stremio-addon-manager backup list
  → Available Backups:
  → 1. backup-20260104-153045.tar.gz (2.3MB) - 5 minutes ago
  → 2. backup-20260103-120000.tar.gz (2.1MB) - 1 day ago
  → 3. backup-20260102-120000.tar.gz (2.0MB) - 2 days ago

# Restore backup
stremio-addon-manager backup restore backup-20260104-153045.tar.gz
  → This will stop the addon and restore from backup.
  → Continue? (y/n): y
  → Stopping service...
  → Restoring files...
  → Starting service...
  → ✓ Backup restored successfully

# Delete backup
stremio-addon-manager backup delete backup-20260102-120000.tar.gz
```

#### 5. Updates

```bash
# Check for updates
stremio-addon-manager update check
  → Current version: 1.0.0
  → Latest version: 1.2.0
  → Update available!
  → Changelog:
  →   - Added AllDebrid support
  →   - Improved caching
  →   - Bug fixes

# Update addon
stremio-addon-manager update install
  → Downloading update...
  → Creating backup...
  → Stopping service...
  → Applying update...
  → Starting service...
  → ✓ Update completed successfully
  → New version: 1.2.0

# Rollback to previous version
stremio-addon-manager update rollback
```

#### 6. Information

```bash
# Show addon info
stremio-addon-manager info
  → Stremio Addon Information
  → ═══════════════════════════════════
  → Name: My_Private_Addon
  → Version: 1.0.0
  → Domain: example.duckdns.org
  → Provider: Real-Debrid
  →
  → URLs:
  → Landing: https://example.duckdns.org/
  → Manifest: https://example.duckdns.org/YourPassword/manifest.json
  →
  → Features:
  → ✓ Firewall
  → ✓ Intrusion Prevention
  → ✓ Caching (TTL: 2h)
  → ✓ Rate Limiting
  → ✓ Authentication
  → ✓ Automated Backups
  → ✓ HTTPS/SSL
  →
  → Statistics:
  → Uptime: 2d 14h 32m
  → Total Requests: 1,234
  → Cache Hit Rate: 87%
  → SSL Valid Until: 2026-03-05

# Show system info
stremio-addon-manager info --system
  → System Information
  → ─────────────────────────────
  → OS: Linux (Ubuntu 22.04)
  → Architecture: x64
  → CPU: 4 cores
  → Memory: 2GB / 4GB (50%)
  → Disk: 8GB / 32GB (25%)
  → Node.js: v18.17.0
  → npm: v9.8.1
```

#### 7. Uninstallation

```bash
# Uninstall addon
stremio-addon-manager uninstall
  → This will remove all addon files and configuration.
  → Do you want to create a backup first? (y/n): y
  → Creating backup...
  → ✓ Backup created
  →
  → Remove the following?
  → [✓] Addon files
  → [✓] Nginx configuration
  → [✓] Systemd service
  → [✓] SSL certificates
  → [✓] Firewall rules
  → [ ] Backups (keep)
  → [ ] Logs (keep)
  →
  → Proceed with uninstallation? (y/n): y
  → Stopping service...
  → Removing files...
  → Cleaning up...
  → ✓ Uninstallation complete
```

### Electron Dashboard

#### Dashboard Screen

```
┌────────────────────────────────────────────────────────────┐
│  Stremio Addon Manager                    🟢 Active         │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │   Quick Stats    │  │  Service Status  │               │
│  ├──────────────────┤  ├──────────────────┤               │
│  │ Uptime: 2d 14h   │  │ ● Running        │               │
│  │ Requests: 1,234  │  │ Memory: 145MB    │               │
│  │ Cache: 87%       │  │ CPU: 2.3%        │               │
│  └──────────────────┘  └──────────────────┘               │
│                                                            │
│  Quick Actions                                             │
│  [ Restart ]  [ Stop ]  [ View Logs ]  [ Settings ]       │
│                                                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Requests Over Time                                 │  │
│  │                                                     │  │
│  │  [Line Chart showing request volume]               │  │
│  │                                                     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
│  Recent Activity                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 15:32  Stream request for "Movie Title" ✓          │  │
│  │ 15:31  Cache hit for torrent search                │  │
│  │ 15:29  Stream request for "Series S01E05" ✓        │  │
│  │ 15:28  Real-Debrid API call: addMagnet ✓           │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
│  [ ← ] Dashboard | Logs | Config | Stats | Backups        │
└────────────────────────────────────────────────────────────┘
```

#### Log Viewer

```
┌────────────────────────────────────────────────────────────┐
│  Logs                                                       │
├────────────────────────────────────────────────────────────┤
│  [🔍 Search logs...]         [Level: All ▼] [Follow: On]   │
│  ┌────────────────────────────────────────────────────┐   │
│  │ 2026-01-04 15:32:14 [INFO] Stream request received  │   │
│  │   Type: movie, ID: tt1234567                        │   │
│  │ 2026-01-04 15:32:14 [INFO] Searching torrents...    │   │
│  │ 2026-01-04 15:32:15 [INFO] Found 15 torrents        │   │
│  │ 2026-01-04 15:32:15 [INFO] Processing top 15...     │   │
│  │ 2026-01-04 15:32:16 [INFO] Real-Debrid: Adding...   │   │
│  │ 2026-01-04 15:32:17 [SUCCESS] Stream ready           │   │
│  │ 2026-01-04 15:32:17 [INFO] Response sent (632ms)    │   │
│  │                                                      │   │
│  │ [Auto-scrolling...]                                 │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  [ Export Logs ]  [ Clear ]  [ Settings ]                 │
│                                                            │
│  Dashboard | [ ← ] Logs | Config | Stats | Backups        │
└────────────────────────────────────────────────────────────┘
```

#### Configuration Editor

```
┌────────────────────────────────────────────────────────────┐
│  Configuration                                              │
├────────────────────────────────────────────────────────────┤
│  ┌─ Addon Settings ────────────────────────────────────┐  │
│  │  Addon Name:      [My_Private_Addon            ]    │  │
│  │  Addon Password:  [●●●●●●●●●●●●●●●]  [Change]      │  │
│  │  Domain:          [example.duckdns.org         ]    │  │
│  │  Torrent Limit:   [15 ▼] (5-25)                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ Provider ──────────────────────────────────────────┐  │
│  │  Provider:        [● Real-Debrid ▼]                  │  │
│  │  API Token:       [●●●●●●●●●●●●●●●]  [Test] [Change] │  │
│  │  Status:          ✓ Connected                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ Features ──────────────────────────────────────────┐  │
│  │  [✓] Caching                                         │  │
│  │      Cache TTL:      [2 ▼] hours                     │  │
│  │      Max Size:       [100 ▼] MB                      │  │
│  │                                                       │  │
│  │  [✓] Rate Limiting                                   │  │
│  │      Stream:         [50 ] per 15 minutes            │  │
│  │      Stats:          [120] per minute                │  │
│  │                                                       │  │
│  │  [✓] Automated Backups                               │  │
│  │      Frequency:      [● Weekly ▼]                     │  │
│  │      Retention:      [7 ▼] backups                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  [ Reset to Defaults ]              [ Save ]  [ Cancel ]  │
│                                                            │
│  Dashboard | Logs | [ ← ] Config | Stats | Backups        │
└────────────────────────────────────────────────────────────┘
```

---

## Error Handling Strategy

### Error Categories

#### 1. Connection Errors

- **SSH Connection Failed**

  - Retry with exponential backoff
  - Verify host/port/username
  - Check SSH service is running
  - Provide manual SSH troubleshooting

- **Network Unreachable**
  - Check internet connection
  - Test DNS resolution
  - Ping target host
  - Verify firewall settings

#### 2. Permission Errors

- **Permission Denied**

  - Check user permissions
  - Suggest using sudo
  - Verify file ownership
  - Check SELinux/AppArmor

- **Port Already in Use**
  - Identify process using port
  - Offer to stop conflicting service
  - Suggest alternative port

#### 3. Configuration Errors

- **Invalid Token**

  - Verify token format
  - Test API connection
  - Provide token retrieval instructions
  - Allow re-entry

- **Invalid Domain**
  - Check domain format
  - Verify DNS resolution
  - Test DuckDNS token
  - Suggest alternatives

#### 4. Installation Errors

- **Package Installation Failed**

  - Check available disk space
  - Verify package manager
  - Update package lists
  - Provide manual install instructions

- **Service Creation Failed**
  - Check systemd availability
  - Verify service file syntax
  - Check file permissions
  - Provide manual service setup

#### 5. SSL Errors

- **Certificate Obtainment Failed**

  - Verify domain ownership
  - Check DNS propagation
  - Verify DuckDNS token
  - Check rate limits
  - Offer staging environment

- **Certificate Renewal Failed**
  - Check certbot configuration
  - Verify cron/systemd timer
  - Manual renewal instructions

### Error Handling Pattern

```javascript
class InstallationStep {
  async execute() {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        await this.run();
        return { success: true };
      } catch (error) {
        attempt++;

        // Log error
        logger.error(`Step failed (attempt ${attempt}/${maxRetries})`, error);

        // Analyze error
        const errorType = this.analyzeError(error);

        // Handle specific error types
        if (errorType === "PERMISSION_DENIED") {
          const useSudo = await prompt("Use sudo?");
          if (useSudo) {
            this.useSudo = true;
            continue;
          }
        }

        // Offer options
        if (attempt < maxRetries) {
          const action = await prompt("Error occurred. Retry, Skip, or Abort?", {
            choices: ["Retry", "Skip", "Abort"],
          });

          if (action === "Skip") {
            return { success: false, skipped: true };
          }
          if (action === "Abort") {
            throw new AbortError("User aborted installation");
          }
          // Retry
          continue;
        }
      }
    }

    // Max retries reached
    return { success: false, error: "Max retries reached" };
  }
}
```

### Rollback Strategy

```javascript
class InstallationManager {
  constructor() {
    this.completedSteps = [];
    this.rollbackActions = [];
  }

  async execute() {
    try {
      for (const step of this.steps) {
        const result = await step.execute();

        if (result.success) {
          this.completedSteps.push(step);
          this.rollbackActions.push(step.rollback);
        } else if (!result.skipped) {
          throw new Error("Critical step failed");
        }
      }
    } catch (error) {
      logger.error("Installation failed, rolling back...");
      await this.rollback();
      throw error;
    }
  }

  async rollback() {
    for (const rollbackAction of this.rollbackActions.reverse()) {
      try {
        await rollbackAction();
      } catch (error) {
        logger.error("Rollback step failed", error);
      }
    }
  }
}
```

---

## Multi-OS Support

### Operating Systems

#### 1. Linux (Ubuntu/Debian)

**Package Manager:** apt-get

**Service Manager:** systemd

**Firewall:** UFW

**Prerequisites Installation:**

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm nginx git python3 python3-pip
sudo pip3 install certbot certbot-dns-duckdns
```

**Service File:** `/etc/systemd/system/stremio-addon.service`

**Nginx Config:** `/etc/nginx/sites-available/stremio-addon`

#### 2. Raspberry Pi OS

**Same as Linux (Ubuntu/Debian)**

**Additional Considerations:**

- ARM architecture
- Limited resources (optimize cache size)
- SD card wear (minimize writes)

#### 3. macOS

**Package Manager:** Homebrew

**Service Manager:** launchd

**Firewall:** pf (Packet Filter)

**Prerequisites Installation:**

```bash
brew install node nginx git python3
pip3 install certbot certbot-dns-duckdns
```

**Service File:** `~/Library/LaunchAgents/com.stremio.addon.plist`

**Nginx Config:** `/usr/local/etc/nginx/servers/stremio-addon`

**launchd Service:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.stremio.addon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/username/stremio-addon-server/server.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/Users/username/stremio-addon-server</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>RD_API_TOKEN</key>
        <string>your_token</string>
        <key>ADDON_PASSWORD</key>
        <string>YourPassword</string>
    </dict>
</dict>
</plist>
```

#### 4. Windows

**Package Manager:** Chocolatey (or manual)

**Service Manager:** Windows Services (NSSM)

**Firewall:** Windows Defender Firewall

**Prerequisites Installation:**

```powershell
# Using Chocolatey
choco install nodejs nginx git python3 -y
pip3 install certbot certbot-dns-duckdns

# Using NSSM for service
choco install nssm -y
```

**Service Creation:**

```powershell
nssm install StremioAddon "C:\Program Files\nodejs\node.exe" "C:\stremio-addon-server\server.js"
nssm set StremioAddon AppDirectory "C:\stremio-addon-server"
nssm set StremioAddon AppEnvironmentExtra NODE_ENV=production RD_API_TOKEN=your_token ADDON_PASSWORD=YourPassword
nssm start StremioAddon
```

**Nginx Config:** `C:\nginx\conf\servers\stremio-addon.conf`

**Firewall Rules:**

```powershell
netsh advfirewall firewall add rule name="Stremio Addon HTTP" dir=in action=allow protocol=TCP localport=80
netsh advfirewall firewall add rule name="Stremio Addon HTTPS" dir=in action=allow protocol=TCP localport=443
```

### OS Detection

```javascript
class OSDetector {
  async detect() {
    // Local detection
    if (process.platform === "linux") {
      const distro = await this.detectLinuxDistro();
      return { os: "linux", distro };
    } else if (process.platform === "darwin") {
      return { os: "macos" };
    } else if (process.platform === "win32") {
      return { os: "windows" };
    }
  }

  async detectRemote(ssh) {
    const result = await ssh.executeCommand("uname -s");
    if (result.includes("Linux")) {
      const distro = await this.detectRemoteLinuxDistro(ssh);
      return { os: "linux", distro };
    } else if (result.includes("Darwin")) {
      return { os: "macos" };
    }
    // Windows detection would use different command
  }

  async detectLinuxDistro() {
    try {
      const release = fs.readFileSync("/etc/os-release", "utf8");
      if (release.includes("Ubuntu")) return "ubuntu";
      if (release.includes("Debian")) return "debian";
      if (release.includes("Raspbian")) return "raspberrypi";
      return "unknown";
    } catch {
      return "unknown";
    }
  }
}
```

---

## Security Considerations

### 1. Secrets Management

**Storage:**

- Store secrets encrypted
- Use system keychain when available
- Never log secrets
- Mask secrets in UI

**Encryption:**

```javascript
const crypto = require("crypto");

class SecretsManager {
  constructor(masterPassword) {
    this.key = crypto.scryptSync(masterPassword, "salt", 32);
  }

  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", this.key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  }

  decrypt(text) {
    const parts = text.split(":");
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv("aes-256-cbc", this.key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
}
```

### 2. SSH Security

**Best Practices:**

- Use SSH keys only
- Disable password authentication
- Use strong key encryption
- Rotate keys regularly
- Limit SSH access by IP

### 3. API Security

**Rate Limiting:**

- Prevent API abuse
- Protect against DDoS
- Monitor usage patterns

**Authentication:**

- Strong password requirements
- Optional 2FA for management interface
- Session management

### 4. System Security

**Updates:**

- Regular security updates
- Automated update checks
- Notifications for critical updates

**Monitoring:**

- Log all access attempts
- Alert on suspicious activity
- Regular security audits

---

## Development Phases

### Phase 1: Planning & Design ✓ (CURRENT)

- [✓] Define requirements
- [✓] Create architecture
- [✓] Design user flows
- [✓] Plan error handling
- [✓] Create documentation

### Phase 2: CLI Core Development

**Duration:** 2-3 weeks

**Tasks:**

1. Setup CLI project structure
2. Implement Commander.js framework
3. Create configuration manager
4. Implement SSH manager
5. Build OS detector
6. Create service manager (all OS)
7. Implement logging system

**Deliverables:**

- CLI tool with basic commands
- Configuration management
- SSH connectivity
- Service control

### Phase 3: Installation Engine

**Duration:** 3-4 weeks

**Tasks:**

1. Build installation wizard
2. Implement prerequisite checker
3. Create installation steps
4. Add error handling
5. Implement rollback mechanism
6. Add progress tracking
7. Test on all OS platforms

**Deliverables:**

- Complete installation flow
- Multi-OS support
- Comprehensive error handling
- Rollback capability

### Phase 4: SSL & Security

**Duration:** 1-2 weeks

**Tasks:**

1. Integrate certbot-dns-duckdns
2. Automate SSL certificate obtainment
3. Setup auto-renewal
4. Implement firewall configuration
5. Add fail2ban integration
6. Create security best practices

**Deliverables:**

- Automated SSL setup
- Firewall configuration
- Intrusion prevention

### Phase 5: Management Features

**Duration:** 2-3 weeks

**Tasks:**

1. Implement service control commands
2. Add log viewing functionality
3. Create backup/restore system
4. Build configuration editor
5. Add statistics collection
6. Implement update mechanism

**Deliverables:**

- Full service management
- Backup system
- Configuration management
- Update functionality

### Phase 6: Electron App Development

**Duration:** 4-5 weeks

**Tasks:**

1. Setup Electron + React project
2. Design UI/UX
3. Create installation wizard UI
4. Build dashboard
5. Implement log viewer
6. Create configuration editor
7. Add statistics visualization
8. Implement backup management UI
9. Add auto-updater

**Deliverables:**

- Complete Electron application
- All CLI features in GUI
- Modern, intuitive interface

### Phase 7: Addon Server Refactoring

**Duration:** 2-3 weeks

**Tasks:**

1. Refactor server for extensibility
2. Create provider abstraction
3. Add configuration loading
4. Improve error handling
5. Add health check endpoint
6. Create admin API
7. Add telemetry (optional)

**Deliverables:**

- Extensible addon server
- Provider abstraction
- Admin API

### Phase 8: Testing & QA

**Duration:** 2-3 weeks

**Tasks:**

1. Write unit tests
2. Create integration tests
3. Perform end-to-end testing
4. Test on all OS platforms
5. Load testing
6. Security audit
7. User acceptance testing

**Deliverables:**

- Comprehensive test suite
- Test reports
- Bug fixes

### Phase 9: Documentation

**Duration:** 1-2 weeks

**Tasks:**

1. Write user guide
2. Create installation guide
3. Document troubleshooting
4. Write developer docs
5. Create video tutorials
6. Build website/landing page

**Deliverables:**

- Complete documentation
- Troubleshooting guides
- Video tutorials

### Phase 10: Deployment & Launch

**Duration:** 1 week

**Tasks:**

1. Setup GitHub repository
2. Configure CI/CD
3. Create release packages
4. Setup auto-update server
5. Launch announcement
6. Monitor feedback

**Deliverables:**

- Public release
- Distribution packages
- Auto-update infrastructure

---

## Testing Strategy

### Unit Testing

**Framework:** Jest

**Coverage:**

- All utility functions
- Configuration manager
- SSH manager
- Service manager
- Backup manager

### Integration Testing

**Framework:** Jest + Mocha

**Tests:**

- SSH connection flow
- Installation process
- Service management
- Backup/restore
- Configuration changes

### End-to-End Testing

**Framework:** Playwright (for Electron)

**Scenarios:**

- Complete installation flow
- Service lifecycle
- Configuration updates
- Backup creation and restoration
- Uninstallation

### Platform Testing

**Test on:**

- Ubuntu 22.04 LTS
- Debian 12
- Raspberry Pi OS (latest)
- macOS 13+ (Ventura)
- Windows 10/11

### Load Testing

**Tools:** Apache JMeter

**Tests:**

- Concurrent installations
- API performance
- Cache effectiveness
- Rate limiting

---

## Future Enhancements

### Phase 11: Additional Providers

- AllDebrid integration
- Premiumize integration
- Torbox integration
- Multi-provider support

### Phase 12: Advanced Features

- Multi-user support
- User quotas
- Analytics dashboard
- Email notifications
- Telegram bot integration
- Discord bot integration

### Phase 13: Clustering

- Multiple addon instances
- Load balancing
- High availability
- Shared cache (Redis)

### Phase 14: Content Management

- Watchlist integration
- Recommendation engine
- Content filtering
- Parental controls

### Phase 15: Mobile App

- iOS app
- Android app
- Remote management

---

## Repository Structure

```
stremio-addon-manager/
├── packages/
│   ├── cli/                    # CLI tool
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   ├── managers/
│   │   │   ├── utils/
│   │   │   └── index.js
│   │   ├── package.json
│   │   └── README.md
│   │
│   ├── electron/               # Electron app
│   │   ├── src/
│   │   │   ├── main/          # Main process
│   │   │   ├── renderer/       # React UI
│   │   │   └── shared/
│   │   ├── package.json
│   │   └── README.md
│   │
│   └── core/                   # Shared core logic
│       ├── src/
│       │   ├── installation/
│       │   ├── management/
│       │   ├── ssh/
│       │   └── os/
│       ├── package.json
│       └── README.md
│
├── addon-server/               # Addon server template
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── README.md
│
├── docs/                       # Documentation
│   ├── installation.md
│   ├── troubleshooting.md
│   ├── development.md
│   └── api.md
│
├── scripts/                    # Build scripts
├── tests/                      # Tests
├── .github/                    # GitHub Actions
├── package.json
├── lerna.json                  # Monorepo config
└── README.md
```

---

## Success Criteria

### For Users

- ✓ Installation completes in < 10 minutes
- ✓ No manual configuration required
- ✓ Works on all supported OS
- ✓ Clear error messages
- ✓ Easy management interface

### For Developers

- ✓ Well-documented code
- ✓ Modular architecture
- ✓ Easy to extend
- ✓ Comprehensive tests
- ✓ Clear contribution guidelines

### For Project

- ✓ 95%+ success rate on installations
- ✓ < 1% error rate in production
- ✓ Active community
- ✓ Regular updates
- ✓ Positive feedback

---

## Notes & Considerations

### Technical Debt

- Regular refactoring
- Code review process
- Performance optimization
- Security updates

### Community

- Discord server
- GitHub discussions
- Issue templates
- Contribution guidelines
- Code of conduct

### Monetization (Optional)

- Freemium model
- Premium features
- Managed hosting service
- Professional support

---

## Conclusion

This is a comprehensive, ambitious project that will democratize private Stremio addon deployment. The focus is on:

1. **User Experience** - Make it dead simple
2. **Reliability** - 100% error-free installations
3. **Security** - Built-in best practices
4. **Extensibility** - Easy to add new features
5. **Support** - Comprehensive documentation

**Estimated Total Development Time:** 4-6 months (with 1-2 developers)

**Estimated Lines of Code:** 15,000-20,000 LOC

**Priority:** High - This will enable many users to benefit from private addon architecture.

---

**Status:** Planning Complete ✓  
**Next Step:** Phase 2 - CLI Core Development  
**Owner:** TBD  
**Last Updated:** 2026-01-04
