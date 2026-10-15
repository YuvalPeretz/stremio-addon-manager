/**
 * URL helpers for path-prefixed bases (e.g. https://host/svc-xxx/).
 */

/**
 * Normalize a full base URL: trim, ensure no trailing slash duplication.
 * Returns the base without a trailing slash (except origin-only empty path).
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error("Base URL is empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid base URL: ${baseUrl}`);
  }

  // Collapse duplicate slashes in pathname (preserve leading slash)
  const pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  parsed.pathname = pathname || "/";
  // Drop search/hash for a clean base
  parsed.search = "";
  parsed.hash = "";

  const href = parsed.toString();
  // URL with pathname "/" ends with "/"; strip trailing slash for join consistency
  // except keep scheme://host form without forcing a path.
  if (parsed.pathname === "/") {
    return href.replace(/\/$/, "");
  }
  return href.replace(/\/+$/, "");
}

/**
 * Join path segments under a full base URL that may already include a path prefix.
 * Example: joinBaseUrl("https://host/svc-xxx/", "pwd", "manifest.json")
 *       → "https://host/svc-xxx/pwd/manifest.json"
 */
export function joinBaseUrl(baseUrl: string, ...parts: Array<string | undefined | null>): string {
  const base = normalizeBaseUrl(baseUrl);
  const segments = parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .flatMap((p) => p.split("/"))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (segments.length === 0) {
    return base;
  }

  return `${base}/${segments.join("/")}`;
}

/**
 * Prefer http:// for localhost / loopback bases (mapped Pi ports without TLS).
 * Accepts bare hostnames by assuming https:// before normalizing.
 */
export function preferHttpForLoopback(url: string): string {
  const trimmed = url.trim();
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    const normalized = normalizeBaseUrl(withScheme);
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const isLoopback =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]";
    if (isLoopback) {
      parsed.protocol = "http:";
      return normalizeBaseUrl(parsed.toString());
    }
    return normalized;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}
