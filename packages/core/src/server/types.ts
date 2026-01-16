/**
 * Server Module Types
 */

import type { Result } from "../types/common.js";

/**
 * Server information
 */
export interface ServerInfo {
  url: string;
  port: number;
  protocol: "http" | "https";
  name?: string;
  version?: string;
  description?: string;
  manifest?: AddonManifest;
  status: "online" | "offline" | "unreachable";
  responseTime?: number;
}

/**
 * Stremio Addon Manifest
 */
export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  logo?: string;
  background?: string;
  types: string[];
  catalogs?: Catalog[];
  resources: string[];
  idPrefixes?: string[];
  behaviorHints?: {
    adult?: boolean;
    p2p?: boolean;
  };
}

export interface Catalog {
  type: string;
  id: string;
  name?: string;
  extra?: Extra[];
}

export interface Extra {
  name: string;
  isRequired?: boolean;
  options?: string[];
  optionsLimit?: number;
}

/**
 * Server connection configuration
 */
export interface ServerConnectionConfig {
  url: string;
  auth?: {
    type: "basic" | "token" | "ssh";
    username?: string;
    password?: string;
    token?: string;
    sshKey?: string;
  };
  timeout?: number;
  retries?: number;
}

/**
 * Server health status
 */
export interface ServerHealth {
  status: "healthy" | "degraded" | "unhealthy";
  uptime?: number;
  memoryUsage?: {
    used: number;
    total: number;
  };
  cpuUsage?: number;
  activeConnections?: number;
  errors?: string[];
}

/**
 * Connection profile
 */
export interface ConnectionProfile {
  id: string;
  name: string;
  url: string;
  type: "local" | "remote";
  auth?: {
    type: "basic" | "token" | "ssh";
    username?: string;
    encryptedPassword?: string;
    encryptedToken?: string;
    sshKeyPath?: string;
  };
  lastConnected?: Date;
  createdAt: Date;
  favorite?: boolean;
  tags?: string[];
  metadata?: {
    version?: string;
    addonName?: string;
    description?: string;
  };
}

/**
 * Server statistics
 */
export interface ServerStats {
  totalRequests: number;
  requestsPerMinute: number;
  averageResponseTime: number;
  activeStreams: number;
  cacheHitRate?: number;
  errors: {
    total: number;
    recent: Array<{
      timestamp: Date;
      message: string;
      level: "warn" | "error";
    }>;
  };
}

/**
 * Server detection result
 */
export type ServerDetectionResult = Result<ServerInfo>;
