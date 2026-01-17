/**
 * Addon Registry
 * Manages the registry of all installed addons
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { logger } from "../utils/logger.js";
import type { AddonRegistryData, AddonMetadata } from "./types.js";

/**
 * Addon Registry class
 * Handles CRUD operations for addon registry
 */
export class AddonRegistry {
  private registryPath: string;
  private registry: AddonRegistryData | null = null;

  /**
   * Create a new AddonRegistry instance
   * @param registryPath Optional path to registry file
   */
  constructor(registryPath?: string) {
    if (registryPath) {
      this.registryPath = registryPath;
    } else {
      const homeDir = os.homedir();
      this.registryPath = path.join(homeDir, ".stremio-addon-manager", "addons", "registry.json");
    }
  }

  /**
   * Get the registry file path
   */
  public getRegistryPath(): string {
    return this.registryPath;
  }

  /**
   * Load registry from file
   */
  public async load(): Promise<AddonRegistryData> {
    try {
      const fileContent = await fs.readFile(this.registryPath, "utf-8");
      
      // Try to parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(fileContent);
      } catch (parseError) {
        // Corrupted JSON - backup and create new registry
        logger.error("Registry file is corrupted (invalid JSON), creating backup and new registry", parseError);
        const backupPath = this.registryPath + `.backup.${Date.now()}`;
        try {
          await fs.copyFile(this.registryPath, backupPath);
          logger.info("Corrupted registry backed up", { backupPath });
        } catch (backupError) {
          logger.warn("Failed to backup corrupted registry", backupError);
        }
        
        // Create new empty registry
        this.registry = {
          version: "1.0.0",
          addons: [],
        };
        await this.save();
        logger.warn("Created new empty registry. Previous registry was corrupted and backed up.");
        return this.registry;
      }

      this.registry = parsed as AddonRegistryData;

      // Validate structure
      if (!this.registry || typeof this.registry !== "object") {
        throw new Error("Registry is not a valid object");
      }

      if (!this.registry.addons || !Array.isArray(this.registry.addons)) {
        logger.warn("Registry missing or invalid 'addons' array, initializing empty array");
        this.registry.addons = [];
      }

      if (!this.registry.version || typeof this.registry.version !== "string") {
        logger.warn("Registry missing or invalid 'version', setting to 1.0.0");
        this.registry.version = "1.0.0";
      }

      // Validate each addon entry
      const validAddons: AddonMetadata[] = [];
      for (const addon of this.registry.addons) {
        if (this.validateAddonMetadata(addon)) {
          validAddons.push(addon);
        } else {
          logger.warn("Invalid addon entry found in registry, skipping", { addon });
        }
      }

      // If we filtered out invalid entries, update and save
      if (validAddons.length !== this.registry.addons.length) {
        logger.warn(
          `Filtered out ${this.registry.addons.length - validAddons.length} invalid addon entries from registry`
        );
        this.registry.addons = validAddons;
        await this.save();
      }

      logger.info("Addon registry loaded", { path: this.registryPath, count: this.registry.addons.length });
      return this.registry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Registry doesn't exist, create empty one
        logger.info("Addon registry not found, creating new registry", { path: this.registryPath });
        this.registry = {
          version: "1.0.0",
          addons: [],
        };
        await this.save();
        return this.registry;
      }

