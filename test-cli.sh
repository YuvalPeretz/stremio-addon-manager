#!/bin/bash

# CLI Test Suite
# Tests all CLI commands to ensure they work correctly

set -e

echo "========================================="
echo "🧪 Stremio Addon Manager - CLI Test Suite"
echo "========================================="
echo ""

CLI="node packages/cli/dist/index.js"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Test function
test_command() {
    local test_name=$1
    local command=$2
    local should_fail=${3:-false}
    
    echo -e "${BLUE}🧪 Testing: ${test_name}${NC}"
    
    if [ "$should_fail" = true ]; then
        if ! eval "$command" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ PASS${NC} - Command failed as expected"
            TESTS_PASSED=$((TESTS_PASSED + 1))
        else
            echo -e "${RED}❌ FAIL${NC} - Command should have failed but succeeded"
            TESTS_FAILED=$((TESTS_FAILED + 1))
        fi
    else
        if eval "$command" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ PASS${NC}"
            TESTS_PASSED=$((TESTS_PASSED + 1))
        else
            echo -e "${RED}❌ FAIL${NC}"
            TESTS_FAILED=$((TESTS_FAILED + 1))
        fi
    fi
    echo ""
}

echo "========================================="
echo "📋 Part 1: CLI Help & Version"
echo "========================================="
echo ""

# Test 1: CLI help
test_command "CLI help command" "$CLI --help"

# Test 2: CLI version
test_command "CLI version command" "$CLI --version"

echo "========================================="
echo "📋 Part 2: Command Help Pages"
echo "========================================="
echo ""

# Test 3-10: Individual command help
test_command "Install command help" "$CLI install --help"
test_command "Status command help" "$CLI status --help"
test_command "Start command help" "$CLI start --help"
test_command "Stop command help" "$CLI stop --help"
test_command "Restart command help" "$CLI restart --help"
test_command "Logs command help" "$CLI logs --help"
test_command "Config command help" "$CLI config --help"
test_command "Uninstall command help" "$CLI uninstall --help"

echo "========================================="
echo "📋 Part 3: Configuration Management"
echo "========================================="
echo ""

# Create a temporary config directory
TEST_CONFIG_DIR=$(mktemp -d)
TEST_CONFIG_FILE="$TEST_CONFIG_DIR/test-config.yaml"

echo -e "${YELLOW}📁 Using test config: $TEST_CONFIG_FILE${NC}"
echo ""

# Test 11: Config show (should fail - no config exists)
test_command "Config show (no config)" "$CLI config --show" true

# Test 12: Config get (should fail - no config exists)
test_command "Config get (no config)" "$CLI config --get addon.name" true

# Test 13: Config reset (creates new config)
echo -e "${BLUE}🧪 Testing: Config reset${NC}"
echo -e "${YELLOW}⚠️  Skipped - requires interactive confirmation${NC}"
echo ""

echo "========================================="
echo "📋 Part 4: Service Commands (Expected to Fail)"
echo "========================================="
echo ""

# These should fail because no config/service is installed
test_command "Status (no installation)" "$CLI status" true
test_command "Start (no installation)" "$CLI start" true
test_command "Stop (no installation)" "$CLI stop" true
test_command "Restart (no installation)" "$CLI restart" true
test_command "Logs (no installation)" "$CLI logs" true

echo "========================================="
echo "📋 Part 5: Module Import Tests"
echo "========================================="
echo ""

# Test that all core modules can be imported
echo -e "${BLUE}🧪 Testing: Core module imports${NC}"

