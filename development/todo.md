# Development Todo

## Package Update System - Update Addon Packages on Remote Servers

### Problem
When addon-server code is improved (e.g., search capabilities, bug fixes), there's currently no way to update the deployed addons on remote servers without reinstalling them completely. Users need the ability to:
- Update addon-server package files while preserving configuration
- Update to specific versions or latest
- Rollback if updates fail
- Update multiple addons at once
- See available updates before applying them

### Solution Architecture

#### Components to Implement
1. **Core Update Manager** (`packages/core/src/installation/update-manager.ts`)
2. **CLI Update Command** (`packages/cli/src/commands/update.ts`)
3. **Electron UI Update Feature** (`packages/electron/src/renderer/components/UpdateAddon.tsx`)
4. **Version Management** (track versions in registry)
5. **Backup & Rollback** (automatic backup before update)

---

## Phase 1: Core Update Manager (Core Package)

### File: `packages/core/src/installation/update-manager.ts`

#### 1.1: Create UpdateManager Class

**Core Functionality:**
```typescript
export class UpdateManager {
  // Version management
  getCurrentVersion(addonId: string): Promise<string>
  getLatestVersion(): string
  getAvailableVersions(): string[]
  
  // Update operations
  updateAddon(addonId: string, options?: UpdateOptions): Promise<UpdateResult>
  updateMultipleAddons(addonIds: string[], options?: UpdateOptions): Promise<UpdateResult[]>
  
  // Pre-update checks
  checkForUpdates(addonId: string): Promise<UpdateInfo>
  validateUpdatePreconditions(addonId: string): Promise<PreUpdateCheck>
  
  // Rollback
  rollbackUpdate(addonId: string, backupId: string): Promise<void>
}
```

**Update Options:**
```typescript
interface UpdateOptions {
  targetVersion?: string;        // Specific version to update to (default: latest)
  skipBackup?: boolean;          // Skip backup before update (NOT recommended)
  restartService?: boolean;      // Restart service after update (default: true)
  forceUpdate?: boolean;         // Force update even if already on target version
  dryRun?: boolean;              // Simulate update without applying
  keepOldFiles?: boolean;        // Keep old files in .old directory
}
```

**Update Result:**
```typescript
interface UpdateResult {
  success: boolean;
  addonId: string;
  previousVersion: string;
  newVersion: string;
  duration: number;
  backupId?: string;             // ID of backup created before update
  changes: string[];             // List of changes made
  warnings?: string[];           // Any warnings during update
  error?: string;                // Error message if failed
}
```

#### 1.2: Version Detection & Comparison

**Implementation:**
- Read version from `package.json` in deployed addon directory
- Compare with bundled version in CLI/Electron packages
- Support semantic versioning comparison (major.minor.patch)

**Version Storage in Registry:**
```typescript
// Add to addon registry entry
interface AddonRegistryEntry {
  // ... existing fields
  version: string;               // Current installed version
  lastUpdated: Date;             // Last update timestamp
  updateHistory: UpdateHistoryEntry[];
}

interface UpdateHistoryEntry {
  timestamp: Date;
  fromVersion: string;
  toVersion: string;
  success: boolean;
  backupId?: string;
  duration: number;
}
```

#### 1.3: Update Process Steps

**Step-by-step update flow:**

1. **Pre-Update Validation**
   - Check addon exists in registry
   - Verify SSH connection (for remote)
   - Check service is running
   - Verify sufficient disk space
   - Check for file conflicts
   - Validate target version exists

2. **Create Backup**
   - Stop service temporarily
   - Create timestamped backup of addon directory
   - Store backup metadata (version, timestamp, size)
   - Resume service before continuing

3. **Update Files**
   - Stop service
   - Rename old directory to `.old` (for quick rollback)
   - Copy new addon-server files to target directory
   - Preserve `node_modules` if dependencies haven't changed
   - Update `package.json` version
   - Sync service file if needed

4. **Reinstall Dependencies (if needed)**
   - Compare `package.json` dependencies
   - Run `npm install` only if dependencies changed
   - Use existing `node_modules` if compatible

