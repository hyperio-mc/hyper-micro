/**
 * @fileoverview Cache Service for hyper-micro
 *
 * This module provides a caching layer using LMDB with optional TTL support.
 * It uses the TtlManager for expiration tracking.
 *
 * @module services/cache
 */

import { RootDatabase, Database } from 'lmdb';
import { TtlManager } from '../lib/ttl.js';

/**
 * CacheService class for managing cached data with optional TTL support.
 *
 * Uses LMDB's sub-database feature to store cache entries in a separate `__cache` database.
 * TTL management is handled by TtlManager in the `__ttl` database.
 *
 * @example
 * ```typescript
 * import { open } from 'lmdb';
 * import { initCacheService, getCacheService } from './services/cache';
 *
 * const rootDb = open({ path: './data' });
 * initCacheService(rootDb);
 *
 * const cache = getCacheService();
 * await cache.set('user:123', { name: 'Alice' }, 60); // 60 second TTL
 * const { value, found } = await cache.get('user:123');
 * ```
 */
export class CacheService {
  private db: Database;
  private ttl: TtlManager;

  /**
   * Creates a new CacheService instance.
   *
   * @param rootDb - The root LMDB database instance
   */
  constructor(rootDb: RootDatabase) {
    this.db = rootDb.openDB({
      name: '__cache',
      compression: true,
    });
    this.ttl = new TtlManager(rootDb);
  }

  /**
   * Builds a storage key with optional namespace prefix.
   *
   * @param key - The key to prefix
   * @param namespace - Optional namespace
   * @returns The storage key
   * @private
   */
  private buildKey(key: string, namespace?: string): string {
    return namespace ? `${namespace}:${key}` : key;
  }

  /**
   * Retrieves a value from the cache.
   * Checks TTL expiration first and returns not found if expired.
   *
   * @param key - The key to retrieve
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to an object with value and found status
   *
   * @example
   * ```typescript
   * const { value, found } = await cache.get('user:123', 'sessions');
   * if (found) {
   *   console.log(value); // The cached value
   * }
   * ```
   */
  async get(key: string, namespace?: string): Promise<{ value: unknown; found: boolean }> {
    const storageKey = this.buildKey(key, namespace);

    // Check TTL expiration first
    const ttlRemaining = await this.ttl.getTtl(key, namespace);

    if (ttlRemaining === -1) {
      // Key has expired - clean up and return not found
      await this.db.remove(storageKey);
      await this.ttl.removeTtl(key, namespace);
      return { value: null, found: false };
    }

    // Get from cache database
    const value = await this.db.get(storageKey);

    if (value === undefined) {
      return { value: null, found: false };
    }

    return { value, found: true };
  }

  /**
   * Stores a value in the cache with optional TTL.
   *
   * @param key - The key to store
   * @param value - The value to store (must be JSON-serializable)
   * @param ttl - Optional time-to-live in seconds
   * @param namespace - Optional namespace for the key
   * @returns Promise that resolves when the value is stored
   *
   * @example
   * ```typescript
   * // Permanent cache entry
   * await cache.set('config:theme', { mode: 'dark' });
   *
   * // Cache entry with 60 second TTL
   * await cache.set('session:abc', { userId: 123 }, 60);
   *
   * // Namespaced cache entry
   * await cache.set('user:123', { name: 'Alice' }, 300, 'app');
   * // Key stored as: 'app:user:123'
   * ```
   */
  async set(key: string, value: unknown, ttl?: number, namespace?: string): Promise<void> {
    const storageKey = this.buildKey(key, namespace);

    // Store the value
    await this.db.put(storageKey, value);

    // Set TTL if provided
    if (ttl !== undefined && ttl > 0) {
      await this.ttl.setTtl(key, ttl, namespace);
    }
  }

