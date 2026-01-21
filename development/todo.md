# Installation Resume & Rollback - Comprehensive TODO

## Overview
Implement functionality to:
1. **Resume failed installations** without re-entering configuration
2. **Abort installations** at any point with automatic rollback
3. **Track system state changes** to enable proper cleanup/reversion

---

## Phase 1: Core Infrastructure (`@stremio-addon-manager/core`)

### 1.1 Installation State Management

#### State Persistence
- [ ] Create `InstallationStateManager` class
  - [ ] Save installation state to disk after each step
  - [ ] Store state in `~/.stremio-addon-manager/installations/{addonId}/state.json`
  - [ ] Include: completed steps, failed step, configuration, timestamp
  - [ ] Add state versioning for future compatibility
  
- [ ] Add state operations to `InstallationStateManager`
  - [ ] `saveState(addonId, state)` - Save current progress
  - [ ] `loadState(addonId)` - Load existing state
  - [ ] `deleteState(addonId)` - Remove state after completion/abort
  - [ ] `listPendingInstallations()` - Get all incomplete installations
  - [ ] `getStateStatus(addonId)` - Check if state exists and is valid

#### State Schema
- [ ] Define `InstallationState` interface
  ```typescript
  {
    addonId: string;
    status: 'in_progress' | 'failed' | 'aborted';
    config: AddonManagerConfig;
    completedSteps: InstallationStep[];
    currentStep: InstallationStep;
    failedStep?: { step: InstallationStep; error: string; timestamp: Date };
    startedAt: Date;
    lastUpdatedAt: Date;
    stateVersion: string;
  }
  ```

### 1.2 Change Tracking & Backup System

#### System State Tracking
- [ ] Create `SystemStateTracker` class
  - [ ] Track all changes made during installation
  - [ ] Store original state before modifications
  - [ ] Enable reversion of changes

- [ ] Implement change tracking for:
  - [ ] **Files Created**
    - Track: path, content hash, creation time
    - Actions: create, modify, delete
  - [ ] **Files Modified**
    - Backup original content before modification
    - Track: path, original content, new content
  - [ ] **System Services**
    - Track: service name, original state (enabled/disabled/non-existent)
    - Track: service file path, original content
  - [ ] **Firewall Rules**
    - Track: UFW rules added
    - Store original UFW status (enabled/disabled)
  - [ ] **fail2ban Configuration**
    - Track: config files modified
    - Backup original config
  - [ ] **Nginx Configuration**
    - Track: config files created/modified
    - Backup original nginx configs
    - Track: sites-enabled symlinks
  - [ ] **SSL Certificates**
    - Track: certificates obtained
    - Track: certbot configs
  - [ ] **Cron Jobs**
    - Track: cron jobs added
    - Backup original crontab
  - [ ] **Directories Created**
    - Track: `/opt/stremio-addon`, `/var/backups/stremio-addon`, etc.
    - Track: ownership and permissions

#### Change Tracking Schema
- [ ] Define `SystemChange` interface
  ```typescript
  {
    type: 'file_create' | 'file_modify' | 'file_delete' | 'service_create' | 
          'service_modify' | 'firewall_rule' | 'cron_job' | 'directory_create';
    target: string; // path, service name, etc.
    originalState?: any; // backup of original state
    newState?: any;
    timestamp: Date;
    reversible: boolean;
  }
  ```

- [ ] Create `ChangeLog` class
  - [ ] `recordChange(change: SystemChange)` - Record a change
  - [ ] `getChanges()` - Get all changes
  - [ ] `saveToFile(addonId)` - Persist changes to disk
  - [ ] `loadFromFile(addonId)` - Load changes from disk
  - [ ] Path: `~/.stremio-addon-manager/installations/{addonId}/changes.json`

### 1.3 Resume Installation Logic

#### InstallationManager Updates
- [ ] Modify `InstallationManager.install()` method
  - [ ] Check for existing state before starting
  - [ ] Load previous configuration if resuming
  - [ ] Skip completed steps
  - [ ] Start from failed step or next pending step
  - [ ] Update state after each step completion

