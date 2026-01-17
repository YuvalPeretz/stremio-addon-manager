/**
 * Addon Registry Manager
 * Provides high-level operations for managing addon registry with validation
 */

import fs from "node:fs/promises";
import { AddonRegistry } from "./registry.js";
import type { AddonMetadata } from "./types.js";
import { logger } from "../utils/logger.js";

/**
 * Generate a slug from a name
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/[\s_-]+/g, "-") // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}

/**
 * Generate a unique ID from a name
 */
function generateId(name: string): string {
  const baseSlug = slugify(name);
  return baseSlug;
}

/**
 * Ensure ID is unique by appending number if needed
 */
async function ensureUniqueId(registry: AddonRegistry, baseId: string): Promise<string> {
  let id = baseId;
  let counter = 1;

  while (registry.exists(id)) {
    id = `${baseId}-${counter}`;
    counter++;
  }

  return id;
}

/**
 * Validate addon name
 */
function validateName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Addon name cannot be empty" };
  }

  if (name.length > 50) {
    return { valid: false, error: "Addon name must be 50 characters or less" };
  }

  // Allow letters, numbers, spaces, hyphens, underscores
  if (!/^[a-zA-Z0-9\s_-]+$/.test(name)) {
    return {
      valid: false,
      error: "Addon name can only contain letters, numbers, spaces, hyphens, and underscores",
    };
  }

  return { valid: true };
}

/**
 * Validate port number
 */
function validatePort(port: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { valid: false, error: "Port must be a number between 1 and 65535" };
  }

  return { valid: true };
}

/**
 * Validate domain
 */
function validateDomain(domain: string): { valid: boolean; error?: string } {
  if (!domain || domain.trim().length === 0) {
    return { valid: false, error: "Domain cannot be empty" };
  }

  // Basic domain validation (allows localhost, IP addresses, and domain names)
  const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$|^localhost$|^(\d{1,3}\.){3}\d{1,3}$/;
  if (!domainRegex.test(domain)) {
    return { valid: false, error: "Invalid domain format" };
  }

  return { valid: true };
}

/**
 * Generate service name from addon ID
 */
