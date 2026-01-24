import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    outDir: "dist/src/main",
    lib: {
      entry: path.resolve(__dirname, "src/main/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: (id) => {
        const cleanId = id.split("?")[0];
        
        // Externalize electron
        if (cleanId === "electron") return true;
        
        // Externalize native modules
        if (cleanId.endsWith(".node")) return true;
        
        // Externalize workspace packages
        if (cleanId.startsWith("@stremio-addon-manager/")) return true;
        
        // Externalize all node_modules
        if (!cleanId.startsWith(".") && !path.isAbsolute(cleanId)) return true;
        
        return false;
      },
    },
    minify: false,
    sourcemap: true,
  },
});