- [ ] Add `InstallationManager.resume()` method
  - [ ] Load state from `InstallationStateManager`
  - [ ] Validate state is still valid (SSH still works, etc.)
  - [ ] Re-establish SSH connection if remote
  - [ ] Continue from last incomplete step
  - [ ] Handle edge cases (partially completed steps)

- [ ] Add step validation before execution
  - [ ] Check if step prerequisites are still met
  - [ ] Verify previous step results are still valid
  - [ ] Example: Check if Nginx is still running before SSL setup

- [ ] Implement idempotent steps
  - [ ] Make steps re-runnable without side effects
  - [ ] Check if step action already completed
  - [ ] Example: Don't reinstall Nginx if already installed

#### Step-Specific Resume Logic
- [ ] **CONNECT**: Re-test SSH connection
- [ ] **DETECT_OS**: Re-validate OS detection
- [ ] **CHECK_PREREQUISITES**: Re-check what's installed
- [ ] **INSTALL_PREREQUISITES**: Check what's already installed, skip those
- [ ] **SETUP_FIREWALL**: Check existing UFW rules, don't duplicate
- [ ] **SETUP_FAIL2BAN**: Check if already configured
- [ ] **CLONE_REPOSITORY**: Check if directory exists, verify contents
- [ ] **INSTALL_DEPENDENCIES**: Check if node_modules exists
- [ ] **SETUP_NGINX**: Check if config exists, validate it
- [ ] **SETUP_SSL**: Check for existing valid certificates
- [ ] **CREATE_SERVICE**: Check if service file exists
- [ ] **START_SERVICE**: Check if service is running
- [ ] **CONFIGURE_DUCKDNS**: Check if cron job exists
- [ ] **CREATE_BACKUP**: Skip if backup exists
- [ ] **VERIFY_INSTALLATION**: Re-run verification

### 1.4 Abort & Rollback Logic

#### InstallationManager Abort
- [ ] Add `InstallationManager.abort()` method
  - [ ] Stop current operation gracefully
  - [ ] Mark state as 'aborted'
  - [ ] Trigger rollback process

- [ ] Add `InstallationManager.rollback()` method
  - [ ] Load changes from `ChangeLog`
  - [ ] Reverse changes in reverse order (LIFO)
  - [ ] Handle errors during rollback gracefully
  - [ ] Log rollback progress
  - [ ] Report what was successfully rolled back

#### Rollback Actions by Change Type
- [ ] **file_create**: Delete created files
- [ ] **file_modify**: Restore original content from backup
- [ ] **file_delete**: Restore from backup (if available)
- [ ] **service_create**: Stop, disable, delete service file
- [ ] **service_modify**: Restore original service file
- [ ] **firewall_rule**: Remove added UFW rules, restore original state
- [ ] **cron_job**: Remove added cron entries, restore original crontab
- [ ] **directory_create**: Remove created directories (if safe to do so)
- [ ] **SSL certificates**: Revoke/delete certificates (optional)

#### Partial Rollback
- [ ] Implement configurable rollback depth
  - [ ] Full rollback: Remove everything
  - [ ] Partial rollback: Keep certain changes (e.g., installed packages)
  - [ ] Safe rollback: Only remove addon-specific changes

- [ ] Add rollback options
  - [ ] `keepPackages: boolean` - Keep installed system packages
  - [ ] `keepFirewallRules: boolean` - Keep firewall configuration
  - [ ] `keepSSL: boolean` - Keep SSL certificates
  - [ ] `removeDirectories: boolean` - Remove created directories

### 1.5 Error Handling & Recovery

#### Graceful Failure
- [ ] Wrap each step in try-catch with state save
- [ ] On error:
  - [ ] Save current state with error details
  - [ ] Save changelog up to failure point
  - [ ] Provide clear error message with resume instructions
  - [ ] Don't auto-cleanup on failure (allow resume)

