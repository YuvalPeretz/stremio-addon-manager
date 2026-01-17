# Stremio Addon Manager - Development Todo

**Last Updated:** January 17, 2026  
**Current Focus:** Environment Variable Management for Multi-Addon Support  
**Status:** Phase 1-7 Complete ✅ (Phase 8 Pending)  
**Status:** Phase 1 Complete ✅ (Phase 2-8 Pending)

---

## Environment Variable Management Feature

### Overview

Add comprehensive environment variable management for each addon, allowing users to view, edit, reset to defaults, and generate values (like during addon creation). This will enable updating service files without reinstalling addons.

### Environment Variables Reference

**Current Environment Variables:**

- `NODE_ENV` - Always "production" (system-managed)
- `PORT` - Addon server port (from `config.addon.port`)
- `RD_API_TOKEN` - Real-Debrid API token (from `config.secrets.realDebridToken`)
- `ADDON_PASSWORD` - Addon authentication password (from `config.addon.password`)
- `ADDON_DOMAIN` - Addon domain for manifest base URL (from `config.addon.domain`)
- `TORRENT_LIMIT` - Max torrents to process (from `config.addon.torrentLimit`, default: 15)
- `AVAILABILITY_CHECK_LIMIT` - Torrents to check for instant availability (from `config.addon.availabilityCheckLimit`, default: 15)
- `MAX_STREAMS` - Max streams to return (from `config.addon.maxStreams`, default: 5)
- `MAX_CONCURRENCY` - Parallel torrent processing (from `config.addon.maxConcurrency`, default: 3)

---

## Phase 1: Core Package - Service File Management ✅

### 1.1 Create Service File Manager ✅

- [x] Create `packages/core/src/service/file-manager.ts`
  - [x] `readServiceFile(serviceName: string, ssh?: SSHConnection): Promise<ServiceFileContent>`
  - [x] `updateServiceFile(serviceName: string, envVars: Record<string, string>, ssh?: SSHConnection): Promise<void>`
  - [x] `generateServiceFile(config: AddonManagerConfig, ssh?: SSHConnection): Promise<string>`
  - [x] `parseServiceFile(content: string): ServiceFileContent`
  - [x] `validateServiceFile(content: string): boolean`
  - [x] `backupServiceFile(serviceName: string, ssh?: SSHConnection): Promise<string>`
  - [x] Types: `ServiceFileContent`, `EnvironmentVariable`

### 1.2 Create Environment Variable Manager ✅

- [x] Create `packages/core/src/config/env-manager.ts`
  - [x] `getEnvVarsFromConfig(config: AddonManagerConfig): Record<string, string>`
  - [x] `getDefaultEnvVars(): Record<string, string>`
  - [x] `validateEnvVar(key: string, value: string): { valid: boolean; error?: string }`
  - [x] `generateEnvVarValue(key: string, config?: AddonManagerConfig): string | undefined`
  - [x] `getAllEnvVarMetadata(): Record<string, EnvVarMetadata>`
  - [x] `getEnvVarMetadata(key: string): EnvVarMetadata | undefined`
  - [x] `mergeEnvVars(config: AddonManagerConfig, overrides?: Record<string, string | null>): Record<string, string>`
  - [x] `getEnvVarSource(key: string, config: AddonManagerConfig, overrides?: Record<string, string | null>): "default" | "config" | "override"`
  - [x] Types: `EnvVarMetadata` (description, default, min, max, required, sensitive, generateable)
  - [x] All 9 environment variables documented with metadata

### 1.3 Update Installation Manager ✅

- [x] Add `updateServiceFile()` method to `InstallationManager`
  - [x] Read current config
  - [x] Generate service file content from config (with overrides support)
  - [x] Backup existing service file
  - [x] Write to systemd service file (local and remote)
  - [x] Reload systemd daemon
  - [x] Optionally restart service
- [x] Export `updateServiceFile` as public method

### 1.4 Update Config Types ✅

