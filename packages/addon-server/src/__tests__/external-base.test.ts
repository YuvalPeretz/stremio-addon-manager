import { describe, expect, it } from "vitest";
import { resolveExternalBaseUrl, resolvePlaybackBaseUrl } from "../external-base.js";

function fakeReq(opts: {
  protocol?: string;
  host?: string;
  forwardedProto?: string;
  forwardedHost?: string;
}): Parameters<typeof resolveExternalBaseUrl>[0] {
  return {
    protocol: opts.protocol || "http",
    get: (name: string) => (name.toLowerCase() === "host" ? opts.host || "127.0.0.1:7000" : undefined),
    headers: {
      ...(opts.forwardedProto ? { "x-forwarded-proto": opts.forwardedProto } : {}),
      ...(opts.forwardedHost ? { "x-forwarded-host": opts.forwardedHost } : {}),
    },
  };
}

describe("resolveExternalBaseUrl", () => {
  it("uses request host when ADDON_DOMAIN is host-only", () => {
    const base = resolveExternalBaseUrl(
      fakeReq({ forwardedProto: "https", forwardedHost: "addon.example.com" }),
      "addon.example.com"
    );
    expect(base).toBe("https://addon.example.com");
  });

  it("keeps Gateway path prefix from ADDON_DOMAIN", () => {
    const base = resolveExternalBaseUrl(
      fakeReq({ forwardedProto: "https", forwardedHost: "gateway.example.com" }),
      "gateway.example.com/svc-51959e0c34f7"
    );
    expect(base).toBe("https://gateway.example.com/svc-51959e0c34f7");
  });

  it("accepts ADDON_DOMAIN with scheme and trailing slash", () => {
    const base = resolveExternalBaseUrl(
      fakeReq({ host: "internal:7000" }),
      "https://gateway.example.com/svc-abc/"
    );
    expect(base).toBe("https://gateway.example.com/svc-abc");
  });
});

describe("resolvePlaybackBaseUrl", () => {
  it("joins password under path-prefixed base", () => {
    const playback = resolvePlaybackBaseUrl(
      fakeReq({ forwardedProto: "https", forwardedHost: "gw.test" }),
      "secret",
      "gw.test/svc-xxx"
    );
    expect(playback).toBe("https://gw.test/svc-xxx/secret");
  });
});
