/**
 * Update Module Types
 */

/**
 * Update options
 */
export interface UpdateOptions {
  targetVersion?: string;        // Specific version to update to (default: latest)
  skipBackup?: boolean;          // Skip backup before update (NOT recommended)
  restartService?: boolean;      // Restart service after update (default: true)
  forceUpdate?: boolean;         // Force update even if already on target version
  dryRun?: boolean;              // Simulate update without applying
  keepOldFiles?: boolean;        // Keep old files in .old directory
  progressCallback?: UpdateProgressCallback;
}

/**
 * Update result
 */
export interface UpdateResult {
  success: boolean;
  addonId: string;
  previousVersion: string;
  newVersion: string;
  duration: number;              // milliseconds
  backupId?: string;             // ID of backup created before update
  changes: string[];             // List of changes made
  warnings?: string[];           // Any warnings during update
  error?: string;                // Error message if failed
  steps: UpdateProgress[];
}

/**
 * Update info (check for updates)
 */
export interface UpdateInfo {
  addonId: string;
  currentVersion: string;
  latestVersion: string;
  availableVersions: string[];
  updateAvailable: boolean;
  changes?: string[];            // Changelog entries
  releaseDate?: Date;
}

/**
 * Pre-update check result
 */
export interface PreUpdateCheck {
  addonExists: boolean;
  serviceRunning: boolean;
  sufficientDiskSpace: boolean;
  availableDiskSpaceMB: number;
  requiredDiskSpaceMB: number;
  sshConnected: boolean;
  canBackup: boolean;
  conflicts: string[];           // Any conflicts that would prevent update
  warnings: string[];            // Non-blocking warnings
}

/**
 * Update step
 */
export enum UpdateStep {
  VALIDATE = 'validate',
  CREATE_BACKUP = 'create_backup',
  STOP_SERVICE = 'stop_service',
  UPDATE_FILES = 'update_files',
  INSTALL_DEPENDENCIES = 'install_dependencies',
  UPDATE_CONFIG = 'update_config',
  RESTART_SERVICE = 'restart_service',
  VERIFY = 'verify',
  UPDATE_REGISTRY = 'update_registry',
  CLEANUP = 'cleanup',
  COMPLETE = 'complete',
}

/**
 * Update step status
 */
export enum UpdateStepStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

/**
 * Update progress
 */
export interface UpdateProgress {
  step: UpdateStep;
  status: UpdateStepStatus;
  message: string;
  progress: number; // 0-100
  error?: Error;
  timestamp: Date;
}

/**
 * Update progress callback
 */
export type UpdateProgressCallback = (progress: UpdateProgress) => void;

/**
 * Backup entry
 */
export interface BackupEntry {
  id: string;                         // backup-20260121-143022
  timestamp: Date;
  version: string;                    // Version at time of backup
  path: string;                       // Path to backup archive
  size: number;                       // Backup size in bytes
  type: 'pre-update' | 'manual' | 'scheduled';
}

/**
 * Update history entry
 */
export interface UpdateHistoryEntry {
  timestamp: Date;
  fromVersion: string;
  toVersion: string;
  success: boolean;
  duration: number;                   // milliseconds
  backupId?: string;
  rollbackId?: string;               // If this was a rollback
  error?: string;                     // Error message if failed
  initiatedBy?: 'user' | 'auto';     // Who initiated the update
}

/**
 * Rollback options
 */
export interface RollbackOptions {
  backupId?: string;                 // Specific backup to rollback to
  useFastRollback?: boolean;         // Use .old directory if available (default: true)
  restartService?: boolean;          // Restart service after rollback (default: true)
  progressCallback?: UpdateProgressCallback;
}

/**
 * Rollback result
 */
export interface RollbackResult {
  success: boolean;
  addonId: string;
  currentVersion: string;
  rolledBackToVersion: string;
  duration: number;                  // milliseconds
  method: 'fast' | 'backup';         // Which rollback method was used
  backupId?: string;
  error?: string;
  steps: UpdateProgress[];
}

/**
 * Backup options
 */
export interface BackupOptions {
  addonId: string;
  type: 'pre-update' | 'manual' | 'scheduled';
  compression: 'gzip' | 'none';
  includeNodeModules: boolean;       // Usually false (reinstall deps instead)
}

/**
 * Version comparison result
 */
export interface VersionComparison {
  current: string;
  target: string;
  isNewer: boolean;                  // Target is newer than current
  isSame: boolean;                   // Target is same as current
  isOlder: boolean;                  // Target is older than current
  difference: 'major' | 'minor' | 'patch' | 'none';
}

