/**
 * @fileoverview Unit tests for TTL Manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { open, RootDatabase } from 'lmdb';
import { tmpdir } from 'node:os';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { TtlManager } from './ttl.js';

describe('TtlManager', () => {
  let tempDir: string;
  let rootDb: RootDatabase;
  let ttlManager: TtlManager;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = join(tmpdir(), `hyper-micro-ttl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    
    rootDb = open({
      path: tempDir,
      name: 'root',
    });
    
    ttlManager = new TtlManager(rootDb);
  });

  afterEach(async () => {
    // Clean up
    await rootDb.close();
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('setTtl', () => {
    it('should store a TTL entry correctly', async () => {
      const key = 'test-key';
      const ttlSeconds = 60;
      
      await ttlManager.setTtl(key, ttlSeconds);
      
      const entry = await ttlManager.getTtlEntry(key);
      expect(entry).not.toBeNull();
      expect(entry!.expiresAt).toBeGreaterThan(Date.now());
      expect(entry!.expiresAt).toBeLessThanOrEqual(Date.now() + ttlSeconds * 1000 + 100);
    });

    it('should store TTL entry with namespace', async () => {
      const key = 'user:123';
      const ttlSeconds = 120;
      const namespace = 'ns1';
      
      await ttlManager.setTtl(key, ttlSeconds, namespace);
      
      const entry = await ttlManager.getTtlEntry(key, namespace);
      expect(entry).not.toBeNull();
      expect(entry!.namespace).toBe(namespace);
      expect(entry!.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should overwrite existing TTL entry', async () => {
      const key = 'overwrite-key';
      
      await ttlManager.setTtl(key, 10);
      const entry1 = await ttlManager.getTtlEntry(key);
      
      await ttlManager.setTtl(key, 60);
      const entry2 = await ttlManager.getTtlEntry(key);
      
      expect(entry2!.expiresAt).toBeGreaterThan(entry1!.expiresAt);
    });
  });

  describe('getTtl', () => {
    it('should return remaining seconds for valid TTL', async () => {
      const key = 'remaining-key';
      const ttlSeconds = 60;
      
      await ttlManager.setTtl(key, ttlSeconds);
      
      const remaining = await ttlManager.getTtl(key);
      
      // Should be close to ttlSeconds (allow some margin for execution time)
      expect(remaining).toBeGreaterThan(ttlSeconds - 2);
      expect(remaining).toBeLessThanOrEqual(ttlSeconds);
    });

    it('should return -2 for non-existent keys', async () => {
      const result = await ttlManager.getTtl('non-existent-key');
      expect(result).toBe(-2);
    });

    it('should return -1 for expired keys', async () => {
      const key = 'expired-key';
      
      // Set a very short TTL (1ms) and wait for it to expire
      await ttlManager.setTtl(key, 0.001); // 1ms in seconds
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const result = await ttlManager.getTtl(key);
      expect(result).toBe(-1);
    });

    it('should respect namespace when getting TTL', async () => {
      const key = 'shared-key';
      
      await ttlManager.setTtl(key, 60, 'ns1');
      await ttlManager.setTtl(key, 120, 'ns2');
      
      const remaining1 = await ttlManager.getTtl(key, 'ns1');
      const remaining2 = await ttlManager.getTtl(key, 'ns2');
      const noNs = await ttlManager.getTtl(key);
      
      // Different namespaces should have different TTLs
      expect(remaining1).toBeGreaterThan(55);
      expect(remaining2).toBeGreaterThan(115);
      expect(noNs).toBe(-2); // No TTL without namespace
    });
  });

  describe('isExpired', () => {
    it('should return false for non-expired keys', async () => {
      const key = 'active-key';
      
      await ttlManager.setTtl(key, 60);
      
      const expired = await ttlManager.isExpired(key);
      expect(expired).toBe(false);
    });

    it('should return true for expired keys', async () => {
      const key = 'timed-out-key';
      
      // Set a very short TTL
      await ttlManager.setTtl(key, 0.001); // 1ms
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const expired = await ttlManager.isExpired(key);
      expect(expired).toBe(true);
    });

    it('should return true for keys without TTL entry (treated as expired)', async () => {
      const expired = await ttlManager.isExpired('no-ttl-key');
      expect(expired).toBe(true);
    });

    it('should respect namespace when checking expiration', async () => {
      const key = 'ns-expired-key';
      
      await ttlManager.setTtl(key, 0.001, 'expiring-ns');
      await ttlManager.setTtl(key, 60, 'active-ns');
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(await ttlManager.isExpired(key, 'expiring-ns')).toBe(true);
      expect(await ttlManager.isExpired(key, 'active-ns')).toBe(false);
    });
  });

  describe('removeTtl', () => {
    it('should remove a TTL entry', async () => {
      const key = 'removable-key';
      
      await ttlManager.setTtl(key, 60);
      expect(await ttlManager.getTtl(key)).toBeGreaterThan(0);
      
      await ttlManager.removeTtl(key);
      
      expect(await ttlManager.getTtl(key)).toBe(-2);
    });

    it('should not throw when removing non-existent key', async () => {
      // Should not throw
      await expect(ttlManager.removeTtl('no-such-key')).resolves.toBeUndefined();
    });

    it('should respect namespace when removing TTL', async () => {
      const key = 'ns-remove-key';
      
      await ttlManager.setTtl(key, 60, 'ns1');
      await ttlManager.setTtl(key, 60, 'ns2');
      
      await ttlManager.removeTtl(key, 'ns1');
      
      expect(await ttlManager.getTtl(key, 'ns1')).toBe(-2);
      expect(await ttlManager.getTtl(key, 'ns2')).toBeGreaterThan(0);
    });
  });

  describe('getExpiredKeys', () => {
    it('should return empty array when no keys are expired', async () => {
      await ttlManager.setTtl('active-1', 60);
      await ttlManager.setTtl('active-2', 120);
      
      const expired = await ttlManager.getExpiredKeys();
      expect(expired).toEqual([]);
    });

    it('should return all expired keys', async () => {
      await ttlManager.setTtl('expired-1', 0.001);
      await ttlManager.setTtl('expired-2', 0.001);
      await ttlManager.setTtl('active', 60);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const expired = await ttlManager.getExpiredKeys();
      expect(expired).toContain('expired-1');
      expect(expired).toContain('expired-2');
      expect(expired).not.toContain('active');
    });

    it('should filter by namespace', async () => {
      await ttlManager.setTtl('key-1', 0.001, 'ns-expired');
      await ttlManager.setTtl('key-2', 0.001, 'ns-active');
      await ttlManager.setTtl('key-3', 60, 'ns-active');
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const expiredNsExpired = await ttlManager.getExpiredKeys('ns-expired');
      expect(expiredNsExpired).toContain('key-1');
      expect(expiredNsExpired).not.toContain('key-2');
      
      const expiredNsActive = await ttlManager.getExpiredKeys('ns-active');
      expect(expiredNsActive).toContain('key-2');
      expect(expiredNsActive).not.toContain('key-3');
    });
  });

  describe('getTtlEntry', () => {
    it('should return the full TTL entry', async () => {
      const key = 'full-entry';
      const namespace = 'test-ns';
      const ttlSeconds = 60;
      
      const beforeSet = Date.now();
      await ttlManager.setTtl(key, ttlSeconds, namespace);
      const afterSet = Date.now();
      
      const entry = await ttlManager.getTtlEntry(key, namespace);
      
      expect(entry).not.toBeNull();
      expect(entry!.namespace).toBe(namespace);
      expect(entry!.expiresAt).toBeGreaterThanOrEqual(beforeSet + ttlSeconds * 1000);
      expect(entry!.expiresAt).toBeLessThanOrEqual(afterSet + ttlSeconds * 1000);
    });

    it('should return null for non-existent key', async () => {
      const entry = await ttlManager.getTtlEntry('no-such-key');
      expect(entry).toBeNull();
    });
  });
});