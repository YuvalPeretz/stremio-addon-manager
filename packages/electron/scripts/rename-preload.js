#!/usr/bin/env node

/**
 * Rename preload.js to preload.cjs after build
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const preloadPath = path.resolve(__dirname, '../dist/src/main/preload.js');

if (fs.existsSync(preloadPath)) {
  const cjsPath = preloadPath.replace('.js', '.cjs');
  fs.renameSync(preloadPath, cjsPath);
  console.log('Renamed preload.js to preload.cjs');
} else {
  console.warn('preload.js not found, skipping rename');
}