#### Validation & Health Checks
- [ ] Add pre-resume validation
  - [ ] Check if SSH is still accessible (for remote)
  - [ ] Verify server hasn't changed (different IP, OS, etc.)
  - [ ] Check if partial installation is still in valid state
  - [ ] Warn if too much time has passed (state might be stale)

#### Cleanup Edge Cases
- [ ] Handle incomplete steps
  - [ ] Nginx config partially written
  - [ ] Service file created but daemon not reloaded
  - [ ] Files uploaded but not moved to final location
  - [ ] DNS updated but not propagated

---

## Phase 2: Configuration Manager (`@stremio-addon-manager/core`)

### 2.1 Installation Config Persistence

- [ ] Extend `ConfigManager` to handle installation state
  - [ ] Save partial configurations during installation
  - [ ] Load incomplete installations
  - [ ] Validate config is still usable for resume

- [ ] Add installation metadata to addon config
  ```typescript
  {
    installationMetadata?: {
      state: 'complete' | 'pending' | 'failed';
      lastAttempt: Date;
      attempts: number;
      canResume: boolean;
    }
  }
  ```

---

## Phase 3: Registry Manager (`@stremio-addon-manager/core`)

### 3.1 Registry State Tracking

- [ ] Don't register addon in registry until installation complete
- [ ] Add `pending` state to registry
  ```typescript
  {
    state: 'active' | 'pending' | 'failed';
    installationInProgress: boolean;
  }
  ```

- [ ] On abort/rollback:
  - [ ] Remove from registry if was added
  - [ ] Update state to 'failed' or remove entry

---

## Phase 4: Electron UI (`@stremio-addon-manager/electron`)

### 4.1 Installation Flow UI

#### Pending Installation Detection
- [ ] On app start, check for pending installations
  - [ ] Query `InstallationStateManager.listPendingInstallations()`
  - [ ] Show notification/badge if found

- [ ] Create "Resume Installation" UI
  - [ ] Show list of pending installations
  - [ ] Display: addon name, last step attempted, time ago, error (if any)
  - [ ] Options: Resume, View Details, Abort & Rollback, Ignore

#### Installation Progress UI Updates
- [ ] Add "Abort Installation" button
  - [ ] Position: Always visible during installation
  - [ ] Show confirmation dialog before abort
  - [ ] Explain what will be rolled back

- [ ] Show rollback progress
  - [ ] New progress bar for rollback
  - [ ] Show what's being undone
  - [ ] Display: "Reverting changes: Removing service file..."

- [ ] Resume flow
  - [ ] Pre-fill form with saved configuration
  - [ ] Show which steps are already complete (checkmarks)
  - [ ] Highlight where installation failed
  - [ ] Start from failed step

#### New Components
- [ ] `PendingInstallationsDialog.tsx`
  - [ ] List pending installations
  - [ ] Resume/Abort actions
  
- [ ] `ResumeInstallationPage.tsx`
  - [ ] Show pre-filled configuration
  - [ ] Display progress of previous attempt
  - [ ] Confirm to continue

- [ ] `RollbackProgress.tsx`
  - [ ] Show rollback steps
  - [ ] Progress bar for cleanup
  - [ ] List of changes being reverted

### 4.2 IPC Handlers

- [ ] Add IPC handlers in `main/index.ts`
  - [ ] `installation:listPending` - Get pending installations
  - [ ] `installation:getState` - Get state for specific addon
  - [ ] `installation:resume` - Resume installation
  - [ ] `installation:abort` - Abort current installation
  - [ ] `installation:rollback` - Rollback specific installation
  - [ ] `installation:deleteState` - Remove pending installation state

### 4.3 Atom State Management

- [ ] Create new atoms in `atoms/`
  - [ ] `pendingInstallationsAtom` - List of pending installations
  - [ ] `currentInstallationStateAtom` - Current installation resume state
  - [ ] `rollbackProgressAtom` - Rollback progress tracking