- [x] Add `environmentVariables?: Record<string, string | null>` to `AddonConfig` interface
  - [x] Allow overrides for environment variables
  - [x] Store custom values that differ from defaults
  - [x] Support null values to reset to default/config

---

## Phase 2: Core Package - Service Manager Updates ✅

### 2.1 Add Environment Variable Methods ✅

- [x] Update `ServiceManager` class in `packages/core/src/service/manager.ts`
  - [x] `getEnvironmentVariables(): Promise<Record<string, string>>`
  - [x] `setEnvironmentVariables(vars: Record<string, string>): Promise<void>`
  - [x] `resetEnvironmentVariables(): Promise<void>`
  - [x] `syncEnvironmentVariablesFromConfig(config: AddonManagerConfig): Promise<void>`
  - [x] All methods validate environment variables before updating
  - [x] All methods backup service file before modifications
  - [x] All methods support local and remote (SSH) operations
  - [x] Linux-only check with clear error messages

### 2.2 Service File Sync ✅

- [x] Add `syncServiceFile()` method
  - [x] Read current config
  - [x] Generate service file from config
  - [x] Compare with existing service file
  - [x] Detect changes (added, changed, removed environment variables)
  - [x] Compare working directory and description
  - [x] Update if different
  - [x] Return detailed change list
  - [x] Reload systemd and optionally restart service
  - [x] Support local and remote (SSH) operations

---

## Phase 3: CLI Package - Environment Variable Commands ✅

### 3.1 Add `env` Command ✅

- [x] Create `packages/cli/src/commands/env.ts`
  - [x] `env list` - List all environment variables for an addon
  - [x] `env get <key>` - Get value of specific environment variable
  - [x] `env set <key> [value]` - Set environment variable value (prompts if value not provided)
  - [x] `env unset <key>` - Remove environment variable (reset to default)
  - [x] `env reset` - Reset all environment variables to defaults (with confirmation)
  - [x] `env sync` - Sync service file with current config
  - [x] `env generate <key>` - Generate values for generateable variables (like passwords)
  - [x] Support `--addon <id>` flag for multi-addon on all commands
  - [x] Support `--restart` flag on commands that modify environment variables
  - [x] Value validation before setting
  - [x] Config integration (saves overrides to config file)

### 3.2 Update CLI Index ✅

- [x] Register `env` command with subcommands in `packages/cli/src/index.ts`
- [x] Add help text and descriptions for all subcommands
- [x] Export `EnvVarManager` from core package for CLI use

### 3.3 Environment Variable Display ✅

- [x] Format output with:
  - [x] Variable name (left-aligned, 25 chars)
  - [x] Current value (mask sensitive values with •)
  - [x] Source indicator (color-coded: [default], [config], [override])
  - [x] Description/metadata from EnvVarManager
  - [x] Color-coded output (cyan for config, yellow for override, gray for default)
  - [x] Fallback display when service file can't be read
  - [x] Table format with proper alignment

---

## Phase 4: Electron Package - Environment Variable UI ✅

### 4.1 Create Environment Variables Page ✅

- [x] Create `packages/electron/src/renderer/pages/EnvironmentVariables/EnvironmentVariables.tsx`
  - [x] Table/list view of all environment variables
  - [x] Columns: Variable (with description), Value (masked), Source (color-coded), Default, Actions
  - [x] Edit inline with save/cancel buttons
  - [x] Mask sensitive values (passwords, tokens shown as •)
  - [x] Show validation errors via Ant Design messages
  - [x] Generate button for generateable variables (ADDON_PASSWORD)
  - [x] Reset to default button per variable (with confirmation)
  - [x] Reset all button (with confirmation)
  - [x] Sync with config button (always enabled)
  - [x] Sync & Restart button (with confirmation)
  - [x] Search/filter functionality
  - [x] Loading states and error handling
  - [x] Multi-addon support via selectedAddonIdAtom

### 4.2 Add Environment Variables Tab to Configuration Page ✅

- [x] Add new tab "Environment Variables" to Configuration page
- [x] Reuse EnvironmentVariables component as tab content
- [x] Show relationship between config values and env vars (source indicators)
- [x] Allow editing both config and env vars in one place
- [x] Component automatically reloads when addon changes

