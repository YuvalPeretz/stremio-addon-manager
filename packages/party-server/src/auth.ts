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
 * Validate that a URL points to a valid Stremio addon.
 * First tries without password (public addon), then detects if password is required.
 */
export async function validateAddonUrl(
    url: string
): Promise<AddonValidationResult> {
    const baseUrl = normalizeAddonUrl(url);

    try {
        const response = await axios.get(`${baseUrl}/manifest.json`, {
            timeout: 8000,
        });
        if (response.data?.id && response.data?.name) {
            return {
                valid: true,
                addonName: response.data.name,
                requiresPassword: false,
            };
        }
    } catch {
        // Public manifest not found - addon likely requires a password
    }

    return {
        valid: false,
        requiresPassword: true,
        error: "Could not access manifest. A password may be required.",
    };
}

/**
 * Validate addon URL + password combination
 */
export async function validateAddonPassword(
    url: string,
    password: string
): Promise<AddonValidationResult> {
    const baseUrl = normalizeAddonUrl(url);

    try {
        const response = await axios.get(
            `${baseUrl}/${password}/manifest.json`,
            {
                timeout: 8000,
            }
        );

        if (response.data?.id && response.data?.name) {
            return {
                valid: true,
                addonName: response.data.name,
                requiresPassword: true,
            };
        }

        return {
            valid: false,
            requiresPassword: true,
            error: "Invalid manifest response",
        };
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            return {
                valid: false,
                requiresPassword: true,
                error: "Invalid password",
            };
        }

        return {
            valid: false,
            requiresPassword: true,
            error: axios.isAxiosError(error)
                ? `Addon unreachable: ${error.message}`
                : "Addon unreachable",
        };
    }
}

/**
 * Full addon validation: tries public first, then with password
 */
export async function validateAddon(
    url: string,
    password?: string
): Promise<AddonValidationResult> {
    // First try public access
    const publicResult = await validateAddonUrl(url);
    if (publicResult.valid) {
        return publicResult;
    }

    // If password provided, try with it
    if (password) {
        return validateAddonPassword(url, password);
    }

    return publicResult;
}
