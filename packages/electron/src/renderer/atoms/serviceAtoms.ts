/**
 * Service State Atoms
 * Global state for addon service management
 */

import { atom } from 'jotai';
import type { ServiceInfo } from '@stremio-addon-manager/core';

/**
 * Service status
 */
export const serviceStatusAtom = atom<ServiceInfo | null>(null);

/**
 * Service logs
 */
export const serviceLogsAtom = atom<string>('');

/**
 * Service loading state
 */
export const serviceLoadingAtom = atom<boolean>(false);

/**
 * Service error state
 */
export const serviceErrorAtom = atom<string | null>(null);

