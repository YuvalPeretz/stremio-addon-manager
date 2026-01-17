/**
 * Environment Variable Command
 * Manage environment variables for addon services
 */

import chalk from "chalk";
import inquirer from "inquirer";
import {
  logger,
  ServiceManager,
  getServiceNameFromAddonId,
  EnvVarManager,
} from "@stremio-addon-manager/core";
import { resolveAddonId, getConfigManagerForAddon } from "../utils/addon-resolver.js";

interface EnvOptions {
  addon?: string;
  key?: string;
  value?: string;
  restart?: boolean;
}

/**
 * Mask sensitive environment variable values
 */
function maskValue(key: string, value: string): string {
  const metadata = EnvVarManager.getEnvVarMetadata(key);
  if (metadata?.sensitive) {
    return value.length > 0 ? "•".repeat(Math.min(value.length, 20)) : "(empty)";
  }
  return value;
}

/**
 * Format environment variable for display
 */
function formatEnvVar(
  key: string,
  value: string,
  source: "default" | "config" | "override",
  showValue: boolean = true
): string {
  const metadata = EnvVarManager.getEnvVarMetadata(key);
  const displayValue = showValue ? (metadata?.sensitive ? maskValue(key, value) : value) : "(hidden)";
  const sourceColor =
    source === "override" ? chalk.yellow : source === "config" ? chalk.cyan : chalk.gray;
  const sourceLabel = source === "override" ? "[override]" : source === "config" ? "[config]" : "[default]";

  return `${chalk.bold(key.padEnd(25))} ${displayValue.padEnd(30)} ${sourceColor(sourceLabel.padEnd(12))} ${metadata?.description || ""}`;
}

/**
 * List all environment variables
 */
