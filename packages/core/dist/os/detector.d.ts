/**
 * OS Detection Module
 * Detects operating system and distribution information for both local and remote systems
 */
import { LinuxDistribution, SystemInfo } from '../types/common.js';
import type { SSHConnection } from '../ssh/types.js';
/**
 * Detects operating system and system information
 */
export declare class OSDetector {
    /**
     * Detect local operating system
     */
    static detect(): SystemInfo;
    /**
     * Detect operating system on a remote machine via SSH
     */
    static detectRemote(ssh: SSHConnection): Promise<SystemInfo>;
    /**
     * Detect local Linux distribution
     */
    static detectLocalLinuxDistro(): Promise<LinuxDistribution>;
    /**
     * Detect remote Linux distribution
     */
    private static detectRemoteLinuxDistro;
    /**
     * Parse /etc/os-release file to determine distribution
     */
    private static parseOSRelease;
    /**
     * Convert Node.js platform string to OperatingSystem enum
     */
    private static platformToOS;
    /**
     * Detect architecture from arch string
     */
    private static detectArchitecture;
    /**
     * Detect remote memory information
     */
    private static detectRemoteMemory;
    /**
     * Detect remote CPU information
     */
    private static detectRemoteCPU;
    /**
     * Detect remote disk space
     */
    private static detectRemoteDisk;
    /**
     * Check if current system is Linux
     */
    static isLinux(): boolean;
    /**
     * Check if current system is macOS
     */
    static isMacOS(): boolean;
    /**
     * Check if current system is Windows
     */
    static isWindows(): boolean;
    /**
     * Get a human-readable OS name
     */
    static getOSName(systemInfo: SystemInfo): string;
}
//# sourceMappingURL=detector.d.ts.map