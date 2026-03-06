/**
 * @fileoverview Unit tests for CacheService
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { open, RootDatabase } from 'lmdb';
import { tmpdir } from 'node:os';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CacheService, initCacheService, getCacheService, resetCacheService } from './cache.js';

describe('CacheService', () => {
  let tempDir: string;
  let rootDb: RootDatabase;
  let cache: CacheService;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = join(tmpdir(), `hyper-micro-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    
    rootDb = open({
      path: tempDir,
      name: 'root',
    });
    
    cache = new CacheService(rootDb);
  });

  afterEach(async () => {
    // Clean up
    resetCacheService();
    await rootDb.close();
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('set()', () => {
    it('should store a value correctly', async () => {
      const key = 'test-key';
      const value = { name: 'Alice', age: 30 };
      
      await cache.set(key, value);
      
      const result = await cache.get(key);
      expect(result.found).toBe(true);
      expect(result.value).toEqual(value);
    });

    it('should store value with TTL correctly', async () => {
      const key = 'ttl-key';
      const value = 'expires-soon';
      const ttlSeconds = 60;
      
      await cache.set(key, value, ttlSeconds);
      
      const result = await cache.get(key);
      expect(result.found).toBe(true);
      expect(result.value).toBe(value);
    });

    it('should overwrite existing value', async () => {
      const key = 'overwrite-key';
      
      await cache.set(key, 'first-value');
      await cache.set(key, 'second-value');
      
      const result = await cache.get(key);
      expect(result.found).toBe(true);
      expect(result.value).toBe('second-value');
    });

    it('should store null values', async () => {
      const key = 'null-key';
      
      await cache.set(key, null);
      
      const result = await cache.get(key);
      expect(result.found).toBe(true);
      expect(result.value).toBeNull();
    });

    it('should store various data types', async () => {
      // String
      await cache.set('string-key', 'hello');
      expect((await cache.get('string-key')).value).toBe('hello');
      
      // Number
      await cache.set('number-key', 42);
      expect((await cache.get('number-key')).value).toBe(42);
      
      // Boolean
      await cache.set('bool-key', true);
      expect((await cache.get('bool-key')).value).toBe(true);
      
      // Array
      await cache.set('array-key', [1, 2, 3]);
      expect((await cache.get('array-key')).value).toEqual([1, 2, 3]);
      
      // Object
      await cache.set('object-key', { nested: { deep: 'value' } });
      expect((await cache.get('object-key')).value).toEqual({ nested: { deep: 'value' } });
    });
  });

  describe('get()', () => {
    it('should retrieve stored value', async () => {
      const key = 'retrieve-key';
      const value = { data: 'test' };
      
      await cache.set(key, value);
      
      const result = await cache.get(key);
      expect(result.found).toBe(true);
      expect(result.value).toEqual(value);
    });

    it('should return { value: null, found: false } for non-existent key', async () => {
      const result = await cache.get('non-existent-key');
      
      expect(result.found).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should return { value: null, found: false } for expired key', async () => {
      const key = 'expired-key';
      const value = 'will-expire';
      
      // Set a very short TTL (1ms in seconds)
      await cache.set(key, value, 0.001);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const result = await cache.get(key);
      expect(result.found).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should clean up expired keys on access', async () => {
      const key = 'cleanup-key';
      
      // Set with short TTL
      await cache.set(key, 'data', 0.001);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Access should clean up
      await cache.get(key);
      
      // Value should be removed from database
      const result = await cache.get(key);
      expect(result.found).toBe(false);
    });
  });

  describe('delete()', () => {
    it('should return true for existing key and remove it', async () => {
      const key = 'delete-key';
      
      await cache.set(key, 'value-to-delete');
      
      const deleted = await cache.delete(key);
      expect(deleted).toBe(true);
      
      const result = await cache.get(key);
      expect(result.found).toBe(false);
    });

    it('should return false for non-existent key', async () => {
      const deleted = await cache.delete('non-existent-key');
      expect(deleted).toBe(false);
    });

    it('should remove TTL entry as well', async () => {
      const key = 'delete-with-ttl';
      
      await cache.set(key, 'has-ttl', 60);
      
      const deleted = await cache.delete(key);
      expect(deleted).toBe(true);
      
      // Key should be gone
      const result = await cache.get(key);
      expect(result.found).toBe(false);
    });

    it('should not throw when deleting expired key', async () => {
      // Verify delete handles expired keys gracefully
      const key = 'expired-delete';
      
      // Set with short TTL
      await cache.set(key, 'temp', 0.001);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Key is now expired - delete should still work without throwing
      // It may return true or false depending on whether value still exists
      await expect(cache.delete(key)).resolves.not.toThrow();
    });
  });

  describe('has()', () => {
    it('should return true for existing key', async () => {
      const key = 'has-key';
      
      await cache.set(key, 'exists');
      
      const exists = await cache.has(key);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      const exists = await cache.has('non-existent-key');
      expect(exists).toBe(false);
    });

    it('should return false for expired key', async () => {
      const key = 'has-expired';
      
      await cache.set(key, 'expires', 0.001);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const exists = await cache.has(key);
      expect(exists).toBe(false);
    });

    it('should return true for stored null value', async () => {
      const key = 'has-null';
      
      await cache.set(key, null);
      
      const exists = await cache.has(key);
      expect(exists).toBe(true);
    });
  });

  describe('namespace support', () => {
    it('should prefix key with namespace for set()', async () => {
      const key = 'user';
      const namespace = 'app';
      const value = 'namespaced-value';
      
      await cache.set(key, value, undefined, namespace);
      
      const result = await cache.get(key, namespace);
      expect(result.found).toBe(true);
      expect(result.value).toBe(value);
    });

    it('should retrieve namespaced values correctly', async () => {
      // Set same key in different namespaces
      await cache.set('config', 'value-ns1', undefined, 'ns1');
      await cache.set('config', 'value-ns2', undefined, 'ns2');
      await cache.set('config', 'value-no-ns');
      
      expect((await cache.get('config', 'ns1')).value).toBe('value-ns1');
      expect((await cache.get('config', 'ns2')).value).toBe('value-ns2');
      expect((await cache.get('config')).value).toBe('value-no-ns');
    });

    it('should return not found when key exists without namespace', async () => {
      await cache.set('key', 'no-namespace');
      
      const result = await cache.get('key', 'other-namespace');
      expect(result.found).toBe(false);
    });

    it('should delete namespaced keys correctly', async () => {
      await cache.set('key', 'in-namespace', undefined, 'ns1');
      await cache.set('key', 'without-namespace');
      
      // Delete only namespaced version
      const deleted = await cache.delete('key', 'ns1');
      expect(deleted).toBe(true);
      
      // Non-namespaced should still exist
      expect((await cache.get('key')).found).toBe(true);
      
      // Namespaced should be gone
      expect((await cache.get('key', 'ns1')).found).toBe(false);
    });

    it('should check existence with namespace correctly', async () => {
      await cache.set('item', 'data', undefined, 'inventory');
      
      expect(await cache.has('item', 'inventory')).toBe(true);
      expect(await cache.has('item')).toBe(false);
      expect(await cache.has('item', 'other-ns')).toBe(false);
    });

    it('should namespace TTL entries independently', async () => {
      // Set in ns1 with short TTL
      await cache.set('expiring', 'data-ns1', 0.001, 'ns1');
      
      // Set in ns2 with longer TTL
      await cache.set('expiring', 'data-ns2', 60, 'ns2');
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // ns1 should be expired
      expect((await cache.get('expiring', 'ns1')).found).toBe(false);
      
      // ns2 should still exist
      expect((await cache.get('expiring', 'ns2')).found).toBe(true);
    });
  });

  describe('full lifecycle', () => {
    it('should support set → get → delete → get returns not found', async () => {
      const key = 'lifecycle-key';
      const value = { test: 'data' };
      
      // Set
      await cache.set(key, value);
      
      // Get - should find it
      let result = await cache.get(key);
      expect(result.found).toBe(true);
      expect(result.value).toEqual(value);
      
      // Delete
      const deleted = await cache.delete(key);
      expect(deleted).toBe(true);
      
      // Get - should not find it
      result = await cache.get(key);
      expect(result.found).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should support lifecycle with TTL', async () => {
      const key = 'lifecycle-ttl';
      const value = 'expires';
      
      // Set with TTL
      await cache.set(key, value, 60);
      
      // Should exist
      expect(await cache.has(key)).toBe(true);
      
      // Delete
      expect(await cache.delete(key)).toBe(true);
      
      // Should not exist
      expect(await cache.has(key)).toBe(false);
    });

    it('should support lifecycle with namespace', async () => {
      const key = 'lifecycle-ns';
      const namespace = 'test-ns';
      const value = 'namespaced';
      
      // Set with namespace
      await cache.set(key, value, undefined, namespace);
      
      // Get with same namespace
      const result = await cache.get(key, namespace);
      expect(result.found).toBe(true);
      expect(result.value).toBe(value);
      
      // Delete with namespace
      const deleted = await cache.delete(key, namespace);
      expect(deleted).toBe(true);
      
      // Get should return not found
      expect((await cache.get(key, namespace)).found).toBe(false);
    });
  });

  describe('singleton functions', () => {
    it('should initialize and get singleton instance', async () => {
      resetCacheService();
      
      // Should throw before initialization
      expect(() => getCacheService()).toThrow('CacheService not initialized');
      
      // Initialize
      const instance = initCacheService(rootDb);
      expect(instance).toBeInstanceOf(CacheService);
      
      // Get should return same instance
      const sameInstance = getCacheService();
      expect(sameInstance).toBe(instance);
    });

    it('should reset singleton instance', async () => {
      initCacheService(rootDb);
      expect(getCacheService()).toBeInstanceOf(CacheService);
      
      resetCacheService();
      
      expect(() => getCacheService()).toThrow('CacheService not initialized');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string values', async () => {
      await cache.set('empty', '');
      const result = await cache.get('empty');
      expect(result.found).toBe(true);
      expect(result.value).toBe('');
    });

    it('should handle numeric zero', async () => {
      await cache.set('zero', 0);
      const result = await cache.get('zero');
      expect(result.found).toBe(true);
      expect(result.value).toBe(0);
    });

    it('should handle boolean false', async () => {
      await cache.set('false', false);
      const result = await cache.get('false');
      expect(result.found).toBe(true);
      expect(result.value).toBe(false);
    });

    it('should handle empty arrays', async () => {
      await cache.set('empty-array', []);
      const result = await cache.get('empty-array');
      expect(result.found).toBe(true);
      expect(result.value).toEqual([]);
    });

    it('should handle empty objects', async () => {
      await cache.set('empty-obj', {});
      const result = await cache.get('empty-obj');
      expect(result.found).toBe(true);
      expect(result.value).toEqual({});
    });

    it('should handle keys with special characters', async () => {
      const specialKey = 'key:with:colons:and-dashes_and_underscores';
      
      await cache.set(specialKey, 'special');
      const result = await cache.get(specialKey);
      expect(result.found).toBe(true);
      expect(result.value).toBe('special');
    });

    it('should handle deeply nested objects', async () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep'
              }
            }
          }
        }
      };
      
      await cache.set('nested', nested);
      const result = await cache.get('nested');
      expect(result.found).toBe(true);
      expect(result.value).toEqual(nested);
    });
  });
});