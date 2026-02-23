/**
 * Party Server Configuration
 */

export interface PartyConfig {
  port: number;
  maxSessions: number;
  maxViewersPerSession: number;
  sessionTimeoutMs: number;
  syncIntervalMs: number;
  wsHeartbeatMs: number;
  adminReconnectTimeoutMs: number;
  streamUrlMaxAgeMs: number;
}

export function loadConfig(): PartyConfig {
  const config: PartyConfig = {
    port: parseInt(process.env.PARTY_PORT || "7001", 10),
    maxSessions: parseInt(process.env.MAX_SESSIONS || "10", 10),
    maxViewersPerSession: parseInt(process.env.MAX_VIEWERS_PER_SESSION || "20", 10),
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || String(4 * 60 * 60 * 1000), 10),
    syncIntervalMs: parseInt(process.env.SYNC_INTERVAL_MS || "5000", 10),
    wsHeartbeatMs: parseInt(process.env.WS_HEARTBEAT_MS || "30000", 10),
    adminReconnectTimeoutMs: parseInt(process.env.ADMIN_RECONNECT_TIMEOUT_MS || String(5 * 60 * 1000), 10),
    streamUrlMaxAgeMs: parseInt(process.env.STREAM_URL_MAX_AGE_MS || String(2 * 60 * 60 * 1000), 10),
  };

  console.log("\n📋 Party Server Configuration:");
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Max Sessions: ${config.maxSessions}`);
  console.log(`  - Max Viewers/Session: ${config.maxViewersPerSession}`);
  console.log(`  - Session Timeout: ${config.sessionTimeoutMs / 1000 / 60} min`);
  console.log(`  - Sync Interval: ${config.syncIntervalMs}ms`);
  console.log(`  - WS Heartbeat: ${config.wsHeartbeatMs}ms`);
  console.log(`  - Admin Reconnect Timeout: ${config.adminReconnectTimeoutMs / 1000}s`);
  console.log(`  - Stream URL Max Age: ${config.streamUrlMaxAgeMs / 1000 / 60} min\n`);

  return config;
}
