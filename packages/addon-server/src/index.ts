/**
 * Stremio Addon Server
 * Main entry point
 */

import { loadConfig } from "./config.js";
import { RealDebridClient } from "./real-debrid.js";
import { CacheManager } from "./cache.js";
import { createServer } from "./server.js";

/**
 * Start the addon server
 */
function startServer(): void {
  // Load configuration
  const config = loadConfig();

  console.log("\n🚀 Starting Stremio Addon Server...\n");
  console.log("Configuration:");
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Environment: ${config.nodeEnv}`);
  console.log(`  - Torrent Limit: ${config.torrentLimit} (from TORRENT_LIMIT env var)`);
  console.log(`  - Authentication: ${config.authEnabled ? "Enabled 🔒" : "Disabled ⚠️"}`);
  const hasValidToken = config.rdApiToken && 
                       config.rdApiToken.trim().length > 0 && 
                       config.rdApiToken !== "YOUR_REAL_DEBRID_TOKEN_HERE";
  console.log(`  - Real-Debrid Token: ${hasValidToken ? "Configured ✓" : "Missing ✗"}`);
  console.log("\nCache Configuration:");
  console.log(`  - Metadata: ${config.cacheTtl.metadata}s (24h)`);
  console.log(`  - Torrent Search: ${config.cacheTtl.torrentSearch}s (6h)`);
  console.log(`  - Streams: ${config.cacheTtl.streams}s (30m)`);
  console.log("\nRate Limiting:");
  console.log(`  - Streams: ${config.rateLimits.streamMax} requests per ${config.rateLimits.streamWindow / 60000} minutes`);
  console.log(`  - Stats: ${config.rateLimits.statsMax} requests per ${config.rateLimits.statsWindow / 60000} minute`);

  // Initialize components
  const rdClient = new RealDebridClient(config);
  const cacheManager = new CacheManager(config);

  // Create Express server
  const app = createServer(config, rdClient, cacheManager);

  // Log cache stats every 10 minutes
  setInterval(() => {
    cacheManager.logStats();
  }, 600000);

  // Start listening
  app.listen(config.port, () => {
    console.log(`\n✓ Server running on port ${config.port}`);
    console.log(`\nEndpoints:`);
    console.log(`  - Landing: http://localhost:${config.port}/`);
    console.log(`  - Stats: http://localhost:${config.port}/stats`);

    if (config.authEnabled) {
      console.log(`\n🔐 Protected endpoints:`);
      console.log(`  - Manifest: /:password/manifest.json`);
      console.log(`  - Streams: /:password/stream/:type/:id.json`);
      console.log(`\n📖 Install URL format: https://yourdomain.com/${config.addonPassword}/manifest.json`);
      console.log(`   Stremio will use this password in all subsequent requests automatically`);
    } else {
      console.log(`\n⚠️  Warning: Authentication is disabled!`);
      console.log(`   Set ADDON_PASSWORD environment variable to enable authentication`);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Server ready! Press Ctrl+C to stop.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  });
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
  process.exit(1);
});

// Start the server
startServer();

