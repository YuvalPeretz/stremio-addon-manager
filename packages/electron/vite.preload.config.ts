import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    outDir: "dist/src/main",
    lib: {
      entry: path.resolve(__dirname, "src/main/preload.ts"),
      formats: ["cjs"],
      fileName: () => "preload.js",
    },
    rollupOptions: {
      external: ["electron"],
    },
    minify: false,
    sourcemap: true,
  },
});
