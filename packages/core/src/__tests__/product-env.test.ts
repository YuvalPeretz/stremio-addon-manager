import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADDON_PRODUCT,
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_TARGET_LANG,
  EnvVarManager,
  InstallationType,
  AccessMethod,
  Provider,
  normalizeAddonProduct,
  productPackageDir,
  resolveLlmModelCatalogEntry,
  STREAMING_ONLY_ENV_KEYS,
  type AddonManagerConfig,
} from "../index.js";

function baseConfig(overrides?: Partial<AddonManagerConfig>): AddonManagerConfig {
  return {
    product: "streaming",
    installation: {
      type: InstallationType.LOCAL,
      accessMethod: AccessMethod.LOCAL_NETWORK,
    },
    addon: {
      name: "Test",
      version: "1.0.0",
      domain: "example.local",
      password: "password12",
      provider: Provider.REAL_DEBRID,
      torrentLimit: 15,
      port: 7000,
    },
    features: {
      firewall: false,
      fail2ban: false,
      caching: { enabled: true, ttl: 7200, maxSize: 100 },
      rateLimiting: { enabled: true, stream: 50, stats: 120 },
      authentication: true,
      backups: { enabled: false, frequency: "weekly", retention: 7 },
      ssl: false,
      duckdnsUpdater: false,
      autoStart: true,
    },
    paths: {
      addonDirectory: "/opt/stremio-addon-test",
      nginxConfig: "/etc/nginx/sites-available/stremio-addon-test",
      serviceFile: "/etc/systemd/system/stremio-addon-test.service",
      logs: "/var/log/stremio-addon-test",
      backups: "/var/backups/stremio-addon-test",
    },
    secrets: {
      realDebridToken: "rd-secret-token",
      torboxToken: "tb-secret-token",
    },
    ...overrides,
  };
}

describe("normalizeAddonProduct", () => {
  it("defaults missing and invalid values to streaming", () => {
    expect(normalizeAddonProduct(undefined)).toBe(DEFAULT_ADDON_PRODUCT);
    expect(normalizeAddonProduct(null)).toBe("streaming");
    expect(normalizeAddonProduct("nope")).toBe("streaming");
  });

  it("accepts translated_subtitles", () => {
    expect(normalizeAddonProduct("translated_subtitles")).toBe("translated_subtitles");
  });
});

describe("productPackageDir", () => {
  it("maps products to bundle directories", () => {
    expect(productPackageDir("streaming")).toBe("addon-server");
    expect(productPackageDir("translated_subtitles")).toBe("translated-subtitles");
  });
});

describe("LLM catalog default", () => {
  it("resolves Qwen3-1.7B as the default recommended model", () => {
    const entry = resolveLlmModelCatalogEntry();
    expect(entry.id).toBe(DEFAULT_LLM_MODEL_ID);
    expect(entry.recommended).toBe(true);
    expect(entry.engine).toBe("llm");
    expect(entry.filename).toBe("Qwen_Qwen3-1.7B-Q4_K_M.gguf");
    expect(entry.expectedBytes).toBe(1282439584);
  });

  it("resolves NLLB as engine=mt", () => {
    const entry = resolveLlmModelCatalogEntry("nllb-200-distilled-600m-int8");
    expect(entry.engine).toBe("mt");
    expect(entry.filename).toBe("nllb-200-distilled-600M-ct2-int8");
  });
});