5. **Update Configuration**
   - Preserve existing environment variables
   - Merge new environment variables if any
   - Update service file with new env vars
   - Reload systemd daemon

6. **Restart Service**
   - Start service with new code
   - Wait for service to be healthy
   - Verify service is responding

7. **Post-Update Verification**
   - Check service status
   - Verify addon responds to HTTP requests
   - Test manifest endpoint
   - Log update completion

8. **Update Registry**
   - Update version in registry
   - Add to update history
   - Store backup ID
   - Set lastUpdated timestamp

9. **Cleanup (Optional)**
   - Remove `.old` directory after verification period
   - Clean up old backups (keep last N backups)

#### 1.4: Rollback Implementation

**Rollback Scenarios:**
- Update fails during file copy → Use `.old` directory (fast rollback)
- Update fails after restart → Restore from backup
- User manually triggers rollback → Choose from backup history

**Rollback Process:**
```typescript
async rollbackUpdate(addonId: string, backupId?: string): Promise<void> {
  // 1. Stop current service
  // 2. If .old exists (recent update), restore from .old (fast)
  // 3. Otherwise, restore from backup archive
  // 4. Reinstall dependencies if needed
  // 5. Restore service file
  // 6. Start service
  // 7. Verify service is healthy
  // 8. Update registry (mark as rolled back)
}
```

#### 1.5: Error Handling & Recovery

**Edge Cases to Handle:**
- Network failure during file copy → Use transaction-like approach (tmp dir)
- Service fails to start after update → Automatic rollback
- Disk space runs out → Pre-check and fail early
- Concurrent updates → Lock mechanism (per-addon lock file)
- Partial update (some files copied, some failed) → Use staging directory
- SSH connection lost mid-update → Resume from last checkpoint

**Recovery Steps:**
- Automatic rollback on critical errors
- Manual rollback command for user-triggered recovery
- Backup retention for multiple rollback points
- Detailed logging for debugging

---

## Phase 2: CLI Update Command

### File: `packages/cli/src/commands/update.ts`

#### 2.1: Basic Update Command

```bash
# Update specific addon to latest version
stremio-addon update my-addon

# Update to specific version
stremio-addon update my-addon --version 1.2.0

# Update all addons
stremio-addon update --all

# Dry run (see what would be updated)
stremio-addon update my-addon --dry-run

# Force update (even if already on target version)
stremio-addon update my-addon --force

# Skip backup (NOT recommended)
stremio-addon update my-addon --skip-backup
```

#### 2.2: Check for Updates Command

```bash
# Check if updates are available for specific addon
stremio-addon check-updates my-addon

# Check updates for all addons
stremio-addon check-updates --all

# Output format: JSON
stremio-addon check-updates --all --json
```

**Output Example:**
```
Checking for updates...

Addon: my-addon
  Current version: 1.0.0
  Latest version:  1.2.3
  Update available: Yes
  Changes:
    - Fixed search capabilities for series
    - Improved torrent matching
    - Added caching improvements

Addon: another-addon
  Current version: 1.2.3
  Latest version:  1.2.3
  Update available: No
```

#### 2.3: Rollback Command

```bash
# Rollback to previous version (uses .old or latest backup)
stremio-addon rollback my-addon

# Rollback to specific backup
stremio-addon rollback my-addon --backup-id backup-20260121-143022

# List available backups for rollback
stremio-addon rollback my-addon --list-backups
```

#### 2.4: Update History Command

```bash
# View update history for addon
stremio-addon update-history my-addon

# View update history for all addons
stremio-addon update-history --all
```

**Output Example:**
```
Update History for my-addon:

2026-01-21 14:30:22
  1.0.0 → 1.2.3
  Duration: 45s
  Status: Success
  Backup: backup-20260121-143022

2026-01-15 09:15:10
  0.9.5 → 1.0.0
  Duration: 52s
  Status: Success
  Backup: backup-20260115-091510
```

---

## Phase 3: Electron UI Update Feature

### Files to Create/Modify:
- `packages/electron/src/renderer/components/UpdateAddon.tsx`
- `packages/electron/src/renderer/components/UpdateNotification.tsx`
- `packages/electron/src/renderer/components/UpdateHistory.tsx`
- `packages/electron/src/main/ipc-handlers/update.ts`

