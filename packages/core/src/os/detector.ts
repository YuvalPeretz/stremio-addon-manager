/**
 * OS Detection Module
 * Detects operating system and distribution information for both local and remote systems
 */

import os from 'node:os';
import fs from 'node:fs/promises';
import { OperatingSystem, LinuxDistribution, Architecture, SystemInfo } from '../types/common.js';
import type { SSHConnection } from '../ssh/types.js';

/**
 * Detects operating system and system information
 */
export class OSDetector {
  /**
   * Detect local operating system
   */
  public static detect(): SystemInfo {
    const platform = os.platform();
    const operatingSystem = this.platformToOS(platform);
    const arch = this.detectArchitecture(os.arch());
    const release = os.release();

    const systemInfo: SystemInfo = {
      os: operatingSystem,
      arch,
      platform,
      release,
      totalMemory: os.totalmem(),
      availableMemory: os.freemem(),
      cpuCores: os.cpus().length,
    };

    return systemInfo;
  }

  /**
   * Detect operating system on a remote machine via SSH
   */
  public static async detectRemote(ssh: SSHConnection): Promise<SystemInfo> {
    // Detect OS type
    const unameResult = await ssh.execCommand('uname -s');
    const osType = unameResult.stdout.trim().toLowerCase();

    let operatingSystem: OperatingSystem;
    if (osType.includes('linux')) {
      operatingSystem = OperatingSystem.LINUX;
    } else if (osType.includes('darwin')) {
      operatingSystem = OperatingSystem.MACOS;
    } else if (osType.includes('mingw') || osType.includes('msys') || osType.includes('cygwin')) {
      operatingSystem = OperatingSystem.WINDOWS;
    } else {
      operatingSystem = OperatingSystem.UNKNOWN;
    }

    // Detect architecture
    const archResult = await ssh.execCommand('uname -m');
    const arch = this.detectArchitecture(archResult.stdout.trim());

    // Detect release
    const releaseResult = await ssh.execCommand('uname -r');
    const release = releaseResult.stdout.trim();

    const systemInfo: SystemInfo = {
      os: operatingSystem,
      arch,
      platform: osType,
      release,
    };

    // If Linux, detect distribution
    if (operatingSystem === OperatingSystem.LINUX) {
      systemInfo.distro = await this.detectRemoteLinuxDistro(ssh);
    }

    // Get additional system info
    try {
      const memInfo = await this.detectRemoteMemory(ssh);
      systemInfo.totalMemory = memInfo.total;
      systemInfo.availableMemory = memInfo.available;

      const cpuInfo = await this.detectRemoteCPU(ssh);
      systemInfo.cpuCores = cpuInfo.cores;

      const diskInfo = await this.detectRemoteDisk(ssh);
      systemInfo.diskSpace = diskInfo;
    } catch (error) {
      // Optional information, continue without it
      console.warn('Could not retrieve full system information:', error);
    }

    return systemInfo;
  }

  /**
   * Detect local Linux distribution
   */
  public static async detectLocalLinuxDistro(): Promise<LinuxDistribution> {
    if (os.platform() !== 'linux') {
      return LinuxDistribution.UNKNOWN;
    }

    try {
      const osRelease = await fs.readFile('/etc/os-release', 'utf-8');
      return this.parseOSRelease(osRelease);
    } catch {
      return LinuxDistribution.UNKNOWN;
    }
  }

  /**
   * Detect remote Linux distribution
   */
  private static async detectRemoteLinuxDistro(ssh: SSHConnection): Promise<LinuxDistribution> {
    try {
      const result = await ssh.execCommand('cat /etc/os-release');
      if (result.code !== 0) {
        return LinuxDistribution.UNKNOWN;
      }
      return this.parseOSRelease(result.stdout);
    } catch {
      return LinuxDistribution.UNKNOWN;
    }
  }

