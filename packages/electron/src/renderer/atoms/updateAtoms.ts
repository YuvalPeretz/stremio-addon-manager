/**
 * Update State Management
 * Jotai atoms for managing update state
 */

import { atom } from 'jotai';

export interface UpdateInfo {
  addonId: string;
  addonName: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

export interface UpdateProgress {
  step: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  message: string;
  progress: number;
  timestamp: Date;
  error?: Error;
}

export interface UpdateResult {
  success: boolean;
  addonId: string;
  previousVersion: string;
  newVersion: string;
  duration: number;
  backupId?: string;
  changes: string[];
  warnings?: string[];
  error?: string;
  steps: UpdateProgress[];
}

// Available updates
export const availableUpdatesAtom = atom<UpdateInfo[]>([]);

// Update notification count
export const updateCountAtom = atom((get) => {
  const updates = get(availableUpdatesAtom);
  return updates.filter(u => u.updateAvailable).length;
});

// Currently updating addon
export const updatingAddonAtom = atom<string | null>(null);

// Update progress for current addon
export const updateProgressAtom = atom<UpdateProgress | null>(null);

// Update dialog open state
export const updateDialogOpenAtom = atom(false);

// Selected addon for update
export const selectedAddonForUpdateAtom = atom<string | null>(null);

// Update result
export const updateResultAtom = atom<UpdateResult | null>(null);

// Rollback dialog open state
export const rollbackDialogOpenAtom = atom(false);

// Selected addon for rollback
export const selectedAddonForRollbackAtom = atom<string | null>(null);

// Show update notification
export const showUpdateNotificationAtom = atom(false);

