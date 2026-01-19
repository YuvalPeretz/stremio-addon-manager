#!/usr/bin/env node

/**
 * Test script to verify landing.html path resolution
 * This simulates how the server resolves the landing.html path
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Testing landing.html path resolution\n');

// Simulate the server.ts path resolution
// In server.ts: const landingPath = path.join(path.dirname(__dirname), "landing.html");
// When running from dist/server.js:
//   __dirname = dist/
//   path.dirname(__dirname) = addon-server package root
//   landingPath = addon-server package root/landing.html

console.log('Current script location:');
console.log(`  __filename: ${__filename}`);
console.log(`  __dirname: ${__dirname}`);
console.log('');

// Test from different locations
const testLocations = [
  {
    name: 'From src/server.ts (development)',
    serverDir: path.resolve(__dirname, '../packages/addon-server/src'),
  },
  {
    name: 'From dist/server.js (compiled)',
    serverDir: path.resolve(__dirname, '../packages/addon-server/dist'),
  },
  {
    name: 'From installed location (bin/server.js)',
    serverDir: path.resolve(__dirname, '../packages/addon-server/bin'),
  },
];

for (const test of testLocations) {
  console.log(`\n📁 Testing: ${test.name}`);
  console.log(`  Server directory: ${test.serverDir}`);
  
  // Simulate the path resolution from server.ts
  const simulatedDirname = test.serverDir;
  const packageRoot = path.dirname(simulatedDirname);
  const landingPath = path.join(packageRoot, 'landing.html');
  
  console.log(`  Simulated __dirname: ${simulatedDirname}`);
  console.log(`  Package root (path.dirname(__dirname)): ${packageRoot}`);
  console.log(`  Landing path: ${landingPath}`);
  
  if (fs.existsSync(landingPath)) {
    console.log(`  ✅ landing.html EXISTS at this path`);
    const stats = fs.statSync(landingPath);
    console.log(`     Size: ${stats.size} bytes`);
  } else {
    console.log(`  ❌ landing.html NOT FOUND at this path`);
    
    // Check if it exists elsewhere
    const possibleLocations = [
      path.join(packageRoot, 'landing.html'),
      path.join(simulatedDirname, 'landing.html'),
      path.join(packageRoot, 'src', 'landing.html'),
      path.join(packageRoot, 'dist', 'landing.html'),
    ];
    
    console.log(`  🔍 Checking alternative locations:`);
    for (const loc of possibleLocations) {
      if (fs.existsSync(loc)) {
        console.log(`     ✅ Found at: ${loc}`);
      }
    }
  }
}

// Test actual addon-server package
console.log('\n\n📦 Testing actual addon-server package:');
const addonServerRoot = path.resolve(__dirname, '../packages/addon-server');
const actualLandingPath = path.join(addonServerRoot, 'landing.html');

console.log(`  Package root: ${addonServerRoot}`);
console.log(`  Expected landing.html path: ${actualLandingPath}`);

if (fs.existsSync(actualLandingPath)) {
  console.log(`  ✅ landing.html EXISTS in addon-server package`);
  const stats = fs.statSync(actualLandingPath);
  console.log(`     Size: ${stats.size} bytes`);
  console.log(`     Modified: ${stats.mtime}`);
} else {
  console.log(`  ❌ landing.html NOT FOUND in addon-server package`);
  console.log(`  ⚠️  This needs to be fixed before installation!`);
}

// Test what the compiled code will see
console.log('\n\n🔬 Testing compiled code path resolution:');
const distServerPath = path.resolve(addonServerRoot, 'dist/server.js');
if (fs.existsSync(distServerPath)) {
  console.log(`  Compiled server.js exists: ${distServerPath}`);
  const distDir = path.dirname(distServerPath);
  const distPackageRoot = path.dirname(distDir);
  const distLandingPath = path.join(distPackageRoot, 'landing.html');
  
  console.log(`  When running from dist/server.js:`);
  console.log(`    __dirname will be: ${distDir}`);
  console.log(`    path.dirname(__dirname) will be: ${distPackageRoot}`);
  console.log(`    landing.html path will be: ${distLandingPath}`);
  
  if (fs.existsSync(distLandingPath)) {
    console.log(`  ✅ landing.html will be found at: ${distLandingPath}`);
  } else {
    console.log(`  ❌ landing.html will NOT be found at: ${distLandingPath}`);
    console.log(`  ⚠️  Need to ensure landing.html is copied to package root during installation`);
  }
} else {
  console.log(`  ⚠️  Compiled server.js not found. Run 'npm run build' first.`);
}

console.log('\n✅ Path resolution test complete\n');
