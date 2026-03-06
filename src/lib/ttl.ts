/**
 * @fileoverview TTL (Time-To-Live) Manager for LMDB
 * 
 * This module provides TTL management for key expiration tracking.
 * It uses a separate `__ttl` database to store expiration metadata.
 * 
 * @module lib/ttl
 */

import { RootDatabase, Database } from 'lmdb';

/**
 * Represents a TTL entry stored in the `__ttl` database.
 */
export interface TtlEntry {
  /** Unix timestamp in milliseconds when the key expires */
  expiresAt: number;
  /** Optional namespace for the key (for multi-tenant support) */
  namespace?: string;
}

/**
 * TTL Manager class for managing key expiration times.
 * 
 * Uses LMDB's sub-database feature to store TTL entries in a separate `__ttl` database.
 * 
 * @example
 * ```typescript
 * import { open } from 'lmdb';
 * import { TtlManager } from './lib/ttl';
 * 
 * const rootDb = open({ path: './data' });
 * const ttlManager = new TtlManager(rootDb);
 * 
 * // Set a TTL of 60 seconds
 * await ttlManager.setTtl('user:123', 60);
 * 
 * // Check remaining time
 * const remaining = await ttlManager.getTtl('user:123');
 * console.log(remaining); // e.g., 58
 * ```
 */
export class TtlManager {
  private ttlDb: Database<TtlEntry>;

  /**
   * Creates a new TTL Manager instance.
   * 
   * @param rootDb - The root LMDB database instance
   */
  constructor(rootDb: RootDatabase) {
    this.ttlDb = rootDb.openDB<TtlEntry>({
      name: '__ttl',
      compression: true,
    });
  }

  /**
   * Stores a TTL entry for a key.
   * 
   * @param key - The key to set TTL for
   * @param ttlSeconds - Time-to-live in seconds
   * @param namespace - Optional namespace for the key
   * @returns Promise that resolves when the TTL is stored
   */
  async setTtl(key: string, ttlSeconds: number, namespace?: string): Promise<void> {
    const entry: TtlEntry = {
      expiresAt: Date.now() + ttlSeconds * 1000,
      ...(namespace && { namespace }),
    };

    const storageKey = namespace ? `${namespace}:${key}` : key;
    await this.ttlDb.put(storageKey, entry);
  }

  /**
   * Gets the remaining TTL for a key.
   * 
   * @param key - The key to check
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to:
   *   - Remaining seconds if TTL exists and key hasn't expired
   *   - -2 if the key has no TTL entry (not found)
   *   - -1 if the key has expired (caller should treat as expired)
   */
  async getTtl(key: string, namespace?: string): Promise<number> {
    const storageKey = namespace ? `${namespace}:${key}` : key;
    const entry = await this.ttlDb.get(storageKey);

    if (!entry) {
      return -2; // Not found
    }

    const remainingMs = entry.expiresAt - Date.now();
    
    if (remainingMs <= 0) {
      return -1; // Expired
    }

    return Math.ceil(remainingMs / 1000);
  }

  /**
   * Removes a TTL entry for a key.
   * 
   * @param key - The key to remove TTL for
   * @param namespace - Optional namespace for the key
   * @returns Promise that resolves when the TTL is removed
   */
  async removeTtl(key: string, namespace?: string): Promise<void> {
    const storageKey = namespace ? `${namespace}:${key}` : key;
    await this.ttlDb.remove(storageKey);
  }

  /**
   * Checks if a key has expired.
   * 
   * @param key - The key to check
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to true if:
   *   - The key has a TTL entry and it has expired
   *   - The key has no TTL entry (non-existent keys are treated as expired)
   *   Returns false only if the key has a valid (unexpired) TTL entry.
   */
  async isExpired(key: string, namespace?: string): Promise<boolean> {
    const storageKey = namespace ? `${namespace}:${key}` : key;
    const entry = await this.ttlDb.get(storageKey);

    if (!entry) {
      return true; // No TTL entry means key doesn't exist or has no TTL - treat as expired
    }

    return Date.now() >= entry.expiresAt;
  }

  /**
   * Gets the raw TTL entry for a key.
   * Useful for debugging or inspecting TTL metadata.
   * 
   * @param key - The key to get entry for
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to the TTL entry or null if not found
   */
  async getTtlEntry(key: string, namespace?: string): Promise<TtlEntry | null> {
    const storageKey = namespace ? `${namespace}:${key}` : key;
    return (await this.ttlDb.get(storageKey)) || null;
  }

  /**
   * Gets all expired keys (cleanup utility).
   * 
   * @param namespace - Optional namespace to filter by
   * @returns Promise resolving to array of expired keys
   */
  async getExpiredKeys(namespace?: string): Promise<string[]> {
    const expiredKeys: string[] = [];
    const now = Date.now();
    const prefix = namespace ? `${namespace}:` : undefined;

    for await (const { key, value } of this.ttlDb.getRange()) {
      // Skip if namespace filter and key doesn't match
      if (prefix && !String(key).startsWith(prefix)) {
        continue;
      }
      
      if (value.expiresAt <= now) {
        // Return the key without namespace prefix
        const keyStr = String(key);
        expiredKeys.push(prefix ? keyStr.slice(prefix.length) : keyStr);
      }
    }

    return expiredKeys;
  }
}