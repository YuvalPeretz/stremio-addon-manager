/**
 * Service Module Types
 */

/**
 * Service status
 */
export enum ServiceStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  FAILED = "failed",
  UNKNOWN = "unknown",
}

/**
 * Service information
 */
export interface ServiceInfo {
  status: ServiceStatus;
  enabled: boolean;
  uptime?: string;
  memory?: string;
  cpu?: string;
  pid?: number;
}

/**
 * Service configuration
 */
export interface ServiceConfig {
  name: string;
  description: string;
  workingDirectory: string;
  execStart: string;
  user: string;
  environment: Record<string, string>;
  restart?: boolean;
  restartSec?: number;
}
