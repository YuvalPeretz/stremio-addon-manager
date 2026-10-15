/**
 * Local library backup / restore — reads or writes `library.json` on the addon host.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import chalk from "chalk";
import { EnvVarManager, SSHManager, type AddonManagerConfig } from "@stremio-addon-manager/core";
import { resolveAddonId, getConfigManagerForAddon } from "../utils/addon-resolver.js";

interface LibraryJsonV1 {
  version: 1;
  roots: unknown[];
  fileOverrides: Record<string, unknown>;
}

function assertLibraryV1(data: unknown): LibraryJsonV1 {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid JSON: expected an object");
  }
  const o = data as Record<string, unknown>;
  if (o.version !== 1) {
    throw new Error(`Unsupported library format version: ${String(o.version)} (expected 1)`);
  }
  if (!Array.isArray(o.roots)) {
    throw new Error("Invalid library.json: roots must be an array");
  }
  if (!o.fileOverrides || typeof o.fileOverrides !== "object") {
    throw new Error("Invalid library.json: fileOverrides must be an object");
  }
  return data as LibraryJsonV1;
}

function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function connectSsh(config: AddonManagerConfig): Promise<SSHManager> {
  const t = config.installation.target;
  if (!t) {
    throw new Error("Remote installation target is not configured");
  }
  const ssh = new SSHManager({
    host: t.host || "",
    port: t.port || 22,
    username: t.username || "",
    password: t.password,
    privateKeyPath: t.privateKeyPath,
  });
  await ssh.connect();
  return ssh;
}

export async function localLibraryExportCommand(options: { addon?: string; output: string }): Promise<void> {
  const addonId = await resolveAddonId(options.addon);
  if (!addonId) {
    console.log(chalk.red("\n❌ No addon selected.\n"));
    process.exit(1);
  }

  const configManager = getConfigManagerForAddon(addonId);
  const config = await configManager.load();
  const remotePath = EnvVarManager.getLocalLibraryJsonPath(config);
  if (!remotePath) {
    console.log(
      chalk.red(
        "\n❌ Local library is disabled (set paths.localLibraryDataDir in config, or clear it to use default).\n"
      )
    );
    process.exit(1);
  }

  let raw: string;
  if (config.installation.type === "remote" && config.installation.target) {
    const ssh = await connectSsh(config);
    try {
      const check = await ssh.execCommand(`sudo test -f ${shSingleQuote(remotePath)} && echo OK || echo MISSING`);
      if (check.stdout.includes("MISSING")) {
        raw = JSON.stringify({ version: 1, roots: [], fileOverrides: {} }, null, 2);
        console.log(chalk.yellow(`No library.json at ${remotePath} — writing empty library template.`));
      } else {
        const cat = await ssh.execCommand(`sudo cat ${shSingleQuote(remotePath)}`);
        if (cat.code !== 0) {
          throw new Error(cat.stderr || cat.stdout || "Failed to read remote library.json");
        }
        raw = cat.stdout;
      }
    } finally {
      await ssh.disconnect();
    }
  } else {
    const localPath = path.normalize(remotePath.split("/").join(path.sep));
    try {
      raw = await fs.readFile(localPath, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        raw = JSON.stringify({ version: 1, roots: [], fileOverrides: {} }, null, 2);
        console.log(chalk.yellow(`No library.json at ${localPath} — writing empty library template.`));
      } else {
        throw e;
      }
    }
  }

  assertLibraryV1(JSON.parse(raw));
  await fs.writeFile(options.output, raw, "utf8");
  console.log(chalk.green(`\n✓ Exported local library to ${options.output}\n`));
}

export async function localLibraryImportCommand(options: { addon?: string; file: string }): Promise<void> {
  const addonId = await resolveAddonId(options.addon);
  if (!addonId) {
    console.log(chalk.red("\n❌ No addon selected.\n"));
    process.exit(1);
  }

  const raw = await fs.readFile(options.file, "utf8");
  let data: LibraryJsonV1;
  try {
    data = assertLibraryV1(JSON.parse(raw));
  } catch (e) {
    console.log(chalk.red(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`));
    process.exit(1);
  }

  const pretty = JSON.stringify(data, null, 2);
  const configManager = getConfigManagerForAddon(addonId);
  const config = await configManager.load();
  const remotePath = EnvVarManager.getLocalLibraryJsonPath(config);
  const dataDir = EnvVarManager.getLocalLibraryDataDir(config);
  if (!remotePath || !dataDir) {
    console.log(chalk.red("\n❌ Local library data directory is not configured.\n"));
    process.exit(1);
  }

  if (config.installation.type === "remote" && config.installation.target) {
    const ssh = await connectSsh(config);
    const localTmp = path.join(os.tmpdir(), `stremio-library-${randomBytes(8).toString("hex")}.json`);
    const remoteTmp = `/tmp/${path.basename(localTmp)}`;
    await fs.writeFile(localTmp, pretty, "utf8");
    try {
      await ssh.transferFile(localTmp, remoteTmp);
      const mkdir = await ssh.execCommand(`sudo mkdir -p ${shSingleQuote(dataDir)}`);
      if (mkdir.code !== 0) {
        throw new Error(mkdir.stderr || "mkdir failed");
      }
      const cp = await ssh.execCommand(
        `sudo cp ${shSingleQuote(remoteTmp)} ${shSingleQuote(remotePath)} && sudo rm -f ${shSingleQuote(remoteTmp)}`
      );
      if (cp.code !== 0) {
        throw new Error(cp.stderr || "Failed to install remote library.json");
      }
    } finally {
      await fs.unlink(localTmp).catch(() => {});
      await ssh.disconnect();
    }
  } else {
    const dir = path.normalize(dataDir.split("/").join(path.sep));
    const localPath = path.join(dir, "library.json");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(localPath, pretty, "utf8");
  }

  console.log(chalk.green("\n✓ Imported local library. Restart the addon service if it is running.\n"));
}