---

## Phase 5: CLI Package (`@stremio-addon-manager/cli`)

### 5.1 Resume Command

- [ ] Add `resume` command
  ```bash
  stremio-addon-manager resume [addonId]
  ```
  - [ ] If no addonId provided, list pending installations
  - [ ] Allow user to select which to resume
  - [ ] Show summary of what will be done
  - [ ] Confirm before proceeding

### 5.2 Abort/Rollback Command

- [ ] Add `rollback` command
  ```bash
  stremio-addon-manager rollback [addonId]
  ```
  - [ ] List what will be removed/reverted
  - [ ] Ask for confirmation
  - [ ] Show progress during rollback
  - [ ] Provide options for partial rollback

### 5.3 Install Command Updates

- [ ] Check for existing state before starting new installation
  - [ ] Warn if installation already in progress
  - [ ] Offer to resume instead
  - [ ] Allow force-restart with `--force` flag

- [ ] Add `--resume` flag to install command
  ```bash
  stremio-addon-manager install --resume
  ```

### 5.4 Status Command Updates

- [ ] Show pending installations in status output
  ```bash
  📦 Installed Addons: 2
  ⏸  Pending Installations: 1
     └─ my-addon (failed at SSL setup, 2 hours ago)
  ```

---

## Phase 6: Testing & Validation

### 6.1 Unit Tests

- [ ] `InstallationStateManager` tests
  - [ ] Save/load state
  - [ ] Handle corrupted state files
  - [ ] State versioning

- [ ] `SystemStateTracker` tests
  - [ ] Track various change types
  - [ ] Save/load change log
  - [ ] Verify backup creation

- [ ] `ChangeLog` tests
  - [ ] Record changes
  - [ ] Serialize/deserialize
  - [ ] Edge cases

### 6.2 Integration Tests

- [ ] Resume after each possible failure point
  - [ ] Fail at each step, verify resume works
  - [ ] Test SSH reconnection on resume
  - [ ] Test configuration reload

- [ ] Rollback tests
  - [ ] Abort at each step, verify cleanup
  - [ ] Test partial rollbacks
  - [ ] Verify original state restored

- [ ] Edge case tests
  - [ ] Multiple resume attempts
  - [ ] Resume after long time (hours/days)
  - [ ] Resume after system reboot
  - [ ] Resume after IP change
  - [ ] Concurrent installations
  - [ ] State file corruption

### 6.3 Manual Testing Scenarios

- [ ] Test on clean system
- [ ] Test on system with partial installation
- [ ] Test abort at various stages
- [ ] Test resume after network failure
- [ ] Test resume after user manually fixed issue
- [ ] Test rollback with various options
- [ ] Test UI for pending installations
- [ ] Test CLI commands

---

## Phase 7: Documentation

### 7.1 User Documentation

- [ ] Update README with resume/abort features
- [ ] Create troubleshooting guide
  - [ ] What to do if installation fails
  - [ ] How to resume
  - [ ] How to abort and start over
  - [ ] What gets rolled back

- [ ] Add examples
  ```bash
  # Resume a failed installation
  stremio-addon-manager resume my-addon
  
  # Abort and rollback
  stremio-addon-manager rollback my-addon
  ```

### 7.2 Developer Documentation

- [ ] Document state file formats
- [ ] Document change tracking system
- [ ] Document rollback logic
- [ ] Add inline code comments
- [ ] Create architecture diagram

### 7.3 UI Help Text

- [ ] Add tooltips explaining resume
- [ ] Add help text in abort confirmation
- [ ] Explain what rollback will do
- [ ] Provide recovery suggestions in error messages

---

## Phase 8: Migration & Backwards Compatibility

### 8.1 Handle Existing Installations

- [ ] Detect installations made with older version
- [ ] Provide migration path
- [ ] Warn if installation can't be resumed (no state saved)

### 8.2 State Version Management

- [ ] Add version to state files
- [ ] Handle state upgrades
- [ ] Deprecate old state formats gracefully

