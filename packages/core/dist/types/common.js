/**
 * Common types used across the core package
 */
/**
 * Supported operating systems
 */
export var OperatingSystem;
(function (OperatingSystem) {
    OperatingSystem["LINUX"] = "linux";
    OperatingSystem["MACOS"] = "macos";
    OperatingSystem["WINDOWS"] = "windows";
    OperatingSystem["UNKNOWN"] = "unknown";
})(OperatingSystem || (OperatingSystem = {}));
/**
 * Linux distributions
 */
export var LinuxDistribution;
(function (LinuxDistribution) {
    LinuxDistribution["UBUNTU"] = "ubuntu";
    LinuxDistribution["DEBIAN"] = "debian";
    LinuxDistribution["RASPBERRY_PI"] = "raspberrypi";
    LinuxDistribution["FEDORA"] = "fedora";
    LinuxDistribution["CENTOS"] = "centos";
    LinuxDistribution["ARCH"] = "arch";
    LinuxDistribution["UNKNOWN"] = "unknown";
})(LinuxDistribution || (LinuxDistribution = {}));
/**
 * System architecture
 */
export var Architecture;
(function (Architecture) {
    Architecture["X64"] = "x64";
    Architecture["ARM"] = "arm";
    Architecture["ARM64"] = "arm64";
    Architecture["X86"] = "x86";
    Architecture["UNKNOWN"] = "unknown";
})(Architecture || (Architecture = {}));
//# sourceMappingURL=common.js.map