/**
 * After tsc, copy packages/addon-server/management/ into dist/management/
 * so a deploy that only ships `dist/` still serves the management UI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, "..");
const src = path.join(pkgRoot, "management");
const dest = path.join(pkgRoot, "dist", "management");

if (!fs.existsSync(src)) {
  console.warn("copy-management-assets: source missing:", src);
  process.exit(0);
}

if (!fs.existsSync(path.join(pkgRoot, "dist"))) {
  console.warn("copy-management-assets: dist/ missing, run tsc first");
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true, force: true });
console.log("copy-management-assets: copied to", dest);
