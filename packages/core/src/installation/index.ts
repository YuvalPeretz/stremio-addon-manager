/**
 * Installation Module - Automated Deployment and Setup
 */

export { InstallationManager } from "./manager.js";
export { UpdateManager } from "./update-manager.js";
export {
  CustomScriptInstaller,
  hashScriptContent,
  parseManagerSsh,
} from "./custom-script-installer.js";
export type {
  CustomScriptRunOptions,
  CustomScriptRunResult,
  CustomScriptAddonIdentity,
  StagedArtifacts,
  RemoteStagingPaths,
  ParsedManagerSsh,
} from "./custom-script-installer.js";
export {
  preflightBash,
  resolveBashPath,
  runBashScript,
  detectPythonInBash,
  createPython3ShimDir,
  runBashCommand,
  PYTHON_DOWNLOAD_URL,
  SSH_HELP_URL,
} from "./script-runner.js";
export type {
  BashPreflightResult,
  BashPreflightErrorCode,
  ScriptRunOptions,
  ScriptRunResult,
  PythonPreflightInfo,
  PythonResolvedAs,
  ToolPreflightInfo,
} from "./script-runner.js";
export {
  resolveBundledAddonServerPath,
  readBundledAddonServerVersion,
  resolveBundledProductPath,
  readBundledProductVersion,
} from "./bundled-paths.js";
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

