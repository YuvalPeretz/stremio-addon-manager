import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry - use absolute path to avoid root resolution issues
        entry: path.resolve(__dirname, "src/main/index.ts"),
        vite: {
          build: {
            outDir: "dist/src/main",
            rollupOptions: {
              external: (id) => {
                // Strip query strings (e.g., "?commonjs-external")
                const cleanId = id.split("?")[0];

                // Externalize electron
                if (cleanId === "electron") return true;

                // Externalize native modules (.node files)
                if (cleanId.endsWith(".node")) return true;

                // Externalize workspace packages
                if (cleanId.startsWith("@stremio-addon-manager/")) return true;

                // Externalize all node_modules (don't bundle dependencies)
                if (!cleanId.startsWith(".") && !path.isAbsolute(cleanId)) return true;

                return false;
              },
            },
          },
        },
      },
      {
        // Preload script entry - use absolute path to avoid root resolution issues
        entry: path.resolve(__dirname, "src/main/preload.ts"),
        onstart(options) {
          // Notify the renderer process to reload the page when the preload scripts build completes
          options.reload();
        },
        vite: {
          build: {
            outDir: "dist/src/main",
            rollupOptions: {
              external: (id) => {
                // Strip query strings (e.g., "?commonjs-external")
                const cleanId = id.split("?")[0];

                // Externalize electron
                if (cleanId === "electron") return true;

                // Externalize native modules (.node files)
                if (cleanId.endsWith(".node")) return true;

                // Externalize workspace packages
                if (cleanId.startsWith("@stremio-addon-manager/")) return true;

                // Externalize all node_modules (don't bundle dependencies)
                if (!cleanId.startsWith(".") && !path.isAbsolute(cleanId)) return true;

                return false;
              },
            },
          },
        },
      },
    ]),
  ],
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
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
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
