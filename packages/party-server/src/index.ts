/**
 * Party Viewing Server - Entry Point
 */

import http from "node:http";
import { loadConfig } from "./config.js";
import { SessionManager } from "./session-manager.js";
import { SyncEngine } from "./sync-engine.js";
import { createServer } from "./server.js";

function start(): void {
  const config = loadConfig();

  console.log("\n🎬 Starting Party Viewing Server...\n");

  // Initialize components
  const sessionManager = new SessionManager(config);
  const syncEngine = new SyncEngine(config, sessionManager);

  // Create Express app
  const app = createServer(config, sessionManager, syncEngine);

  // Create HTTP server (needed for WebSocket upgrade)
  const httpServer = http.createServer(app);

  // Attach WebSocket server
  syncEngine.attach(httpServer);

  // Start session cleanup
  sessionManager.startCleanup();

  // Start listening
  httpServer.listen(config.port, () => {
    console.log(`\n✓ Party server running on port ${config.port}`);
    console.log(`\nEndpoints:`);
    console.log(`  - Health:     http://localhost:${config.port}/health`);
    console.log(`  - Sessions:   http://localhost:${config.port}/api/sessions`);
    console.log(`  - Validate:   POST http://localhost:${config.port}/api/validate-addon`);
    console.log(`  - Create:     POST http://localhost:${config.port}/api/sessions`);
    console.log(`  - Search:     GET  http://localhost:${config.port}/api/sessions/:id/search?q=...`);
    console.log(`  - Episodes:   GET  http://localhost:${config.port}/api/sessions/:id/episodes/:imdbId`);
    console.log(`  - Resolve:    POST http://localhost:${config.port}/api/sessions/:id/resolve`);
    console.log(`  - Subtitles:  GET  http://localhost:${config.port}/api/sessions/:id/subtitles`);
    console.log(`  - WebSocket:  ws://localhost:${config.port}/ws/:sessionId?token=...&name=...`);
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Party server ready! Press Ctrl+C to stop.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  });

  // Graceful shutdown
  const shutdown = (): void => {
    console.log("\n🛑 Shutting down party server...");
    syncEngine.shutdown();
    sessionManager.stopCleanup();
    httpServer.close(() => {
      console.log("✓ Party server stopped");
      process.exit(0);
    });

    // Force exit after 5 seconds if graceful shutdown fails
    setTimeout(() => {
      console.error("Force exiting...");
      process.exit(1);
    }, 5000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Error handlers - keep server alive
process.on("uncaughtException", (error) => {
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("UNCAUGHT EXCEPTION - Server continuing to run");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error(error);
});

process.on("unhandledRejection", (reason) => {
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("UNHANDLED REJECTION - Server continuing to run");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error(reason);
});

start();
