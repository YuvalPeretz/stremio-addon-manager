/**
 * Resolve bundled product package paths for staging (custom-script + installers).
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";
import type { CustomScriptArtifactMode } from "../config/types.js";
import type { AddonProduct } from "../config/product.js";
import { normalizeAddonProduct, productPackageDir } from "../config/product.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PathCheck {
  path: string;
  description: string;
}

function getCoreLayoutPaths(): { coreRootDir: string; packagesDir: string } {
  // .../core/dist/installation → .../core/dist → .../core → .../packages
  const coreDistDir = path.dirname(__dirname);
  const coreRootDir = path.dirname(coreDistDir);
  const packagesDir = path.dirname(coreRootDir);
  return { coreRootDir, packagesDir };
}

function buildProductPathChecks(packageDir: string): PathCheck[] {
  const { coreRootDir, packagesDir } = getCoreLayoutPaths();
  const pathChecks: PathCheck[] = [];

  if (process.env.ELECTRON_RESOURCES_PATH) {
    const resourcesPath = process.env.ELECTRON_RESOURCES_PATH;
    pathChecks.push({
      path: path.join(resourcesPath, "cli", "resources", packageDir),
      description: "Electron packaged (from env, Option 2)",
    });
    pathChecks.push({
      path: path.join(resourcesPath, packageDir),
      description: "Electron packaged (from env, legacy)",
    });
  }

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (typeof resourcesPath === "string" && resourcesPath.length > 0) {
    pathChecks.push({
      path: path.join(resourcesPath, "cli", "resources", packageDir),
      description: "Electron packaged (Option 2)",
    });
    pathChecks.push({
      path: path.join(resourcesPath, packageDir),
      description: "Electron packaged (legacy)",
    });
  }

  if (process.env.ELECTRON_APP_PATH) {
    const appPath = process.env.ELECTRON_APP_PATH;
    pathChecks.push({
      path: path.join(appPath, "resources", "cli", "resources", packageDir),
      description: "Electron dev (from env, Option 2)",
    });
    pathChecks.push({
      path: path.join(appPath, "resources", packageDir),
      description: "Electron dev (from env, legacy)",
    });
  }

  pathChecks.push({
    path: path.join(coreRootDir, "..", "..", "electron", "resources", "cli", "resources", packageDir),
    description: "Electron dev (from core, Option 2)",
  });
  pathChecks.push({
    path: path.join(process.cwd(), "resources", "cli", "resources", packageDir),
    description: "Electron dev (from cwd, Option 2)",
  });
  pathChecks.push({
    path: path.join(process.cwd(), "resources", packageDir),
    description: "Electron/CLI (cwd resources)",
  });
  pathChecks.push({
    path: path.join(coreRootDir, "..", packageDir),
    description: "CLI packaged (from core)",
  });
  pathChecks.push({
    path: path.join(packagesDir, "cli", "resources", packageDir),
    description: "CLI dev (from core, monorepo)",
  });
  pathChecks.push({
    path: path.join(process.cwd(), "..", "cli", "resources", packageDir),
    description: "CLI dev (from cwd, monorepo)",
  });
  pathChecks.push({
    path: path.join(packagesDir, packageDir),
    description: "Monorepo (from core)",
  });
  pathChecks.push({
    path: path.join(process.cwd(), "packages", packageDir),
    description: "Monorepo (from cwd)",
  });
  pathChecks.push({
    path: path.join(packagesDir, "electron", "resources", "cli", "resources", packageDir),
    description: "Electron package in monorepo (from core)",
  });
  pathChecks.push({
    path: path.join(process.cwd(), "packages", "electron", "resources", "cli", "resources", packageDir),
    description: "Electron package in monorepo (from cwd)",
  });

  return pathChecks;
}

function pathExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function matchesArtifactMode(candidate: string, mode: CustomScriptArtifactMode): boolean {
  const packageJsonPath = path.join(candidate, "package.json");
  if (!pathExists(packageJsonPath)) {
    return false;
  }
  if (mode === "built") {
    return pathExists(path.join(candidate, "dist"));
  }
  // source: prefer trees with src/; accept package root with package.json as fallback
  return pathExists(path.join(candidate, "src")) || pathExists(path.join(candidate, "package.json"));
}

/**
 * Resolve local path to a bundled (or monorepo) product package for the given artifact mode.
 */
export async function resolveBundledProductPath(
  product: AddonProduct = "streaming",
  mode: CustomScriptArtifactMode = "built"
): Promise<string | null> {
  const resolvedProduct = normalizeAddonProduct(product);
  const packageDir = productPackageDir(resolvedProduct);
  let pathChecks = buildProductPathChecks(packageDir);

  // For source mode, prefer monorepo packages/<dir> first
  if (mode === "source") {
    const { packagesDir } = getCoreLayoutPaths();
    const preferred: PathCheck[] = [
      { path: path.join(packagesDir, packageDir), description: "Monorepo source (preferred)" },
      {
        path: path.join(process.cwd(), "packages", packageDir),
        description: "Monorepo source (cwd preferred)",
      },
    ];
    const preferredPaths = new Set(preferred.map((p) => path.resolve(p.path)));
    pathChecks = [
      ...preferred,
      ...pathChecks.filter((c) => !preferredPaths.has(path.resolve(c.path))),
    ];
  }

  logger.debug("Resolving bundled product path", {
    product: resolvedProduct,
    packageDir,
    mode,
    totalPaths: pathChecks.length,
    cwd: process.cwd(),
  });

  for (const check of pathChecks) {
    const absolutePath = path.isAbsolute(check.path) ? check.path : path.resolve(check.path);
    if (matchesArtifactMode(absolutePath, mode)) {
      logger.info("Found bundled product package", {
        product: resolvedProduct,
        packageDir,
        path: absolutePath,
        mode,
        description: check.description,
      });
      return absolutePath;
    }
  }

  logger.warn("Bundled product package not found", {
    product: resolvedProduct,
    packageDir,
    mode,
    checkedPaths: pathChecks.length,
  });
  return null;
}

/**
 * Resolve local path to bundled (or monorepo) addon-server for the given artifact mode.
 */
export async function resolveBundledAddonServerPath(
  mode: CustomScriptArtifactMode = "built"
): Promise<string | null> {
  return resolveBundledProductPath("streaming", mode);
}

/**
 * Read version from a bundled product package.json (for registry / Updates UI).
 */
export async function readBundledProductVersion(
  product: AddonProduct = "streaming",
  mode: CustomScriptArtifactMode = "built"
): Promise<string | undefined> {
  try {
    const root = await resolveBundledProductPath(product, mode);
    if (!root) return undefined;
    const packageJsonPath = path.join(root, "package.json");
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return typeof pkg.version === "string" && pkg.version.trim() ? pkg.version.trim() : undefined;
  } catch (error) {
    logger.warn("Could not read bundled product version", {
      product,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Read version from bundled addon-server package.json (for registry / Updates UI).
 */
export async function readBundledAddonServerVersion(
  mode: CustomScriptArtifactMode = "built"
): Promise<string | undefined> {
  return readBundledProductVersion("streaming", mode);
}