describe("EnvVarManager product maps", () => {
  it("streaming env includes RD/provider keys and not TARGET_LANG", () => {
    const env = EnvVarManager.getEnvVarsFromConfig(baseConfig());
    expect(env.RD_API_TOKEN).toBe("rd-secret-token");
    expect(env.STREAM_PROVIDER_MODE || env.TORRENT_LIMIT).toBeTruthy();
    expect(env.TARGET_LANG).toBeUndefined();
    expect(EnvVarManager.getAllEnvVarMetadata("streaming").RD_API_TOKEN).toBeDefined();
    expect(EnvVarManager.getAllEnvVarMetadata("streaming").TARGET_LANG).toBeUndefined();
  });

  it("translated_subtitles env has catalog + TARGET_LANG and no RD/TorBox/STREAM_PROVIDER", () => {
    const env = EnvVarManager.mergeEnvVars(
      baseConfig({
        product: "translated_subtitles",
        addon: {
          name: "Subs",
          version: "1.0.0",
          domain: "subs.local",
          password: "password12",
          provider: Provider.REAL_DEBRID,
          torrentLimit: 15,
          port: 8080,
          targetLang: "heb",
          llmModelId: DEFAULT_LLM_MODEL_ID,
        },
      })
    );

    expect(env.TARGET_LANG).toBe("heb");
    expect(env.LLM_MODEL_ID).toBe(DEFAULT_LLM_MODEL_ID);
    expect(env.LLM_MODEL_URL).toContain("Qwen_Qwen3-1.7B-Q4_K_M.gguf");
    expect(env.LLM_MODEL_FILENAME).toBe("Qwen_Qwen3-1.7B-Q4_K_M.gguf");
    expect(env.LLM_MODEL_SHA256).toHaveLength(64);
    expect(env.LLM_MODEL_BYTES).toBe("1282439584");
    expect(env.OPENSUBTITLES_BASE_URL).toBe("https://opensubtitles-v3.strem.io");
    expect(env.PORT).toBe("8080");
    expect(env.ADDON_PASSWORD).toBe("password12");
    expect(env.ENABLE_MANAGEMENT_API).toBe("true");

    for (const key of STREAMING_ONLY_ENV_KEYS) {
      expect(env[key], key).toBeUndefined();
    }

    const meta = EnvVarManager.getAllEnvVarMetadata("translated_subtitles");
    expect(meta.TARGET_LANG).toBeDefined();
    expect(meta.RD_API_TOKEN).toBeUndefined();
    expect(meta.STREAM_PROVIDER_ORDER).toBeUndefined();
  });

  it("defaults TARGET_LANG and model when unset", () => {
    const env = EnvVarManager.getEnvVarsFromConfig(
      baseConfig({
        product: "translated_subtitles",
        addon: {
          name: "Subs",
          version: "1.0.0",
          domain: "subs.local",
          password: "password12",
          provider: Provider.REAL_DEBRID,
          torrentLimit: 15,
        },
      })
    );
    expect(env.TARGET_LANG).toBe(DEFAULT_TARGET_LANG);
    expect(env.LLM_MODEL_ID).toBe(DEFAULT_LLM_MODEL_ID);
    expect(env.PORT).toBe("8080");
  });

  it("NLLB catalog id sets MT_* and omits GGUF sha/url", () => {
    const env = EnvVarManager.getEnvVarsFromConfig(
      baseConfig({
        product: "translated_subtitles",
        addon: {
          name: "Subs",
          version: "1.0.0",
          domain: "subs.local",
          password: "password12",
          provider: Provider.REAL_DEBRID,
          torrentLimit: 15,
          port: 8080,
          targetLang: "heb",
          llmModelId: "nllb-200-distilled-600m-int8",
        },
      })
    );
    expect(env.LLM_MODEL_ID).toBe("nllb-200-distilled-600m-int8");
    expect(env.MT_MODEL_URL).toContain("nllb-200-distilled-600M-ct2-int8");
    expect(env.MT_MODEL_DIR).toBe("nllb-200-distilled-600M-ct2-int8");
    expect(env.MT_MODEL_SHA256).toHaveLength(64);
    expect(env.MT_SERVER_URL).toBe("http://127.0.0.1:8082");
    expect(env.LLM_MODEL_URL).toBeUndefined();
    expect(env.LLM_MODEL_FILENAME).toBeUndefined();
    expect(env.LLM_MODEL_SHA256).toBeUndefined();
  });
});