---

## Phase 9: Additional Improvements

### 9.1 User Experience

- [ ] Add progress percentage to resume
- [ ] Show estimated time remaining
- [ ] Better error messages with resume instructions
- [ ] Add "Retry failed step" option (don't start from beginning)

### 9.2 Safety Features

- [ ] Add state validation before resume
- [ ] Warn about stale states (>24 hours old)
- [ ] Require confirmation for destructive rollbacks
- [ ] Create safety backups before rollback

### 9.3 Performance

- [ ] Optimize state saves (don't write after every tiny change)
- [ ] Compress backup files
- [ ] Clean up old state files automatically

### 9.4 Advanced Features

- [ ] Export/import installation state (for debugging)
- [ ] Dry-run mode for rollback
- [ ] Partial resume (skip certain steps)
- [ ] Installation templates for retry with modifications

---

## Priority Levels

### P0 (Critical - Required for MVP)
- Phase 1.1: Installation State Management
- Phase 1.2: Basic Change Tracking (files, services)
- Phase 1.3: Resume Logic (basic)
- Phase 1.4: Abort & Rollback (basic)
- Phase 4.1: Basic Resume UI
- Phase 4.2: Basic IPC Handlers

### P1 (High - Important for usability)
- Phase 1.2: Complete Change Tracking (all types)
- Phase 1.4: Comprehensive Rollback
- Phase 1.5: Error Handling
- Phase 4.1: Complete UI
- Phase 5.1-5.2: CLI Resume/Rollback
- Phase 6.2: Integration Tests

### P2 (Medium - Nice to have)
- Phase 2: Config Manager Integration
- Phase 3: Registry State Tracking
- Phase 5.3-5.4: CLI Improvements
- Phase 7: Documentation
- Phase 9.1: UX Improvements

### P3 (Low - Future enhancements)
- Phase 6.1: Unit Tests
- Phase 6.3: Manual Test Scenarios
- Phase 8: Migration
- Phase 9.2-9.4: Advanced Features

---

## Implementation Notes

### File Locations
```
~/.stremio-addon-manager/
├── installations/
│   ├── {addonId}/
│   │   ├── state.json          # Installation state
│   │   ├── changes.json        # Change log
│   │   ├── backups/            # Original file backups
│   │   │   ├── nginx.conf.bak
│   │   │   ├── ufw-rules.bak
│   │   │   └── crontab.bak
│   │   └── logs/               # Installation logs
│   └── ...
```

### State Transitions
```
[Start] → [In Progress] → [Complete]
           ↓
        [Failed] → [Resume] → [In Progress]
           ↓
        [Abort] → [Rolling Back] → [Rolled Back]
```

### Error Recovery Strategy
1. **Transient Errors** (network, timeout): Auto-save state, suggest resume
2. **Configuration Errors**: Save state, let user fix config, resume
3. **Fatal Errors**: Save state, perform safe rollback, guide user

---

## Success Criteria

- [ ] User can resume any failed installation without re-entering data
- [ ] User can abort at any step with full rollback
- [ ] System tracks all changes and can revert them
- [ ] Resume works after days/weeks (if system unchanged)
- [ ] Rollback leaves system in clean state
- [ ] Clear UI feedback on what will be resumed/rolled back
- [ ] CLI and Electron UI both support resume/rollback
- [ ] Comprehensive error messages guide users
- [ ] No data loss on abort/resume
- [ ] Production-ready error handling

---

## Estimated Effort

- Phase 1 (Core): **3-4 weeks**
- Phase 2-3 (Config/Registry): **3-4 days**
- Phase 4 (Electron UI): **1-2 weeks**
- Phase 5 (CLI): **3-5 days**
- Phase 6 (Testing): **1-2 weeks**
- Phase 7 (Documentation): **3-5 days**
- Phase 8-9 (Extras): **1 week**

**Total: 8-10 weeks for complete implementation**

**MVP (P0 only): 4-5 weeks**

