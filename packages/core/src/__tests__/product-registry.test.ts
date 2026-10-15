import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AddonRegistry } from "../config/registry.js";
import { AddonRegistryManager } from "../config/registry-manager.js";

describe("AddonRegistry product field", () => {
  let tmpDir: string;
  let registryPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stremio-product-reg-"));
    registryPath = path.join(tmpDir, "registry.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores product on create and accepts legacy entries without product", async () => {
    const registry = new AddonRegistry(registryPath);
    await registry.load();
    registry.create({
      id: "legacy-stream",
      name: "Legacy",
      slug: "legacy",
      configPath: path.join(tmpDir, "legacy.yaml"),
      serviceName: "stremio-addon-legacy",
      port: 7000,
      domain: "legacy.local",
    });
    registry.create({
      id: "subs",
      name: "Subs",
      slug: "subs",
      configPath: path.join(tmpDir, "subs.yaml"),
      serviceName: "stremio-addon-subs",
      port: 8080,
      domain: "subs.local",
      product: "translated_subtitles",
    });
    await registry.save();

    const reloaded = new AddonRegistry(registryPath);
    await reloaded.load();
    expect(reloaded.get("legacy-stream")?.product).toBeUndefined();
    expect(reloaded.get("subs")?.product).toBe("translated_subtitles");
  });

  it("createAddon writes product onto metadata", async () => {
    const registry = new AddonRegistry(registryPath);
    const manager = new AddonRegistryManager(registry);
    await manager.initialize();
    const created = await manager.createAddon("My Subs", 8080, "subs.example", path.join(tmpDir, "c.yaml"), {
      product: "translated_subtitles",
    });
    expect(created.product).toBe("translated_subtitles");
    expect((await manager.getAddon(created.id))?.product).toBe("translated_subtitles");
  });
});
