/**
 * Connection Profile Manager
 * Manages saved server connection profiles
 */

import fs from "fs/promises";
import path from "path";
import { logger } from "../utils/logger.js";
import type { Result } from "../types/common.js";
import type { ConnectionProfile } from "./types.js";
import { ServerConnection } from "./connection.js";

/**
 * Connection Profile Manager class
 */
export class ConnectionProfileManager {
  private configPath: string;
  private profiles: Map<string, ConnectionProfile> = new Map();

  constructor(configPath?: string) {
    this.configPath = configPath || this.getDefaultConfigPath();
  }

  /**
   * Get default config path
   */
  private getDefaultConfigPath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
    return path.join(homeDir, ".stremio-addon-manager", "connection-profiles.json");
  }

  /**
   * Ensure config directory exists
   */
  private async ensureConfigDir(): Promise<void> {
    const dir = path.dirname(this.configPath);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Load profiles from disk
   */
  private async loadFromDisk(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, "utf-8");
      const profilesArray: ConnectionProfile[] = JSON.parse(data);

      this.profiles.clear();
      for (const profile of profilesArray) {
        // Convert date strings back to Date objects
        if (profile.lastConnected) {
          profile.lastConnected = new Date(profile.lastConnected);
        }
        profile.createdAt = new Date(profile.createdAt);

        this.profiles.set(profile.id, profile);
      }

      logger.debug(`Loaded ${this.profiles.size} connection profile(s)`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error("Failed to load profiles", error);
      }
    }
  }

  /**
   * Save profiles to disk
   */
  private async saveToDisk(): Promise<void> {
    try {
      await this.ensureConfigDir();

      const profilesArray = Array.from(this.profiles.values());
      const data = JSON.stringify(profilesArray, null, 2);

      await fs.writeFile(this.configPath, data, "utf-8");
      logger.debug(`Saved ${profilesArray.length} connection profile(s)`);
    } catch (error) {
      logger.error("Failed to save profiles", error);
      throw error;
    }
  }

  /**
   * Generate a unique ID for a profile
   */
  private generateId(): string {
    return `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Save a connection profile
   */
  public async saveProfile(profile: Omit<ConnectionProfile, "id" | "createdAt">): Promise<Result<ConnectionProfile>> {
    try {
      await this.loadFromDisk();

      const newProfile: ConnectionProfile = {
        id: this.generateId(),
        createdAt: new Date(),
        ...profile,
      };

      this.profiles.set(newProfile.id, newProfile);
      await this.saveToDisk();

      logger.info(`Saved connection profile: ${newProfile.name}`);

      return {
        success: true,
        data: newProfile,
      };
    } catch (error) {
      logger.error("Failed to save profile", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Load all profiles
   */
  public async loadProfiles(): Promise<ConnectionProfile[]> {
    await this.loadFromDisk();
    return Array.from(this.profiles.values());
  }

  /**
   * Get a specific profile by ID
   */
  public async getProfile(id: string): Promise<ConnectionProfile | null> {
    await this.loadFromDisk();
    return this.profiles.get(id) || null;
  }

  /**
   * Delete a profile
   */
  public async deleteProfile(id: string): Promise<Result<void>> {
    try {
      await this.loadFromDisk();

      if (!this.profiles.has(id)) {
        return {
          success: false,
          error: new Error(`Profile not found: ${id}`),
        };
      }

      this.profiles.delete(id);
      await this.saveToDisk();

      logger.info(`Deleted connection profile: ${id}`);

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      logger.error("Failed to delete profile", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Update a profile
   */
  public async updateProfile(id: string, updates: Partial<ConnectionProfile>): Promise<Result<ConnectionProfile>> {
    try {
      await this.loadFromDisk();

      const existingProfile = this.profiles.get(id);

      if (!existingProfile) {
        return {
          success: false,
          error: new Error(`Profile not found: ${id}`),
        };
      }

      const updatedProfile: ConnectionProfile = {
        ...existingProfile,
        ...updates,
        id, // Ensure ID doesn't change
        createdAt: existingProfile.createdAt, // Ensure createdAt doesn't change
      };

      this.profiles.set(id, updatedProfile);
      await this.saveToDisk();

      logger.info(`Updated connection profile: ${updatedProfile.name}`);

      return {
        success: true,
        data: updatedProfile,
      };
    } catch (error) {
      logger.error("Failed to update profile", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Get recently used profiles
   */
  public async getRecentProfiles(limit = 5): Promise<ConnectionProfile[]> {
    await this.loadFromDisk();

    const profiles = Array.from(this.profiles.values())
      .filter((p) => p.lastConnected)
      .sort((a, b) => {
        const timeA = a.lastConnected?.getTime() || 0;
        const timeB = b.lastConnected?.getTime() || 0;
        return timeB - timeA;
      })
      .slice(0, limit);

    return profiles;
  }

  /**
   * Test a profile connection
   */
  public async testProfile(id: string): Promise<Result<boolean>> {
    try {
      await this.loadFromDisk();

      const profile = this.profiles.get(id);

      if (!profile) {
        return {
          success: false,
          error: new Error(`Profile not found: ${id}`),
        };
      }

      const connection = new ServerConnection({
        url: profile.url,
        auth: profile.auth
          ? {
              type: profile.auth.type,
              username: profile.auth.username,
              // Note: In production, decrypt these values
              password: profile.auth.encryptedPassword,
              token: profile.auth.encryptedToken,
            }
          : undefined,
      });

      const result = await connection.testConnection();

      if (result.success && result.data) {
        // Update last connected time
        await this.updateProfile(id, {
          lastConnected: new Date(),
        });
      }

      return result;
    } catch (error) {
      logger.error("Profile connection test failed", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }

  /**
   * Mark profile as favorite
   */
  public async toggleFavorite(id: string): Promise<Result<void>> {
    try {
      await this.loadFromDisk();

      const profile = this.profiles.get(id);

      if (!profile) {
        return {
          success: false,
          error: new Error(`Profile not found: ${id}`),
        };
      }

      await this.updateProfile(id, {
        favorite: !profile.favorite,
      });

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      logger.error("Failed to toggle favorite", error);
      return {
        success: false,
        error: error as Error,
      };
    }
  }
}
