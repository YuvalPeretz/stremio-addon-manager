/**
 * Process entry: load config, start Express + llama.cpp sidecar.
 */

import { loadConfig } from "./config.js";
import { SubtitleCache } from "./cache.js";
import { OpenSubtitlesClient } from "./opensubtitles-client.js";
import { LlmSidecar } from "./llm-process.js";
import { LlamaCompletionClient, LlmTranslator } from "./translator.js";
import { TranslatePipeline } from "./pipeline.js";
import { createServer } from "./server.js";

function startServer(): void {
  const config = loadConfig();
  const cache = new SubtitleCache(config.subtitleCacheDir, config.subtitleCacheTtlSec);
  const osClient = new OpenSubtitlesClient(config.openSubtitlesBaseUrl);
  const sidecar = new LlmSidecar(config);
  const completion = new LlamaCompletionClient(config.llmServerUrl);
  const translator = new LlmTranslator(
    completion,
    config.targetLang,
    config.translationGlossary,
    config.translateBatchSize
  );
  const pipeline = new TranslatePipeline(config, osClient, cache, translator, () =>
    sidecar.ensureReady()
  );
  const app = createServer({ config, pipeline, sidecar });

  const server = app.listen(config.port, () => {
    console.log(`\n✓ TranslatedSubtitles listening on port ${config.port}`);
    console.log(`  - Health: http://localhost:${config.port}/health`);
    if (config.authEnabled) {
      console.log(`  - Manifest: /:password/manifest.json`);
      console.log(`  - Subtitles: /:password/subtitles/:type/:id.json`);
      console.log(
        `\n📖 Install URL: http://localhost:${config.port}/${config.addonPassword}/manifest.json`
      );
    } else {
      console.log("⚠️  ADDON_PASSWORD is not set — authentication is disabled");
    }
    console.log(`  - Translated files: /translated/:cacheKey.(srt|vtt)\n`);
  });

  void sidecar.ensureReady().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`LLM sidecar not ready: ${message}`);
    console.error("Translation requests will retry sidecar startup on demand.");
  });

  const shutdown = (): void => {
    console.log("\nShutting down…");
    void sidecar.stop().finally(() => {
      server.close(() => process.exit(0));
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

process.on("uncaughtException", (error: Error) => {
  console.error("UNCAUGHT EXCEPTION — server continuing", error);
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("UNHANDLED REJECTION — server continuing", reason);
});

startServer();