#### 3.1: Update UI Components

**Update Button in Addon List:**
- Show "Update Available" badge if update exists
- Click to open update dialog
- Show current version vs. latest version

**Update Dialog:**
```
┌─────────────────────────────────────────┐
│ Update Available: my-addon              │
├─────────────────────────────────────────┤
│ Current Version: 1.0.0                  │
│ Latest Version:  1.2.3                  │
│                                         │
│ Changes in 1.2.3:                       │
│ • Fixed search capabilities             │
│ • Improved episode matching             │
│ • Added caching improvements            │
│                                         │
│ ⚠️  Service will be restarted           │
│ ℹ️  Backup will be created              │
│                                         │
│ [ ] Advanced Options                    │
│   [ ] Skip backup (not recommended)     │
│   [ ] Keep old files (.old directory)   │
│                                         │
│ [Cancel]  [Update Now]                  │
└─────────────────────────────────────────┘
```

**Update Progress:**
```
Updating my-addon...

✓ Pre-update validation
✓ Creating backup
⏳ Copying new files... (2/5 MB)
  Installing dependencies...
  Restarting service...
  Verifying installation...

[Cancel Update]
```

**Update Complete:**
```
✓ Update Successful!

my-addon updated from 1.0.0 to 1.2.3

Service is running and healthy.

[View Update History]  [Close]
```

#### 3.2: Auto-Update Check

**Background update checking:**
- Check for updates on app startup
- Check periodically (every 24 hours)
- Show notification badge on sidebar
- Show notification popup for important updates

**Settings for auto-update:**
```
Update Settings:
  [x] Check for updates automatically
  [x] Notify me when updates are available
  [ ] Auto-install updates (not recommended)
  
  Check frequency: [Daily ▼]
  
  Update channel: [Stable ▼]
    - Stable (recommended)
    - Beta
    - Nightly
```

#### 3.3: Batch Update

**Update all addons at once:**
```
┌─────────────────────────────────────────┐
│ Update All Addons                       │
├─────────────────────────────────────────┤
│ 3 addons have updates available         │
│                                         │
│ ☑ my-addon (1.0.0 → 1.2.3)             │
│ ☑ another-addon (0.9.0 → 1.0.0)        │
│ ☑ third-addon (1.1.0 → 1.1.5)          │
│                                         │
│ Total time estimate: ~2-3 minutes       │
│                                         │
│ [Cancel]  [Update Selected]             │
└─────────────────────────────────────────┘
```

#### 3.4: Update History View

**Show update history in addon details:**
- Timeline view of updates
- Click to see details
- Option to rollback to previous version

---

## Phase 4: Version Management System

### 4.1: Version Tracking in Registry

**Update registry structure:**
```typescript
// packages/core/src/config/registry.ts
interface AddonRegistryEntry {
  // Existing fields...
  id: string;
  name: string;
  domain: string;
  port: number;
  
  // New version tracking fields
  version: string;                    // Current version (from package.json)
  installedAt: Date;                  // When first installed
  lastUpdated?: Date;                 // Last update timestamp
  updateHistory: UpdateHistoryEntry[];
  
  // Backup tracking
  backups: BackupEntry[];
  maxBackups: number;                 // Keep last N backups (default: 5)
}

interface UpdateHistoryEntry {
  timestamp: Date;
  fromVersion: string;
  toVersion: string;
  success: boolean;
  duration: number;
  backupId?: string;
  rollbackId?: string;               // If this was a rollback
  error?: string;                     // Error message if failed
}

interface BackupEntry {
  id: string;                         // backup-20260121-143022
  timestamp: Date;
  version: string;                    // Version at time of backup
  path: string;                       // Path to backup archive
  size: number;                       // Backup size in bytes
  type: 'pre-update' | 'manual' | 'scheduled';
}
```

### 4.2: Version in package.json

**Ensure addon-server has proper versioning:**
```json
// packages/addon-server/package.json
{
  "name": "@stremio-addon-manager/addon-server",
  "version": "1.2.3",
  "description": "Stremio addon server with Real-Debrid integration"
}
```

