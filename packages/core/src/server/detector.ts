/**
 * Server Detector
 * Detects and verifies Stremio addon servers
 */

import axios from "axios";
import { logger } from "../utils/logger.js";
import type { ServerInfo, AddonManifest, ServerDetectionResult } from "./types.js";

/**
 * Common ports to scan for local servers
 */
const COMMON_PORTS = [3000, 7000, 8080, 8000, 3001, 3002, 3003, 3004, 3005];

/**
 * Server Detector class
 */
export class ServerDetector {
  /**
   * Detect server on specific URL
   */
  public static async detectServer(url: string): Promise<ServerDetectionResult> {
    try {
      const startTime = Date.now();

      // Clean up URL
      const cleanUrl = url.replace(/\/+$/, ""); // Remove trailing slashes

      // Try to get manifest
      const manifest = await this.getManifest(cleanUrl);

      if (!manifest) {
        return {
          success: false,
          error: new Error("No valid Stremio manifest found"),
        };
      }

      const responseTime = Date.now() - startTime;
      const urlObj = new URL(cleanUrl);

      const serverInfo: ServerInfo = {
        url: cleanUrl,
        port: parseInt(urlObj.port) || (urlObj.protocol === "https:" ? 443 : 80),
        protocol: urlObj.protocol === "https:" ? "https" : "http",
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        manifest,
        status: "online",
        responseTime,
      };

      logger.info(`Server detected: ${serverInfo.name} at ${serverInfo.url}`);

      return {
        success: true,
        data: serverInfo,
      };
    } catch (error) {
      logger.error("Server detection failed", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Scan localhost for addon servers on common ports
   */
  public static async detectLocalServers(): Promise<ServerInfo[]> {
    logger.info("Scanning localhost for addon servers...");

    const servers: ServerInfo[] = [];
    const promises = COMMON_PORTS.map((port) => this.detectServer(`http://localhost:${port}`));

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.success && result.value.data) {
        servers.push(result.value.data);
      }
    }

    logger.info(`Found ${servers.length} local server(s)`);
    return servers;
  }

  /**
   * Scan local network for addon servers
   * Note: This requires network scanning permissions and may be slow
   */
  public static async scanNetwork(_ipRange?: string): Promise<ServerInfo[]> {
    logger.info("Network scanning not yet implemented");
    // TODO: Implement network scanning
    // This would require:
    // 1. Get local IP range
    // 2. Scan IPs in parallel (with rate limiting)
    // 3. Check common ports on each IP
    return [];
  }

  /**
   * Verify if a server is a valid Stremio addon
   */
  public static async verifyStremioAddon(url: string): Promise<boolean> {
    try {
      const manifest = await this.getManifest(url);
      return manifest !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get addon manifest from server
   */
  public static async getManifest(url: string): Promise<AddonManifest | null> {
    try {
      const cleanUrl = url.replace(/\/+$/, "");
      const manifestUrl = `${cleanUrl}/manifest.json`;

      logger.debug(`Fetching manifest from ${manifestUrl}`);

      const response = await axios.get<AddonManifest>(manifestUrl, {
        timeout: 5000,
        validateStatus: (status) => status === 200,
      });

      const manifest = response.data;

      // Validate required fields
      if (!manifest.id || !manifest.name || !manifest.version || !manifest.resources || !manifest.types) {
        logger.warn("Invalid manifest structure", manifest);
        return null;
      }

      // Check if it has at least one valid resource
      const validResources = ["catalog", "stream", "meta", "subtitles"];
      const hasValidResource = manifest.resources.some((resource) => validResources.includes(resource));

      if (!hasValidResource) {
        logger.warn("Manifest has no valid resources", manifest);
        return null;
      }

      logger.debug(`Valid manifest found: ${manifest.name} v${manifest.version}`);
      return manifest;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNREFUSED") {
          logger.debug(`No server running at ${url}`);
        } else if (error.response?.status === 404) {
          logger.debug(`No manifest found at ${url}`);
        } else {
          logger.debug(`Failed to fetch manifest from ${url}: ${error.message}`);
        }
      }
      return null;
    }
  }

  /**
   * Test if server is reachable
   */
  public static async testConnection(url: string, timeout = 3000): Promise<boolean> {
    try {
      const cleanUrl = url.replace(/\/+$/, "");
      await axios.get(cleanUrl, {
        timeout,
        validateStatus: () => true, // Accept any status
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get server response time
   */
  public static async getResponseTime(url: string): Promise<number | null> {
    try {
      const startTime = Date.now();
      await axios.get(url, { timeout: 5000 });
      return Date.now() - startTime;
    } catch {
      return null;
    }
  }
}
