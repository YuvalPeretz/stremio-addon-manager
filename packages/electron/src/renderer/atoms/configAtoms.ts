/**
 * Configuration State Atoms
 * Global state for addon configuration
 */

import { atom } from 'jotai';
import type { AddonManagerConfig } from '@stremio-addon-manager/core';

/**
 * Configuration atom - stores the complete addon configuration
 */
export const configAtom = atom<AddonManagerConfig | null>(null);

/**
 * Configuration loading state
 */
export const configLoadingAtom = atom<boolean>(false);

/**
 * Configuration exists state
 */
export const configExistsAtom = atom<boolean>(false);

/**
 * Derived atom - checks if config is loaded
 */
export const isConfiguredAtom = atom((get) => {
  const config = get(configAtom);
  return config !== null;
});