**Sync version across packages:**
- Use Lerna/Turborepo version command
- Update all packages together
- Include version in bundle

### 4.3: Changelog Management

**Track changes between versions:**
```
// CHANGELOG.md in addon-server package
## [1.2.3] - 2026-01-21
### Fixed
- Fixed episode matching regex patterns for series
- Improved torrent search capabilities
- Fixed cache key generation

### Added
- Better logging for episode matching

## [1.2.2] - 2026-01-15
### Fixed
- Fixed SSL certificate renewal
...
```

**Parse changelog for UI:**
- Show changes when update is available
- Include in update dialog
- Store in update history

---

## Phase 5: Backup & Rollback System

### 5.1: Automatic Backup Before Update

**Backup Strategy:**
```typescript
interface BackupOptions {
  addonId: string;
  type: 'pre-update' | 'manual' | 'scheduled';
  compression: 'gzip' | 'none';
  includeNodeModules: boolean;       // Usually false (reinstall deps instead)
}
```

**Backup Process:**
1. Stop service temporarily
2. Create tar.gz archive of addon directory (exclude node_modules)
3. Store in `/opt/stremio-addon-backups/{addonId}/`
4. Update registry with backup metadata
5. Resume service

**Backup Location:**
```
/opt/stremio-addon-backups/
  my-addon/
    backup-20260121-143022.tar.gz
    backup-20260115-091510.tar.gz
    backup-metadata.json
```

### 5.2: Backup Retention Policy

**Automatic cleanup:**
- Keep last N backups (default: 5)
- Delete oldest backups when limit reached
- Option to manually keep specific backups
- Never delete backups from failed updates

**Manual backup management:**
```bash
# Create manual backup
stremio-addon backup my-addon

# List backups
stremio-addon backup list my-addon

# Delete specific backup
stremio-addon backup delete backup-20260115-091510

# Restore from backup (alias for rollback)
stremio-addon backup restore my-addon --backup-id backup-20260121-143022
```

### 5.3: Fast Rollback with .old Directory

**Quick rollback mechanism:**
- When updating, rename old directory to `{addon-dir}.old`
- If update fails or user wants immediate rollback, restore from `.old`
- Keep `.old` for 24 hours after successful update
- Automatically clean up `.old` directories

**Directory structure during update:**
```
/opt/stremio-addon/my-addon/         # New version
/opt/stremio-addon/my-addon.old/     # Previous version (fast rollback)
/opt/stremio-addon-backups/my-addon/ # Compressed backups
```

---

## Phase 6: Testing & Validation

### 6.1: Test Scenarios

**Update scenarios:**
- [ ] Update from old version to latest
- [ ] Update with no dependency changes
- [ ] Update with dependency changes (npm install required)
- [ ] Update with environment variable changes
- [ ] Update with service file changes
- [ ] Update multiple addons sequentially
- [ ] Update multiple addons in parallel

**Failure scenarios:**
- [ ] Network failure during file copy
- [ ] Disk space runs out mid-update
- [ ] Service fails to start after update
- [ ] SSH connection lost during update
- [ ] Invalid target version specified
- [ ] Addon not found in registry
- [ ] Concurrent update attempts

**Rollback scenarios:**
- [ ] Rollback from .old directory (fast)
- [ ] Rollback from backup archive
- [ ] Rollback to specific previous version
- [ ] Rollback when .old doesn't exist
- [ ] Rollback with dependency changes

### 6.2: Integration Tests

**Test files to create:**
- `packages/core/src/installation/__tests__/update-manager.test.ts`
- `packages/cli/src/commands/__tests__/update.test.ts`
- `packages/electron/src/main/__tests__/update-ipc.test.ts`

**Test coverage:**
- Version comparison logic
- Update process (mocked file operations)
- Rollback process
- Backup creation and restoration
- Registry updates
- Error handling and recovery

---

## Phase 7: Documentation

### 7.1: User Documentation

**Files to create/update:**
- `docs/UPDATE_GUIDE.md` - How to update addons
- `docs/ROLLBACK_GUIDE.md` - How to rollback updates
- `docs/BACKUP_GUIDE.md` - Backup management
- `packages/cli/README.md` - Add update commands
- `packages/electron/README.md` - Add update UI documentation

