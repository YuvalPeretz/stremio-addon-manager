/**
 * Server Connection State Atoms
 * Global state for server connections and profiles
 */

import { atom } from "jotai";
import type { ServerInfo, ConnectionProfile } from "@stremio-addon-manager/core";

/**
 * Currently connected server
 */
export const connectedServerAtom = atom<ServerInfo | null>(null);

/**
 * Connection profiles
 */
export const connectionProfilesAtom = atom<ConnectionProfile[]>([]);

/**
 * Active connection profile ID
 */
export const activeProfileIdAtom = atom<string | null>(null);

/**
 * Server connection loading state
 */
export const serverConnectionLoadingAtom = atom<boolean>(false);

/**
 * Server detection loading state
 */
export const serverDetectionLoadingAtom = atom<boolean>(false);

/**
 * Detected local servers
 */
export const localServersAtom = atom<ServerInfo[]>([]);

/**
 * Connection error
 */
export const connectionErrorAtom = atom<string | null>(null);

/**
 * Derived atom - check if connected to a server
 */
export const isConnectedAtom = atom((get) => {
  const server = get(connectedServerAtom);
  return server !== null;
});

