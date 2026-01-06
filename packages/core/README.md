# @stremio-addon-manager/core

Core shared logic for Stremio Addon Manager. This package provides essential functionality used by both the CLI and Electron applications.

## Features

### ✅ Implemented

- **OS Detection** (`OSDetector`)
  - Detect local and remote operating systems
  - Identify Linux distributions (Ubuntu, Debian, Raspberry Pi, etc.)
  - Get system information (CPU, memory, disk space)
  - Architecture detection (x64, ARM, ARM64, etc.)

### 🚧 In Progress

- **SSH Management** (`SSHManager`) - Phase 2
- **Service Management** (`ServiceManager`) - Phase 2
- **Configuration Management** (`ConfigManager`) - Phase 2
- **Installation Engine** - Phase 3

## Installation

```bash
npm install @stremio-addon-manager/core
```

## Usage

### OS Detection

```typescript
import { OSDetector, OperatingSystem, LinuxDistribution } from "@stremio-addon-manager/core";

// Detect local OS
const systemInfo = OSDetector.detect();
console.log(`OS: ${systemInfo.os}`);
console.log(`Architecture: ${systemInfo.arch}`);
console.log(`CPU Cores: ${systemInfo.cpuCores}`);

// Check OS type
if (OSDetector.isLinux()) {
  const distro = await OSDetector.detectLocalLinuxDistro();
  console.log(`Linux Distribution: ${distro}`);
}

// Get human-readable OS name
const osName = OSDetector.getOSName(systemInfo);
console.log(`Running on: ${osName}`);

// Detect remote OS via SSH
const remoteInfo = await OSDetector.detectRemote(sshConnection);
console.log(`Remote OS: ${remoteInfo.os}`);
```

## API Reference

### OSDetector

#### Methods

- `detect(): SystemInfo` - Detect local operating system
- `detectRemote(ssh: SSHConnection): Promise<SystemInfo>` - Detect remote OS via SSH
- `detectLocalLinuxDistro(): Promise<LinuxDistribution>` - Detect Linux distribution
- `isLinux(): boolean` - Check if current system is Linux
- `isMacOS(): boolean` - Check if current system is macOS
- `isWindows(): boolean` - Check if current system is Windows
- `getOSName(systemInfo: SystemInfo): string` - Get human-readable OS name

### Types

#### SystemInfo

```typescript
interface SystemInfo {
  os: OperatingSystem;
  distro?: LinuxDistribution;
  arch: Architecture;
  platform: string;
  release: string;
  totalMemory?: number;
  availableMemory?: number;
  cpuCores?: number;
  diskSpace?: {
    total: number;
    available: number;
  };
}
```

#### OperatingSystem

```typescript
enum OperatingSystem {
  LINUX = "linux",
  MACOS = "macos",
  WINDOWS = "windows",
  UNKNOWN = "unknown",
}
```

#### LinuxDistribution

```typescript
enum LinuxDistribution {
  UBUNTU = "ubuntu",
  DEBIAN = "debian",
  RASPBERRY_PI = "raspberrypi",
  FEDORA = "fedora",
  CENTOS = "centos",
  ARCH = "arch",
  UNKNOWN = "unknown",
}
```

#### Architecture

```typescript
enum Architecture {
  X64 = "x64",
  ARM = "arm",
  ARM64 = "arm64",
  X86 = "x86",
  UNKNOWN = "unknown",
}
```

## Development

```bash
# Build the package
npm run build

# Watch mode (rebuild on changes)
npm run dev

# Type check
npm run type-check

# Lint
npm run lint

# Run tests
npm test
```

## License

MIT
