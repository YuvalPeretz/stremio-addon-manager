# Stremio Addon Manager - Development Todo

**Last Updated:** January 12, 2026  
**Current Focus:** Making torrent processing limits configurable

---

## 🎯 Current Task: Dynamic Torrent Processing Configuration

### Problem

Currently, several torrent processing values are hardcoded in both the TypeScript and JavaScript codebases:

- `limitedTorrents` (availability check) - hardcoded to 15
- `maxStreams` (early return limit) - hardcoded to 5
- `maxConcurrency` (parallel processing) - hardcoded to 3
- `torrentsToProcess` cap - hardcoded to 10 in some places

These should be configurable by users through the CLI/Electron UI, which writes to the config file, which gets written to systemd service file as environment variables, which the addon-server reads.

### Configuration Flow Architecture

```
User Input (CLI/Electron)
    ↓
ConfigManager.save() → Config File (JSON)
    ↓
InstallationManager → systemd Service File (Environment Variables)
    ↓
addon-server → Reads env vars → Uses in code
```

### Current State Analysis

#### Hardcoded Values Found:

**TypeScript (`stream-handler.ts`):**

- Line 205: `const limitedTorrents = filteredTorrents.slice(0, 15);` - Hardcoded to 15
- Line 254: `const maxConcurrency = 3;` - Hardcoded to 3
- Line 255: `const maxStreams = 5;` - Hardcoded to 5
- Line 256: `Math.min(config.torrentLimit, 10)` - Caps at 10

**JavaScript (`server.js`):**

- Line 372: `const limitedTorrents = filteredTorrents.slice(0, 15);` - Hardcoded to 15
- Line 410: `const torrentsToProcess = cachedTorrents.slice(0, 10);` - Hardcoded to 10
- Line 402: `const maxConcurrency = 3;` - Hardcoded to 3
- Line 403: `const maxStreams = 5;` - Hardcoded to 5

#### Existing Configuration System:

**Core Package (`core/src/config/types.ts`):**

- `AddonConfig` interface has `torrentLimit: number`
- `DEFAULT_CONFIG.addon.torrentLimit = 15`
- This is the source of truth for all packages

**CLI (`cli/src/commands/install.ts`):**

- Prompts user for `torrentLimit` (5-25 range)
- Saves to config via `ConfigManager`
- Uses `AddonConfig` from core

**Installation Manager (`core/src/installation/manager.ts`):**

- Line 670: Writes `Environment=TORRENT_LIMIT=${config.addon.torrentLimit}` to systemd service
- This is where config → environment variable conversion happens

**addon-server (`addon-server/src/config.ts`):**

- Reads `TORRENT_LIMIT` from `process.env`
- Has `torrentLimit` in `ServerConfig` interface
- Missing: `availabilityCheckLimit`, `maxStreams`, `maxConcurrency`

**Electron (`electron/src/renderer/pages/Configuration/Configuration.tsx`):**

- Line 154-160: Has UI for `torrentLimit` with validation (5-25)
- Uses `AddonConfig` from core
- Missing: UI for new config options

---

## 📋 Implementation Plan

### Phase 1: Core Configuration Types (Source of Truth)

#### 1.1 Update Core Package (`core/src/config/types.ts`)

- [ ] Add new fields to `AddonConfig` interface:
  - `availabilityCheckLimit?: number` - Torrents to check for instant availability
  - `maxStreams?: number` - Maximum streams to return before stopping
  - `maxConcurrency?: number` - Parallel torrent processing limit
- [ ] Update `DEFAULT_CONFIG` with defaults:
  - `availabilityCheckLimit: 15`
  - `maxStreams: 5`
  - `maxConcurrency: 3`
- [ ] Add JSDoc comments explaining each field
- [ ] Ensure backward compatibility (all fields optional with defaults)

**Files to modify:**

- `stremio-addon-manager/packages/core/src/config/types.ts`

**Impact:** This is the source of truth - all other packages will use these types

---

### Phase 2: CLI Configuration Updates

#### 2.1 Update CLI Install Command (`cli/src/commands/install.ts`)

- [ ] Add prompts for new configuration options in `promptAddonConfiguration()`:
  - `availabilityCheckLimit` (default: 15, range: 5-50)
  - `maxStreams` (default: 5, range: 1-20)
  - `maxConcurrency` (default: 3, range: 1-10)
- [ ] Add validation for each field (min/max bounds)
- [ ] Update return object to include new fields
- [ ] Add helpful descriptions in prompts explaining what each does

