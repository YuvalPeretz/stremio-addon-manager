/**
 * Addon public/management URL builders.
 * Prefer customScript.publicUrl / managementUrl (full bases with Gateway path prefix).
 */

import type { AddonManagerConfig } from "@stremio-addon-manager/core";

/** Strip trailing slashes; keep path prefix (e.g. /svc-xxx). */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Join segments under a base URL without dropping the base path. */
export function joinBaseUrl(base: string, ...segments: string[]): string {
  const normalizedBase = normalizeBaseUrl(base);
  const parts = segments
    .flatMap((segment) => segment.split("/"))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return normalizedBase;
  }

  return `${normalizedBase}/${parts.join("/")}`;
}

function preferHttpForLoopback(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname;
    if (
      /^localhost$/i.test(host) ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]"
    ) {
      parsed.protocol = "http:";
      return normalizeBaseUrl(parsed.toString());
    }
    return normalizeBaseUrl(parsed.toString());
  } catch {
    return normalizeBaseUrl(trimmed);
  }
}

/**
 * Resolve the public (Stremio) base URL.
 * Prefers customScript.publicUrl; falls back to https://{domain}.
 */
export function getPublicBaseUrl(config: AddonManagerConfig): string | null {
  const publicUrl = config.installation?.customScript?.publicUrl?.trim();
  if (publicUrl) {
    return preferHttpForLoopback(publicUrl);
  }

  const domain = config.addon?.domain?.trim();
  if (!domain) return null;

  if (/^https?:\/\//i.test(domain)) {
    return preferHttpForLoopback(domain);
  }

  return preferHttpForLoopback(`https://${domain}`);
}

/**
 * Resolve the management (admin) base URL.
 * Prefers customScript.managementUrl; otherwise same as public base.
 */
export function getManagementBaseUrl(config: AddonManagerConfig): string | null {
  const managementUrl = config.installation?.customScript?.managementUrl?.trim();
  if (managementUrl) {
    return preferHttpForLoopback(managementUrl);
  }
  return getPublicBaseUrl(config);
}

export function isCustomScriptInstall(config: AddonManagerConfig): boolean {
  return (
    config.installation?.type === "custom_script" ||
    !!config.installation?.customScript?.publicUrl?.trim()
  );
}

/** Stremio install URL: {publicBase}/{password}/manifest.json */
export function buildManifestUrl(config: AddonManagerConfig): string | null {
  const base = getPublicBaseUrl(config);
  const password = config.addon?.password?.trim();
  if (!base || !password) return null;
  return joinBaseUrl(base, password, "manifest.json");
}

/** Management UI URL under public or management base. */
export function buildManagementUrl(config: AddonManagerConfig): string | null {
  const base = getManagementBaseUrl(config);
  const password = config.addon?.password?.trim();
  if (!base || !password) return null;
  return joinBaseUrl(base, password, "management");
}

/** Party viewing URL under the public base when available. */
export function buildPartyUrl(config: AddonManagerConfig, domainFallback?: string): string | null {
  const base = getPublicBaseUrl(config);
  if (base) {
    return joinBaseUrl(base, "party");
  }
  const domain = domainFallback?.trim() || config.addon?.domain?.trim();
  if (!domain) return null;
  if (/^https?:\/\//i.test(domain)) {
    return joinBaseUrl(preferHttpForLoopback(domain), "party");
  }
  return `https://${domain.replace(/\/+$/, "")}/party`;
}

/**
 * HTTP API base for Local Library (password via header, not path).
 * Prefers customScript.publicUrl so Gateway path prefixes are preserved.
 */
export function buildAddonHttpApiBase(config: AddonManagerConfig): string | null {
  return getPublicBaseUrl(config);
}
