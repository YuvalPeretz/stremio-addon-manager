/**
 * Service Manager
 * Manages system services across different operating systems
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../utils/logger.js";
import { OSDetector } from "../os/detector.js";
import { OperatingSystem } from "../types/common.js";
import { generateServiceName, EnvVarManager } from "../config/index.js";
import type { AddonManagerConfig } from "../config/types.js";
import type { ServiceInfo } from "./types.js";
import { ServiceStatus } from "./types.js";
import type { SSHConnection } from "../ssh/types.js";
import { ServiceFileManager } from "./file-manager.js";

const execAsync = promisify(exec);

/**
 * Service Manager class
 */
export class ServiceManager {
  private serviceName: string;
  private os: OperatingSystem;
  private ssh?: SSHConnection;

  /**
   * Create a new ServiceManager instance
   * @param serviceName Name of the service
   * @param ssh Optional SSH connection for remote management
   */
  constructor(serviceName: string, ssh?: SSHConnection) {
    this.serviceName = serviceName;
    this.ssh = ssh;
    this.os = ssh ? OperatingSystem.UNKNOWN : OSDetector.detect().os;
  }

  /**
   * Detect OS for remote connection
   * Always detects remote OS when SSH is present, regardless of current OS value
   * This allows Windows clients to manage Linux servers via SSH
   */
  private async detectRemoteOS(): Promise<void> {
    if (this.ssh) {
      // Always detect remote OS when SSH is present
      // This allows Windows clients to manage Linux servers
      try {
        const systemInfo = await OSDetector.detectRemote(this.ssh);
        this.os = systemInfo.os;
        logger.debug("Remote OS detected", { os: this.os, service: this.serviceName });
      } catch (error) {
        logger.warn("Failed to detect remote OS, assuming Linux for service operations", {
          error: (error as Error).message,
          service: this.serviceName,
        });
        // If detection fails but SSH is present, assume Linux (most common case)
        // This allows operations to proceed even if OS detection fails
        this.os = OperatingSystem.LINUX;
      }
    }
  }

