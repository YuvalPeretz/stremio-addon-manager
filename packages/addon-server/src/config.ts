/**
 * Addon Server Configuration
 * Reads from environment variables with defaults
 */

export interface ServerConfig {
  // Real-Debrid
  rdApiToken: string;
  rdApiBase: string;

  // Authentication
  addonPassword: string;
  authEnabled: boolean;

  // Server
  port: number;
  nodeEnv: string;
  domain?: string; // Addon domain (for manifest base URL)

  // Features
  torrentLimit: number;
  availabilityCheckLimit: number;
  maxStreams: number;
  maxConcurrency: number;

  // Cache TTL (in seconds)
  cacheTtl: {
    metadata: number;
    torrentSearch: number;
    streams: number;
  };

  // Rate Limiting
  rateLimits: {
    streamWindow: number; // milliseconds
    streamMax: number;
    statsWindow: number; // milliseconds
    statsMax: number;
  };
}

/**
 * Validate and clamp a numeric configuration value within specified bounds
 */
function validateConfigValue(
  value: number,
  min: number,
  max: number,
  name: string,
  defaultValue: number
): number {
  if (isNaN(value) || value < min || value > max) {
    console.warn(
      `⚠️  Invalid ${name} value: ${value}. Must be between ${min} and ${max}. Using default: ${defaultValue}`
    );
    return defaultValue;
  }
  return value;
}

/**
 * Parse integer from environment variable with validation
 */
function parseEnvInt(envVar: string | undefined, defaultValue: number, min: number, max: number, name: string): number {
  const value = envVar ? parseInt(envVar, 10) : defaultValue;
  return validateConfigValue(value, min, max, name, defaultValue);
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): ServerConfig {
  // Handle empty strings - treat them as missing tokens
  const rdApiTokenEnv = process.env.RD_API_TOKEN?.trim() || "";
  const rdApiToken = rdApiTokenEnv && rdApiTokenEnv.length > 0 ? rdApiTokenEnv : "YOUR_REAL_DEBRID_TOKEN_HERE";
  const addonPassword = process.env.ADDON_PASSWORD || "YOUR_ADDON_PASSWORD_HERE";
  const authEnabled = Boolean(addonPassword && addonPassword !== "YOUR_ADDON_PASSWORD_HERE");

  // Parse and validate torrent processing limits
  const torrentLimit = parseEnvInt(process.env.TORRENT_LIMIT, 15, 1, 50, "TORRENT_LIMIT");
  const availabilityCheckLimit = parseEnvInt(
    process.env.AVAILABILITY_CHECK_LIMIT,
    15,
    5,
    50,
    "AVAILABILITY_CHECK_LIMIT"
  );
  const maxStreams = parseEnvInt(process.env.MAX_STREAMS, 5, 1, 20, "MAX_STREAMS");
  const maxConcurrency = parseEnvInt(process.env.MAX_CONCURRENCY, 3, 1, 10, "MAX_CONCURRENCY");

  const config: ServerConfig = {
    // Real-Debrid
    rdApiToken,
    rdApiBase: "https://api.real-debrid.com/rest/1.0",

    // Authentication
    addonPassword,
    authEnabled,

    // Server
    port: parseInt(process.env.PORT || "7000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    domain: process.env.ADDON_DOMAIN, // Optional domain for manifest base URL

    // Features
    torrentLimit,
    availabilityCheckLimit,
    maxStreams,
    maxConcurrency,

    // Cache TTL (in seconds)
    cacheTtl: {
      metadata: 86400, // 24 hours
      torrentSearch: 21600, // 6 hours
      streams: 1800, // 30 minutes
    },

    // Rate Limiting
    rateLimits: {
      streamWindow: 15 * 60 * 1000, // 15 minutes
      streamMax: 50,
      statsWindow: 1 * 60 * 1000, // 1 minute
      statsMax: 120,
    },
  };

  // Log configuration on startup (hide sensitive values)
  console.log("\n📋 Addon Server Configuration:");
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Environment: ${config.nodeEnv}`);
  console.log(`  - Torrent Limit: ${config.torrentLimit}`);
  console.log(`  - Availability Check Limit: ${config.availabilityCheckLimit}`);
  console.log(`  - Max Streams: ${config.maxStreams}`);
  console.log(`  - Max Concurrency: ${config.maxConcurrency}`);
  const hasValidToken = config.rdApiToken && 
                       config.rdApiToken.trim().length > 0 && 
                       config.rdApiToken !== "YOUR_REAL_DEBRID_TOKEN_HERE";
  console.log(`  - Real-Debrid Token: ${hasValidToken ? "Configured ✓" : "Missing ✗"}`);
  console.log(`  - Authentication: ${config.authEnabled ? "Enabled 🔒" : "Disabled ⚠️"}\n`);

  return config;
}