  /**
   * Deletes a value from the cache.
   * Removes both the cached value and any associated TTL entry.
   *
   * @param key - The key to delete
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to true if the key existed, false otherwise
   *
   * @example
   * ```typescript
   * const existed = await cache.delete('user:123', 'sessions');
   * console.log(existed ? 'Key was deleted' : 'Key not found');
   * ```
   */
  async delete(key: string, namespace?: string): Promise<boolean> {
    const storageKey = this.buildKey(key, namespace);

    // Check if exists
    const exists = await this.db.get(storageKey) !== undefined;

    if (exists) {
      // Remove from cache database
      await this.db.remove(storageKey);
    }

    // Always remove TTL entry (it may exist even if value doesn't)
    await this.ttl.removeTtl(key, namespace);

    return exists;
  }

  /**
   * Checks if a key exists in the cache and is not expired.
   * Does not return the value, just the existence status.
   *
   * @param key - The key to check
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to true if key exists and is not expired
   *
   * @example
   * ```typescript
   * const hasKey = await cache.has('user:123', 'sessions');
   * if (hasKey) {
   *   // Key exists and is valid
   * }
   * ```
   */
  async has(key: string, namespace?: string): Promise<boolean> {
    const storageKey = this.buildKey(key, namespace);

    // Check TTL expiration first
    const ttlRemaining = await this.ttl.getTtl(key, namespace);

    if (ttlRemaining === -1) {
      // Expired - doesn't count as existing
      return false;
    }

    // Check if value exists in cache database
    const value = await this.db.get(storageKey);
    return value !== undefined;
  }

  /**
   * Gets the remaining TTL for a key in seconds.
   *
   * @param key - The key to check
   * @param namespace - Optional namespace for the key
   * @returns Promise resolving to:
   *   - Remaining TTL in seconds (> 0)
   *   - -1 if no TTL is set (permanent entry)
   *   - -2 if key does not exist or has expired
   *
   * @example
   * ```typescript
   * const ttl = await cache.getTtl('session:abc');
   * if (ttl > 0) {
   *   console.log(`Expires in ${ttl} seconds`);
   * } else if (ttl === -1) {
   *   console.log('Permanent entry (no TTL)');
   * } else {
   *   console.log('Key not found or expired');
   * }
   * ```
   */
  async getTtl(key: string, namespace?: string): Promise<number> {
    // Check if key exists first
    const exists = await this.has(key, namespace);
    if (!exists) {
      return -2;
    }

    // Get TTL info
    const ttlRemaining = await this.ttl.getTtl(key, namespace);

    // TTLManager returns:
    // - -1 for expired
    // - -2 for no TTL set
    // - positive number for remaining seconds
    if (ttlRemaining === -2) {
      return -1; // No TTL set (permanent)
    }

    return ttlRemaining;
  }
}

// Singleton instance
let cacheService: CacheService | null = null;

/**
 * Gets the singleton CacheService instance.
 * Must call initCacheService first.
 *
 * @returns The CacheService instance
 * @throws Error if CacheService has not been initialized
 *
 * @example
 * ```typescript
 * const cache = getCacheService();
 * await cache.set('key', 'value');
 * ```
 */
export function getCacheService(): CacheService {
  if (!cacheService) {
    throw new Error('CacheService not initialized. Call initCacheService(rootDb) first.');
  }
  return cacheService;
}

/**
 * Initializes the singleton CacheService instance.
 * Should be called once during application startup.
 *
 * @param rootDb - The root LMDB database instance
 * @returns The CacheService instance
 *
 * @example
 * ```typescript
 * import { open } from 'lmdb';
 * import { initCacheService } from './services/cache';
 *
 * const rootDb = open({ path: './data' });
 * initCacheService(rootDb);
 * ```
 */
export function initCacheService(rootDb: RootDatabase): CacheService {
  cacheService = new CacheService(rootDb);
  return cacheService;
}

/**
 * Resets the singleton instance.
 * Used for testing purposes.
 *
 * @internal
 */
export function resetCacheService(): void {
  cacheService = null;
}