  /**
   * Execute a command (local or remote)
   * Enhanced with better error handling for SSH and permission errors
   */
  private async executeCommand(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
      if (this.ssh) {
        // Check SSH connection before executing
        if (!this.ssh.isConnected || !this.ssh.isConnected()) {
          throw new Error("SSH connection is not established. Please check your SSH connection and try again.");
        }
        return await this.ssh.execCommand(command);
      } else {
        const { stdout, stderr } = await execAsync(command);
        return { stdout, stderr, code: 0 };
      }
    } catch (error) {
      const errorMsg = (error as Error).message;

      // Handle SSH connection errors
      if (this.ssh) {
        if (errorMsg.includes("ECONNREFUSED")) {
          throw new Error(
            `SSH connection refused: ${errorMsg}\n` +
              "Recovery steps:\n" +
              "1. Verify the SSH host and port are correct\n" +
              "2. Check that the SSH service is running on the remote host: sudo systemctl status sshd\n" +
              "3. Verify firewall allows SSH connections\n" +
              "4. Check SSH key permissions and authentication"
          );
        } else if (errorMsg.includes("ETIMEDOUT") || errorMsg.includes("timeout")) {
          throw new Error(
            `SSH connection timed out: ${errorMsg}\n` +
              "Recovery steps:\n" +
              "1. Check network connectivity to remote host: ping <host>\n" +
              "2. Verify SSH service is running and responsive\n" +
              "3. Check SSH connection timeout settings\n" +
              "4. Increase timeout if network is slow\n" +
              "5. Retry the operation"
          );
        } else if (errorMsg.includes("ENOTFOUND") || errorMsg.includes("getaddrinfo")) {
          throw new Error(
            `SSH host not found: ${errorMsg}\n` +
              "Recovery steps:\n" +
              "1. Verify the SSH hostname or IP address is correct\n" +
              "2. Check DNS resolution: nslookup <host>\n" +
              "3. Verify network connectivity\n" +
              "4. Check if host is reachable: ping <host>"
          );
        } else if (errorMsg.includes("ECONNRESET") || errorMsg.includes("connection reset")) {
          throw new Error(
            `SSH connection reset: ${errorMsg}\n` +
              "Recovery steps:\n" +
              "1. Check network stability\n" +
              "2. Verify SSH service is running: sudo systemctl status sshd\n" +
              "3. Check SSH logs: sudo journalctl -u sshd -n 50\n" +
              "4. Retry the operation"
          );
        }
      }

      // Handle permission errors
      if (errorMsg.includes("EACCES") || errorMsg.includes("Permission denied") || errorMsg.includes("permission")) {
        throw new Error(
          `Permission denied: ${errorMsg}\n` +
            "Recovery steps:\n" +
            "1. Ensure you have the necessary permissions\n" +
            "2. For local operations, run with sudo or as administrator\n" +
            "3. For remote operations, ensure the SSH user has sudo privileges"
        );
      }

      // Generic error handling
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: execError.stdout || "",
        stderr: execError.stderr || errorMsg,
        code: execError.code || 1,
      };
    }
  }

  /**
   * Execute a sudo command (local or remote)
   * Enhanced with better error handling for permission and systemd errors
   */
  private async executeSudoCommand(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
      if (this.ssh) {
        // Check SSH connection before executing
        if (!this.ssh.isConnected || !this.ssh.isConnected()) {
          throw new Error("SSH connection is not established. Please check your SSH connection and try again.");
        }
        const result = await this.ssh.execSudo(command);

        // Check for common sudo errors
        if (result.code !== 0) {
          const errorMsg = result.stderr || result.stdout;
          if (errorMsg.includes("sudo:") && errorMsg.includes("password")) {
            throw new Error(
              `Sudo password required: ${errorMsg}\n` +
                "Recovery steps:\n" +
                "1. Ensure passwordless sudo is configured for the SSH user\n" +
                "2. Or provide sudo password in SSH configuration\n" +
                "3. Verify the SSH user has sudo privileges"
            );
          }
          if (errorMsg.includes("NOPASSWD") || errorMsg.includes("password is required")) {
            throw new Error(
              `Sudo authentication failed: ${errorMsg}\n` +
                "Recovery steps:\n" +
                "1. Configure passwordless sudo: add 'username ALL=(ALL) NOPASSWD: ALL' to /etc/sudoers\n" +
                "2. Or use SSH key-based authentication with sudo\n" +
                "3. Verify the SSH user has sudo privileges"
            );
          }
        }

        return result;
      } else {
        const sudoCommand = process.platform === "win32" ? command : `sudo ${command}`;
        const result = await this.executeCommand(sudoCommand);

        // Check for sudo errors on local system
        if (result.code !== 0 && result.stderr.includes("sudo:")) {
          throw new Error(
            `Sudo command failed: ${result.stderr}\n` +
              "Recovery steps:\n" +
              "1. Ensure you have sudo privileges\n" +
              "2. Enter your password when prompted\n" +
              "3. On Windows, run as Administrator instead"
          );
        }

        return result;
      }
    } catch (error) {
      // Re-throw enhanced errors
      if ((error as Error).message.includes("Recovery steps:")) {
        throw error;
      }
      // Wrap other errors
      throw new Error(`Failed to execute sudo command: ${(error as Error).message}`);
    }
  }

  /**
   * Start the service
   */
  public async start(): Promise<void> {
    await this.detectRemoteOS();

    try {
      logger.info("Starting service", { service: this.serviceName, os: this.os });

      let command: string;

      switch (this.os) {
        case OperatingSystem.LINUX:
          command = `systemctl start ${this.serviceName}`;
          break;
        case OperatingSystem.MACOS:
          command = `launchctl start ${this.serviceName}`;
          break;
        case OperatingSystem.WINDOWS:
          command = `nssm start ${this.serviceName}`;
          break;
        default:
          throw new Error(`Unsupported operating system: ${this.os}`);
      }

      const result = await this.executeSudoCommand(command);

      if (result.code !== 0) {
        const errorMsg = result.stderr || result.stdout;
        throw new Error(
          `Failed to start service: ${errorMsg}\n` +
            "Recovery steps:\n" +
            "1. Check service status: systemctl status " +
            this.serviceName +
            "\n" +
            "2. Check service logs: journalctl -u " +
            this.serviceName +
            " -n 50\n" +
            "3. Verify service file syntax: systemd-analyze verify " +
            this.serviceName +
            "\n" +
            "4. Ensure all dependencies are available"
        );
      }

      logger.info("Service started successfully", { service: this.serviceName });
    } catch (error) {
      logger.error("Failed to start service", { service: this.serviceName, error });
      // Re-throw enhanced errors as-is
      if ((error as Error).message.includes("Recovery steps:")) {
        throw error;
      }
      throw new Error(`Failed to start service: ${(error as Error).message}`);
    }
  }

  /**
   * Stop the service
   */
  public async stop(): Promise<void> {
    await this.detectRemoteOS();

    try {
      logger.info("Stopping service", { service: this.serviceName, os: this.os });

      let command: string;

      switch (this.os) {
        case OperatingSystem.LINUX:
          command = `systemctl stop ${this.serviceName}`;
          break;
        case OperatingSystem.MACOS:
          command = `launchctl stop ${this.serviceName}`;
          break;
        case OperatingSystem.WINDOWS:
          command = `nssm stop ${this.serviceName}`;
          break;
        default:
          throw new Error(`Unsupported operating system: ${this.os}`);
      }

      const result = await this.executeSudoCommand(command);

      if (result.code !== 0) {
        throw new Error(`Failed to stop service: ${result.stderr}`);
      }

      logger.info("Service stopped successfully", { service: this.serviceName });
    } catch (error) {
      logger.error("Failed to stop service", { service: this.serviceName, error });
      throw new Error(`Failed to stop service: ${(error as Error).message}`);
    }
  }

  /**
   * Restart the service
   */
  public async restart(): Promise<void> {
    await this.detectRemoteOS();

    try {
      logger.info("Restarting service", { service: this.serviceName, os: this.os });

      let command: string;

      switch (this.os) {
        case OperatingSystem.LINUX:
          command = `systemctl restart ${this.serviceName}`;
          break;
        case OperatingSystem.MACOS:
          await this.stop();
          await this.start();
          return;
        case OperatingSystem.WINDOWS:
          command = `nssm restart ${this.serviceName}`;
          break;
        default:
          throw new Error(`Unsupported operating system: ${this.os}`);
      }

      const result = await this.executeSudoCommand(command);

      if (result.code !== 0) {
        const errorMsg = result.stderr || result.stdout;
        throw new Error(
          `Failed to restart service: ${errorMsg}\n` +
            "Recovery steps:\n" +
            "1. Check if service is running: systemctl status " +
            this.serviceName +
            "\n" +
            "2. Check service logs for errors: journalctl -u " +
            this.serviceName +
            " -n 50 --no-pager\n" +
            "3. Try stopping then starting manually: systemctl stop " +
            this.serviceName +
            " && systemctl start " +
            this.serviceName +
            "\n" +
            "4. Verify service file is valid: systemd-analyze verify " +
            this.serviceName +
            "\n" +
            "5. Check for dependency issues: systemctl list-dependencies " +
            this.serviceName
        );
      }

      // Verify service actually restarted successfully (Linux only)
      if (this.os === OperatingSystem.LINUX) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
        const statusResult = await this.executeSudoCommand(`systemctl is-active ${this.serviceName}`);
        if (statusResult.stdout.trim() !== "active") {
          throw new Error(
            `Service restarted but is not active. Current status: ${statusResult.stdout.trim()}\n` +
              "Recovery steps:\n" +
              "1. Check service status: systemctl status " +
              this.serviceName +
              "\n" +
              "2. Check service logs: journalctl -u " +
              this.serviceName +
              " -n 100 --no-pager\n" +
              "3. Verify service file configuration"
          );
        }
      }

      logger.info("Service restarted successfully", { service: this.serviceName });
    } catch (error) {
      logger.error("Failed to restart service", { service: this.serviceName, error });
      // Re-throw enhanced errors as-is
      if ((error as Error).message.includes("Recovery steps:")) {
        throw error;
      }
      throw new Error(`Failed to restart service: ${(error as Error).message}`);
    }
  }

  /**
   * Get service status
   */
  public async status(): Promise<ServiceInfo> {
    await this.detectRemoteOS();

    try {
      logger.debug("Getting service status", { service: this.serviceName, os: this.os });

      let statusCommand: string;
      let enabledCommand: string;
      let fullStatusCommand: string | undefined;

      switch (this.os) {
        case OperatingSystem.LINUX:
          statusCommand = `systemctl is-active ${this.serviceName}`;
          enabledCommand = `systemctl is-enabled ${this.serviceName}`;
          fullStatusCommand = `systemctl status ${this.serviceName} --no-pager`;
          break;
        case OperatingSystem.MACOS:
          statusCommand = `launchctl list | grep ${this.serviceName}`;
          enabledCommand = statusCommand;
          break;
        case OperatingSystem.WINDOWS:
          statusCommand = `nssm status ${this.serviceName}`;
          enabledCommand = `nssm get ${this.serviceName} Start`;
          break;
        default:
          throw new Error(`Unsupported operating system: ${this.os}`);
      }

      const statusResult = await this.executeSudoCommand(statusCommand);
      const enabledResult = await this.executeSudoCommand(enabledCommand);

      const status = this.parseStatus(statusResult.stdout, this.os);
      const enabled = this.parseEnabled(enabledResult.stdout, this.os);

      const serviceInfo: ServiceInfo = {
        status,
        enabled,
      };

      // Get additional details for Linux
      if (this.os === OperatingSystem.LINUX && fullStatusCommand) {
        try {
          const fullStatusResult = await this.executeSudoCommand(fullStatusCommand);
          const details = this.parseSystemdStatus(fullStatusResult.stdout);
          if (details.pid) serviceInfo.pid = details.pid;
          if (details.cpu) serviceInfo.cpu = details.cpu;
          if (details.uptime) serviceInfo.uptime = details.uptime;

          // Get memory using ps command if PID is available
          if (serviceInfo.pid) {
            try {
              const memoryCommand = `ps -p ${serviceInfo.pid} -o rss= | awk '{print $1/1024 "MB"}'`;
              const memoryResult = await this.executeCommand(memoryCommand);
              const memoryStr = memoryResult.stdout.trim();
              if (memoryStr && memoryStr !== "") {
                serviceInfo.memory = memoryStr;
              }
            } catch (error) {
              logger.debug("Failed to get memory info", { error });
            }
          }
        } catch (error) {
          logger.debug("Failed to get detailed status", { error });
          // Continue without details
        }
      }

      return serviceInfo;
    } catch (error) {
      logger.error("Failed to get service status", { service: this.serviceName, error });
      return {
        status: ServiceStatus.UNKNOWN,
        enabled: false,
      };
    }
  }

  /**
   * Enable service (auto-start on boot)
   */
  public async enable(): Promise<void> {
    await this.detectRemoteOS();

    try {
      logger.info("Enabling service", { service: this.serviceName, os: this.os });

      let command: string;

      switch (this.os) {
        case OperatingSystem.LINUX:
          command = `systemctl enable ${this.serviceName}`;
          break;
        case OperatingSystem.MACOS:
          command = `launchctl load -w ~/Library/LaunchAgents/${this.serviceName}.plist`;
          break;
        case OperatingSystem.WINDOWS:
          command = `nssm set ${this.serviceName} Start SERVICE_AUTO_START`;
          break;
        default:
          throw new Error(`Unsupported operating system: ${this.os}`);
      }

      const result = await this.executeSudoCommand(command);

      if (result.code !== 0) {
        throw new Error(`Failed to enable service: ${result.stderr}`);
      }

      logger.info("Service enabled successfully", { service: this.serviceName });
    } catch (error) {
      logger.error("Failed to enable service", { service: this.serviceName, error });
      throw new Error(`Failed to enable service: ${(error as Error).message}`);
    }
  }

  /**
   * Disable service (no auto-start on boot)
   */
  public async disable(): Promise<void> {
    await this.detectRemoteOS();

    try {
      logger.info("Disabling service", { service: this.serviceName, os: this.os });

      let command: string;

      switch (this.os) {
        case OperatingSystem.LINUX:
          command = `systemctl disable ${this.serviceName}`;
          break;
        case OperatingSystem.MACOS:
          command = `launchctl unload -w ~/Library/LaunchAgents/${this.serviceName}.plist`;
          break;
        case OperatingSystem.WINDOWS:
          command = `nssm set ${this.serviceName} Start SERVICE_DEMAND_START`;
          break;
        default:
          throw new Error(`Unsupported operating system: ${this.os}`);
      }

      const result = await this.executeSudoCommand(command);

      if (result.code !== 0) {
        throw new Error(`Failed to disable service: ${result.stderr}`);
      }

      logger.info("Service disabled successfully", { service: this.serviceName });
    } catch (error) {
      logger.error("Failed to disable service", { service: this.serviceName, error });
      throw new Error(`Failed to disable service: ${(error as Error).message}`);
    }
  }

  /**
   * Check if service is enabled
   */
  public async isEnabled(): Promise<boolean> {
    const info = await this.status();
    return info.enabled;
  }

  /**
   * Get service logs
   */
  public async logs(lines = 50, follow = false): Promise<string> {
    await this.detectRemoteOS();

    try {
      logger.debug("Getting service logs", { service: this.serviceName, lines, follow });

      let command: string;

      switch (this.os) {
        case OperatingSystem.LINUX:
          command = follow ? `journalctl -u ${this.serviceName} -f` : `journalctl -u ${this.serviceName} -n ${lines}`;
          break;
        case OperatingSystem.MACOS:
          // macOS logs are in a file specified in the plist
          command = `tail -n ${lines} /tmp/${this.serviceName}.log`;
          break;
        case OperatingSystem.WINDOWS:
          // Windows logs would be in a file or Event Viewer
          command = `type C:\\${this.serviceName}\\logs\\service.log`;
          break;
        default:
          throw new Error(`Unsupported operating system: ${this.os}`);
      }

      const result = await this.executeSudoCommand(command);
      return result.stdout;
    } catch (error) {
      logger.error("Failed to get service logs", { service: this.serviceName, error });
      throw new Error(`Failed to get service logs: ${(error as Error).message}`);
    }
  }

  /**
   * Parse service status from command output
   */
  private parseStatus(output: string, os: OperatingSystem): ServiceStatus {
    const trimmed = output.trim().toLowerCase();

    switch (os) {
      case OperatingSystem.LINUX:
        if (trimmed === "active") return ServiceStatus.ACTIVE;
        if (trimmed === "inactive") return ServiceStatus.INACTIVE;
        if (trimmed === "failed") return ServiceStatus.FAILED;
        return ServiceStatus.UNKNOWN;

      case OperatingSystem.MACOS:
        return trimmed.length > 0 ? ServiceStatus.ACTIVE : ServiceStatus.INACTIVE;

      case OperatingSystem.WINDOWS:
        if (trimmed.includes("running")) return ServiceStatus.ACTIVE;
        if (trimmed.includes("stopped")) return ServiceStatus.INACTIVE;
        return ServiceStatus.UNKNOWN;

      default:
        return ServiceStatus.UNKNOWN;
    }
  }

  /**
   * Parse enabled status from command output
   */
  private parseEnabled(output: string, os: OperatingSystem): boolean {
    const trimmed = output.trim().toLowerCase();

    switch (os) {
      case OperatingSystem.LINUX:
        return trimmed === "enabled";

      case OperatingSystem.MACOS:
        return trimmed.length > 0;

      case OperatingSystem.WINDOWS:
        return trimmed.includes("auto_start");

      default:
        return false;
    }
  }

  /**
   * Parse systemd status output to extract PID, CPU, and uptime
   */
  private parseSystemdStatus(output: string): { pid?: number; cpu?: string; uptime?: string } {
    const result: { pid?: number; cpu?: string; uptime?: string } = {};

    // Extract PID from "Main PID: 12345"
    const pidMatch = output.match(/Main PID:\s+(\d+)/);
    if (pidMatch) {
      result.pid = parseInt(pidMatch[1], 10);
    }

    // Extract CPU from "CPU: 1.234s" or "CPU: 1.234s / 2.345s"
    const cpuMatch = output.match(/CPU:\s+([\d.]+s?)/i);
    if (cpuMatch) {
      result.cpu = cpuMatch[1];
    }

    // Extract uptime from "Active: active (running) since Mon 2024-01-01 12:00:00 UTC; 1h 30min ago"
    const uptimeMatch = output.match(/Active:.*since\s+[^;]+;\s+(.+?)(?:\n|$)/);
    if (uptimeMatch) {
      result.uptime = uptimeMatch[1].trim();
    }

    return result;
  }

  /**
   * Get the service name
   */
  public getServiceName(): string {
    return this.serviceName;
  }

  /**
   * Get environment variables from service file
   */
  public async getEnvironmentVariables(): Promise<Record<string, string>> {
    await this.detectRemoteOS();

    if (this.os !== OperatingSystem.LINUX) {
      throw new Error("Environment variable management is only supported on Linux systems");
    }

    try {
      logger.debug("Reading environment variables from service file", { service: this.serviceName });

      const serviceFile = await ServiceFileManager.readServiceFile(this.serviceName, this.ssh);
      const envVars: Record<string, string> = {};

      for (const env of serviceFile.service.environment) {
        envVars[env.key] = env.value;
      }

      logger.debug("Environment variables read successfully", {
        service: this.serviceName,
        count: Object.keys(envVars).length,
      });

      return envVars;
    } catch (error) {
      logger.error("Failed to read environment variables", { service: this.serviceName, error });
      throw new Error(`Failed to read environment variables: ${(error as Error).message}`);
    }
  }

  /**
   * Set environment variables in service file
   * Handles edge cases: missing service file, invalid values, SSH timeouts, concurrent updates
   */
  public async setEnvironmentVariables(vars: Record<string, string>): Promise<void> {
    await this.detectRemoteOS();

    if (this.os !== OperatingSystem.LINUX) {
      throw new Error("Environment variable management is only supported on Linux systems");
    }

    try {
      logger.info("Updating environment variables in service file", {
        service: this.serviceName,
        count: Object.keys(vars).length,
      });

      // Edge case: Empty vars object
      if (Object.keys(vars).length === 0) {
        logger.warn("No environment variables provided to set");
        return;
      }

      // Edge case: Validate all environment variables before updating
      const validationResult = EnvVarManager.validateEnvVars(vars);
      if (!validationResult.valid) {
        const errorMessages = validationResult.errors.map((e) => `  - ${e.key}: ${e.error}`).join("\n");
        throw new Error(
          `Invalid environment variable values:\n${errorMessages}\n` +
            "Please fix these errors before updating the service file."
        );
      }

      // Edge case: Handle missing service file gracefully
      let serviceFileExists = true;
      try {
        await ServiceFileManager.readServiceFile(this.serviceName, this.ssh);
      } catch (readError) {
        const errorMsg = (readError as Error).message;
        if (errorMsg.includes("does not exist") || errorMsg.includes("ENOENT")) {
          serviceFileExists = false;
          logger.warn("Service file does not exist, will create new one", { service: this.serviceName });
        } else {
          // Re-throw other errors (permission, corruption, etc.)
          throw readError;
        }
      }

      // Backup service file (only if it exists)
      if (serviceFileExists) {
        try {
          await ServiceFileManager.backupServiceFile(this.serviceName, this.ssh);
        } catch (backupError) {
          const errorMsg = (backupError as Error).message;
          // If backup fails due to missing file, that's okay (we'll create new)
          if (!errorMsg.includes("ENOENT") && !errorMsg.includes("No such file")) {
            logger.warn("Failed to backup service file, continuing anyway", {
              service: this.serviceName,
              error: errorMsg,
            });
          }
        }
      }

      // Update service file (will create if it doesn't exist)
      await ServiceFileManager.updateServiceFile(this.serviceName, vars, this.ssh);

      logger.info("Environment variables updated successfully", { service: this.serviceName });
    } catch (error) {
      const errorMsg = (error as Error).message;

      // Edge case: Handle SSH timeout errors
      if (this.ssh && (errorMsg.includes("ETIMEDOUT") || errorMsg.includes("timeout"))) {
        throw new Error(
          `SSH connection timed out while updating environment variables.\n` +
            "Recovery steps:\n" +
            "1. Check network connectivity to remote host\n" +
            "2. Verify SSH service is running\n" +
            "3. Check SSH connection timeout settings\n" +
            "4. Retry the operation"
        );
      }

      // Edge case: Handle concurrent update conflicts
      if (errorMsg.includes("ENOENT") && errorMsg.includes("service file")) {
        // Service file was deleted between read and write (concurrent update)
        throw new Error(
          `Service file was modified or deleted during update (possible concurrent update).\n` +
            "Recovery steps:\n" +
            "1. Wait a few seconds and retry\n" +
            "2. Check if another process is updating the service file\n" +
            "3. Verify service file exists: systemctl status " +
            this.serviceName
        );
      }

      logger.error("Failed to update environment variables", { service: this.serviceName, error });
      // Re-throw enhanced errors as-is
      if (errorMsg.includes("Recovery steps:")) {
        throw error;
      }
      throw new Error(`Failed to update environment variables: ${errorMsg}`);
    }
  }

  /**
   * Reset environment variables to defaults
   */
  public async resetEnvironmentVariables(): Promise<void> {
    await this.detectRemoteOS();

    if (this.os !== OperatingSystem.LINUX) {
      throw new Error("Environment variable management is only supported on Linux systems");
    }

    try {
      logger.info("Resetting environment variables to defaults", { service: this.serviceName });

      // Get current service file to preserve non-env settings
      const serviceFile = await ServiceFileManager.readServiceFile(this.serviceName, this.ssh);

      // Get default environment variables
      const defaults = EnvVarManager.getDefaultEnvVars();

      // Merge with existing non-default env vars that should be preserved
      // (e.g., NODE_ENV, PORT if they're not in defaults)
      const envVars: Record<string, string> = { ...defaults };

      // Preserve system-managed variables that might not be in defaults
      for (const env of serviceFile.service.environment) {
        if (!(env.key in defaults)) {
          // Keep non-default variables (might be system-specific)
          envVars[env.key] = env.value;
        }
      }

      // Backup service file
      await ServiceFileManager.backupServiceFile(this.serviceName, this.ssh);

      // Update service file with defaults
      await ServiceFileManager.updateServiceFile(this.serviceName, envVars, this.ssh);

      logger.info("Environment variables reset to defaults", { service: this.serviceName });
    } catch (error) {
      logger.error("Failed to reset environment variables", { service: this.serviceName, error });
      throw new Error(`Failed to reset environment variables: ${(error as Error).message}`);
    }
  }

  /**
   * Sync environment variables from configuration
   * This reads the config, generates env vars, and updates the service file
   */
  public async syncEnvironmentVariablesFromConfig(config: AddonManagerConfig): Promise<void> {
    await this.detectRemoteOS();

    if (this.os !== OperatingSystem.LINUX) {
      throw new Error("Environment variable management is only supported on Linux systems");
    }

    try {
      logger.info("Syncing environment variables from config", { service: this.serviceName });

      // Get environment variables from config (with overrides)
      const envVars = EnvVarManager.mergeEnvVars(config, config.addon.environmentVariables);

      // Validate all environment variables
      for (const [key, value] of Object.entries(envVars)) {
        const validation = EnvVarManager.validateEnvVar(key, value);
        if (!validation.valid) {
          logger.warn(`Invalid environment variable ${key}: ${validation.error}`, {
            service: this.serviceName,
          });
          // Continue with warning instead of failing
        }
      }

      // Backup service file
      await ServiceFileManager.backupServiceFile(this.serviceName, this.ssh);

      // Update service file
      await ServiceFileManager.updateServiceFile(this.serviceName, envVars, this.ssh);

      logger.info("Environment variables synced from config", { service: this.serviceName });
    } catch (error) {
      logger.error("Failed to sync environment variables from config", {
        service: this.serviceName,
        error,
      });
      throw new Error(`Failed to sync environment variables from config: ${(error as Error).message}`);
    }
  }

  /**
   * Sync service file with current configuration
   * Compares existing service file with config-generated one and updates if different
   */
  public async syncServiceFile(
    config: AddonManagerConfig,
    options?: { restartService?: boolean }
  ): Promise<{ updated: boolean; changes?: string[] }> {
    await this.detectRemoteOS();

    if (this.os !== OperatingSystem.LINUX) {
      throw new Error("Service file sync is only supported on Linux systems");
    }

    try {
      logger.info("Syncing service file with config", { service: this.serviceName });

      // Read existing service file
      let existingServiceFile;
      try {
        existingServiceFile = await ServiceFileManager.readServiceFile(this.serviceName, this.ssh);
      } catch (error) {
        logger.warn("Service file not found, will create new one", { service: this.serviceName });
        existingServiceFile = null;
      }

      // Generate service file from config
      const serviceName = this.serviceName;
      const targetDir = config.paths.addonDirectory;
      const addonName = config.addon.name;

      // Get environment variables from config (with overrides)
      const envVars = EnvVarManager.mergeEnvVars(config, config.addon.environmentVariables);

      const newServiceContent = ServiceFileManager.generateServiceFile({
        serviceName,
        addonName,
        addonDirectory: targetDir,
        port: config.addon.port || 7000,
        envVars,
        autoStart: config.features.autoStart,
      });

      // Compare with existing service file
      let needsUpdate = false;
      const changes: string[] = [];

      if (!existingServiceFile) {
        needsUpdate = true;
        changes.push("Service file does not exist, will create new one");
      } else {
        // Compare environment variables
        const existingEnvVars: Record<string, string> = {};
        for (const env of existingServiceFile.service.environment) {
          existingEnvVars[env.key] = env.value;
        }

        // Check for differences
        const newEnvVars = envVars;

        // Check for added or changed variables
        for (const [key, value] of Object.entries(newEnvVars)) {
          if (!(key in existingEnvVars)) {
            needsUpdate = true;
            changes.push(`Added environment variable: ${key}`);
          } else if (existingEnvVars[key] !== value) {
            needsUpdate = true;
            changes.push(`Changed environment variable: ${key} (${existingEnvVars[key]} -> ${value})`);
          }
        }

        // Check for removed variables
        for (const key of Object.keys(existingEnvVars)) {
          if (!(key in newEnvVars)) {
            needsUpdate = true;
            changes.push(`Removed environment variable: ${key}`);
          }
        }

        // Compare other service file properties
        if (existingServiceFile.service.workingDirectory !== targetDir) {
          needsUpdate = true;
          changes.push(`Changed working directory: ${existingServiceFile.service.workingDirectory} -> ${targetDir}`);
        }

        if (existingServiceFile.unit.description !== `Stremio Private Addon: ${addonName}`) {
          needsUpdate = true;
          changes.push(`Changed description`);
        }
      }

      if (!needsUpdate) {
        logger.info("Service file is up to date", { service: this.serviceName });
        return { updated: false };
      }

      // Write updated service file with validation, backup, and rollback
      await ServiceFileManager.writeServiceFile(this.serviceName, newServiceContent, this.ssh, {
        skipBackup: false, // Always backup
        skipValidation: false, // Always validate
        skipTest: false, // Always test with systemd-analyze
      });

      // Reload systemd (already done by writeServiceFile, but ensure it's done)
      try {
        const reloadResult = await this.executeSudoCommand("systemctl daemon-reload");
        if (reloadResult.code !== 0) {
          throw new Error(
            `Failed to reload systemd daemon: ${reloadResult.stderr || reloadResult.stdout}\n` +
              "Recovery steps:\n" +
              "1. Check systemd status: systemctl status\n" +
              "2. Verify systemd is running: systemctl --version\n" +
              "3. Check system logs: journalctl -xe\n" +
              "4. Try manual reload: sudo systemctl daemon-reload"
          );
        }
      } catch (error) {
        logger.error("Failed to reload systemd daemon", { service: this.serviceName, error });
        // Re-throw enhanced errors as-is
        if ((error as Error).message.includes("Recovery steps:")) {
          throw error;
        }
        throw new Error(`Failed to reload systemd daemon: ${(error as Error).message}`);
      }

      // Restart service if requested
      if (options?.restartService) {
        await this.restart();
        logger.info("Service restarted after service file sync");
      }

      logger.info("Service file synced successfully", {
        service: this.serviceName,
        changes: changes.length,
      });

      return { updated: true, changes };
    } catch (error) {
      logger.error("Failed to sync service file", { service: this.serviceName, error });
      throw new Error(`Failed to sync service file: ${(error as Error).message}`);
    }
  }
}

/**
 * Get service name from addon ID
 * Helper function for generating service names from addon IDs
 * @param addonId The addon ID
 * @returns The service name (e.g., "stremio-addon-{id}")
 */
export function getServiceNameFromAddonId(addonId: string): string {
  return generateServiceName(addonId);
}
