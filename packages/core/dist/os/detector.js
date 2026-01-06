/**
 * OS Detection Module
 * Detects operating system and distribution information for both local and remote systems
 */
import os from 'node:os';
import fs from 'node:fs/promises';
import { OperatingSystem, LinuxDistribution, Architecture } from '../types/common.js';
/**
 * Detects operating system and system information
 */
export class OSDetector {
    /**
     * Detect local operating system
     */
    static detect() {
        const platform = os.platform();
        const operatingSystem = this.platformToOS(platform);
        const arch = this.detectArchitecture(os.arch());
        const release = os.release();
        const systemInfo = {
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
    static async detectRemote(ssh) {
        // Detect OS type
        const unameResult = await ssh.execCommand('uname -s');
        const osType = unameResult.stdout.trim().toLowerCase();
        let operatingSystem;
        if (osType.includes('linux')) {
            operatingSystem = OperatingSystem.LINUX;
        }
        else if (osType.includes('darwin')) {
            operatingSystem = OperatingSystem.MACOS;
        }
        else if (osType.includes('mingw') || osType.includes('msys') || osType.includes('cygwin')) {
            operatingSystem = OperatingSystem.WINDOWS;
        }
        else {
            operatingSystem = OperatingSystem.UNKNOWN;
        }
        // Detect architecture
        const archResult = await ssh.execCommand('uname -m');
        const arch = this.detectArchitecture(archResult.stdout.trim());
        // Detect release
        const releaseResult = await ssh.execCommand('uname -r');
        const release = releaseResult.stdout.trim();
        const systemInfo = {
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
        }
        catch (error) {
            // Optional information, continue without it
            console.warn('Could not retrieve full system information:', error);
        }
        return systemInfo;
    }
    /**
     * Detect local Linux distribution
     */
    static async detectLocalLinuxDistro() {
        if (os.platform() !== 'linux') {
            return LinuxDistribution.UNKNOWN;
        }
        try {
            const osRelease = await fs.readFile('/etc/os-release', 'utf-8');
            return this.parseOSRelease(osRelease);
        }
        catch {
            return LinuxDistribution.UNKNOWN;
        }
    }
    /**
     * Detect remote Linux distribution
     */
    static async detectRemoteLinuxDistro(ssh) {
        try {
            const result = await ssh.execCommand('cat /etc/os-release');
            if (result.code !== 0) {
                return LinuxDistribution.UNKNOWN;
            }
            return this.parseOSRelease(result.stdout);
        }
        catch {
            return LinuxDistribution.UNKNOWN;
        }
    }
    /**
     * Parse /etc/os-release file to determine distribution
     */
    static parseOSRelease(content) {
        const idMatch = content.match(/^ID=(.+)$/m);
        if (!idMatch) {
            return LinuxDistribution.UNKNOWN;
        }
        const id = idMatch[1].replace(/['"]/g, '').toLowerCase();
        if (id.includes('ubuntu'))
            return LinuxDistribution.UBUNTU;
        if (id.includes('debian'))
            return LinuxDistribution.DEBIAN;
        if (id.includes('raspbian'))
            return LinuxDistribution.RASPBERRY_PI;
        if (id.includes('fedora'))
            return LinuxDistribution.FEDORA;
        if (id.includes('centos'))
            return LinuxDistribution.CENTOS;
        if (id.includes('arch'))
            return LinuxDistribution.ARCH;
        return LinuxDistribution.UNKNOWN;
    }
    /**
     * Convert Node.js platform string to OperatingSystem enum
     */
    static platformToOS(platform) {
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
    static detectArchitecture(archString) {
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
    static async detectRemoteMemory(ssh) {
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
    static async detectRemoteCPU(ssh) {
        const result = await ssh.execCommand('nproc');
        const cores = parseInt(result.stdout.trim(), 10);
        return { cores };
    }
    /**
     * Detect remote disk space
     */
    static async detectRemoteDisk(ssh) {
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
    static isLinux() {
        return os.platform() === 'linux';
    }
    /**
     * Check if current system is macOS
     */
    static isMacOS() {
        return os.platform() === 'darwin';
    }
    /**
     * Check if current system is Windows
     */
    static isWindows() {
        return os.platform() === 'win32';
    }
    /**
     * Get a human-readable OS name
     */
    static getOSName(systemInfo) {
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
//# sourceMappingURL=detector.js.map