/**
 * Service File Manager
 * Handles reading, parsing, updating, and generating systemd service files
 */

import fs from "node:fs/promises";
import { logger } from "../utils/logger.js";
import type { SSHConnection } from "../ssh/types.js";

/**
 * Environment variable entry in service file
 */
export interface EnvironmentVariable {
  key: string;
  value: string;
}

/**
 * Parsed service file content
 */
export interface ServiceFileContent {
  unit: {
    description?: string;
    after?: string;
  };
  service: {
    type?: string;
    user?: string;
    workingDirectory?: string;
    execStart?: string;
    restart?: string;
    restartSec?: string;
    environment: EnvironmentVariable[];
  };
  install: {
    wantedBy?: string;
  };
  rawContent: string;
}

/**
 * Service File Manager class
 */
export class ServiceFileManager {
  /**
   * Read service file from systemd
   * Handles edge cases: missing file, corrupted file, permission errors
   */
  public static async readServiceFile(
    serviceName: string,
    ssh?: SSHConnection
  ): Promise<ServiceFileContent> {
    const servicePath = `/etc/systemd/system/${serviceName}.service`;

    try {
      let content: string;

      if (ssh) {
        // Read from remote system
        const result = await ssh.execSudo(`cat ${servicePath}`);
        if (result.code !== 0) {
          // Check if file doesn't exist
          if (result.stderr.includes("No such file") || result.stderr.includes("ENOENT")) {
            throw new Error(
              `Service file does not exist: ${servicePath}\n` +
                "This is normal for new installations. The service file will be created during installation."
            );
          }
          // Check for permission errors
          if (result.stderr.includes("Permission denied") || result.stderr.includes("EACCES")) {
            throw new Error(
              `Permission denied reading service file: ${servicePath}\n` +
                "Recovery steps:\n" +
                "1. Ensure you have sudo privileges\n" +
                "2. Check file permissions: ls -l " +
                servicePath +
                "\n" +
                "3. Verify SSH user has sudo access"
            );
          }
          throw new Error(`Failed to read service file: ${result.stderr}`);
        }
        content = result.stdout;
        
        // Check if file is empty
        if (!content || content.trim().length === 0) {
          throw new Error(
            `Service file is empty: ${servicePath}\n` +
              "The service file exists but contains no content. This may indicate corruption."
          );
        }
      } else {
        // Read from local system
        try {
          content = await fs.readFile(servicePath, "utf-8");
        } catch (fileError) {
          const error = fileError as NodeJS.ErrnoException;
          // Handle missing file
          if (error.code === "ENOENT") {
            throw new Error(
              `Service file does not exist: ${servicePath}\n` +
                "This is normal for new installations. The service file will be created during installation."
            );
          }
          // Handle permission errors
          if (error.code === "EACCES") {
            throw new Error(
              `Permission denied reading service file: ${servicePath}\n` +
                "Recovery steps:\n" +
                "1. Run with sudo or as administrator\n" +
                "2. Check file permissions: ls -l " +
                servicePath
            );
          }
          throw fileError;
        }
        
        // Check if file is empty
        if (!content || content.trim().length === 0) {
          throw new Error(
            `Service file is empty: ${servicePath}\n` +
              "The service file exists but contains no content. This may indicate corruption."
          );
        }
      }

      // Parse with error handling for corrupted files
      try {
        return this.parseServiceFile(content);
      } catch (parseError) {
        logger.error("Failed to parse service file - file may be corrupted", {
          serviceName,
          error: parseError,
          contentPreview: content.substring(0, 200),
        });
        throw new Error(
          `Service file appears to be corrupted or invalid: ${servicePath}\n` +
            `Parse error: ${(parseError as Error).message}\n` +
            "Recovery steps:\n" +
            "1. Check service file manually: cat " +
            servicePath +
            "\n" +
            "2. Verify service file syntax: systemd-analyze verify " +
            serviceName +
            "\n" +
            "3. Restore from backup if available\n" +
            "4. Recreate service file if necessary"
        );
      }
    } catch (error) {
      // Re-throw enhanced errors as-is
      if ((error as Error).message.includes("Recovery steps:") || (error as Error).message.includes("This is normal")) {
        throw error;
      }
      logger.error("Failed to read service file", error);
      throw new Error(`Failed to read service file: ${(error as Error).message}`);
    }
  }

