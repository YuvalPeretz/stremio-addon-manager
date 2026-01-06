/**
 * Installation State Atoms
 * Global state for addon installation process
 */

import { atom } from 'jotai';
import type { InstallationProgress, InstallationResult } from '@stremio-addon-manager/core';

/**
 * Installation in progress flag
 */
export const isInstallingAtom = atom<boolean>(false);

/**
 * Installation progress updates
 */
export const installationProgressAtom = atom<InstallationProgress[]>([]);

/**
 * Latest installation progress
 */
export const latestInstallationProgressAtom = atom((get) => {
  const progress = get(installationProgressAtom);
  return progress.length > 0 ? progress[progress.length - 1] : null;
});

/**
 * Installation result
 */
export const installationResultAtom = atom<InstallationResult | null>(null);

/**
 * Installation error
 */
export const installationErrorAtom = atom<string | null>(null);

