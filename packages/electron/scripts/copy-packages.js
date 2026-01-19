#!/usr/bin/env node

/**
 * Copy CLI package (and its resources: core, addon-server) to Electron resources
 * This allows installations to use the bundled packages instead of cloning from GitHub
 * 
 * Structure:
 * resources/
 *   cli/
 *     dist/
 *     package.json
 *     bin/
 *     resources/  (CLI's bundled packages)
 *       core/
 *       addon-server/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const electronRoot = path.resolve(__dirname, '..');
const packagesRoot = path.resolve(electronRoot, '..');
const resourcesDir = path.resolve(electronRoot, 'resources');

// CLI package configuration (includes its resources directory)
const cliPackage = {
  name: 'cli',
  files: ['dist', 'package.json', 'bin', 'resources'],
};

console.log('📦 Copying CLI package to Electron resources...\n');
console.log('   Note: CLI includes bundled core and addon-server in its resources/\n');

const sourceRoot = path.resolve(packagesRoot, cliPackage.name);
const targetDir = path.resolve(resourcesDir, cliPackage.name);

console.log(`📁 Processing ${cliPackage.name}...`);
console.log(`   From: ${sourceRoot}`);
console.log(`   To: ${targetDir}`);

// Ensure CLI is built (which includes its bundled packages)
const distDir = path.join(sourceRoot, 'dist');
const resourcesSourceDir = path.join(sourceRoot, 'resources');

if (!fs.existsSync(distDir)) {
  console.error(`❌ Error: ${cliPackage.name}/dist does not exist. Please build CLI first:`);
  console.error(`   cd packages/${cliPackage.name} && npm run build`);
  process.exit(1);
}

// Ensure CLI has bundled its resources (core and addon-server)
if (!fs.existsSync(resourcesSourceDir)) {
  console.error(`❌ Error: ${cliPackage.name}/resources does not exist. CLI must bundle core and addon-server first:`);
  console.error(`   cd packages/${cliPackage.name} && npm run build:packages`);
  process.exit(1);
}

// Verify CLI resources contain expected packages
const coreResources = path.join(resourcesSourceDir, 'core');
const addonServerResources = path.join(resourcesSourceDir, 'addon-server');

if (!fs.existsSync(coreResources)) {
  console.error(`❌ Error: CLI resources missing core package. Please rebuild CLI:`);
  console.error(`   cd packages/${cliPackage.name} && npm run build:packages`);
  process.exit(1);
}

if (!fs.existsSync(addonServerResources)) {
  console.error(`❌ Error: CLI resources missing addon-server package. Please rebuild CLI:`);
  console.error(`   cd packages/${cliPackage.name} && npm run build:packages`);
  process.exit(1);
}

console.log(`   ✓ CLI resources verified (contains core and addon-server)\n`);

// Create target directory
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

// Copy files
let copiedCount = 0;
let skippedCount = 0;

for (const item of cliPackage.files) {
  const source = path.join(sourceRoot, item);
  const target = path.join(targetDir, item);

  if (!fs.existsSync(source)) {
    console.warn(`   ⚠️  Warning: ${item} does not exist, skipping`);
    skippedCount++;
    continue;
  }

  try {
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      fs.cpSync(source, target, { recursive: true });
      console.log(`   ✓ Copied directory: ${item}`);
    } else {
      // Ensure target directory exists for files
      const targetDirPath = path.dirname(target);
      if (!fs.existsSync(targetDirPath)) {
        fs.mkdirSync(targetDirPath, { recursive: true });
      }
      fs.copyFileSync(source, target);
      console.log(`   ✓ Copied file: ${item}`);
    }
    copiedCount++;
  } catch (error) {
    console.error(`   ❌ Error copying ${item}:`, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

if (copiedCount === 0) {
  console.error(`❌ Error: No files were copied. Please check the source path.`);
  process.exit(1);
}

if (skippedCount > 0) {
  console.warn(`   ⚠️  Warning: ${skippedCount} item(s) were skipped`);
}

// Also copy addon-server to legacy location for backward compatibility
// This ensures both paths work: resources/cli/resources/addon-server and resources/addon-server
const legacyAddonServerSource = path.join(resourcesSourceDir, 'addon-server');
const legacyAddonServerTarget = path.resolve(resourcesDir, 'addon-server');

if (fs.existsSync(legacyAddonServerSource)) {
  console.log(`\n📁 Copying addon-server to legacy location for backward compatibility...`);
  if (fs.existsSync(legacyAddonServerTarget)) {
    fs.rmSync(legacyAddonServerTarget, { recursive: true, force: true });
  }
  fs.cpSync(legacyAddonServerSource, legacyAddonServerTarget, { recursive: true });
  console.log(`   ✓ Copied addon-server to legacy location: resources/addon-server/`);
}

console.log(`\n✅ CLI package copied successfully!`);
console.log(`   Total files/directories copied: ${copiedCount}`);
console.log(`   Structure:`);
console.log(`     - resources/cli/ (includes resources/core/ and resources/addon-server/)`);
console.log(`     - resources/addon-server/ (legacy location, for backward compatibility)`);