  /**
   * Parse /etc/os-release file to determine distribution
   */
  private static parseOSRelease(content: string): LinuxDistribution {
    const idMatch = content.match(/^ID=(.+)$/m);
    if (!idMatch) {
      return LinuxDistribution.UNKNOWN;
    }

    const id = idMatch[1].replace(/['"]/g, '').toLowerCase();

    if (id.includes('ubuntu')) return LinuxDistribution.UBUNTU;
    if (id.includes('debian')) return LinuxDistribution.DEBIAN;
    if (id.includes('raspbian')) return LinuxDistribution.RASPBERRY_PI;
    if (id.includes('fedora')) return LinuxDistribution.FEDORA;
    if (id.includes('centos')) return LinuxDistribution.CENTOS;
    if (id.includes('arch')) return LinuxDistribution.ARCH;

    return LinuxDistribution.UNKNOWN;
  }

  /**
   * Convert Node.js platform string to OperatingSystem enum
   */
  private static platformToOS(platform: string): OperatingSystem {
    switch (platform) {
      case 'linux':
        return OperatingSystem.LINUX;
      case 'darwin':
        return OperatingSystem.MACOS;
      case 'win32':
        return OperatingSystem.WINDOWS;
      default:
        return OperatingSystem.UNKNOWN;
    }
  }

  /**
   * Detect architecture from arch string
   */
  private static detectArchitecture(archString: string): Architecture {
    const arch = archString.toLowerCase();

    if (arch === 'x64' || arch === 'amd64' || arch === 'x86_64') {
      return Architecture.X64;
    }
    if (arch === 'arm64' || arch === 'aarch64') {
      return Architecture.ARM64;
    }
    if (arch.startsWith('arm')) {
      return Architecture.ARM;
    }
    if (arch === 'x86' || arch === 'i386' || arch === 'i686') {
      return Architecture.X86;
    }

    return Architecture.UNKNOWN;
  }

  /**
   * Detect remote memory information
   */
  private static async detectRemoteMemory(
    ssh: SSHConnection
  ): Promise<{ total: number; available: number }> {
    const result = await ssh.execCommand("free -m | awk 'NR==2{print $2,$7}'");
    const [total, available] = result.stdout.trim().split(' ').map(Number);
    return {
      total: total * 1024 * 1024, // Convert MB to bytes
      available: available * 1024 * 1024,
    };
  }

  /**
   * Detect remote CPU information
   */
  private static async detectRemoteCPU(ssh: SSHConnection): Promise<{ cores: number }> {
    const result = await ssh.execCommand('nproc');
    const cores = parseInt(result.stdout.trim(), 10);
    return { cores };
  }

  /**
   * Detect remote disk space
   */
  private static async detectRemoteDisk(
    ssh: SSHConnection
  ): Promise<{ total: number; available: number }> {
    const result = await ssh.execCommand("df -BG / | awk 'NR==2{print $2,$4}' | sed 's/G//g'");
    const [total, available] = result.stdout.trim().split(' ').map(Number);
    return {
      total: total * 1024 * 1024 * 1024, // Convert GB to bytes
      available: available * 1024 * 1024 * 1024,
    };
  }

  /**
   * Check if current system is Linux
   */
  public static isLinux(): boolean {
    return os.platform() === 'linux';
  }

  /**
   * Check if current system is macOS
   */
  public static isMacOS(): boolean {
    return os.platform() === 'darwin';
  }

  /**
   * Check if current system is Windows
   */
  public static isWindows(): boolean {
    return os.platform() === 'win32';
  }

  /**
   * Get a human-readable OS name
   */
  public static getOSName(systemInfo: SystemInfo): string {
    if (systemInfo.os === OperatingSystem.LINUX && systemInfo.distro) {
      const distroName = systemInfo.distro.charAt(0).toUpperCase() + systemInfo.distro.slice(1);
      return `${distroName} Linux`;
    }

    switch (systemInfo.os) {
      case OperatingSystem.LINUX:
        return 'Linux';
      case OperatingSystem.MACOS:
        return 'macOS';
      case OperatingSystem.WINDOWS:
        return 'Windows';
      default:
        return 'Unknown OS';
    }
  }
}

