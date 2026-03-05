#!/usr/bin/env node

/**
 * Copy packages (core, addon-server) to CLI resources
 * This allows installations to use the bundled packages instead of cloning from GitHub
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliRoot = path.resolve(__dirname, '..');
const packagesRoot = path.resolve(cliRoot, '..');
const resourcesDir = path.resolve(cliRoot, 'resources');

// Package configurations
const packages = [
  {
    name: 'core',
    files: ['dist', 'package.json', 'README.md'],
  },
  {
    name: 'addon-server',
    files: ['dist', 'package.json', 'README.md', 'bin', 'landing.html'],
  },
  {
    name: 'party-server',
    files: ['dist', 'package.json'],
  },
];

console.log('📦 Copying packages to CLI resources...\n');

let totalCopied = 0;
let totalSkipped = 0;

for (const pkg of packages) {
  const sourceRoot = path.resolve(packagesRoot, pkg.name);
  const targetDir = path.resolve(resourcesDir, pkg.name);

  console.log(`📁 Processing ${pkg.name}...`);
  console.log(`   From: ${sourceRoot}`);
  console.log(`   To: ${targetDir}`);

  // Ensure package is built
  const distDir = path.join(sourceRoot, 'dist');
  if (!fs.existsSync(distDir)) {
    console.error(`❌ Error: ${pkg.name}/dist does not exist. Please build ${pkg.name} first:`);
    console.error(`   cd packages/${pkg.name} && npm run build`);
    process.exit(1);
  }

  // Create target directory
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  // Copy files
  let copiedCount = 0;
  let skippedCount = 0;

  for (const item of pkg.files) {
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
        // force: true prevents EEXIST on Windows when the target already exists
        fs.cpSync(source, target, { recursive: true, force: true });
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
    console.error(`   ❌ Error: No files were copied for ${pkg.name}. Please check the source path.`);
    process.exit(1);
  }

  if (skippedCount > 0) {
    console.warn(`   ⚠️  Warning: ${skippedCount} item(s) were skipped`);
  }

  console.log(`   ✅ Successfully copied ${pkg.name}\n`);
  totalCopied += copiedCount;
  totalSkipped += skippedCount;
}

console.log(`✅ All packages copied successfully!`);
console.log(`   Total files/directories copied: ${totalCopied}`);
if (totalSkipped > 0) {
  console.log(`   Total skipped: ${totalSkipped}`);
}