### 7.2: Developer Documentation

**Files to create:**
- `docs/UPDATE_ARCHITECTURE.md` - How update system works
- `docs/VERSION_MANAGEMENT.md` - Versioning strategy
- `CHANGELOG.md` - Version changelog (root and addon-server)

---

## Implementation Plan - Priority Order

### Sprint 1: Core Infrastructure (Week 1)
- [x] Fix episode matching regex (COMPLETED - 2026-01-21)
- [ ] Create UpdateManager class skeleton
- [ ] Add version field to registry
- [ ] Implement version detection from package.json
- [ ] Add updateHistory to registry structure

### Sprint 2: Update Logic (Week 2)
- [ ] Implement update file copy logic
- [ ] Add backup creation before update
- [ ] Implement service restart after update
- [ ] Add registry update after successful update
- [ ] Handle dependency installation (npm install)

### Sprint 3: Rollback & Recovery (Week 3)
- [ ] Implement .old directory fast rollback
- [ ] Implement backup-based rollback
- [ ] Add automatic rollback on failure
- [ ] Test all rollback scenarios

### Sprint 4: CLI Commands (Week 4)
- [ ] Create `update.ts` command
- [ ] Create `check-updates.ts` command
- [ ] Create `rollback.ts` command
- [ ] Add update-history command
- [ ] Test CLI commands

### Sprint 5: Electron UI (Week 5)
- [ ] Create UpdateAddon component
- [ ] Add update notification system
- [ ] Create update progress UI
- [ ] Add update history view
- [ ] Implement IPC handlers

### Sprint 6: Polish & Testing (Week 6)
- [ ] Integration testing
- [ ] Error handling improvements
- [ ] Performance optimization
- [ ] Documentation
- [ ] User acceptance testing

---

## Files to Create

### Core Package
- [ ] `packages/core/src/installation/update-manager.ts`
- [ ] `packages/core/src/installation/update-types.ts`
- [ ] `packages/core/src/installation/__tests__/update-manager.test.ts`

### CLI Package
- [ ] `packages/cli/src/commands/update.ts`
- [ ] `packages/cli/src/commands/check-updates.ts`
- [ ] `packages/cli/src/commands/rollback.ts`
- [ ] `packages/cli/src/commands/__tests__/update.test.ts`

### Electron Package
- [ ] `packages/electron/src/renderer/components/UpdateAddon.tsx`
- [ ] `packages/electron/src/renderer/components/UpdateNotification.tsx`
- [ ] `packages/electron/src/renderer/components/UpdateHistory.tsx`
- [ ] `packages/electron/src/renderer/components/UpdateProgress.tsx`
- [ ] `packages/electron/src/main/ipc-handlers/update.ts`
- [ ] `packages/electron/src/main/__tests__/update-ipc.test.ts`

### Documentation
- [ ] `docs/UPDATE_GUIDE.md`
- [ ] `docs/ROLLBACK_GUIDE.md`
- [ ] `docs/BACKUP_GUIDE.md`
- [ ] `docs/UPDATE_ARCHITECTURE.md`
- [ ] `docs/VERSION_MANAGEMENT.md`
- [ ] `CHANGELOG.md` (root)
- [ ] `packages/addon-server/CHANGELOG.md`

---

## Files to Modify

### Core Package
- [ ] `packages/core/src/config/types.ts` - Add version tracking types
- [ ] `packages/core/src/config/registry.ts` - Add updateHistory and backups
- [ ] `packages/core/src/installation/types.ts` - Add UpdateResult, UpdateOptions
- [ ] `packages/core/src/installation/index.ts` - Export UpdateManager

### CLI Package
- [ ] `packages/cli/src/index.ts` - Register new commands
- [ ] `packages/cli/README.md` - Document update commands

### Electron Package
- [ ] `packages/electron/src/renderer/App.tsx` - Add update notification
- [ ] `packages/electron/src/renderer/components/AddonList.tsx` - Add update badge
- [ ] `packages/electron/src/main/index.ts` - Register update IPC handlers
- [ ] `packages/electron/README.md` - Document update UI