export async function envListCommand(options: EnvOptions): Promise<void> {
  try {
    const addonId = await resolveAddonId(options.addon);
    if (!addonId) {
      console.log(chalk.red("\n❌ No addon selected.\n"));
      process.exit(1);
    }

    const configManager = getConfigManagerForAddon(addonId);
    const config = await configManager.load();
    const serviceName = getServiceNameFromAddonId(addonId);
    const serviceManager = new ServiceManager(serviceName);

    console.log(chalk.bold.cyan(`\n📋 Environment Variables for Addon: ${config.addon.name} (${addonId})\n`));
    console.log(chalk.gray("─".repeat(120)));

    try {
      // Get current environment variables from service file
      const currentEnvVars = await serviceManager.getEnvironmentVariables();

      // Get metadata for all variables
      const allMetadata = EnvVarManager.getAllEnvVarMetadata();
      const defaults = EnvVarManager.getDefaultEnvVars();

      // Display header
      console.log(
        `${chalk.bold("Variable".padEnd(25))} ${chalk.bold("Value".padEnd(30))} ${chalk.bold("Source".padEnd(12))} ${chalk.bold("Description")}`
      );
      console.log(chalk.gray("─".repeat(120)));

      // Display all known environment variables
      for (const [key] of Object.entries(allMetadata)) {
        const currentValue = currentEnvVars[key] || "";
        const source = EnvVarManager.getEnvVarSource(key, config, config.addon.environmentVariables);
        const displayValue = currentValue || (defaults[key] ? `(default: ${defaults[key]})` : "(not set)");

        console.log(formatEnvVar(key, displayValue, source, true));
      }

      // Display any additional variables in service file that aren't in metadata
      const allMetadataKeys = Object.keys(allMetadata);
      for (const key of Object.keys(currentEnvVars)) {
        if (!allMetadataKeys.includes(key)) {
          const source = EnvVarManager.getEnvVarSource(key, config, config.addon.environmentVariables);
          console.log(formatEnvVar(key, currentEnvVars[key], source, true));
        }
      }
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Could not read service file: ${(error as Error).message}`));
      console.log(chalk.gray("Showing expected environment variables from config:\n"));

      // Fallback to showing config-derived values
      const fromConfig = EnvVarManager.getEnvVarsFromConfig(config);

      console.log(
        `${chalk.bold("Variable".padEnd(25))} ${chalk.bold("Value".padEnd(30))} ${chalk.bold("Source".padEnd(12))} ${chalk.bold("Description")}`
      );
      console.log(chalk.gray("─".repeat(120)));

      for (const [key, value] of Object.entries(fromConfig)) {
        const source = EnvVarManager.getEnvVarSource(key, config, config.addon.environmentVariables);
        console.log(formatEnvVar(key, value, source, true));
      }
    }

    console.log(chalk.gray("─".repeat(120)));
    console.log();
  } catch (error) {
    logger.error("Failed to list environment variables", error);
    console.log(chalk.red(`\n❌ Failed to list environment variables: ${(error as Error).message}\n`));
    process.exit(1);
  }
}

/**
 * Get specific environment variable
 */
export async function envGetCommand(key: string, options: EnvOptions): Promise<void> {
  try {
    if (!key) {
      console.log(chalk.red("\n❌ Environment variable key is required.\n"));
      console.log(chalk.yellow("Usage: stremio-addon-manager env get <key> [--addon <id>]\n"));
      process.exit(1);
    }

    const addonId = await resolveAddonId(options.addon);
    if (!addonId) {
      console.log(chalk.red("\n❌ No addon selected.\n"));
      process.exit(1);
    }

    const configManager = getConfigManagerForAddon(addonId);
    const config = await configManager.load();
    const serviceName = getServiceNameFromAddonId(addonId);
    const serviceManager = new ServiceManager(serviceName);

    try {
      const envVars = await serviceManager.getEnvironmentVariables();
      const value = envVars[key];

      if (value === undefined) {
        console.log(chalk.yellow(`\n⚠️  Environment variable '${key}' is not set.\n`));
        const metadata = EnvVarManager.getEnvVarMetadata(key);
        if (metadata?.default !== undefined) {
          console.log(chalk.gray(`Default value: ${metadata.default}\n`));
        }
      } else {
        const metadata = EnvVarManager.getEnvVarMetadata(key);
        const source = EnvVarManager.getEnvVarSource(key, config, config.addon.environmentVariables);
        const displayValue = metadata?.sensitive ? maskValue(key, value) : value;

        console.log(chalk.bold.cyan(`\n📋 Environment Variable: ${key}\n`));
        console.log(chalk.gray("─".repeat(60)));
        console.log(`${chalk.bold("Value:")} ${displayValue}`);
        console.log(`${chalk.bold("Source:")} ${source}`);
        if (metadata) {
          console.log(`${chalk.bold("Description:")} ${metadata.description}`);
          if (metadata.default !== undefined) {
            console.log(`${chalk.bold("Default:")} ${metadata.default}`);
          }
        }
        console.log(chalk.gray("─".repeat(60)));
        console.log();
      }
    } catch (error) {
      console.log(chalk.red(`\n❌ Failed to get environment variable: ${(error as Error).message}\n`));
      process.exit(1);
    }
  } catch (error) {
    logger.error("Failed to get environment variable", error);
    console.log(chalk.red(`\n❌ Failed to get environment variable: ${(error as Error).message}\n`));
    process.exit(1);
  }
}

/**
 * Set environment variable
 */
export async function envSetCommand(key: string, value: string, options: EnvOptions): Promise<void> {
  try {
    if (!key) {
      console.log(chalk.red("\n❌ Environment variable key is required.\n"));
      console.log(chalk.yellow("Usage: stremio-addon-manager env set <key> <value> [--addon <id>] [--restart]\n"));
      process.exit(1);
    }

    if (value === undefined) {
      // Prompt for value if not provided
      const metadata = EnvVarManager.getEnvVarMetadata(key);
      const prompt = await inquirer.prompt([
        {
          type: metadata?.sensitive ? "password" : "input",
          name: "value",
          message: `Enter value for ${key}:`,
          default: metadata?.default ? String(metadata.default) : undefined,
          validate: (input: string) => {
            if (!input && EnvVarManager.getEnvVarMetadata(key)?.required) {
              return "This environment variable is required";
            }
            const validation = EnvVarManager.validateEnvVar(key, input);
            if (!validation.valid) {
              return validation.error || "Invalid value";
            }
            return true;
          },
        },
      ]);
      value = prompt.value;
    }

    // Validate value
    const validation = EnvVarManager.validateEnvVar(key, value);
    if (!validation.valid) {
      console.log(chalk.red(`\n❌ Invalid value: ${validation.error}\n`));
      process.exit(1);
    }

    const addonId = await resolveAddonId(options.addon);
    if (!addonId) {
      console.log(chalk.red("\n❌ No addon selected.\n"));
      process.exit(1);
    }

    const configManager = getConfigManagerForAddon(addonId);
    const config = await configManager.load();
    const serviceName = getServiceNameFromAddonId(addonId);
    const serviceManager = new ServiceManager(serviceName);

    // Get current environment variables
    const currentEnvVars = await serviceManager.getEnvironmentVariables();

    // Update the specific variable
    currentEnvVars[key] = value;

    // Update service file
    await serviceManager.setEnvironmentVariables(currentEnvVars);

    // Optionally save as override in config
    if (!config.addon.environmentVariables) {
      config.addon.environmentVariables = {};
    }
    config.addon.environmentVariables[key] = value;
    await configManager.save(config);

    console.log(chalk.green(`\n✅ Environment variable '${key}' set successfully.\n`));

    if (options.restart) {
      console.log(chalk.yellow("Restarting service..."));
      await serviceManager.restart();
      console.log(chalk.green("Service restarted.\n"));
    } else {
      console.log(chalk.yellow("⚠️  Service file updated. Restart the service for changes to take effect."));
      console.log(chalk.gray("   Use --restart flag to restart automatically.\n"));
    }
  } catch (error) {
    logger.error("Failed to set environment variable", error);
    console.log(chalk.red(`\n❌ Failed to set environment variable: ${(error as Error).message}\n`));
    process.exit(1);
  }
}

/**
 * Unset environment variable (reset to default)
 */
export async function envUnsetCommand(key: string, options: EnvOptions): Promise<void> {
  try {
    if (!key) {
      console.log(chalk.red("\n❌ Environment variable key is required.\n"));
      console.log(chalk.yellow("Usage: stremio-addon-manager env unset <key> [--addon <id>] [--restart]\n"));
      process.exit(1);
    }

    const addonId = await resolveAddonId(options.addon);
    if (!addonId) {
      console.log(chalk.red("\n❌ No addon selected.\n"));
      process.exit(1);
    }

    const configManager = getConfigManagerForAddon(addonId);
    const config = await configManager.load();
    const serviceName = getServiceNameFromAddonId(addonId);
    const serviceManager = new ServiceManager(serviceName);

    // Get current environment variables
    const currentEnvVars = await serviceManager.getEnvironmentVariables();

    // Remove the variable (will fall back to default/config)
    delete currentEnvVars[key];

    // Update service file
    await serviceManager.setEnvironmentVariables(currentEnvVars);

    // Remove override from config
    if (config.addon.environmentVariables) {
      config.addon.environmentVariables[key] = null;
      await configManager.save(config);
    }

    console.log(chalk.green(`\n✅ Environment variable '${key}' reset to default/config value.\n`));

    if (options.restart) {
      console.log(chalk.yellow("Restarting service..."));
      await serviceManager.restart();
      console.log(chalk.green("Service restarted.\n"));
    } else {
      console.log(chalk.yellow("⚠️  Service file updated. Restart the service for changes to take effect."));
      console.log(chalk.gray("   Use --restart flag to restart automatically.\n"));
    }
  } catch (error) {
    logger.error("Failed to unset environment variable", error);
    console.log(chalk.red(`\n❌ Failed to unset environment variable: ${(error as Error).message}\n`));
    process.exit(1);
  }
}

/**
 * Reset all environment variables to defaults
 */
export async function envResetCommand(options: EnvOptions): Promise<void> {
  try {
    const addonId = await resolveAddonId(options.addon);
    if (!addonId) {
      console.log(chalk.red("\n❌ No addon selected.\n"));
      process.exit(1);
    }

    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: "Are you sure you want to reset all environment variables to defaults?",
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.yellow("\n❌ Operation cancelled.\n"));
      return;
    }

    const serviceName = getServiceNameFromAddonId(addonId);
    const serviceManager = new ServiceManager(serviceName);

    await serviceManager.resetEnvironmentVariables();

    // Clear all overrides in config
    const configManager = getConfigManagerForAddon(addonId);
    const config = await configManager.load();
    config.addon.environmentVariables = {};
    await configManager.save(config);

    console.log(chalk.green("\n✅ All environment variables reset to defaults.\n"));

    if (options.restart) {
      console.log(chalk.yellow("Restarting service..."));
      await serviceManager.restart();
      console.log(chalk.green("Service restarted.\n"));
    } else {
      console.log(chalk.yellow("⚠️  Service file updated. Restart the service for changes to take effect."));
      console.log(chalk.gray("   Use --restart flag to restart automatically.\n"));
    }
  } catch (error) {
    logger.error("Failed to reset environment variables", error);
    console.log(chalk.red(`\n❌ Failed to reset environment variables: ${(error as Error).message}\n`));
    process.exit(1);
  }
}

/**
 * Sync service file with current config
 */
export async function envSyncCommand(options: EnvOptions): Promise<void> {
  try {
    const addonId = await resolveAddonId(options.addon);
    if (!addonId) {
      console.log(chalk.red("\n❌ No addon selected.\n"));
      process.exit(1);
    }

    const configManager = getConfigManagerForAddon(addonId);
    const config = await configManager.load();
    const serviceName = getServiceNameFromAddonId(addonId);
    const serviceManager = new ServiceManager(serviceName);

    console.log(chalk.yellow("\n🔄 Syncing service file with configuration...\n"));

    const result = await serviceManager.syncServiceFile(config, {
      restartService: options.restart,
    });

    if (result.updated) {
      console.log(chalk.green("✅ Service file updated successfully.\n"));
      if (result.changes && result.changes.length > 0) {
        console.log(chalk.cyan("Changes made:"));
        result.changes.forEach((change) => {
          console.log(chalk.gray(`  - ${change}`));
        });
        console.log();
      }
    } else {
      console.log(chalk.green("✅ Service file is already up to date.\n"));
    }
  } catch (error) {
    logger.error("Failed to sync service file", error);
    console.log(chalk.red(`\n❌ Failed to sync service file: ${(error as Error).message}\n`));
    process.exit(1);
  }
}

/**
 * Generate value for generateable environment variable
 */
export async function envGenerateCommand(key: string, options: EnvOptions): Promise<void> {
  try {
    if (!key) {
      console.log(chalk.red("\n❌ Environment variable key is required.\n"));
      console.log(chalk.yellow("Usage: stremio-addon-manager env generate <key> [--addon <id>] [--restart]\n"));
      process.exit(1);
    }

    const metadata = EnvVarManager.getEnvVarMetadata(key);
    if (!metadata || !metadata.generateable) {
      console.log(chalk.red(`\n❌ Environment variable '${key}' cannot be generated.\n`));
      const allMetadata = EnvVarManager.getAllEnvVarMetadata();
      const generateable = Object.entries(allMetadata)
        .filter(([, m]) => m.generateable)
        .map(([k]) => k);
      if (generateable.length > 0) {
        console.log(chalk.yellow("Generateable variables:"));
        generateable.forEach((k) => {
          console.log(chalk.cyan(`  - ${k}`));
        });
        console.log();
      }
      process.exit(1);
    }

    const generatedValue = EnvVarManager.generateEnvVarValue(key);
    if (!generatedValue) {
      console.log(chalk.red(`\n❌ Failed to generate value for '${key}'.\n`));
      process.exit(1);
    }

    const addonId = await resolveAddonId(options.addon);
    if (!addonId) {
      console.log(chalk.red("\n❌ No addon selected.\n"));
      process.exit(1);
    }

    const configManager = getConfigManagerForAddon(addonId);
    const config = await configManager.load();
    const serviceName = getServiceNameFromAddonId(addonId);
    const serviceManager = new ServiceManager(serviceName);

    // Get current environment variables
    const currentEnvVars = await serviceManager.getEnvironmentVariables();

    // Set the generated value
    currentEnvVars[key] = generatedValue;

    // Update service file
    await serviceManager.setEnvironmentVariables(currentEnvVars);

    // Save as override in config
    if (!config.addon.environmentVariables) {
      config.addon.environmentVariables = {};
    }
    config.addon.environmentVariables[key] = generatedValue;
    await configManager.save(config);

    console.log(chalk.green(`\n✅ Generated and set value for '${key}'.\n`));
    console.log(chalk.cyan(`Generated value: ${maskValue(key, generatedValue)}\n`));

    if (options.restart) {
      console.log(chalk.yellow("Restarting service..."));
      await serviceManager.restart();
      console.log(chalk.green("Service restarted.\n"));
    } else {
      console.log(chalk.yellow("⚠️  Service file updated. Restart the service for changes to take effect."));
      console.log(chalk.gray("   Use --restart flag to restart automatically.\n"));
    }
  } catch (error) {
    logger.error("Failed to generate environment variable", error);
    console.log(chalk.red(`\n❌ Failed to generate environment variable: ${(error as Error).message}\n`));
    process.exit(1);
  }
}

/**
 * Main env command handler
 */
export async function envCommand(action: string, key?: string, value?: string, options: EnvOptions = {}): Promise<void> {
  switch (action) {
    case "list":
      await envListCommand(options);
      break;
    case "get":
      await envGetCommand(key || "", options);
      break;
    case "set":
      await envSetCommand(key || "", value || "", options);
      break;
    case "unset":
      await envUnsetCommand(key || "", options);
      break;
    case "reset":
      await envResetCommand(options);
      break;
    case "sync":
      await envSyncCommand(options);
      break;
    case "generate":
      await envGenerateCommand(key || "", options);
      break;
    default:
      console.log(chalk.red(`\n❌ Unknown action: ${action}\n`));
      console.log(chalk.yellow("Available actions: list, get, set, unset, reset, sync, generate\n"));
      process.exit(1);
  }
}
