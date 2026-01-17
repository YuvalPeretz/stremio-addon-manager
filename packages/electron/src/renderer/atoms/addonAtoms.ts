/**
 * Addon State Atoms
 * Global state for addon selection and management
 */

import { atom } from "jotai";
import type { AddonMetadata } from "@stremio-addon-manager/core";

/**
 * Selected addon ID atom - stores the currently selected addon ID
 * Persisted to localStorage
 */
export const selectedAddonIdAtom = atom<string | null>(null);

/**
 * Addon list atom - stores all available addons
 */
export const addonListAtom = atom<AddonMetadata[]>([]);

/**
 * Default addon atom - stores the default addon
 */
export const defaultAddonAtom = atom<AddonMetadata | null>(null);

/**
 * Addon loading state
 */
export const addonLoadingAtom = atom<boolean>(false);

/**
 * Derived atom - gets the currently selected addon metadata
 */
export const selectedAddonAtom = atom((get) => {
  const selectedId = get(selectedAddonIdAtom);
  const addons = get(addonListAtom);
  if (!selectedId) return null;
  return addons.find((a) => a.id === selectedId) || null;
});