**Files to modify:**

- `stremio-addon-manager/packages/cli/src/commands/install.ts`

**Impact:** Users can now set these values during installation

#### 2.2 Update CLI Config Command (`cli/src/commands/config.ts`)

- [ ] Verify config command can read/write new fields (should work automatically via ConfigManager)
- [ ] Test `--set` and `--get` commands with new fields
- [ ] Update help text if needed

**Files to check/test:**

- `stremio-addon-manager/packages/cli/src/commands/config.ts`

**Impact:** Users can modify these values after installation

---

### Phase 3: Installation Manager Updates

#### 3.1 Update Service File Generation (`core/src/installation/manager.ts`)

- [ ] Add new environment variables to systemd service file template (around line 670):
  - `Environment=AVAILABILITY_CHECK_LIMIT=${this.options.config.addon.availabilityCheckLimit || 15}`
  - `Environment=MAX_STREAMS=${this.options.config.addon.maxStreams || 5}`
  - `Environment=MAX_CONCURRENCY=${this.options.config.addon.maxConcurrency || 3}`
- [ ] Use fallback defaults if values not set (for backward compatibility)
- [ ] Update comments in service file template

**Files to modify:**

- `stremio-addon-manager/packages/core/src/installation/manager.ts`

**Impact:** New config values are written to systemd service file as environment variables

---

### Phase 4: Addon Server Configuration Updates

#### 4.1 Update TypeScript Config (`addon-server/src/config.ts`)

- [ ] Add `availabilityCheckLimit` to `ServerConfig` interface
- [ ] Add `maxStreams` to `ServerConfig` interface
- [ ] Add `maxConcurrency` to `ServerConfig` interface
- [ ] Update `loadConfig()` function to read from environment variables:
  - `AVAILABILITY_CHECK_LIMIT` (default: 15)
  - `MAX_STREAMS` (default: 5)
  - `MAX_CONCURRENCY` (default: 3)
- [ ] Add validation (min/max bounds) with helpful error messages
- [ ] Log configuration values on startup (hide sensitive values)

**Files to modify:**

- `stremio-addon-manager/packages/addon-server/src/config.ts`

**Impact:** TypeScript addon-server can now read and use new config values

#### 4.2 Update TypeScript Stream Handler (`addon-server/src/stream-handler.ts`)

- [ ] Replace hardcoded `15` with `config.availabilityCheckLimit` (line 205)
- [ ] Replace hardcoded `3` with `config.maxConcurrency` (line 254)
- [ ] Replace hardcoded `5` with `config.maxStreams` (line 255)
- [ ] Replace `Math.min(config.torrentLimit, 10)` with `config.torrentLimit` (line 256)
- [ ] Update comments to reference config values
- [ ] Add validation checks before using config values

**Files to modify:**

- `stremio-addon-manager/packages/addon-server/src/stream-handler.ts`

**Impact:** TypeScript version now uses configurable values

#### 4.3 Update JavaScript Config (`server.js`)

- [ ] Add constants at top of file (after existing config section):
  ```javascript
  const AVAILABILITY_CHECK_LIMIT = parseInt(process.env.AVAILABILITY_CHECK_LIMIT || "15", 10);
  const MAX_STREAMS = parseInt(process.env.MAX_STREAMS || "5", 10);
  const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || "3", 10);
  ```
- [ ] Add validation and bounds checking with console warnings
- [ ] Add JSDoc comments explaining each constant
- [ ] Log values on startup

**Files to modify:**

- `server.js` (root directory)

**Impact:** JavaScript version can now read and use new config values

#### 4.4 Update JavaScript Stream Handler (`server.js`)

- [ ] Replace hardcoded `15` with `AVAILABILITY_CHECK_LIMIT` constant (line 372)
- [ ] Replace hardcoded `10` with `TORRENT_LIMIT` or remove cap (line 410)
- [ ] Replace hardcoded `3` with `MAX_CONCURRENCY` constant
- [ ] Replace hardcoded `5` with `MAX_STREAMS` constant
- [ ] Update comments to reference constants
- [ ] Ensure consistency with TypeScript version

**Files to modify:**

- `server.js` (root directory)

**Impact:** JavaScript version now uses configurable values

---

### Phase 5: Electron GUI Updates

#### 5.1 Update Configuration UI (`electron/src/renderer/pages/Configuration/Configuration.tsx`)

