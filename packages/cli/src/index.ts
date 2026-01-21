#!/usr/bin/env node

/**
 * Stremio Addon Manager CLI
 * Main entry point
 */

import { Command } from "commander";
import { logger } from "@stremio-addon-manager/core";
import { installCommand } from "./commands/install.js";
import { listCommand } from "./commands/list.js";
import { switchCommand } from "./commands/switch.js";
import { statusCommand } from "./commands/status.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { restartCommand } from "./commands/restart.js";
import { logsCommand } from "./commands/logs.js";
import { configCommand } from "./commands/config.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { envCommand } from "./commands/env.js";
import { updateCommand } from "./commands/update.js";
import { rollbackCommand } from "./commands/rollback.js";

const program = new Command();

/**
 * CLI Version and description
 */
program
  .name("stremio-addon-manager")
  .description("Stremio Addon Manager - Install and manage your private Stremio addon")
  .version("1.0.0");

/**
 * Install command - Main installation flow
 */
program
  .command("install")
  .description("Install the Stremio addon on local or remote machine")
  .option("-r, --remote", "Install on a remote machine via SSH")
  .option("-c, --config <path>", "Use a specific configuration file")
  .option("--skip-ssl", "Skip SSL/HTTPS setup (not recommended for Stremio)")
  .option("--addon-name <name>", "Name for the new addon (required for multi-addon support)")
  .action(installCommand);

/**
 * List command - List all installed addons
 */
program.command("list").description("List all installed addons").action(listCommand);

/**
 * Switch command - Set default addon
 */
program
  .command("switch <addonId>")
  .description("Set the default addon for commands without --addon flag")
  .action(switchCommand);

/**
 * Status command - Check addon status
 */
program
  .command("status")
  .description("Check the status of the addon service(s)")
  .option("-a, --addon <id>", "Specific addon ID (shows all if not specified)")
  .option("-r, --remote", "Check status on a remote machine")
  .action(statusCommand);

/**
 * Start command - Start the addon service
 */
program
  .command("start")
  .description("Start the addon service(s)")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--all", "Start all addons")
  .option("-r, --remote", "Start service on a remote machine")
  .action(startCommand);

/**
 * Stop command - Stop the addon service
 */
program
  .command("stop")
  .description("Stop the addon service(s)")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--all", "Stop all addons")
  .option("-r, --remote", "Stop service on a remote machine")
  .action(stopCommand);

/**
 * Restart command - Restart the addon service
 */
program
  .command("restart")
  .description("Restart the addon service(s)")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--all", "Restart all addons")
  .option("-r, --remote", "Restart service on a remote machine")
  .action(restartCommand);

/**
 * Update command - Update addon to latest version
 */
program
  .command("update")
  .description("Update addon(s) to latest version")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--all", "Update all addons")
  .option("--version <version>", "Update to specific version")
  .option("--skip-backup", "Skip backup before update (not recommended)")
  .option("--force", "Force update even if already on target version")
  .option("--dry-run", "Simulate update without applying changes")
  .option("--keep-old", "Keep old files in .old directory")
  .action(updateCommand);

/**
 * Rollback command - Rollback addon to previous version
 */
program
  .command("rollback")
  .description("Rollback addon to previous version")
  .option("-a, --addon <id>", "Specific addon ID (required)")
  .option("--backup-id <id>", "Specific backup to restore")
  .option("--list-backups", "List available backups")
  .action(rollbackCommand);

/**
 * Logs command - View addon logs
 */
program
  .command("logs")
  .description("View addon service logs")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("-n, --lines <number>", "Number of lines to show", "50")
  .option("-f, --follow", "Follow log output")
  .option("-r, --remote", "View logs from a remote machine")
  .action(logsCommand);

/**
 * Config command - Manage configuration
 */
program
  .command("config")
  .description("Manage addon configuration")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--show", "Show current configuration")
  .option("--edit", "Edit configuration interactively")
  .option("--set <key=value>", "Set a configuration value")
  .option("--get <key>", "Get a configuration value")
  .option("--reset", "Reset configuration to defaults")
  .option("--list-addons", "List all addons")
  .option("--create-addon <name>", "Create a new addon configuration")
  .option("--delete-addon <id>", "Delete an addon")
  .option("--switch-addon <id>", "Set default addon")
  .action(configCommand);

/**
 * Uninstall command - Remove addon
 */
program
  .command("uninstall")
  .description("Uninstall the addon and remove all files")
  .option("-a, --addon <id>", "Addon ID to uninstall (required for multi-addon)")
  .option("-r, --remote", "Uninstall from a remote machine")
  .option("--keep-config", "Keep configuration file")
  .option("--keep-backups", "Keep backup files")
  .action(uninstallCommand);