export function generateServiceName(addonId: string): string {
  // Service names must be systemd-safe: lowercase, hyphens only
  const serviceName = `stremio-addon-${addonId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
  return serviceName;
}

/**
 * Addon Registry Manager class
 * Provides high-level operations with validation
 */
export class AddonRegistryManager {
  private registry: AddonRegistry;

  /**
   * Create a new AddonRegistryManager instance
   */
  constructor(registry?: AddonRegistry) {
    this.registry = registry || new AddonRegistry();
  }

  /**
   * Initialize registry (load from file)
   */
  public async initialize(): Promise<void> {
    await this.registry.load();
  }

  /**
   * Create a new addon with validation
   */
  public async createAddon(
    name: string,
    port: number,
    domain: string,
    configPath: string
  ): Promise<AddonMetadata> {
    await this.initialize();

    // Validate name
    const nameValidation = validateName(name);
    if (!nameValidation.valid) {
      throw new Error(nameValidation.error);
    }

    // Check name uniqueness
    if (this.registry.nameExists(name)) {
      const existingAddon = this.registry.getByName(name);
      const suggestion = existingAddon
        ? `Try a different name like '${name} 2' or '${name}-backup'`
        : `Try a different name`;
      throw new Error(
        `Addon name '${name}' is already in use by addon '${existingAddon?.id || "unknown"}'. ${suggestion}`
      );
    }

    // Validate port
    const portValidation = validatePort(port);
    if (!portValidation.valid) {
      throw new Error(portValidation.error);
    }

    // Check port availability
    if (this.registry.portInUse(port)) {
      const existingAddon = this.registry.list().find((a) => a.port === port);
      const suggestedPort = await this.findAvailablePort(port + 1, 10).catch(() => port + 1);
      throw new Error(
        `Port ${port} is already in use by addon '${existingAddon?.name || existingAddon?.id || "unknown"}'. ` +
          `Try using port ${suggestedPort} instead.`
      );
    }

    // Validate domain
    const domainValidation = validateDomain(domain);
    if (!domainValidation.valid) {
      throw new Error(domainValidation.error);
    }

    // Check domain availability
    if (this.registry.domainInUse(domain)) {
      const existingAddon = this.registry.list().find((a) => a.domain === domain);
      throw new Error(
        `Domain '${domain}' is already in use by addon '${existingAddon?.name || existingAddon?.id || "unknown"}'. ` +
          `Each addon must have a unique domain. If you're using the same domain, consider using subdomains or different ports.`
      );
    }

    // Generate ID and ensure uniqueness
    const baseId = generateId(name);
    const id = await ensureUniqueId(this.registry, baseId);
    const slug = slugify(name);
    const serviceName = generateServiceName(id);

    // Create addon metadata
    const metadata = this.registry.create({
      id,
      name,
      slug,
      configPath,
      serviceName,
      port,
      domain,
    });

    // Save registry
    await this.registry.save();

    logger.info("Addon created successfully", { id, name, port, domain });
    return metadata;
  }

  /**
   * Update addon with validation
   */
  public async updateAddon(
    id: string,
    updates: {
      name?: string;
      port?: number;
      domain?: string;
    }
  ): Promise<AddonMetadata> {
    await this.initialize();

    if (!this.registry.exists(id)) {
      throw new Error(`Addon with ID '${id}' not found`);
    }

    const updateData: Partial<Omit<AddonMetadata, "id" | "createdAt" | "updatedAt">> = {};

    // Validate and update name if provided
    if (updates.name !== undefined) {
      const nameValidation = validateName(updates.name);
      if (!nameValidation.valid) {
        throw new Error(nameValidation.error);
      }

      if (this.registry.nameExists(updates.name, id)) {
        const existingAddon = this.registry.getByName(updates.name);
        const suggestion = existingAddon
          ? `Try a different name like '${updates.name} 2' or '${updates.name}-backup'`
          : `Try a different name`;
        throw new Error(
          `Addon name '${updates.name}' is already in use by addon '${existingAddon?.id || "unknown"}'. ${suggestion}`
        );
      }

      updateData.name = updates.name;
      updateData.slug = slugify(updates.name);
      updateData.serviceName = generateServiceName(id); // Service name based on ID, not name
    }

    // Validate and update port if provided
    if (updates.port !== undefined) {
      const portValidation = validatePort(updates.port);
      if (!portValidation.valid) {
        throw new Error(portValidation.error);
      }

      if (updates.port !== undefined && this.registry.portInUse(updates.port, id)) {
        const existingAddon = this.registry.list().find((a) => a.port === updates.port && a.id !== id);
        const suggestedPort = await this.findAvailablePort(updates.port + 1, 10).catch(() => updates.port! + 1);
        throw new Error(
          `Port ${updates.port} is already in use by addon '${existingAddon?.name || existingAddon?.id || "unknown"}'. ` +
            `Try using port ${suggestedPort} instead.`
        );
      }

      updateData.port = updates.port;
    }

    // Validate and update domain if provided
    if (updates.domain !== undefined) {
      const domainValidation = validateDomain(updates.domain);
      if (!domainValidation.valid) {
        throw new Error(domainValidation.error);
      }

      if (this.registry.domainInUse(updates.domain, id)) {
        const existingAddon = this.registry.list().find((a) => a.domain === updates.domain && a.id !== id);
        throw new Error(
          `Domain '${updates.domain}' is already in use by addon '${existingAddon?.name || existingAddon?.id || "unknown"}'. ` +
            `Each addon must have a unique domain. If you're using the same domain, consider using subdomains or different ports.`
        );
      }

      updateData.domain = updates.domain;
    }

    // Update addon
    const updated = this.registry.update(id, updateData);
    await this.registry.save();

    logger.info("Addon updated successfully", { id });
    return updated;
  }

  /**
   * Delete addon
   */
  public async deleteAddon(id: string): Promise<boolean> {
    await this.initialize();

    if (!this.registry.exists(id)) {
      return false;
    }

    const deleted = this.registry.delete(id);
    if (deleted) {
      await this.registry.save();
      logger.info("Addon deleted successfully", { id });
    }

    return deleted;
  }

  /**
   * Get addon by ID
   */
  public async getAddon(id: string): Promise<AddonMetadata | undefined> {
    await this.initialize();
    return this.registry.get(id);
  }

  /**
   * List all addons
   */
  public async listAddons(): Promise<AddonMetadata[]> {
    await this.initialize();
    return this.registry.list();
  }

  /**
   * Get default addon
   */
  public async getDefaultAddon(): Promise<AddonMetadata | undefined> {
    await this.initialize();
    const defaultId = this.registry.getDefaultAddonId();
    if (!defaultId) {
      return undefined;
    }
    return this.registry.get(defaultId);
  }

  /**
   * Set default addon
   */
  public async setDefaultAddon(id: string): Promise<void> {
    await this.initialize();
    this.registry.setDefaultAddonId(id);
    await this.registry.save();
  }

  /**
   * Check if name is available
   */
  public async isNameAvailable(name: string, excludeId?: string): Promise<boolean> {
    await this.initialize();
    const validation = validateName(name);
    if (!validation.valid) {
      return false;
    }
    return !this.registry.nameExists(name, excludeId);
  }

  /**
   * Check if port is available
   */
  public async isPortAvailable(port: number, excludeId?: string): Promise<boolean> {
    await this.initialize();
    const validation = validatePort(port);
    if (!validation.valid) {
      return false;
    }
    return !this.registry.portInUse(port, excludeId);
  }

  /**
   * Check if domain is available
   */
  public async isDomainAvailable(domain: string, excludeId?: string): Promise<boolean> {
    await this.initialize();
    const validation = validateDomain(domain);
    if (!validation.valid) {
      return false;
    }
    return !this.registry.domainInUse(domain, excludeId);
  }

  /**
   * Find available port starting from a given port
   */
  public async findAvailablePort(startPort: number = 7000, maxAttempts: number = 100): Promise<number> {
    await this.initialize();

    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      if (!this.registry.portInUse(port)) {
        return port;
      }
    }

    throw new Error(`Could not find available port starting from ${startPort}`);
  }

  /**
   * Get registry instance (for advanced operations)
   */
  public getRegistry(): AddonRegistry {
    return this.registry;
  }

  /**
   * Validate registry integrity and detect orphaned entries
   * Returns list of issues found
   */
  public async validateIntegrity(): Promise<{
    valid: boolean;
    issues: Array<{ type: string; addonId?: string; message: string }>;
  }> {
    await this.initialize();
    const issues: Array<{ type: string; addonId?: string; message: string }> = [];
    const addons = this.registry.list();

    for (const addon of addons) {
      // Check if config file exists
      try {
        await fs.access(addon.configPath);
      } catch {
        issues.push({
          type: "missing_config",
          addonId: addon.id,
          message: `Config file not found: ${addon.configPath}`,
        });
      }

      // Check for duplicate IDs (shouldn't happen, but validate)
      const duplicates = addons.filter((a) => a.id === addon.id);
      if (duplicates.length > 1) {
        issues.push({
          type: "duplicate_id",
          addonId: addon.id,
          message: `Duplicate addon ID found: ${addon.id}`,
        });
      }

      // Check for duplicate ports
      const portDuplicates = addons.filter((a) => a.port === addon.port && a.id !== addon.id);
      if (portDuplicates.length > 0) {
        issues.push({
          type: "duplicate_port",
          addonId: addon.id,
          message: `Port ${addon.port} is used by multiple addons`,
        });
      }

      // Check for duplicate domains
      const domainDuplicates = addons.filter((a) => a.domain === addon.domain && a.id !== addon.id);
      if (domainDuplicates.length > 0) {
        issues.push({
          type: "duplicate_domain",
          addonId: addon.id,
          message: `Domain ${addon.domain} is used by multiple addons`,
        });
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Detect orphaned services (services that exist but are not in registry)
   * Only works on Linux with systemd
   */
  public async detectOrphanedServices(): Promise<Array<{ serviceName: string; message: string }>> {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);
    const { OSDetector } = await import("../os/index.js");

    const systemInfo = OSDetector.detect();
    if (systemInfo.os !== "linux") {
      return []; // Only check on Linux
    }

    const orphaned: Array<{ serviceName: string; message: string }> = [];

    try {
      // List all stremio-addon services
      const { stdout } = await execAsync("systemctl list-units --type=service --no-legend 'stremio-addon-*'");
      const serviceLines = stdout.trim().split("\n").filter((line) => line.trim());

      await this.initialize();
      const registeredServices = new Set(this.registry.list().map((a) => a.serviceName));

      for (const line of serviceLines) {
        const match = line.match(/^([^\s]+)\.service/);
        if (match) {
          const serviceName = match[1];
          if (!registeredServices.has(serviceName)) {
            orphaned.push({
              serviceName,
              message: `Service '${serviceName}' exists but is not registered in addon registry`,
            });
          }
        }
      }
    } catch (error) {
      logger.warn("Failed to detect orphaned services", error);
    }

    return orphaned;
  }
}