### 4.3 IPC Handlers ✅

- [x] Add IPC handlers in `packages/electron/src/main/index.ts`:
  - [x] `env:list` - Get all environment variables for addon
  - [x] `env:get` - Get specific environment variable
  - [x] `env:set` - Set environment variable (updates service file and config)
  - [x] `env:unset` - Remove environment variable (resets to default)
  - [x] `env:reset` - Reset all to defaults
  - [x] `env:sync` - Sync service file with config (with optional restart)
  - [x] `env:generate` - Generate value for variable
  - [x] `env:getMetadata` - Get all environment variable metadata
  - [x] All handlers support `addonId` parameter
  - [x] Config integration (saves overrides to config file)

### 4.4 Update Preload and Types ✅

- [x] Add `env` object to `preload.ts` with all methods
- [x] Update `electron.d.ts` with environment variable types
- [x] All methods properly typed with return types
- [x] Uses existing Jotai atoms (selectedAddonIdAtom) for state management

### 4.5 Navigation Updates ✅

- [x] Added route `/environment-variables` in `App.tsx` (standalone page)
- [x] Integrated into Configuration page as tab
- [x] Component uses selectedAddonIdAtom for multi-addon support
- [x] Automatic reload when addon changes

---

## Phase 5: Configuration Integration ✅

### 5.1 Config to Env Var Mapping ✅

- [x] Document mapping between config fields and env vars:
  - [x] `config.addon.port` → `PORT`
  - [x] `config.secrets.realDebridToken` → `RD_API_TOKEN`
  - [x] `config.addon.password` → `ADDON_PASSWORD`
  - [x] `config.addon.domain` → `ADDON_DOMAIN`
  - [x] `config.addon.torrentLimit` → `TORRENT_LIMIT`
  - [x] `config.addon.availabilityCheckLimit` → `AVAILABILITY_CHECK_LIMIT`
  - [x] `config.addon.maxStreams` → `MAX_STREAMS`
  - [x] `config.addon.maxConcurrency` → `MAX_CONCURRENCY`
  - [x] Added comprehensive documentation in `env-manager.ts` with mapping table and override priority

### 5.2 Config Save Integration ✅

