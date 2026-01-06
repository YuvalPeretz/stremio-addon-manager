/**
 * Test script for core module imports and basic functionality
 */

(async () => {
  console.log('🧪 Testing Core Module Imports...\n');
  
  try {
    // Import core modules
    const core = await import('./packages/core/dist/index.js');
    
    // Test 1: Check all exports are present
    console.log('📦 Checking exports...');
    const requiredExports = [
      'OSDetector',
      'SSHManager',
      'ServiceManager',
      'ConfigManager',
      'InstallationManager',
      'logger',
      'OperatingSystem',
      'LinuxDistribution',
      'Architecture',
      'InstallationStep',
      'StepStatus',
      'ServiceStatus',
      'LogLevel',
      'AccessMethod',
      'InstallationType',
      'Provider',
    ];
    
    let allPresent = true;
    for (const exp of requiredExports) {
      if (core[exp]) {
        console.log(`  ✅ ${exp}`);
      } else {
        console.log(`  ❌ ${exp} - MISSING!`);
        allPresent = false;
      }
    }
    
    if (!allPresent) {
      throw new Error('Some exports are missing');
    }
    
    console.log('\n✅ All exports present\n');
    
    // Test 2: OSDetector
    console.log('🖥️  Testing OSDetector...');
    const systemInfo = core.OSDetector.detect();
    console.log(`  OS: ${systemInfo.os}`);
    console.log(`  Platform: ${systemInfo.platform}`);
    console.log(`  Architecture: ${systemInfo.arch}`);
    console.log(`  Release: ${systemInfo.release}`);
    console.log(`  CPU Cores: ${systemInfo.cpuCores}`);
    console.log(`  Total Memory: ${Math.round((systemInfo.totalMemory || 0) / 1024 / 1024 / 1024)}GB`);
    
    if (!systemInfo.os || !systemInfo.platform) {
      throw new Error('OSDetector returned incomplete data');
    }
    console.log('✅ OSDetector working\n');
    
    // Test 3: ConfigManager
    console.log('⚙️  Testing ConfigManager...');
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs/promises');
    
    const testConfigPath = path.join(os.tmpdir(), 'test-stremio-config.yaml');
    const configManager = new core.ConfigManager(testConfigPath);
    
    // Create test config
    const testConfig = {
      installation: {
        type: core.InstallationType.LOCAL,
        accessMethod: core.AccessMethod.DUCKDNS,
      },
      addon: {
        name: 'Test_Addon',
        version: '1.0.0',
        domain: 'test.duckdns.org',
        password: 'TestPassword123',
        provider: core.Provider.REAL_DEBRID,
        torrentLimit: 15,
        port: 7000,
      },
      features: {
        firewall: true,
        fail2ban: true,
        caching: { enabled: true, ttl: 7200, maxSize: 100 },
        rateLimiting: { enabled: true, stream: 50, stats: 120 },
        authentication: true,
        backups: { enabled: true, frequency: 'weekly', retention: 7 },
        ssl: true,
        duckdnsUpdater: false,
        autoStart: true,
      },
      paths: {
        addonDirectory: '/opt/stremio-addon',
        nginxConfig: '/etc/nginx/sites-available/stremio-addon',
        serviceFile: '/etc/systemd/system/stremio-addon.service',
        logs: '/var/log/stremio-addon',
        backups: '/var/backups/stremio-addon',
      },
      secrets: {
        realDebridToken: 'test_token_123',
      },
    };
    
    // Save config
    await configManager.save(testConfig);
    console.log('  ✅ Config saved');
    
    // Load config
    const loadedConfig = await configManager.load();
    console.log('  ✅ Config loaded');
    
    // Verify data
    if (loadedConfig.addon.name !== 'Test_Addon') {
      throw new Error('Config data mismatch');
    }
    console.log('  ✅ Config data verified');
    
    // Test nested get/set
    const domain = configManager.getNestedValue('addon.domain');
    if (domain !== 'test.duckdns.org') {
      throw new Error('getNestedValue failed');
    }
    console.log('  ✅ getNestedValue working');
    
    configManager.setNestedValue('addon.torrentLimit', 20);
    const newLimit = configManager.getNestedValue('addon.torrentLimit');
    if (newLimit !== 20) {
      throw new Error('setNestedValue failed');
    }
    console.log('  ✅ setNestedValue working');
    
    // Test validation
    const validation = configManager.validate();
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }
    console.log('  ✅ Config validation passed');
    
    // Cleanup
    await fs.unlink(testConfigPath);
    console.log('  ✅ Test config cleaned up');
    console.log('✅ ConfigManager working\n');
    
    // Test 4: Logger
    console.log('📝 Testing Logger...');
    core.initLogger({
      level: core.LogLevel.DEBUG,
      logToFile: false,
      silent: true, // Don't output to console
    });
    
    core.logger.info('Test info message');
    core.logger.warn('Test warning message');
    core.logger.error('Test error message');
    core.logger.debug('Test debug message');
    console.log('✅ Logger working\n');
    
    // Test 5: Enums
    console.log('🔢 Testing Enums...');
    console.log(`  OperatingSystem.LINUX = ${core.OperatingSystem.LINUX}`);
    console.log(`  InstallationStep.COMPLETE = ${core.InstallationStep.COMPLETE}`);
    console.log(`  Provider.REAL_DEBRID = ${core.Provider.REAL_DEBRID}`);
    console.log('✅ Enums working\n');
    
    // Summary
    console.log('═══════════════════════════════════════');
    console.log('🎉 All module tests passed!');
    console.log('═══════════════════════════════════════');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();

