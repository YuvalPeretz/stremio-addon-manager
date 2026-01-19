#!/usr/bin/env node

/**
 * Test script to verify registration flow
 * Simulates what happens during installation
 */

import { InstallationManager } from '@stremio-addon-manager/core';

// Simulate the options object that would be passed from Electron
const testOptions = {
  config: {
    addon: {
      name: 'Test Addon',
      domain: 'test.duckdns.org',
      port: 7000,
      password: 'test12345678',
    },
    // addonId will be set by Electron main process
    // addonId: 'test-addon', // This should be set before InstallationManager is created
  },
  installation: {
    type: 'remote',
    target: {
      host: '192.168.0.50',
      port: 22,
      username: 'yuvalpi',
    },
  },
};

console.log('🧪 Testing Registration Flow\n');
console.log('Initial options.config.addonId:', testOptions.config.addonId);

// Simulate what Electron main process does
if (!testOptions.config.addonId) {
  // Generate addonId (same logic as Electron)
  let addonId = testOptions.config.addon.name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  
  testOptions.config.addonId = addonId;
  testOptions.config.serviceName = `stremio-addon-${addonId}`;
  
  console.log('Generated addonId:', addonId);
  console.log('After generation - options.config.addonId:', testOptions.config.addonId);
}

// Simulate creating InstallationManager with spread operator
const installOptions = {
  ...testOptions,
  progressCallback: () => {},
};

console.log('\nAfter spread - installOptions.config.addonId:', installOptions.config.addonId);
console.log('Same object reference?', installOptions.config === testOptions.config);

// Check if addonId would be available in InstallationManager
console.log('\n✅ Registration check would pass:', !!installOptions.config.addonId);

if (!installOptions.config.addonId) {
  console.error('❌ ERROR: addonId is not set! Registration would be skipped.');
  process.exit(1);
} else {
  console.log('✅ addonId is set correctly. Registration should work.');
}