      logger.error("Failed to load addon registry", error);
      throw new Error(`Failed to load addon registry: ${(error as Error).message}`);
    }
  }

  /**
   * Validate addon metadata structure
   */
  private validateAddonMetadata(addon: unknown): addon is AddonMetadata {
    if (!addon || typeof addon !== "object") {
      return false;
    }

    const a = addon as Record<string, unknown>;

    // Required fields
    if (typeof a.id !== "string" || !a.id.trim()) {
      return false;
    }
    if (typeof a.name !== "string" || !a.name.trim()) {
      return false;
    }
    if (typeof a.slug !== "string" || !a.slug.trim()) {
      return false;
    }
    if (typeof a.configPath !== "string" || !a.configPath.trim()) {
      return false;
    }
    if (typeof a.serviceName !== "string" || !a.serviceName.trim()) {
      return false;
    }
    if (typeof a.port !== "number" || a.port < 1 || a.port > 65535) {
      return false;
    }
    if (typeof a.domain !== "string" || !a.domain.trim()) {
      return false;
    }

    return true;
  }

  /**
   * Save registry to file
   */
  public async save(): Promise<void> {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }

    try {
      // Ensure directory exists
      const registryDir = path.dirname(this.registryPath);
      await fs.mkdir(registryDir, { recursive: true });

      // Write to file
      const jsonContent = JSON.stringify(this.registry, null, 2);
      await fs.writeFile(this.registryPath, jsonContent, "utf-8");

      logger.info("Addon registry saved", { path: this.registryPath, count: this.registry.addons.length });
    } catch (error) {
      logger.error("Failed to save addon registry", error);
      throw new Error(`Failed to save addon registry: ${(error as Error).message}`);
    }
  }

  /**
   * Get the current registry data
   */
  public getData(): AddonRegistryData {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }
    return this.registry;
  }

  /**
   * List all addons
   */
  public list(): AddonMetadata[] {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }
    return [...this.registry.addons];
  }

  /**
   * Get addon by ID
   */
  public get(id: string): AddonMetadata | undefined {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }
    return this.registry.addons.find((addon) => addon.id === id);
  }

  /**
   * Check if addon exists
   */
  public exists(id: string): boolean {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }
    return this.registry.addons.some((addon) => addon.id === id);
  }

  /**
   * Add new addon to registry
   */
  public create(metadata: Omit<AddonMetadata, "createdAt" | "updatedAt">): AddonMetadata {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }

    // Check if addon with same ID already exists
    if (this.exists(metadata.id)) {
      throw new Error(`Addon with ID '${metadata.id}' already exists`);
    }

    const now = new Date().toISOString();
    const addonMetadata: AddonMetadata = {
      ...metadata,
      createdAt: now,
      updatedAt: now,
    };

    this.registry.addons.push(addonMetadata);
    logger.info("Addon added to registry", { id: metadata.id, name: metadata.name });
    return addonMetadata;
  }

  /**
   * Update addon in registry
   */
  public update(id: string, updates: Partial<Omit<AddonMetadata, "id" | "createdAt" | "updatedAt">>): AddonMetadata {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }

    const index = this.registry.addons.findIndex((addon) => addon.id === id);
    if (index === -1) {
      throw new Error(`Addon with ID '${id}' not found`);
    }

    const existing = this.registry.addons[index];
    const updated: AddonMetadata = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.registry.addons[index] = updated;
    logger.info("Addon updated in registry", { id });
    return updated;
  }

  /**
   * Delete addon from registry
   */
  public delete(id: string): boolean {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }

    const index = this.registry.addons.findIndex((addon) => addon.id === id);
    if (index === -1) {
      return false;
    }

    this.registry.addons.splice(index, 1);

    // If deleted addon was the default, clear default
    if (this.registry.defaultAddonId === id) {
      this.registry.defaultAddonId = undefined;
    }

    logger.info("Addon removed from registry", { id });
    return true;
  }

  /**
   * Get default addon ID
   */
  public getDefaultAddonId(): string | undefined {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }
    return this.registry.defaultAddonId;
  }

  /**
   * Set default addon ID
   */
  public setDefaultAddonId(id: string): void {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }

    if (!this.exists(id)) {
      throw new Error(`Addon with ID '${id}' not found`);
    }

    this.registry.defaultAddonId = id;
    logger.info("Default addon set", { id });
  }

  /**
   * Get addon by name (case-insensitive)
   */
  public getByName(name: string): AddonMetadata | undefined {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }
    return this.registry.addons.find((addon) => addon.name.toLowerCase() === name.toLowerCase());
  }

  /**
   * Get addon by slug
   */
  public getBySlug(slug: string): AddonMetadata | undefined {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }
    return this.registry.addons.find((addon) => addon.slug === slug);
  }

  /**
   * Check if name exists (case-insensitive)
   */
  public nameExists(name: string, excludeId?: string): boolean {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }
    return this.registry.addons.some(
      (addon) => addon.name.toLowerCase() === name.toLowerCase() && addon.id !== excludeId
    );
  }

  /**
   * Check if port is in use by another addon
   */
  public portInUse(port: number, excludeId?: string): boolean {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }
    return this.registry.addons.some((addon) => addon.port === port && addon.id !== excludeId);
  }

  /**
   * Check if domain is in use by another addon
   */
  public domainInUse(domain: string, excludeId?: string): boolean {
    if (!this.registry) {
      throw new Error("Registry not loaded. Call load() first.");
    }
    return this.registry.addons.some((addon) => addon.domain === domain && addon.id !== excludeId);
  }
}
