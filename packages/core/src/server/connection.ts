/**
 * Server Connection
 * Manages connections to Stremio addon servers
 */

import axios, { AxiosInstance } from "axios";
import { logger } from "../utils/logger.js";
import type { Result } from "../types/common.js";
import type { ServerConnectionConfig, ServerHealth, AddonManifest } from "./types.js";
import type { AddonManagerConfig } from "../config/types.js";

/**
 * Server Connection class
 */
export class ServerConnection {
  private config: ServerConnectionConfig;
  private client: AxiosInstance;
  private connected: boolean = false;

  constructor(config: ServerConnectionConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.url,
      timeout: config.timeout || 10000,
      headers: this.buildHeaders(),
    });
  }

  /**
   * Build request headers
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.auth) {
      if (this.config.auth.type === "basic" && this.config.auth.username && this.config.auth.password) {
        const credentials = Buffer.from(
          `${this.config.auth.username}:${this.config.auth.password}`
        ).toString("base64");
        headers["Authorization"] = `Basic ${credentials}`;
      } else if (this.config.auth.type === "token" && this.config.auth.token) {
        headers["Authorization"] = `Bearer ${this.config.auth.token}`;
      }
    }

    return headers;
  }

  /**
   * Test connection to server
   */
  public async testConnection(): Promise<Result<boolean>> {
    try {
      const response = await this.client.get("/manifest.json");
      const isValid = response.status === 200 && response.data && response.data.id;
      
      return {
        success: true,
        data: isValid,
      };
    } catch (error) {
      logger.error("Connection test failed", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Connect to server
   */
  public async connect(): Promise<Result<void>> {
    try {
      // Test the connection
      const testResult = await this.testConnection();
      
      if (!testResult.success || !testResult.data) {
        return {
          success: false,
          error: new Error("Failed to connect to server"),
        };
      }

      this.connected = true;
      logger.info(`Connected to server: ${this.config.url}`);
      
      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      logger.error("Connection failed", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Disconnect from server
   */
  public async disconnect(): Promise<void> {
    this.connected = false;
    logger.info(`Disconnected from server: ${this.config.url}`);
  }

  /**
   * Get server health status
   */
  public async getHealth(): Promise<Result<ServerHealth>> {
    try {
      // Try to get health endpoint (if available)
      try {
        const response = await this.client.get("/health");
        if (response.status === 200 && response.data) {
        return {
          success: true,
          data: response.data as ServerHealth,
        };
        }
      } catch {
        // Health endpoint not available, use basic check
      }

      // Fallback: Basic health check via manifest
      const manifestResponse = await this.client.get("/manifest.json");
      
      if (manifestResponse.status === 200) {
        return {
          success: true,
          data: {
            status: "healthy",
          },
        };
      }

      return {
        success: true,
        data: {
          status: "unhealthy",
        },
      };
    } catch (error) {
      logger.error("Health check failed", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Get server manifest
   */
  public async getManifest(): Promise<Result<AddonManifest>> {
    try {
      const response = await this.client.get<AddonManifest>("/manifest.json");
      
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      logger.error("Failed to get manifest", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Get server configuration (if accessible)
   * Note: This assumes the server has a config endpoint
   */
  public async getConfiguration(): Promise<Result<AddonManagerConfig>> {
    try {
      const response = await this.client.get<AddonManagerConfig>("/api/config");
      
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      logger.error("Failed to get configuration", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Get server logs (if accessible)
   */
  public async getLogs(lines = 100): Promise<Result<string>> {
    try {
      const response = await this.client.get<string>("/api/logs", {
        params: { lines },
      });
      
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      logger.error("Failed to get logs", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Check if server requires authentication
   */
  public async requiresAuth(): Promise<boolean> {
    try {
      // Try to access manifest without auth
      const response = await axios.get(`${this.config.url}/manifest.json`, {
        timeout: 3000,
        validateStatus: (status) => status === 200 || status === 401 || status === 403,
      });

      return response.status === 401 || response.status === 403;
    } catch {
      return false;
    }
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get connection URL
   */
  public getUrl(): string {
    return this.config.url;
  }

  /**
   * Update connection config
   */
  public updateConfig(config: Partial<ServerConnectionConfig>): void {
    this.config = { ...this.config, ...config };
    this.client = axios.create({
      baseURL: this.config.url,
      timeout: this.config.timeout || 10000,
      headers: this.buildHeaders(),
    });
  }
}

