/**
 * Stremio Addon Manifest
 */

import { addonBuilder } from "stremio-addon-sdk";

export const manifest = {
  id: "community.stremio.rd.passthrough",
  version: "1.0.0",
  name: "Real-Debrid Passthrough",
  description: "Stream via Real-Debrid with passthrough (no downloads)",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  background: "https://i.imgur.com/8VIqPYB.jpg",
  logo: "https://i.imgur.com/8VIqPYB.jpg",
};

/**
 * Create addon builder with manifest
 */
export function createAddonBuilder() {
  return new addonBuilder(manifest);
}

