import { describe, expect, it } from "vitest";
import { normalizeHealthPayload } from "../server/connection.js";

describe("normalizeHealthPayload", () => {
  it("maps addon-server status ok to healthy", () => {
    expect(
      normalizeHealthPayload({
        status: "ok",
        uptime: 12.5,
        timestamp: "2026-08-11T20:00:00.000Z",
      })
    ).toEqual({
      status: "healthy",
      uptime: 12.5,
    });
  });

  it("keeps healthy and maps degraded/unhealthy", () => {
    expect(normalizeHealthPayload({ status: "healthy" })?.status).toBe("healthy");
    expect(normalizeHealthPayload({ status: "degraded" })?.status).toBe("degraded");
    expect(normalizeHealthPayload({ status: "unhealthy" })?.status).toBe("unhealthy");
  });

  it("treats HTTP 200 payloads without status as healthy", () => {
    expect(normalizeHealthPayload({ uptime: 1 })?.status).toBe("healthy");
  });

  it("returns null for empty bodies", () => {
    expect(normalizeHealthPayload(null)).toBeNull();
    expect(normalizeHealthPayload(undefined)).toBeNull();
  });
});
