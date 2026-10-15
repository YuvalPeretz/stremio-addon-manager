/**
 * Build the external public origin for absolute subtitle file URLs.
 */

import type { Request } from "express";

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
      if (pathPrefix && pathPrefix !== "/") {
        return `${parsed.protocol}//${parsed.host}${pathPrefix}`;
      }
    } catch {
      // fall through to request host
    }
  }

  return `${protocol}://${hostFromHeaders}`;
}
