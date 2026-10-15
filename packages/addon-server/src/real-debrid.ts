/**
 * Real-Debrid API Client
 */

import axios, { type AxiosRequestConfig } from "axios";
import type { RealDebridAddMagnetResponse, RealDebridTorrentInfo, RealDebridUnrestrictResponse } from "./types.js";
import type { ServerConfig } from "./config.js";

export class RealDebridClient {
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  /**
   * Make a Real-Debrid API call
   */
  private async apiCall<T>(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    data: Record<string, string> | null = null
  ): Promise<T> {
    const maxAttempts = 4; // 3 retries on 429

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const config: AxiosRequestConfig = {
          method,
          url: `${this.config.rdApiBase}${endpoint}`,
          headers: {
            Authorization: `Bearer ${this.config.rdApiToken}`,
          },
        };

        if (data) {
          if (method === "POST") {
            config.data = new URLSearchParams(data);
            config.headers!["Content-Type"] = "application/x-www-form-urlencoded";
          } else {
            config.params = data;
          }
        }

        const response = await axios(config);
        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;

          if (status === 429 && attempt < maxAttempts - 1) {
            const delayMs = Math.min(2000 * Math.pow(2, attempt), 10000); // 2s, 4s, 8s
            console.warn(`RD rate-limited (429), retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxAttempts})...`);
            await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
            continue;
          }

          const rdMessage = (error.response?.data as { error?: string })?.error ?? error.message;
          if (status !== 451) {
            console.error(`RD API Error [${status}]: ${rdMessage}`);
          }
          const clean = new Error(rdMessage) as Error & { rdStatus?: number };
          clean.rdStatus = status;
          throw clean;
        }
        throw error;
      }
    }

    // Unreachable — the loop always returns or throws on the final attempt
    throw new Error("RD API: exhausted retries");
  }

  /**
   * Add magnet to Real-Debrid
   */
  async addMagnet(magnetLink: string): Promise<RealDebridAddMagnetResponse> {
    return await this.apiCall<RealDebridAddMagnetResponse>("/torrents/addMagnet", "POST", {
      magnet: magnetLink,
    });
  }

  /**
   * Get torrent info
   */
  async getTorrentInfo(torrentId: string): Promise<RealDebridTorrentInfo> {
    return await this.apiCall<RealDebridTorrentInfo>(`/torrents/info/${torrentId}`);
  }

  /**
   * Select files from torrent
   */
  async selectFiles(torrentId: string, fileIds: string = "all"): Promise<void> {
    await this.apiCall(`/torrents/selectFiles/${torrentId}`, "POST", { files: fileIds });
  }

  /**
   * Unrestrict a link
   */
  async unrestrictLink(link: string): Promise<RealDebridUnrestrictResponse> {
    return await this.apiCall<RealDebridUnrestrictResponse>("/unrestrict/link", "POST", { link });
  }

  /**
   * Get cached availability for torrents
   */
  async getCachedAvailability(hashes: string[]): Promise<unknown> {
    return await this.apiCall(`/torrents/instantAvailability/${hashes.join("/")}`);
  }
}