- [ ] Add form fields for new configuration options in "Addon Settings" tab:
  - `availabilityCheckLimit` - InputNumber (min: 5, max: 50, default: 15)
  - `maxStreams` - InputNumber (min: 1, max: 20, default: 5)
  - `maxConcurrency` - InputNumber (min: 1, max: 10, default: 3)
- [ ] Add helpful descriptions/tooltips for each field
- [ ] Add validation rules matching CLI validation
- [ ] Ensure form layout is clean and organized
- [ ] Test form save/load functionality

**Files to modify:**

- `stremio-addon-manager/packages/electron/src/renderer/pages/Configuration/Configuration.tsx`

**Impact:** Users can configure these values via GUI

**Note:** Electron uses the same `AddonConfig` from core, so types will automatically be available

---

### Phase 6: Documentation Updates

#### 6.1 Addon Server README (`addon-server/README.md`)

- [ ] Update "Environment Variables" section
- [ ] Document new environment variables:
  - `AVAILABILITY_CHECK_LIMIT` - Number of torrents to check for instant availability (default: 15, range: 5-50)
  - `MAX_STREAMS` - Maximum number of streams to return before stopping (default: 5, range: 1-20)
  - `MAX_CONCURRENCY` - Number of torrents to process in parallel (default: 3, range: 1-10)
  - `TORRENT_LIMIT` - Maximum number of torrents to process (default: 15, range: 5-50)
- [ ] Add usage examples
- [ ] Document recommended values and performance implications
- [ ] Add troubleshooting section

**Files to modify:**

- `stremio-addon-manager/packages/addon-server/README.md`

#### 6.2 Core Package Documentation

- [ ] Document new `AddonConfig` fields in code comments
- [ ] Explain configuration flow (CLI → Config File → Service File → Env Vars)
- [ ] Add examples of configuration structure

**Files to check/create:**

- `stremio-addon-manager/packages/core/src/config/README.md` (if exists)

#### 6.3 CLI Documentation

- [ ] Update CLI help text if needed
- [ ] Document new configuration options in install command
- [ ] Add examples of setting config via CLI

**Files to check:**

- CLI package README (if exists)

#### 6.4 Electron Documentation

- [ ] Update Electron README with new configuration options
- [ ] Add screenshots of new UI fields (if applicable)

**Files to check:**

- `stremio-addon-manager/packages/electron/README.md`

#### 6.5 Development Guidelines

- [ ] Update `development/guidelines.md` with new config options
- [ ] Document configuration best practices
- [ ] Add troubleshooting section for configuration issues

**Files to modify:**

- `stremio-addon-manager/development/guidelines.md`

#### 6.6 Commands List (if applicable)

- [ ] Update `development/commands-list.json` if it includes environment variable examples
- [ ] Add examples of setting these variables in service files

**Files to check:**

- `stremio-addon-manager/development/commands-list.json`

---

### Phase 7: Validation & Testing

#### 7.1 Configuration Validation (All Packages)

- [ ] **Core:** Ensure `AddonConfig` validation in ConfigManager
- [ ] **CLI:** Validate user input in install prompts (already has some validation)
- [ ] **addon-server (TS):** Add validation in `loadConfig()`:
  - `availabilityCheckLimit`: min 5, max 50
  - `maxStreams`: min 1, max 20
  - `maxConcurrency`: min 1, max 10
  - `torrentLimit`: min 1, max 50
- [ ] **addon-server (JS):** Add validation with console warnings
- [ ] **Electron:** Ensure form validation matches CLI validation
- [ ] Add type checking (must be integers)
- [ ] Add helpful error messages for invalid values
- [ ] Log configuration on startup (hide sensitive values)

#### 7.2 Integration Testing

- [ ] **Full Flow Test:**
  1. Set config via CLI install command
  2. Verify config file contains new values
  3. Run installation (or update service file)
  4. Verify systemd service file has new env vars
  5. Start addon-server
  6. Verify addon-server reads and uses new values
  7. Test with actual stream request
- [ ] **Electron Flow Test:**
  1. Set config via Electron UI
  2. Verify config file updated
  3. Restart service (if needed)
  4. Verify new values applied
- [ ] **Backward Compatibility Test:**
  1. Use old config file (without new fields)
  2. Verify defaults are used
  3. Verify no errors occur

#### 7.3 Unit Testing

- [ ] Test with default values (no config set)
- [ ] Test with custom values via environment variables
- [ ] Test with invalid values (should use defaults or show error)
- [ ] Test with edge cases (very low, very high values)
- [ ] Test with missing values (backward compatibility)
- [ ] Verify both TypeScript and JavaScript versions work identically