  /**
   * Parse service file content into structured format
   * Handles edge cases: malformed content, missing sections, invalid entries, duplicate env vars
   */
  public static parseServiceFile(content: string): ServiceFileContent {
    if (!content || typeof content !== "string") {
      throw new Error("Service file content must be a non-empty string");
    }

    const lines = content.split("\n");
    const result: ServiceFileContent = {
      unit: {},
      service: {
        environment: [],
      },
      install: {},
      rawContent: content,
    };

    let currentSection: "unit" | "service" | "install" | null = null;
    const errors: string[] = [];
    const envVarKeys = new Set<string>(); // Track duplicate environment variables

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      // Detect section headers (handle with/without whitespace)
      if (trimmed === "[Unit]" || trimmed.startsWith("[Unit]")) {
        currentSection = "unit";
        continue;
      } else if (trimmed === "[Service]" || trimmed.startsWith("[Service]")) {
        currentSection = "service";
        continue;
      } else if (trimmed === "[Install]" || trimmed.startsWith("[Install]")) {
        currentSection = "install";
        continue;
      }

      // If we encounter a key-value pair outside a section, log warning but continue
      if (!currentSection && trimmed.includes("=")) {
        errors.push(`Line ${i + 1}: Key-value pair found outside section (ignored): ${trimmed}`);
        continue;
      }

      // Parse key-value pairs
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();

        // Validate key is not empty
        if (!key) {
          errors.push(`Line ${i + 1}: Empty key in key-value pair (ignored): ${trimmed}`);
          continue;
        }

        try {
          if (currentSection === "unit") {
            if (key === "Description") {
              result.unit.description = value;
            } else if (key === "After") {
              result.unit.after = value;
            }
            // Ignore unknown unit keys (they might be custom entries)
          } else if (currentSection === "service") {
            if (key === "Type") {
              result.service.type = value;
            } else if (key === "User") {
              result.service.user = value;
            } else if (key === "WorkingDirectory") {
              result.service.workingDirectory = value;
            } else if (key === "ExecStart") {
              result.service.execStart = value;
            } else if (key === "Restart") {
              result.service.restart = value;
            } else if (key === "RestartSec") {
              result.service.restartSec = value;
            } else if (key === "Environment") {
              // Parse Environment=KEY=VALUE format
              // Handle cases where value might contain = signs (e.g., paths with =)
              const envMatch = value.match(/^([^=]+)=(.*)$/);
              if (envMatch) {
                const envKey = envMatch[1].trim();
                const envValue = envMatch[2].trim();

                // Validate environment variable key
                if (!envKey) {
                  errors.push(`Line ${i + 1}: Empty environment variable key (ignored): ${trimmed}`);
                  continue;
                }

                // Handle duplicate environment variables (keep the last one, log warning)
                if (envVarKeys.has(envKey)) {
                  logger.warn(`Duplicate environment variable '${envKey}' found, using last value`, {
                    line: i + 1,
                    value: envValue,
                  });
                  // Update existing entry
                  const existingIndex = result.service.environment.findIndex((env) => env.key === envKey);
                  if (existingIndex >= 0) {
                    result.service.environment[existingIndex].value = envValue;
                  }
                } else {
                  envVarKeys.add(envKey);
                  result.service.environment.push({
                    key: envKey,
                    value: envValue,
                  });
                }
              } else {
                errors.push(`Line ${i + 1}: Invalid environment variable format (ignored): ${trimmed}`);
              }
            }
            // Ignore unknown service keys (they might be custom entries)
          } else if (currentSection === "install") {
            if (key === "WantedBy") {
              result.install.wantedBy = value;
            }
            // Ignore unknown install keys (they might be custom entries)
          }
        } catch (parseError) {
          errors.push(`Line ${i + 1}: Error parsing key-value pair '${key}': ${(parseError as Error).message}`);
        }
      } else if (currentSection && trimmed.length > 0) {
        // Line doesn't match key=value format but is in a section
        errors.push(`Line ${i + 1}: Invalid format in ${currentSection} section (ignored): ${trimmed}`);
      }
    }

    // Log warnings for non-critical errors
    if (errors.length > 0) {
      logger.warn("Service file parsing encountered warnings", {
        errorCount: errors.length,
        errors: errors.slice(0, 10), // Log first 10 errors
        serviceFilePreview: content.substring(0, 500),
      });
    }

    // Only throw if we can't extract any critical information
    if (!result.service.execStart && !result.service.workingDirectory) {
      throw new Error(
        `Failed to parse service file: No critical information found (ExecStart or WorkingDirectory).\n` +
          `Errors:\n${errors.slice(0, 5).join("\n")}${errors.length > 5 ? `\n... and ${errors.length - 5} more` : ""}`
      );
    }

    return result;
  }

  /**
   * Generate service file content from configuration
   */
  public static generateServiceFile(
    config: {
      serviceName: string;
      addonName: string;
      addonDirectory: string;
      port: number;
      envVars: Record<string, string>;
      autoStart?: boolean;
    }
  ): string {
    const { addonName, addonDirectory, envVars } = config;

    // Build environment variables section
    const envLines = Object.entries(envVars)
      .map(([key, value]) => `Environment=${key}=${value}`)
      .join("\n");

    const serviceConfig = `[Unit]
Description=Stremio Private Addon: ${addonName}
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${addonDirectory}
ExecStart=/usr/bin/node ${addonDirectory}/server.js
Restart=always
RestartSec=10
${envLines}

[Install]
WantedBy=multi-user.target
`;

    return serviceConfig;
  }

  /**
   * Update service file with new environment variables
   * Handles edge cases: missing service file, custom entries, concurrent updates
   */
  public static async updateServiceFile(
    serviceName: string,
    envVars: Record<string, string>,
    ssh?: SSHConnection
  ): Promise<void> {
    try {
      // Edge case: Handle missing service file - create new one
      let existing: ServiceFileContent | null = null;
      let serviceFileExists = true;

      try {
        existing = await this.readServiceFile(serviceName, ssh);
      } catch (readError) {
        const errorMsg = (readError as Error).message;
        if (errorMsg.includes("does not exist") || errorMsg.includes("ENOENT")) {
          serviceFileExists = false;
          logger.info("Service file does not exist, will create new one", { serviceName });
          // Create minimal service file structure
          existing = {
            unit: {
              description: `Stremio Private Addon: ${serviceName}`,
              after: "network.target",
            },
            service: {
              type: "simple",
              user: "root",
              workingDirectory: "/opt/stremio-addon",
              execStart: "/usr/bin/node /opt/stremio-addon/server.js",
              restart: "always",
              restartSec: "10",
              environment: [],
            },
            install: {
              wantedBy: "multi-user.target",
            },
            rawContent: "",
          };
        } else {
          // Re-throw other errors (permission, corruption, etc.)
          throw readError;
        }
      }

      // Edge case: Empty envVars - preserve existing
      if (Object.keys(envVars).length === 0 && existing) {
        logger.warn("No environment variables provided, preserving existing", { serviceName });
        return; // No changes needed
      }

      // Update environment variables while preserving existing ones
      const updatedEnv: EnvironmentVariable[] = [];
      const envVarKeys = new Set(Object.keys(envVars));

      // Keep existing environment variables that aren't being updated
      if (existing) {
        for (const env of existing.service.environment) {
          if (envVarKeys.has(env.key)) {
            // Update existing variable
            updatedEnv.push({
              key: env.key,
              value: envVars[env.key],
            });
            envVarKeys.delete(env.key);
          } else {
            // Preserve existing variable (including custom entries)
            updatedEnv.push(env);
          }
        }
      }

      // Add new environment variables
      for (const key of envVarKeys) {
        updatedEnv.push({
          key,
          value: envVars[key],
        });
      }

      // Generate new service file content, preserving custom entries from existing file
      const envVarsMap: Record<string, string> = {};
      for (const env of updatedEnv) {
        envVarsMap[env.key] = env.value;
      }

      // Use existing values or defaults
      const addonName = existing?.unit.description?.replace("Stremio Private Addon: ", "") || serviceName;
      const addonDirectory = existing?.service.workingDirectory || "/opt/stremio-addon";
      const port = parseInt(envVarsMap.PORT || existing?.service.environment.find((e) => e.key === "PORT")?.value || "7000", 10);

      const newContent = this.generateServiceFile({
        serviceName,
        addonName,
        addonDirectory,
        port,
        envVars: envVarsMap,
        autoStart: true,
      });

      // Write updated service file using writeServiceFile for safety (validation, backup, rollback)
      await this.writeServiceFile(serviceName, newContent, ssh, {
        skipBackup: !serviceFileExists, // Don't backup if creating new file
        skipValidation: false,
        skipTest: false,
      });

      logger.info("Service file updated", { serviceName, created: !serviceFileExists });
    } catch (error) {
      const errorMsg = (error as Error).message;

      // Edge case: Handle concurrent update conflicts
      if (errorMsg.includes("ENOENT") && errorMsg.includes("service file")) {
        throw new Error(
          `Service file was modified or deleted during update (possible concurrent update).\n` +
            "Recovery steps:\n" +
            "1. Wait a few seconds and retry\n" +
            "2. Check if another process is updating the service file\n" +
            "3. Verify service file exists: systemctl status " +
            serviceName
        );
      }

      logger.error("Failed to update service file", error);
      // Re-throw enhanced errors as-is
      if (errorMsg.includes("Recovery steps:")) {
        throw error;
      }
      throw new Error(`Failed to update service file: ${errorMsg}`);
    }
  }

  /**
   * Validate service file content
   * Performs comprehensive validation of systemd service file syntax and structure
   */
  public static validateServiceFile(content: string): { valid: boolean; errors: string[]; warnings?: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic syntax checks
    if (!content || content.trim().length === 0) {
      errors.push("Service file content is empty");
      return { valid: false, errors };
    }

    // Check for required sections
    if (!content.includes("[Unit]")) {
      errors.push("Missing required [Unit] section");
    }
    if (!content.includes("[Service]")) {
      errors.push("Missing required [Service] section");
    }
    if (!content.includes("[Install]")) {
      errors.push("Missing required [Install] section");
    }

    // Check section order (Unit should come first)
    const unitIndex = content.indexOf("[Unit]");
    const serviceIndex = content.indexOf("[Service]");
    const installIndex = content.indexOf("[Install]");

    if (unitIndex !== -1 && serviceIndex !== -1 && unitIndex > serviceIndex) {
      errors.push("Invalid section order: [Unit] must come before [Service]");
    }
    if (serviceIndex !== -1 && installIndex !== -1 && serviceIndex > installIndex) {
      errors.push("Invalid section order: [Service] must come before [Install]");
    }

    // Parse and validate structure
    let parsed: ServiceFileContent;
    try {
      parsed = this.parseServiceFile(content);
    } catch (error) {
      errors.push(`Failed to parse service file: ${(error as Error).message}`);
      return { valid: false, errors };
    }

    // Validate Unit section
    if (!parsed.unit.description) {
      warnings.push("No Description in [Unit] section (recommended)");
    }

    // Validate Service section - required fields
    if (!parsed.service.execStart) {
      errors.push("Missing required ExecStart in [Service] section");
    } else {
      // Validate ExecStart path
      const execPath = parsed.service.execStart.split(" ")[0];
      if (!execPath.startsWith("/")) {
        errors.push(`ExecStart path must be absolute: ${execPath}`);
      }
    }

    if (!parsed.service.workingDirectory) {
      errors.push("Missing required WorkingDirectory in [Service] section");
    } else {
      // Validate WorkingDirectory path
      if (!parsed.service.workingDirectory.startsWith("/")) {
        errors.push(`WorkingDirectory must be absolute: ${parsed.service.workingDirectory}`);
      }
    }

    if (!parsed.service.type) {
      warnings.push("No Type specified in [Service] section (defaults to 'simple')");
    }

    if (!parsed.service.user) {
      warnings.push("No User specified in [Service] section (defaults to root)");
    }

    if (!parsed.service.restart) {
      warnings.push("No Restart policy specified in [Service] section (recommended: 'always')");
    }

    // Validate environment variables format
    for (const env of parsed.service.environment) {
      if (!env.key || env.key.trim().length === 0) {
        errors.push(`Environment variable has empty key: ${env.value}`);
      }
      if (env.value === undefined || env.value === null) {
        errors.push(`Environment variable ${env.key} has no value`);
      }
      // Check for common issues
      if (env.key.includes(" ")) {
        errors.push(`Environment variable key contains spaces: ${env.key}`);
      }
      if (env.key.includes("=")) {
        errors.push(`Environment variable key contains '=': ${env.key}`);
      }
    }

    // Validate Install section
    if (!parsed.install.wantedBy) {
      warnings.push("No WantedBy in [Install] section (recommended: 'multi-user.target')");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Test systemd service file configuration
   * Uses systemd-analyze to validate the service file
   */
  public static async testSystemdConfig(
    serviceName: string,
    ssh?: SSHConnection
  ): Promise<{ valid: boolean; errors: string[]; warnings?: string[] }> {
    const servicePath = `/etc/systemd/system/${serviceName}.service`;

    try {
      let result: { code: number; stdout: string; stderr: string };

      if (ssh) {
        result = await ssh.execSudo(`systemd-analyze verify ${servicePath}`);
      } else {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);
        const output = await execAsync(`sudo systemd-analyze verify ${servicePath}`);
        result = {
          code: 0,
          stdout: output.stdout.toString(),
          stderr: output.stderr.toString(),
        };
      }

      if (result.code === 0) {
        return { valid: true, errors: [] };
      } else {
        // Parse systemd-analyze output
        const errors: string[] = [];
        const warnings: string[] = [];

        const output = result.stderr || result.stdout;
        const lines = output.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          if (line.toLowerCase().includes("error") || line.toLowerCase().includes("failed")) {
            errors.push(line.trim());
          } else if (line.toLowerCase().includes("warning")) {
            warnings.push(line.trim());
          } else {
            // Treat unknown output as warnings
            warnings.push(line.trim());
          }
        }

        return {
          valid: errors.length === 0,
          errors,
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      }
    } catch (error) {
      // If systemd-analyze is not available or fails, return error
      return {
        valid: false,
        errors: [`Failed to test systemd configuration: ${(error as Error).message}`],
      };
    }
  }

  /**
   * Backup service file before modification
   */
  public static async backupServiceFile(
    serviceName: string,
    ssh?: SSHConnection
  ): Promise<string> {
    const servicePath = `/etc/systemd/system/${serviceName}.service`;
    const backupPath = `${servicePath}.backup.${Date.now()}`;

    try {
      if (ssh) {
        await ssh.execSudo(`cp ${servicePath} ${backupPath}`);
      } else {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);
        await execAsync(`sudo cp ${servicePath} ${backupPath}`);
      }

      logger.info("Service file backed up", { servicePath, backupPath });
      return backupPath;
    } catch (error) {
      logger.error("Failed to backup service file", error);
      throw new Error(`Failed to backup service file: ${(error as Error).message}`);
    }
  }

  /**
   * Write service file with validation, backup, and rollback on failure
   * This is the safe way to write service files - it validates, backs up, writes, tests, and rolls back on failure
   */
  public static async writeServiceFile(
    serviceName: string,
    content: string,
    ssh?: SSHConnection,
    options?: { skipBackup?: boolean; skipValidation?: boolean; skipTest?: boolean }
  ): Promise<{ backupPath?: string; validated: boolean; tested: boolean }> {
    const servicePath = `/etc/systemd/system/${serviceName}.service`;
    let backupPath: string | undefined;

    try {
      // Step 1: Validate service file content
      if (!options?.skipValidation) {
        const validation = this.validateServiceFile(content);
        if (!validation.valid) {
          throw new Error(
            `Service file validation failed:\n${validation.errors.join("\n")}${
              validation.warnings ? `\nWarnings:\n${validation.warnings.join("\n")}` : ""
            }`
          );
        }
        if (validation.warnings && validation.warnings.length > 0) {
          logger.warn("Service file validation warnings", { warnings: validation.warnings });
        }
      }

      // Step 2: Backup existing service file (if it exists)
      if (!options?.skipBackup) {
        try {
          backupPath = await this.backupServiceFile(serviceName, ssh);
        } catch (error) {
          // If backup fails but file doesn't exist, that's okay (new service)
          const errorMsg = (error as Error).message;
          if (!errorMsg.includes("ENOENT") && !errorMsg.includes("No such file")) {
            logger.warn("Failed to backup service file, continuing anyway", { error: errorMsg });
          }
        }
      }

      // Step 3: Write service file
      const tempPath = `/tmp/${serviceName}.service.${Date.now()}`;

      if (ssh) {
        // Remote: write via SSH
        await ssh.execCommand(`cat > ${tempPath} << 'EOF'\n${content}\nEOF`);
        await ssh.execSudo(`mv ${tempPath} ${servicePath}`);
      } else {
        // Local: write to temp then move with sudo
        await fs.writeFile(tempPath, content, "utf-8");
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);
        await execAsync(`sudo mv ${tempPath} ${servicePath}`);
      }

      // Step 4: Test systemd configuration
      let tested = false;
      if (!options?.skipTest) {
        const testResult = await this.testSystemdConfig(serviceName, ssh);
        if (!testResult.valid) {
          // Rollback on test failure
          if (backupPath) {
            logger.warn("Systemd config test failed, rolling back", { errors: testResult.errors });
            await this.rollbackServiceFile(serviceName, backupPath, ssh);
            throw new Error(
              `Systemd configuration test failed:\n${testResult.errors.join("\n")}\nService file has been rolled back.`
            );
          } else {
            throw new Error(`Systemd configuration test failed:\n${testResult.errors.join("\n")}`);
          }
        }
        tested = true;
        if (testResult.warnings && testResult.warnings.length > 0) {
          logger.warn("Systemd config test warnings", { warnings: testResult.warnings });
        }
      }

      logger.info("Service file written successfully", { serviceName, backupPath, tested });
      return { backupPath, validated: !options?.skipValidation, tested };
    } catch (error) {
      // Rollback on any error if we have a backup
      if (backupPath) {
        try {
          await this.rollbackServiceFile(serviceName, backupPath, ssh);
          logger.info("Service file rolled back due to error", { serviceName, backupPath });
        } catch (rollbackError) {
          logger.error("Failed to rollback service file", rollbackError);
          throw new Error(
            `Failed to write service file and rollback failed: ${(error as Error).message}. Rollback error: ${(rollbackError as Error).message}`
          );
        }
      }
      logger.error("Failed to write service file", error);
      throw error;
    }
  }

  /**
   * Rollback service file from backup
   */
  public static async rollbackServiceFile(
    serviceName: string,
    backupPath: string,
    ssh?: SSHConnection
  ): Promise<void> {
    const servicePath = `/etc/systemd/system/${serviceName}.service`;

    try {
      if (ssh) {
        await ssh.execSudo(`cp ${backupPath} ${servicePath}`);
        await ssh.execSudo("systemctl daemon-reload");
      } else {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);
        await execAsync(`sudo cp ${backupPath} ${servicePath}`);
        await execAsync("sudo systemctl daemon-reload");
      }

      logger.info("Service file rolled back successfully", { serviceName, backupPath });
    } catch (error) {
      logger.error("Failed to rollback service file", error);
      throw new Error(`Failed to rollback service file: ${(error as Error).message}`);
    }
  }
}
