/**
 * Authentication - Addon validation and session auth
 */

import axios from "axios";
import type { AddonValidationResult } from "./types.js";

/**
 * Normalize an addon URL to a consistent base form (no trailing slash)
 */
export function normalizeAddonUrl(url: string): string {
    return url.replace(/\/+$/, "");
}

/**
 * Try fetching a manifest URL and return the result.
 * Returns null if the request fails or the response is not a valid manifest.
 */
interface ManifestData {
    id: string;
    name: string;
}

async function tryFetchManifest(manifestUrl: string, timeoutMs = 6000): Promise<ManifestData | null> {
    try {
        const response = await axios.get<ManifestData>(manifestUrl, { timeout: timeoutMs });
        const data = response.data;
        if (typeof data === 'object' && data !== null && 'id' in data && 'name' in data) {
            return data;
        }
    } catch {
        // ignore — caller handles null
    }
    return null;
}

/**
 * Validate that a URL points to a valid Stremio addon.
 * Tries the public URL first; if the server and addon are co-located, also
 * tries localhost as a fallback to handle hairpin-NAT environments where the
 * server cannot reach its own public domain name from within the LAN.
 */
export async function validateAddonUrl(
    url: string,
    localAddonPort?: number,
): Promise<AddonValidationResult> {
    const baseUrl = normalizeAddonUrl(url);

    const manifest = await tryFetchManifest(`${baseUrl}/manifest.json`);
    if (manifest) {
        return { valid: true, addonName: manifest.name, requiresPassword: false };
    }

    if (localAddonPort) {
        const localManifest = await tryFetchManifest(`http://localhost:${localAddonPort}/manifest.json`);
        if (localManifest) {
            return { valid: true, addonName: localManifest.name, requiresPassword: false };
        }
    }

    return {
        valid: false,
        requiresPassword: true,
        error: "Could not access manifest. A password may be required.",
    };
}

/**
 * Validate addon URL + password combination.
 * Falls back to localhost when the public URL is unreachable from within the
 * server (hairpin NAT — server cannot route to its own public IP from LAN).
 */
export async function validateAddonPassword(
    url: string,
    password: string,
    localAddonPort?: number,
): Promise<AddonValidationResult> {
    const baseUrl = normalizeAddonUrl(url);

    // Try public URL first
    const manifest = await tryFetchManifest(`${baseUrl}/${password}/manifest.json`);
    if (manifest) {
        return { valid: true, addonName: manifest.name, requiresPassword: true };
    }

    // Hairpin NAT fallback: try reaching the addon via localhost
    if (localAddonPort) {
        const localManifest = await tryFetchManifest(`http://localhost:${localAddonPort}/${password}/manifest.json`);
        if (localManifest) {
            return { valid: true, addonName: localManifest.name, requiresPassword: true };
        }
    }

    // Neither worked — distinguish between bad password (401) and unreachable
    try {
        await axios.get(`${baseUrl}/${password}/manifest.json`, { timeout: 3000 });
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            return { valid: false, requiresPassword: true, error: "Invalid password" };
        }
    }

    return {
        valid: false,
        requiresPassword: true,
        error: "Addon unreachable. Check the addon URL and password.",
    };
}

/**
 * Full addon validation: tries public first, then with password.
 * Pass localAddonPort when the party server runs on the same machine as the
 * addon server (enables localhost fallback to bypass hairpin NAT).
 */
export async function validateAddon(
    url: string,
    password?: string,
    localAddonPort?: number,
): Promise<AddonValidationResult> {
    const publicResult = await validateAddonUrl(url, localAddonPort);
    if (publicResult.valid) {
        return publicResult;
    }

    if (password) {
        return validateAddonPassword(url, password, localAddonPort);
    }

    return publicResult;
}