### Addon Server Package
- [ ] `packages/addon-server/package.json` - Ensure version is set
- [ ] `packages/addon-server/CHANGELOG.md` - Track version changes

---

## Configuration Options

### Environment Variables
```bash
# Update configuration
STREMIO_ADDON_UPDATE_CHECK_INTERVAL=86400  # Check daily (seconds)
STREMIO_ADDON_UPDATE_CHANNEL=stable        # stable|beta|nightly
STREMIO_ADDON_MAX_BACKUPS=5                # Keep last 5 backups
STREMIO_ADDON_BACKUP_COMPRESSION=gzip      # gzip|none
STREMIO_ADDON_AUTO_CLEANUP_OLD=true        # Auto cleanup .old directories
```

### CLI Config
```json
// ~/.stremio-addon-manager/config.json
{
  "update": {
    "checkInterval": 86400,
    "channel": "stable",
    "autoCheck": true,
    "maxBackups": 5,
    "backupCompression": "gzip"
  }
}
```

---

## Success Criteria

### Functional Requirements
- ✅ Users can update deployed addons to latest version
- ✅ Users can update to specific versions
- ✅ Users can check for available updates
- ✅ Users can rollback failed updates
- ✅ System creates automatic backups before updates
- ✅ System handles update failures gracefully
- ✅ System preserves configuration during updates
- ✅ System works for both local and remote installations

### Non-Functional Requirements
- ✅ Update process completes in < 2 minutes (for typical addon)
- ✅ Rollback completes in < 30 seconds (using .old directory)
- ✅ Zero downtime for HTTP endpoints (nginx continues serving during update)
- ✅ Clear progress indicators and error messages
- ✅ Comprehensive logging for debugging
- ✅ Atomic operations (update fully succeeds or fully fails)

---

## Risk Assessment & Mitigation

### High Risk Areas
1. **Service downtime during update**
   - Mitigation: Use nginx as proxy, keep it running
   - Mitigation: Fast updates (< 2 minutes typical)
   - Mitigation: Update during low-traffic periods

2. **Data loss during failed update**
   - Mitigation: Automatic backup before update
   - Mitigation: Transaction-like update (stage in temp dir)
   - Mitigation: Keep .old directory for fast rollback

3. **SSH connection failure mid-update**
   - Mitigation: Resume capability (checkpoints)
   - Mitigation: Idempotent operations
   - Mitigation: Automatic rollback on critical failures

4. **Dependency conflicts after update**
   - Mitigation: Test in staging environment first
   - Mitigation: Lock file for reproducible installs
   - Mitigation: Rollback if npm install fails

### Medium Risk Areas
1. **Disk space issues**
   - Mitigation: Pre-check available disk space
   - Mitigation: Cleanup old backups automatically
   - Mitigation: Compress backups (gzip)

2. **Concurrent updates**
   - Mitigation: Lock file per addon
   - Mitigation: Queue updates if already in progress
   - Mitigation: UI shows "Update in progress" state

---

## Notes & Considerations

### Design Decisions
1. **Why .old directory AND backups?**
   - .old provides fast rollback (< 30s) for immediate failures
   - Backups provide long-term rollback capability (compressed, managed retention)
   - .old is temporary (cleaned after 24h), backups are permanent (with retention policy)

2. **Why not auto-update by default?**
   - Addons are production services (users want control)
   - Updates may introduce breaking changes
   - Users should review changes before applying
   - Option available for users who want auto-updates

3. **Why not use git pull for updates?**
   - Users may not have git on remote servers
   - Cleaner to use bundled packages (tested together)
   - Easier version management
   - Simpler rollback process

4. **Why stop service during update?**
   - Prevent file conflicts (process locking files)
   - Ensure clean state for new code
   - Minimize risk of partial updates
   - Fast restart (< 5 seconds typically)

### Future Enhancements
- [ ] Gradual rollout (canary deployments)
- [ ] A/B testing different versions
- [ ] Update scheduling (update at specific time)
- [ ] Update notifications via email/webhook
- [ ] Diff view for changed files
- [ ] Integration with CI/CD for auto-builds
- [ ] Multi-region update orchestration
- [ ] Health checks before marking update successful

