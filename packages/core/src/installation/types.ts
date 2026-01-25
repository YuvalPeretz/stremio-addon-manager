/**
 * Installation Module Types
 */

import type { AddonManagerConfig } from '../config/types.js';

/**
 * Installation step
 */
export enum InstallationStep {
  CONNECT = 'connect',
  DETECT_OS = 'detect_os',
  CHECK_PREREQUISITES = 'check_prerequisites',
  INSTALL_PREREQUISITES = 'install_prerequisites',
  SETUP_FIREWALL = 'setup_firewall',
  SETUP_FAIL2BAN = 'setup_fail2ban',
  CLONE_REPOSITORY = 'clone_repository', // NOTE: Now copies from bundled packages, not GitHub
  INSTALL_DEPENDENCIES = 'install_dependencies',
  SETUP_NGINX = 'setup_nginx',
  SETUP_SSL = 'setup_ssl',
  CREATE_SERVICE = 'create_service',
  START_SERVICE = 'start_service',
  CONFIGURE_DUCKDNS = 'configure_duckdns',
  CREATE_BACKUP = 'create_backup',
  VERIFY_INSTALLATION = 'verify_installation',
  CLEANUP = 'cleanup',
  COMPLETE = 'complete',
}

/**
 * Installation step status
 */
export enum StepStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

/**
 * Installation progress
 */
export interface InstallationProgress {
  step: InstallationStep;
  status: StepStatus;
  message: string;
  progress: number; // 0-100
  error?: Error;
  timestamp: Date;
}

/**
 * Prerequisite check result
 */
export interface PrerequisiteCheck {
  name: string;
  required: boolean;
  installed: boolean;
  version?: string;
  requiredVersion?: string;
  installCommand?: string;
}

/**
 * Installation result
 */
export interface InstallationResult {
  success: boolean;
  config: AddonManagerConfig;
  addonId?: string;
  addonUrl: string;
  installManifestUrl: string;
  steps: InstallationProgress[];
  error?: Error;
  duration: number; // milliseconds
}

/**
 * Progress callback
 */
export type ProgressCallback = (progress: InstallationProgress) => void;

/**
 * SSL Certificate information
 */
export interface CertificateInfo {
  domain: string;
  expiryDate: Date;
  certificatePath: string;
  privateKeyPath: string;
  isValid: boolean;
  daysUntilExpiry: number;
}

/**
 * Installation options
 */
export interface InstallationOptions {
  config: AddonManagerConfig;
  progressCallback?: ProgressCallback;
  skipSSL?: boolean;
  dryRun?: boolean;
  repoUrl?: string;
  repoBranch?: string;
}

