/**
 * Example: OS Detection
 * 
 * This example demonstrates how to use the OSDetector to detect
 * local and remote operating systems.
 */

import { OSDetector, OperatingSystem, LinuxDistribution } from '../src/index.js';

async function main(): Promise<void> {
  console.log('=== OS Detection Example ===\n');

  // Detect local OS
  console.log('1. Detecting local operating system...');
  const localSystem = OSDetector.detect();
  
  console.log(`   OS: ${localSystem.os}`);
  console.log(`   Architecture: ${localSystem.arch}`);
  console.log(`   Platform: ${localSystem.platform}`);
  console.log(`   Release: ${localSystem.release}`);
  console.log(`   CPU Cores: ${localSystem.cpuCores}`);
  console.log(`   Total Memory: ${formatBytes(localSystem.totalMemory ?? 0)}`);
  console.log(`   Available Memory: ${formatBytes(localSystem.availableMemory ?? 0)}`);
  console.log();

  // Check OS type
  console.log('2. Checking OS type...');
  console.log(`   Is Linux? ${OSDetector.isLinux()}`);
  console.log(`   Is macOS? ${OSDetector.isMacOS()}`);
  console.log(`   Is Windows? ${OSDetector.isWindows()}`);
  console.log();

  // Detect Linux distribution (if applicable)
  if (localSystem.os === OperatingSystem.LINUX) {
    console.log('3. Detecting Linux distribution...');
    const distro = await OSDetector.detectLocalLinuxDistro();
    console.log(`   Distribution: ${distro}`);
    console.log();
  }

  // Get human-readable OS name
  console.log('4. Getting human-readable OS name...');
  const osName = OSDetector.getOSName(localSystem);
  console.log(`   OS Name: ${osName}`);
  console.log();

  // Example: Remote OS detection would require SSH connection
  console.log('5. Remote OS detection (requires SSH connection)');
  console.log('   const remoteSystem = await OSDetector.detectRemote(sshConnection);');
  console.log('   // Would return SystemInfo for the remote machine');
}

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Run the example
main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