- [x] When config is saved, optionally sync service file
- [x] Add `syncServiceFile` option to config save
- [x] Added `restartService` option for automatic service restart after sync
- [x] Returns sync results (updated status and change list)
- [x] Updated Electron IPC handlers to support new options
- [x] Updated TypeScript types for config.save method
- [x] Service file sync is optional and non-blocking (errors are logged but don't fail config save)

### 5.3 Environment Variable Overrides ✅

- [x] Allow storing env var overrides in config (`config.addon.environmentVariables`)
- [x] Overrides take precedence over config-derived values (implemented in `mergeEnvVars`)
- [x] Clear overrides when resetting to defaults (null values remove overrides)
- [x] Overrides are properly saved/loaded as part of config
- [x] Priority order documented: Overrides > Config-derived > Defaults

---

## Phase 6: Validation & Error Handling ✅

### 6.1 Environment Variable Validation ✅

- [x] Validate all environment variable values:
  - [x] Type checking (string, number, boolean) - Enhanced with integer validation for numbers
  - [x] Range validation (min/max for numbers) - Clear error messages with received values
  - [x] Format validation (URLs, domains, ports) - Custom validation functions in metadata
  - [x] Required vs optional - Proper handling of empty optional values
- [x] Show clear error messages - Enhanced with context, received values, and descriptions
- [x] Added `validateEnvVars()` method for batch validation

### 6.2 Service File Validation ✅

- [x] Validate service file syntax before writing - Comprehensive validation in `validateServiceFile()`
  - [x] Required sections check ([Unit], [Service], [Install])
  - [x] Section order validation
  - [x] Required fields validation (ExecStart, WorkingDirectory)
  - [x] Path validation (absolute paths required)
  - [x] Environment variable format validation
  - [x] Warnings for missing recommended fields
- [x] Backup existing service file before updates - `backupServiceFile()` method
- [x] Rollback on failure - `rollbackServiceFile()` method with automatic rollback in `writeServiceFile()`
- [x] Test systemd config before applying - `testSystemdConfig()` method using `systemd-analyze verify`
- [x] New `writeServiceFile()` method with validation, backup, test, and rollback workflow

### 6.3 Error Handling ✅

- [x] Handle SSH connection errors - Enhanced error messages with recovery steps
  - [x] Connection status checking before commands
  - [x] Specific error detection (ECONNREFUSED, ETIMEDOUT, ENOTFOUND)
  - [x] Clear recovery steps for SSH issues
- [x] Handle permission errors (sudo required) - Enhanced sudo error handling
  - [x] Detection of permission denied errors
  - [x] Sudo password requirement detection
  - [x] Passwordless sudo configuration guidance
  - [x] Clear recovery steps for permission issues
- [x] Handle systemd reload failures - Enhanced error handling with recovery steps
- [x] Handle service restart failures - Enhanced error handling with status verification
  - [x] Post-restart status verification (Linux)
  - [x] Clear recovery steps with specific commands
  - [x] Service log and status checking guidance
- [x] Provide clear error messages and recovery steps - All errors include:
  - [x] Clear error description
  - [x] Recovery steps with specific commands
  - [x] Context-specific guidance (SSH, permissions, systemd, service)

---

## Phase 7: Documentation & Help ✅

### 7.1 Environment Variable Documentation ✅

- [x] Document all environment variables in README
  - [x] Complete table with all 9 environment variables
  - [x] Detailed descriptions for each variable
  - [x] Default values, ranges, and formats
  - [x] Examples for each variable
  - [x] Marked which are generateable (ADDON_PASSWORD)
  - [x] Marked which are sensitive (RD_API_TOKEN, ADDON_PASSWORD)
  - [x] Performance tuning tips and example configurations
  - [x] Quick reference table and detailed variable descriptions

### 7.2 CLI Help Text ✅

- [x] Add comprehensive help for `env` command
  - [x] Main command description with examples
  - [x] List of all available variables
  - [x] Options documentation (`--addon`, `--restart`)
  - [x] Help text for each subcommand with examples:
    - [x] `env list` - List all variables
    - [x] `env get <key>` - Get specific variable
    - [x] `env set <key> [value]` - Set variable value
    - [x] `env unset <key>` - Reset to default
    - [x] `env reset` - Reset all to defaults
    - [x] `env sync` - Sync service file with config
    - [x] `env generate <key>` - Generate secure values
  - [x] Reference to README for detailed documentation

### 7.3 Electron UI Help ✅

- [x] Add tooltips/help text for each environment variable
  - [x] Comprehensive tooltips on Variable column with:
    - [x] Full description
    - [x] Type information
    - [x] Valid ranges (for numbers)
    - [x] Length constraints (for strings)
    - [x] Default values
    - [x] Required status
    - [x] Special flags (Sensitive, Generateable)
    - [x] Source information
  - [x] Visual indicators (tags) for Required, Sensitive, Generateable
  - [x] Inline range/constraint display in description
  - [x] Tooltips on Value column showing current value and constraints
  - [x] Enhanced input placeholders with default values and ranges
  - [x] Number input type for numeric variables

---

## Phase 8: Testing & Edge Cases

### 8.1 Unit Tests

- [ ] Test service file parsing
- [ ] Test service file generation
- [ ] Test environment variable validation
- [ ] Test config to env var mapping

### 8.2 Integration Tests

- [ ] Test CLI env commands
- [ ] Test Electron UI env management
- [ ] Test service file updates
- [ ] Test service restart after updates

### 8.3 Edge Cases ✅

- [x] Handle missing service file
  - [x] Graceful handling in `readServiceFile()` with clear error messages
  - [x] Automatic creation in `updateServiceFile()` when file doesn't exist
  - [x] Proper handling in `setEnvironmentVariables()` with informative messages
  - [x] Config save handles missing service gracefully
- [x] Handle corrupted service file
  - [x] Enhanced `parseServiceFile()` with error recovery
  - [x] Handles malformed content, missing sections, invalid entries
  - [x] Preserves what can be parsed, logs warnings for non-critical errors
  - [x] Only throws if critical information (ExecStart, WorkingDirectory) is missing
  - [x] Clear error messages with recovery steps
- [x] Handle invalid environment variable values
  - [x] Comprehensive validation in `validateEnvVar()` and `validateEnvVars()`
  - [x] Batch validation with detailed error messages
  - [x] Validation before any service file updates
  - [x] Clear error messages showing which variables are invalid and why
- [x] Handle service file with custom entries
  - [x] `parseServiceFile()` preserves unknown keys (custom entries)
  - [x] `updateServiceFile()` preserves existing environment variables not being updated
  - [x] Custom service file entries are maintained during updates
- [x] Handle multiple addons with different env vars
  - [x] Addon-specific service names ensure isolation
  - [x] Addon-specific config paths prevent conflicts
  - [x] Each addon has its own environment variable overrides in config
  - [x] Service file operations are addon-specific via service name
- [x] Handle remote installations (SSH)
  - [x] Enhanced SSH error handling in `executeCommand()` and `executeSudoCommand()`
  - [x] Specific handling for connection refused, timeouts, host not found, connection reset
  - [x] SSH timeout handling in `setEnvironmentVariables()`
  - [x] Clear recovery steps for each SSH error type
  - [x] Connection status checking before operations
- [x] Additional edge cases handled:
  - [x] Empty environment variable values (handled in validation)
  - [x] Duplicate environment variables (last one wins, warning logged)
  - [x] Concurrent service file updates (detected and handled with clear errors)
  - [x] Empty envVars object in setEnvironmentVariables (preserves existing)
  - [x] Config save failures (handled gracefully, service sync is optional)
  - [x] Service file write failures (automatic rollback from backup)

---

## Implementation Notes

### Service File Format

```ini
[Unit]
Description=Stremio Private Addon: {name}
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory={addonDirectory}
ExecStart=/usr/bin/node {addonDirectory}/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT={port}
Environment=RD_API_TOKEN={token}
Environment=ADDON_PASSWORD={password}
Environment=ADDON_DOMAIN={domain}
Environment=TORRENT_LIMIT={limit}
Environment=AVAILABILITY_CHECK_LIMIT={limit}
Environment=MAX_STREAMS={streams}
Environment=MAX_CONCURRENCY={concurrency}

[Install]
WantedBy=multi-user.target
```

### Environment Variable Metadata Example

```typescript
{
  PORT: {
    description: "Addon server port",
    default: 7000,
    type: "number",
    min: 1024,
    max: 65535,
    required: true,
    sensitive: false,
    generateable: false,
    source: "config.addon.port"
  },
  ADDON_PASSWORD: {
    description: "Addon authentication password",
    default: undefined,
    type: "string",
    minLength: 8,
    required: true,
    sensitive: true,
    generateable: true,
    source: "config.addon.password"
  }
}
```

### Workflow

1. User edits environment variable in Electron UI or CLI
2. Value is validated
3. If valid, stored in config (as override) or updated in config field
4. User clicks "Apply" or "Sync"
5. Service file is regenerated from current config
6. Service file is written to systemd
7. Systemd daemon is reloaded
8. Service is restarted (optional, user choice)

---

## Priority Order

1. **Phase 1** - Core service file management (foundation)
2. **Phase 2** - Service manager updates (integration)
3. **Phase 3** - CLI commands (quick access)
4. **Phase 4** - Electron UI (user-friendly)
5. **Phase 5** - Config integration (seamless)
6. **Phase 6** - Validation (safety)
7. **Phase 7** - Documentation (usability)
8. **Phase 8** - Testing (quality)

---

## Related Features

- Multi-addon support (already implemented)
- Configuration management (already implemented)
- Service management (already implemented)
- Installation wizard (already implemented)
