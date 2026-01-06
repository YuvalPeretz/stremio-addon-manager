/**
 * Common types used across the core package
 */
/**
 * Supported operating systems
 */
export declare enum OperatingSystem {
    LINUX = "linux",
    MACOS = "macos",
    WINDOWS = "windows",
    UNKNOWN = "unknown"
}
/**
 * Linux distributions
 */
export declare enum LinuxDistribution {
    UBUNTU = "ubuntu",
    DEBIAN = "debian",
    RASPBERRY_PI = "raspberrypi",
    FEDORA = "fedora",
    CENTOS = "centos",
    ARCH = "arch",
    UNKNOWN = "unknown"
}
/**
 * System architecture
 */
export declare enum Architecture {
    X64 = "x64",
    ARM = "arm",
    ARM64 = "arm64",
    X86 = "x86",
    UNKNOWN = "unknown"
}
/**
 * System information
 */
export interface SystemInfo {
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
/**
 * Result type for operations that can fail
 */
export interface Result<T, E = Error> {
    success: boolean;
    data?: T;
    error?: E;
}
/**
 * Execution result for commands
 */
export interface ExecutionResult {
    stdout: string;
    stderr: string;
    code: number;
    success: boolean;
}
//# sourceMappingURL=common.d.ts.map