import { describe, expect, it } from "vitest";
import { joinBaseUrl, normalizeBaseUrl, preferHttpForLoopback } from "../utils/url.js";

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes but keeps path prefix", () => {
    expect(normalizeBaseUrl("https://host/svc-xxx/")).toBe("https://host/svc-xxx");
    expect(normalizeBaseUrl("https://host/svc-xxx///")).toBe("https://host/svc-xxx");
  });
});

describe("joinBaseUrl", () => {
  it("joins under Gateway path prefix (not origin root)", () => {
    expect(joinBaseUrl("https://host/svc-xxx/", "/manifest.json")).toBe(
      "https://host/svc-xxx/manifest.json"
    );
    expect(joinBaseUrl("https://host/svc-xxx", "password", "management")).toBe(
      "https://host/svc-xxx/password/management"
    );
    expect(joinBaseUrl("https://host/svc-xxx/", "party")).toBe("https://host/svc-xxx/party");
  });
});

describe("preferHttpForLoopback", () => {
  it("forces http for localhost", () => {
    expect(preferHttpForLoopback("https://localhost:7000/svc")).toBe("http://localhost:7000/svc");
  });
});
