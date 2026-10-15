/**
 * Build the external public origin for absolute stream/proxy URLs.
 * When ADDON_DOMAIN includes a Gateway path prefix (e.g. host/svc-xxx),
 * that prefix must appear in playback URLs — Host headers alone omit it.
 */

import type { Request } from "express";

/**
 * Resolve scheme://host[/pathPrefix] for client-facing absolute URLs.
 */
export function resolveExternalBaseUrl(
  req: Pick<Request, "protocol" | "get" | "headers">,
  domain?: string
): string {
  const protoHeader = req.headers["x-forwarded-proto"];
  const protocol =
    (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader)?.split(",")[0]?.trim() ||
    req.protocol ||
    "https";

  const hostHeader = req.headers["x-forwarded-host"];
  const hostFromHeaders =
    (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)?.split(",")[0]?.trim() ||
    req.get("host") ||
    "localhost";

  const trimmedDomain = domain?.trim();
  if (trimmedDomain) {
    const withScheme = /^https?:\/\//i.test(trimmedDomain)
      ? trimmedDomain
      : `${protocol}://${trimmedDomain}`;
    try {
      const parsed = new URL(withScheme);
      const pathPrefix = parsed.pathname.replace(/\/+$/, "");
      // Path-prefixed ADDON_DOMAIN (Gateway /svc-xxx/) — use host + prefix
      if (pathPrefix && pathPrefix !== "/") {
        return `${parsed.protocol}//${parsed.host}${pathPrefix}`;
      }
    } catch {
      // fall through to request host
    }
  }

  return `${protocol}://${hostFromHeaders}`;
}

/**
 * Password-scoped base used for stream placeholders and RD proxy rewrite.
 */
export function resolvePlaybackBaseUrl(
  req: Pick<Request, "protocol" | "get" | "headers">,
  password: string,
  domain?: string
): string {
  const origin = resolveExternalBaseUrl(req, domain).replace(/\/+$/, "");
  const pwd = password.replace(/^\/+|\/+$/g, "");
  return `${origin}/${pwd}`;
}
