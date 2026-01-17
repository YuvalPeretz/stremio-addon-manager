/**
 * List Command
 * List all installed addons
 */

import { listAddons } from '../utils/addon-resolver.js';

/**
 * List command handler
 */
export async function listCommand(): Promise<void> {
  await listAddons();
}
