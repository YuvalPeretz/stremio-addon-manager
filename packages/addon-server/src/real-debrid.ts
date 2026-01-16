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
        console.error("RD API Error:", error.response?.data || error.message);
      }
      throw error;
    }
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
