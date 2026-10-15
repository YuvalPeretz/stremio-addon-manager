/**
 * Server Connection
 * Manages connections to Stremio addon servers
 */

import axios, { AxiosInstance } from "axios";
import { logger } from "../utils/logger.js";
import { joinBaseUrl, normalizeBaseUrl } from "../utils/url.js";
import type { Result } from "../types/common.js";
import type { ServerConnectionConfig, ServerHealth, AddonManifest } from "./types.js";
import type { AddonManagerConfig } from "../config/types.js";

/**
 * Map addon-server / Gateway health JSON onto ServerHealth.
 * Addon-server returns `{ status: "ok" }`; ServerHealth uses `"healthy"`.
 */
export function normalizeHealthPayload(data: unknown): ServerHealth | null {
  if (data === null || data === undefined) {
    return null;
  }

  const obj =
    typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;

  const rawStatus =
    obj && typeof obj.status === "string" ? obj.status.trim().toLowerCase() : "";

  let status: ServerHealth["status"];
  if (
    rawStatus === "unhealthy" ||
    rawStatus === "error" ||
    rawStatus === "down" ||
    rawStatus === "fail" ||
    rawStatus === "failed"
  ) {
    status = "unhealthy";
  } else if (rawStatus === "degraded" || rawStatus === "warn" || rawStatus === "warning") {
    status = "degraded";
  } else {
    // "ok", "healthy", "online", or any other successful /health payload
    status = "healthy";
  }

  const uptime = obj && typeof obj.uptime === "number" ? obj.uptime : undefined;
  const errors =
    obj && Array.isArray(obj.errors)
      ? obj.errors.filter((e): e is string => typeof e === "string")
      : undefined;

  return {
    status,
    uptime,
    ...(errors && errors.length > 0 ? { errors } : {}),
  };
}

function relativeHealthPath(healthPath?: string): string {
  const raw = (healthPath || "health").trim();
  return raw.replace(/^\/+/, "") || "health";
}

function formatHealthError(error: unknown, attemptedUrl: string): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const statusText = error.response?.statusText;
    if (status) {
      return new Error(
        `HTTP ${status}${statusText ? ` ${statusText}` : ""} from ${attemptedUrl}`
      );
    }
    if (error.code === "ECONNABORTED") {
      return new Error(`Timeout contacting ${attemptedUrl}`);
    }
    if (error.code) {
      return new Error(`${error.code} contacting ${attemptedUrl}`);
    }
    return new Error(`${error.message || "Request failed"} (${attemptedUrl})`);
  }
  if (error instanceof Error) {
    return new Error(`${error.message} (${attemptedUrl})`);
  }
  return new Error(`Health check failed (${attemptedUrl})`);
}

/**
 * Server Connection class
 */
export class ServerConnection {
  private config: ServerConnectionConfig;
  private client: AxiosInstance;
  private connected: boolean = false;

  constructor(config: ServerConnectionConfig) {
    this.config = {
      ...config,
      url: normalizeBaseUrl(config.url),
    };
    this.client = this.createClient();
  }

  /**
   * Axios baseURL with trailing slash so relative paths join under a Gateway prefix
   * (e.g. https://host/svc-xxx/ + manifest.json → …/svc-xxx/manifest.json).
   */
  private createClient(): AxiosInstance {
    return axios.create({
      baseURL: `${this.config.url}/`,
      timeout: this.config.timeout || 10000,
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
      // Relative path (no leading slash) preserves base path prefix under axios
      const response = await this.client.get("manifest.json");
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
   * Get server health status.
   * Probes `{base}/health` (or configured healthPath) under the path-prefixed baseURL,
   * then falls back to `{base}/manifest.json`. Maps addon-server `status: "ok"` → `"healthy"`.
   */
  public async getHealth(): Promise<Result<ServerHealth>> {
    const healthRel = relativeHealthPath(this.config.healthPath);
    const healthUrl = joinBaseUrl(this.config.url, healthRel);
    const manifestUrl = joinBaseUrl(this.config.url, "manifest.json");
    let lastError: Error | undefined;

    try {
      try {
        const response = await this.client.get(healthRel);
        if (response.status === 200 && response.data !== undefined && response.data !== null) {
          const normalized = normalizeHealthPayload(response.data);
          if (normalized) {
            return {
              success: true,
              data: normalized,
            };
          }
        }
        lastError = new Error(
          `Unexpected health payload (HTTP ${response.status}) from ${healthUrl}`
        );
      } catch (error) {
        lastError = formatHealthError(error, healthUrl);
        // Health endpoint not available / failed — try manifest fallback
      }

      // Fallback: unauthenticated manifest (may 404 when password is required)
      try {
        const manifestResponse = await this.client.get("manifest.json");
        if (manifestResponse.status === 200) {
          return {
            success: true,
            data: {
              status: "healthy",
            },
          };
        }
        lastError = new Error(`HTTP ${manifestResponse.status} from ${manifestUrl}`);
      } catch (error) {
        lastError = formatHealthError(error, manifestUrl);
      }

      return {
        success: true,
        data: {
          status: "unhealthy",
          errors: [lastError?.message || `Unhealthy: ${healthUrl}`],
        },
      };
    } catch (error) {
      logger.error("Health check failed", error);
      const wrapped = lastError || formatHealthError(error, healthUrl);
      return {
        success: false,
        error: wrapped,
      };
    }
  }

  /**
   * Get server manifest
   */
  public async getManifest(): Promise<Result<AddonManifest>> {
    try {
      const response = await this.client.get<AddonManifest>("manifest.json");
      
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
      const response = await this.client.get<AddonManagerConfig>("api/config");
      
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
      const response = await this.client.get<string>("api/logs", {
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
      // Try to access manifest without auth — join under base (path prefix safe)
      const response = await axios.get(joinBaseUrl(this.config.url, "manifest.json"), {
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
    this.config = {
      ...this.config,
      ...config,
      url: config.url !== undefined ? normalizeBaseUrl(config.url) : this.config.url,
    };
    this.client = this.createClient();
  }
}