cat > /tmp/test-imports.js << 'EOF'
(async () => {
    try {
        // Test core imports
        const core = await import('./packages/core/dist/index.js');
        
        const modules = [
            'OSDetector',
            'SSHManager',
            'ServiceManager',
            'ConfigManager',
            'InstallationManager',
            'logger',
            'OperatingSystem',
            'InstallationStep'
        ];
        
        let allImported = true;
        for (const mod of modules) {
            if (!core[mod]) {
                console.error(`❌ Missing export: ${mod}`);
                allImported = false;
            }
        }
        
        if (allImported) {
            console.log('✅ All core modules imported successfully');
            process.exit(0);
        } else {
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Import failed:', error.message);
        process.exit(1);
    }
})();
EOF

if node /tmp/test-imports.js; then
    echo -e "${GREEN}✅ PASS${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}❌ FAIL${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

rm /tmp/test-imports.js

echo "========================================="
echo "📋 Part 6: OSDetector Test"
echo "========================================="
echo ""

# Test OSDetector functionality
echo -e "${BLUE}🧪 Testing: OSDetector.detect()${NC}"

cat > /tmp/test-osdetector.js << 'EOF'
(async () => {
    try {
        const { OSDetector } = await import('./packages/core/dist/index.js');
        
        const systemInfo = OSDetector.detect();
        
        console.log('OS:', systemInfo.os);
        console.log('Platform:', systemInfo.platform);
        console.log('Architecture:', systemInfo.arch);
        console.log('Release:', systemInfo.release);
        
        if (systemInfo.os && systemInfo.platform && systemInfo.arch) {
            console.log('✅ OSDetector working correctly');
            process.exit(0);
        } else {
            console.error('❌ OSDetector returned incomplete data');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ OSDetector test failed:', error.message);
        process.exit(1);
    }
})();
EOF

if node /tmp/test-osdetector.js; then
    echo -e "${GREEN}✅ PASS${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}❌ FAIL${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

rm /tmp/test-osdetector.js

echo "========================================="
echo "📋 Part 7: ConfigManager Test"
echo "========================================="
echo ""

# Test ConfigManager functionality
echo -e "${BLUE}🧪 Testing: ConfigManager create and save${NC}"

cat > /tmp/test-config.js << 'EOF'
(async () => {
    try {
        const { ConfigManager, InstallationType, AccessMethod, Provider } = await import('./packages/core/dist/index.js');
        const os = await import('os');
        const path = await import('path');
        
        const testConfigPath = path.join(os.tmpdir(), 'test-stremio-config.yaml');
        const configManager = new ConfigManager(testConfigPath);
        
        // Create a test configuration
        const testConfig = {
            installation: {
                type: InstallationType.LOCAL,
                accessMethod: AccessMethod.DUCKDNS,
            },
            addon: {
                name: 'Test_Addon',
                version: '1.0.0',
                domain: 'test.duckdns.org',
                password: 'TestPassword123',
                provider: Provider.REAL_DEBRID,
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
        
        // Save configuration
        await configManager.save(testConfig);
        console.log('✅ Configuration saved');
        
        // Load configuration
        const loadedConfig = await configManager.load();
        console.log('✅ Configuration loaded');
        
        // Verify data
        if (loadedConfig.addon.name === 'Test_Addon' &&
            loadedConfig.addon.domain === 'test.duckdns.org') {
            console.log('✅ Configuration data verified');
        } else {
            throw new Error('Configuration data mismatch');
        }
        
        // Test getValue
        const addonName = configManager.getValue('addon');
        if (addonName.name === 'Test_Addon') {
            console.log('✅ getValue() working');
        }
        
        // Test getNestedValue
        const domain = configManager.getNestedValue('addon.domain');
        if (domain === 'test.duckdns.org') {
            console.log('✅ getNestedValue() working');
        }
        
        // Test setNestedValue
        configManager.setNestedValue('addon.torrentLimit', 20);
        const newLimit = configManager.getNestedValue('addon.torrentLimit');
        if (newLimit === 20) {
            console.log('✅ setNestedValue() working');
        }
        
        // Test validation
        const validation = configManager.validate();
        if (validation.valid) {
            console.log('✅ Configuration validation passed');
        } else {
            console.error('❌ Validation errors:', validation.errors);
            process.exit(1);
        }
        
        // Cleanup
        const fs = await import('fs/promises');
        await fs.unlink(testConfigPath);
        console.log('✅ Test config file cleaned up');
        
        console.log('✅ ConfigManager test completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('❌ ConfigManager test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
EOF

if node /tmp/test-config.js; then
    echo -e "${GREEN}✅ PASS${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}❌ FAIL${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

rm /tmp/test-config.js

echo "========================================="
echo "📋 Part 8: Logger Test"
echo "========================================="
echo ""

# Test Logger functionality
echo -e "${BLUE}🧪 Testing: Logger functionality${NC}"

cat > /tmp/test-logger.js << 'EOF'
(async () => {
    try {
        const { logger, initLogger, LogLevel } = await import('./packages/core/dist/index.js');
        
        // Initialize logger with custom config
        initLogger({
            level: LogLevel.DEBUG,
            logToFile: false,
            silent: true, // Don't output to console for test
        });
        
        // Test logging methods
        logger.info('Test info message');
        logger.warn('Test warning message');
        logger.error('Test error message');
        logger.debug('Test debug message');
        
        console.log('✅ Logger methods executed without errors');
        process.exit(0);
    } catch (error) {
        console.error('❌ Logger test failed:', error.message);
        process.exit(1);
    }
})();
EOF

if node /tmp/test-logger.js; then
    echo -e "${GREEN}✅ PASS${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}❌ FAIL${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

rm /tmp/test-logger.js

# Cleanup
rm -rf "$TEST_CONFIG_DIR"

echo "========================================="
echo "📊 Test Summary"
echo "========================================="
echo ""
echo -e "${GREEN}✅ Passed: $TESTS_PASSED${NC}"
echo -e "${RED}❌ Failed: $TESTS_FAILED${NC}"
echo -e "Total: $((TESTS_PASSED + TESTS_FAILED))"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some tests failed${NC}"
    exit 1
fi

