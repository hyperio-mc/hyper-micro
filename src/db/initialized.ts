/**
 * Initialized LMDB Client Singleton
 * Provides access to the initialized LMDB client
 */

import { LmdbClient, type LmdbConfig, type Result } from './lmdb.js';

let client: LmdbClient | null = null;

/**
 * Initialize the LMDB client with the given config
 * Should be called once at startup
 */
export async function initializeLmdb(config?: LmdbConfig): Promise<Result<void>> {
  if (client) {
    return { ok: true, value: undefined };
  }

  client = new LmdbClient(config);
  const result = await client.initialize();

  if (!result.ok) {
    client = null;
    return result;
  }

  return { ok: true, value: undefined };
}

/**
 * Get the initialized LMDB client
 * Returns null if not initialized
 */
export function getLmdbClient(): LmdbClient | null {
  return client;
}

/**
 * Close and reset the LMDB client
 * Should be called on shutdown
 */
export async function closeLmdb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}