#### 7.4 Performance Testing

- [ ] Test with different `maxConcurrency` values (1, 3, 5, 10)
- [ ] Test with different `availabilityCheckLimit` values (5, 15, 30, 50)
- [ ] Test with different `maxStreams` values (1, 5, 10, 20)
- [ ] Measure response times
- [ ] Verify early return optimization works with different `maxStreams`
- [ ] Check memory usage with high limits

---

### Phase 8: Code Review & Cleanup

#### 8.1 Code Quality

- [ ] Ensure consistent naming across all packages:
  - Config file: `availabilityCheckLimit`, `maxStreams`, `maxConcurrency`
  - Environment variables: `AVAILABILITY_CHECK_LIMIT`, `MAX_STREAMS`, `MAX_CONCURRENCY`
  - Code variables: Match config naming
- [ ] Remove any remaining hardcoded values
- [ ] Update all comments to reflect configurable values
- [ ] Verify no magic numbers remain
- [ ] Ensure consistent defaults across all packages

#### 8.2 Type Safety (TypeScript)

- [ ] Ensure all config values are properly typed in core package
- [ ] Verify addon-server types match core types
- [ ] Add JSDoc comments for config interfaces
- [ ] Verify no type errors in any package
- [ ] Run TypeScript compiler on all packages

#### 8.3 Consistency Check

- [ ] Verify TypeScript and JavaScript versions behave identically
- [ ] Verify CLI and Electron use same validation rules
- [ ] Verify installation manager writes correct env var names
- [ ] Verify addon-server reads correct env var names
- [ ] Check all default values match across packages

---

## 📊 Implementation Summary

### Packages Affected (in order of dependency):

1. **core** (Phase 1) - Source of truth for config types
2. **cli** (Phase 2) - User input and config management
3. **core/installation** (Phase 3) - Writes config to service file
4. **addon-server** (Phase 4) - Reads and uses config
5. **electron** (Phase 5) - GUI for config
6. **Documentation** (Phase 6) - All packages
7. **Testing** (Phase 7) - All packages
8. **Review** (Phase 8) - All packages

### Configuration Flow Diagram:

```
┌─────────────────┐
│  User Input     │
│  (CLI/Electron) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  ConfigManager  │
│  (core package) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────────┐
│  Config File    │─────▶│  AddonConfig     │
│  (JSON)         │      │  (TypeScript)    │
└────────┬────────┘      └──────────────────┘
         │
         ▼
┌─────────────────┐
│ Installation    │
│ Manager         │
│ (core package)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ systemd Service │
│ File            │
│ (Env Vars)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ addon-server    │
│ (reads env)     │
└─────────────────┘
```

### Key Files to Modify:

**Core Package:**

- `packages/core/src/config/types.ts` - Add new fields to AddonConfig

**CLI Package:**

- `packages/cli/src/commands/install.ts` - Add prompts for new config

**Installation Manager:**

- `packages/core/src/installation/manager.ts` - Write new env vars to service file

**Addon Server (TypeScript):**

- `packages/addon-server/src/config.ts` - Read new env vars
- `packages/addon-server/src/stream-handler.ts` - Use new config values

**Addon Server (JavaScript):**

- `server.js` - Read new env vars and use in code

**Electron Package:**

- `packages/electron/src/renderer/pages/Configuration/Configuration.tsx` - Add UI fields

**Documentation:**

- Multiple README files across packages
- Development guidelines

---

## ✅ Completion Checklist

- [ ] **Phase 1:** Core Configuration Types (Source of Truth)
- [ ] **Phase 2:** CLI Configuration Updates
- [ ] **Phase 3:** Installation Manager Updates
- [ ] **Phase 4:** Addon Server Configuration Updates
- [ ] **Phase 5:** Electron GUI Updates
- [ ] **Phase 6:** Documentation Updates
- [ ] **Phase 7:** Validation & Testing
- [ ] **Phase 8:** Code Review & Cleanup

---

## 🎯 Critical Success Factors

1. **Backward Compatibility:** Old config files must still work (use defaults)
2. **Type Safety:** All packages must use same types from core
3. **Consistency:** Same validation rules across CLI, Electron, and server
4. **Documentation:** All new options must be documented
5. **Testing:** Full integration test from user input to server execution

---

**Status:** 📋 Comprehensive Planning Complete - Ready for Implementation  
**Next Step:** Wait for user approval to begin Phase 1 (Core Configuration Types)
