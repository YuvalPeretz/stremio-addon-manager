/**
 * Logs Command
 * View addon service logs
 */

import chalk from "chalk";
import {
  logger,
  ConfigManager,
  ServiceManager,
  SSHManager,
  getServiceNameFromAddonId,
} from "@stremio-addon-manager/core";
import { resolveAddonId, getAddonMetadata } from "../utils/addon-resolver.js";

interface LogsOptions {
  addon?: string;
  lines?: string;
  follow?: boolean;
  remote?: boolean;
}

/**
 * Logs command handler
 */
export async function logsCommand(options: LogsOptions): Promise<void> {
  try {
    const resolvedAddonId = await resolveAddonId(options.addon);
    if (!resolvedAddonId) {
      console.log(chalk.yellow("\n⚠️  No addon specified or found.\n"));
      process.exit(1);
    }

    const addon = await getAddonMetadata(resolvedAddonId);
    if (!addon) {
      console.log(chalk.red(`\n❌ Addon '${resolvedAddonId}' not found.\n`));
      process.exit(1);
    }

    const configManager = new ConfigManager(resolvedAddonId);
    const config = await configManager.load();

    let ssh: SSHManager | undefined;

    if (config.installation.type === "remote" && config.installation.target) {
      ssh = new SSHManager({
        host: config.installation.target.host || "",
        port: config.installation.target.port || 22,
        username: config.installation.target.username || "",
        password: config.installation.target.password,
        privateKeyPath: config.installation.target.privateKeyPath,
      });
      await ssh.connect();
    }

    const serviceName = config.serviceName || getServiceNameFromAddonId(resolvedAddonId);
    const serviceManager = new ServiceManager(serviceName, ssh);
    const lines = parseInt(options.lines || "50", 10);
    const logs = await serviceManager.logs(lines, options.follow);

    console.log(chalk.bold.cyan(`\n📋 Addon Service Logs: ${addon.name}\n`));
    console.log(chalk.gray("─".repeat(80)));
    console.log(logs);
    console.log(chalk.gray("─".repeat(80) + "\n"));

    if (ssh) {
      await ssh.disconnect();
    }
  } catch (error) {
    logger.error("Failed to get logs", error);
    console.log(chalk.red(`\n❌ Failed to get logs: ${(error as Error).message}\n`));
    process.exit(1);
  }
}
