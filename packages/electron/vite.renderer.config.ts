import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/renderer"),
      "@components": path.resolve(__dirname, "./src/renderer/components"),
      "@pages": path.resolve(__dirname, "./src/renderer/pages"),
      "@atoms": path.resolve(__dirname, "./src/renderer/atoms"),
      "@hooks": path.resolve(__dirname, "./src/renderer/hooks"),
      "@utils": path.resolve(__dirname, "./src/renderer/utils"),
      "@styles": path.resolve(__dirname, "./src/renderer/styles"),
    },
  },
  css: {
    modules: {
      localsConvention: "camelCase",
    },
  },
  server: {
    port: 3000,
  },
});
