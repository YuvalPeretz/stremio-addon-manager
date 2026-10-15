/**
 * Stremio Addon Manifest
 */

/** Core fields shared by all transports */
const manifestBase = {
  id: "community.stremio.rd.passthrough",
  version: "1.0.0",
  name: "Real-Debrid Passthrough",
  description: "Stream via Real-Debrid with passthrough (no downloads)",
  types: ["movie", "series"] as const,
  idPrefixes: ["tt"],
  background: "https://i.imgur.com/8VIqPYB.jpg",
  logo: "https://i.imgur.com/8VIqPYB.jpg",
};

const localLibraryCatalogs = [
  {
    type: "movie" as const,
    id: "local",
    name: "Local Library",
    extra: [
      { name: "search" as const, isRequired: false as const },
      { name: "skip" as const, isRequired: false as const },
    ],
  },
  {
    type: "series" as const,
    id: "local",
    name: "Local Library",
    extra: [
      { name: "search" as const, isRequired: false as const },
      { name: "skip" as const, isRequired: false as const },
    ],
  },
];

/**
 * Default manifest (local library off): streams only — Cinemeta supplies meta for `tt` ids.
 */
export const manifest = {
  ...manifestBase,
  resources: ["stream"] as const,
  catalogs: [] as typeof localLibraryCatalogs,
};

/**
 * Manifest when LOCAL_LIBRARY_DATA_DIR is set: Discover / Search from indexed files + streams.
 * Meta is only answered for titles present in the local index (otherwise 404 so Cinemeta can serve).
 */
export function getManifestWithLocalLibrary() {
  return {
    ...manifestBase,
    resources: ["catalog", "meta", "stream"] as const,
    catalogs: localLibraryCatalogs,
  };
}