/**
 * Environment Variables command - Manage environment variables
 * 
 * Manage environment variables for addon services. Environment variables control
 * server behavior, authentication, and performance tuning.
 * 
 * Examples:
 *   # List all environment variables
 *   $ stremio-addon-manager env list
 *   $ stremio-addon-manager env list --addon my-addon
 * 
 *   # Get a specific variable
 *   $ stremio-addon-manager env get PORT
 *   $ stremio-addon-manager env get RD_API_TOKEN --addon my-addon
 * 
 *   # Set a variable
 *   $ stremio-addon-manager env set PORT 8080
 *   $ stremio-addon-manager env set MAX_STREAMS 10 --addon my-addon
 *   $ stremio-addon-manager env set ADDON_PASSWORD "newpass123" --restart
 * 
 *   # Generate a secure password
 *   $ stremio-addon-manager env generate ADDON_PASSWORD
 *   $ stremio-addon-manager env generate ADDON_PASSWORD --addon my-addon --restart
 * 
 *   # Reset a variable to default
 *   $ stremio-addon-manager env unset MAX_STREAMS
 * 
 *   # Reset all variables to defaults
 *   $ stremio-addon-manager env reset
 *   $ stremio-addon-manager env reset --addon my-addon --restart
 * 
 *   # Sync service file with config
 *   $ stremio-addon-manager env sync
 *   $ stremio-addon-manager env sync --addon my-addon --restart
 * 
 * Options:
 *   -a, --addon <id>    Specify addon ID for multi-addon setups
 *   --restart            Restart service after updating environment variables
 * 
 * Available Variables:
 *   NODE_ENV                    Node.js environment (production/development)
 *   PORT                        Server port (1024-65535, default: 7000)
 *   RD_API_TOKEN                Real-Debrid API token (required, sensitive)
 *   ADDON_PASSWORD              Authentication password (required, sensitive, generateable)
 *   ADDON_DOMAIN                Domain for manifest base URL (optional)
 *   TORRENT_LIMIT               Max torrents to process (1-50, default: 15)
 *   AVAILABILITY_CHECK_LIMIT    Torrents to check for cache (5-50, default: 15)
 *   MAX_STREAMS                 Max streams to return (1-20, default: 5)
 *   MAX_CONCURRENCY             Parallel processing limit (1-10, default: 3)
 * 
 * See README.md for detailed variable descriptions and examples.
 */
const envCmd = program
  .command("env")
  .description("Manage environment variables for addon services")
  .option("-a, --addon <id>", "Specify addon ID for multi-addon setups")
  .option("--restart", "Restart service after updating environment variables");

envCmd
  .command("list")
  .description("List all environment variables for an addon")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--restart", "Restart service after updating (not applicable for list)")
  .action(async (options: { addon?: string; restart?: boolean }) => {
    await envCommand("list", undefined, undefined, options || {});
  })
  .addHelpText("after", `
Examples:
  $ stremio-addon-manager env list
  $ stremio-addon-manager env list --addon my-addon

Shows all environment variables with their current values, sources (default/config/override),
and descriptions. Sensitive values are masked.
  `);

envCmd
  .command("get <key>")
  .description("Get value of specific environment variable")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--restart", "Restart service after updating (not applicable for get)")
  .action(async (key: string, options: { addon?: string; restart?: boolean }) => {
    await envCommand("get", key, undefined, options || {});
  })
  .addHelpText("after", `
Examples:
  $ stremio-addon-manager env get PORT
  $ stremio-addon-manager env get RD_API_TOKEN --addon my-addon

Displays the current value of the specified environment variable.
Sensitive values are masked for security.
  `);

envCmd
  .command("set <key> [value]")
  .description("Set environment variable value")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--restart", "Restart service after updating")
  .action(async (key: string, value: string | undefined, options: { addon?: string; restart?: boolean }) => {
    await envCommand("set", key, value, options || {});
  })
  .addHelpText("after", `
Examples:
  $ stremio-addon-manager env set PORT 8080
  $ stremio-addon-manager env set MAX_STREAMS 10 --addon my-addon
  $ stremio-addon-manager env set ADDON_PASSWORD "newpass123" --restart

Sets an environment variable value. If value is not provided, you'll be prompted
interactively. The value is validated before being saved. Use --restart to restart
the service after updating.
  `);

envCmd
  .command("unset <key>")
  .description("Remove environment variable (reset to default)")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--restart", "Restart service after updating")
  .action(async (key: string, options: { addon?: string; restart?: boolean }) => {
    await envCommand("unset", key, undefined, options || {});
  })
  .addHelpText("after", `
Examples:
  $ stremio-addon-manager env unset MAX_STREAMS
  $ stremio-addon-manager env unset ADDON_DOMAIN --addon my-addon --restart

Removes an environment variable override, resetting it to its default or config-derived
value. Use --restart to restart the service after updating.
  `);

envCmd
  .command("reset")
  .description("Reset all environment variables to defaults")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--restart", "Restart service after updating")
  .action(async (options: { addon?: string; restart?: boolean }) => {
    await envCommand("reset", undefined, undefined, options || {});
  })
  .addHelpText("after", `
Examples:
  $ stremio-addon-manager env reset
  $ stremio-addon-manager env reset --addon my-addon --restart

Resets all environment variables to their default values. This removes all overrides
and uses config-derived or default values. Use --restart to restart the service.
  `);

envCmd
  .command("sync")
  .description("Sync service file with current config")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--restart", "Restart service after syncing")
  .action(async (options: { addon?: string; restart?: boolean }) => {
    await envCommand("sync", undefined, undefined, options || {});
  })
  .addHelpText("after", `
Examples:
  $ stremio-addon-manager env sync
  $ stremio-addon-manager env sync --addon my-addon --restart

Synchronizes the systemd service file with the current configuration. This ensures
the service file matches the config values and any environment variable overrides.
Use --restart to restart the service after syncing.
  `);

envCmd
  .command("generate <key>")
  .description("Generate value for generateable variables (like passwords)")
  .option("-a, --addon <id>", "Specific addon ID")
  .option("--restart", "Restart service after updating")
  .action(async (key: string, options: { addon?: string; restart?: boolean }) => {
    await envCommand("generate", key, undefined, options || {});
  })
  .addHelpText("after", `
Examples:
  $ stremio-addon-manager env generate ADDON_PASSWORD
  $ stremio-addon-manager env generate ADDON_PASSWORD --addon my-addon --restart

Generates a secure random value for generateable environment variables. Currently
only ADDON_PASSWORD is generateable. The generated value is automatically saved
and the service file is updated. Use --restart to restart the service.
  `);

/**
 * Parse and execute commands
 */
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error("CLI error", error);
    process.exit(1);
  }
}

main();

export { program };
