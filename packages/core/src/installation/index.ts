/**
 * Installation Module - Automated Deployment and Setup
 */

export { InstallationManager } from "./manager.js";
export { UpdateManager } from "./update-manager.js";
export type {
  InstallationOptions,
  InstallationResult,
  InstallationProgress,
  PrerequisiteCheck,
  ProgressCallback,
  CertificateInfo,
} from "./types.js";
export { InstallationStep, StepStatus } from "./types.js";
export type {
  UpdateOptions,
  UpdateResult,
  UpdateInfo,
  PreUpdateCheck,
  UpdateProgress,
  RollbackOptions,
  RollbackResult,
  BackupOptions,
  BackupEntry,
  UpdateHistoryEntry,
  VersionComparison,
} from "./update-types.js";
export { UpdateStep, UpdateStepStatus } from "./update-types.js";

