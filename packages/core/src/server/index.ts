/**
 * Server Module
 * Connection and detection for Stremio addon servers
 */

export { ServerDetector } from "./detector.js";
export { ServerConnection } from "./connection.js";
export { ConnectionProfileManager } from "./profile.js";

export type {
  ServerInfo,
  AddonManifest,
  Catalog,
  Extra,
  ServerConnectionConfig,
  ServerHealth,
  ConnectionProfile,
  ServerStats,
  ServerDetectionResult,
} from "./types.js";

