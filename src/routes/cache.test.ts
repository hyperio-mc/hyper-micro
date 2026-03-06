/**
 * @fileoverview Integration tests for Cache API Routes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { open, RootDatabase } from 'lmdb';
import { tmpdir } from 'node:os';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { cacheRoutes } from './cache.js';
import { initCacheService, resetCacheService } from '../services/cache.js';

describe('Cache API Routes', () => {
  let tempDir: string;
  let rootDb: RootDatabase;
  let app: Hono;
  let originalApiKey: string | undefined;

  // Test API key that matches the default dev key
  const testApiKey = 'dev-key-change-in-production';

  beforeEach(async () => {
    // Save original API_KEYS
    originalApiKey = process.env.API_KEYS;

    // Set test API key
    process.env.API_KEYS = testApiKey;

    // Create a temporary directory for each test
    tempDir = join(tmpdir(), `hyper-micro-cache-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });

    rootDb = open({
      path: tempDir,
      name: 'root',
    });

    // Initialize cache service
    initCacheService(rootDb);

    // Create Hono app with cache routes
    // Note: cacheRoutes has its own auth middleware
    app = new Hono();
    app.route('/api/cache', cacheRoutes);
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

    // Restore original API_KEYS
    if (originalApiKey === undefined) {
      delete process.env.API_KEYS;
    } else {
      process.env.API_KEYS = originalApiKey;
    }
  });

  // Helper to make authenticated requests
  const authHeaders = () => ({
    'Authorization': `Bearer ${testApiKey}`
  });

  // ============================================
  // Authentication Tests
  // ============================================

  describe('Authentication', () => {
    describe('GET /api/cache/:key', () => {
      it('should return 401 without Authorization header', async () => {
        const res = await app.request('/api/cache/test-key');
        expect(res.status).toBe(401);

        const data = await res.json();
        expect(data).toMatchObject({
          ok: false,
          error: 'Unauthorized',
        });
        expect(data.message).toContain('Missing Authorization header');
      });

      it('should return 401 with invalid Authorization format', async () => {
        const res = await app.request('/api/cache/test-key', {
          headers: { 'Authorization': 'InvalidFormat token123' }
        });
        expect(res.status).toBe(401);

        const data = await res.json();
        expect(data).toMatchObject({
          ok: false,
          error: 'Unauthorized',
        });
        expect(data.message).toContain('Invalid Authorization header format');
      });

      it('should return 401 with invalid API key', async () => {
        const res = await app.request('/api/cache/test-key', {
          headers: { 'Authorization': 'Bearer invalid-key' }
        });
        expect(res.status).toBe(401);

        const data = await res.json();
        expect(data).toMatchObject({
          ok: false,
          error: 'Unauthorized',
          message: 'Invalid API key',
        });
      });
    });

    describe('POST /api/cache/set', () => {
      it('should return 401 without Authorization header', async () => {
        const res = await app.request('/api/cache/set', {
          method: "POST",
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'test-key', value: 'test' })
        });
        expect(res.status).toBe(401);

        const data = await res.json();
        expect(data.error).toBe('Unauthorized');
      });

      it('should return 401 with invalid API key', async () => {
        const res = await app.request('/api/cache/set', {
          method: "POST",
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer invalid-key'
          },
          body: JSON.stringify({ key: 'test-key', value: 'test' })
        });
        expect(res.status).toBe(401);
      });
    });

    describe('DELETE /api/cache/:key', () => {
      it('should return 401 without Authorization header', async () => {
        const res = await app.request('/api/cache/test-key', {
          method: 'DELETE'
        });
        expect(res.status).toBe(401);

        const data = await res.json();
        expect(data.error).toBe('Unauthorized');
      });

      it('should return 401 with invalid API key', async () => {
        const res = await app.request('/api/cache/test-key', {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer invalid-key' }
        });
        expect(res.status).toBe(401);
      });
    });

    describe('GET /api/cache/:key/exists', () => {
      it('should return 401 without Authorization header', async () => {
        const res = await app.request('/api/cache/test-key/exists');
        expect(res.status).toBe(401);
      });

      it('should return 401 with invalid API key', async () => {
        const res = await app.request('/api/cache/test-key/exists', {
          headers: { 'Authorization': 'Bearer invalid-key' }
        });
        expect(res.status).toBe(401);
      });
    });
  });

  // ============================================
  // GET /api/cache/:key
  // ============================================

  describe('GET /api/cache/:key', () => {
    it('should return { value: null, found: false } for non-existent key', async () => {
      const res = await app.request('/api/cache/nonexistent', {
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        value: null,
        found: false,
      });
    });

    it('should return { value, found: true } for existing key', async () => {
      // First store a value
      await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'mykey', value: 'stored-value' }),
      });

      // Then retrieve it
      const res = await app.request('/api/cache/mykey', {
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        value: 'stored-value',
        found: true,
      });
    });

    it('should return complex objects correctly', async () => {
      const complexValue = {
        user: {
          id: 123,
          name: 'Alice',
          roles: ['admin', 'user'],
          metadata: {
            lastLogin: '2024-01-15',
            preferences: { theme: 'dark', notifications: true }
          }
        }
      };

      // Store complex object
      await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'complex', value: complexValue }),
      });

      // Retrieve it
      const res = await app.request('/api/cache/complex', {
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.found).toBe(true);
      expect(data.value).toEqual(complexValue);
    });

    it('should handle URL-encoded keys', async () => {
      // Store with key containing special characters
      await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'user:123', value: 'user-data' }),
      });

      // Retrieve it
      const res = await app.request('/api/cache/user:123', {
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.found).toBe(true);
      expect(data.value).toBe('user-data');
    });
  });

  // ============================================
  // POST /api/cache/set
  // ============================================

  describe('POST /api/cache/set', () => {
    it('should store value and return { ok, key }', async () => {
      const res = await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'newkey', value: 'my-value' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({
        ok: true,
        key: 'newkey',
      });
    });

    it('should store value with TTL and return ttl in response', async () => {
      const res = await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'ttlkey', value: 'expires-soon', ttl: 3600 }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({
        ok: true,
        key: 'ttlkey',
        ttl: 3600,
      });
    });

    it('should overwrite existing value', async () => {
      // Store initial value
      await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'overwrite', value: 'first' }),
      });

      // Overwrite with new value
      await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'overwrite', value: 'second' }),
      });

      // Retrieve and verify
      const res = await app.request('/api/cache/overwrite', {
        headers: authHeaders()
      });

      const data = await res.json();
      expect(data.value).toBe('second');
    });

    it('should return 400 for missing value', async () => {
      const res = await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'no-value' }), // No value field
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('value is required');
    });

    it('should return 400 for missing key', async () => {
      const res = await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 'test' }), // No key field
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('key is required');
    });

    it('should return 400 for invalid TTL (non-positive)', async () => {
      const res = await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'bad-ttl', value: 'test', ttl: -100 }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('ttl must be a positive number');
    });

    it('should return 400 for invalid TTL (zero)', async () => {
      const res = await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'zero-ttl', value: 'test', ttl: 0 }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('ttl must be a positive number');
    });

    it('should return 400 for invalid JSON body', async () => {
      const res = await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: 'not valid json',
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid JSON');
    });

    it('should store null values', async () => {
      const res = await app.request('/api/cache/set', {
        method: "POST",
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'null-value', value: null }),
      });

      expect(res.status).toBe(200);

      // Retrieve and verify null value stored
      const getRes = await app.request('/api/cache/null-value', {
        headers: authHeaders()
      });

      const data = await getRes.json();
      expect(data.found).toBe(true);
      expect(data.value).toBeNull();
    });

    it('should store various data types', async () => {
      // String
      let res = await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'type-string', value: 'hello' }),
      });
      expect(res.status).toBe(200);

      // Number
      res = await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'type-number', value: 42 }),
      });
      expect(res.status).toBe(200);

      // Boolean
      res = await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'type-bool', value: true }),
      });
      expect(res.status).toBe(200);

      // Array
      res = await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'type-array', value: [1, 2, 3] }),
      });
      expect(res.status).toBe(200);

      // Verify retrieval
      const getRes = await app.request('/api/cache/type-array', {
        headers: authHeaders()
      });
      const data = await getRes.json();
      expect(data.value).toEqual([1, 2, 3]);
    });
  });

  // ============================================
  // DELETE /api/cache/:key
  // ============================================

  describe('DELETE /api/cache/:key', () => {
    it('should return { deleted: true } for existing key', async () => {
      // Store a value first
      await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'to-delete', value: 'delete-me' }),
      });

      // Delete it
      const res = await app.request('/api/cache/to-delete', {
        method: 'DELETE',
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ deleted: true });

      // Verify it's gone
      const getRes = await app.request('/api/cache/to-delete', {
        headers: authHeaders()
      });
      const getData = await getRes.json();
      expect(getData.found).toBe(false);
    });

    it('should return { deleted: false } for non-existent key', async () => {
      const res = await app.request('/api/cache/nonexistent-delete', {
        method: 'DELETE',
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ deleted: false });
    });

    it('should delete key with TTL', async () => {
      // Store with TTL
      await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ttl-delete', value: 'has-ttl', ttl: 60 }),
      });

      // Delete it
      const res = await app.request('/api/cache/ttl-delete', {
        method: 'DELETE',
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(true);

      // Verify it's gone
      const getRes = await app.request('/api/cache/ttl-delete', {
        headers: authHeaders()
      });
      const getData = await getRes.json();
      expect(getData.found).toBe(false);
    });
  });

  // ============================================
  // GET /api/cache/:key/exists
  // ============================================

  describe('GET /api/cache/:key/exists', () => {
    it('should return 200 with { exists: true, ttl: -1 } for existing key without TTL', async () => {
      // Store a value without TTL
      await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'head-check', value: 'exists' }),
      });

      // Check with GET /exists
      const res = await app.request('/api/cache/head-check/exists', {
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.exists).toBe(true);
      expect(data.ttl).toBe(-1); // -1 for permanent (no TTL)
    });

    it('should return 200 with { exists: true, ttl } for existing key with TTL', async () => {
      // Store a value with TTL
      await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'head-ttl', value: 'expires', ttl: 60 }),
      });

      // Check with GET /exists
      const res = await app.request('/api/cache/head-ttl/exists', {
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.exists).toBe(true);
      // TTL should be positive (around 60 seconds, but might be slightly less due to time elapsed)
      expect(data.ttl).toBeGreaterThan(0);
      expect(data.ttl).toBeLessThanOrEqual(60);
    });

    it('should return 200 with { exists: false } for non-existent key', async () => {
      const res = await app.request('/api/cache/nonexistent-head/exists', {
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.exists).toBe(false);
    });

    it('should return { exists: false } for expired key', async () => {
      // Store with very short TTL
      await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'expired-head', value: 'expires-fast', ttl: 0.001 }), // 1ms
      });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 50));

      // Check with GET /exists
      const res = await app.request('/api/cache/expired-head/exists', {
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.exists).toBe(false);
    });

    it('should return JSON response with exists and ttl fields', async () => {
      // Store a value
      await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'head-empty', value: 'test' }),
      });

      // GET /exists should return JSON
      const res = await app.request('/api/cache/head-empty/exists', {
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('exists');
      expect(data).toHaveProperty('ttl');
      expect(data.exists).toBe(true);
    });
  });

  // ============================================
  // Namespace Support (Phase 2 Preview)
  // ============================================

  describe('Namespace support', () => {
    it('should store and retrieve values with namespace', async () => {
      // Store in namespace
      const res = await app.request('/api/cache/set?namespace=app1', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'nskey', value: 'namespaced-value' }),
      });
      expect(res.status).toBe(200);

      // Retrieve with same namespace
      const getRes = await app.request('/api/cache/nskey?namespace=app1', {
        headers: authHeaders()
      });
      const data = await getRes.json();
      expect(data.found).toBe(true);
      expect(data.value).toBe('namespaced-value');
    });

    it('should isolate namespaces', async () => {
      // Store same key in different namespaces
      await app.request('/api/cache/set?namespace=ns1', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'shared', value: 'value-ns1' }),
      });

      await app.request('/api/cache/set?namespace=ns2', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'shared', value: 'value-ns2' }),
      });

      // Retrieve from each namespace
      const res1 = await app.request('/api/cache/shared?namespace=ns1', {
        headers: authHeaders()
      });
      expect((await res1.json()).value).toBe('value-ns1');

      const res2 = await app.request('/api/cache/shared?namespace=ns2', {
        headers: authHeaders()
      });
      expect((await res2.json()).value).toBe('value-ns2');
    });

    it('should return not found when key exists in different namespace', async () => {
      // Store without namespace
      await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'isolated', value: 'no-namespace' }),
      });

      // Try to retrieve with namespace
      const res = await app.request('/api/cache/isolated?namespace=other', {
        headers: authHeaders()
      });
      const data = await res.json();
      expect(data.found).toBe(false);
    });

    it('should delete namespaced keys', async () => {
      // Store with namespace
      await app.request('/api/cache/set?namespace=todelete', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'del-ns', value: 'will-delete' }),
      });

      // Delete with same namespace
      const res = await app.request('/api/cache/del-ns?namespace=todelete', {
        method: 'DELETE',
        headers: authHeaders()
      });
      expect(res.status).toBe(200);
      expect((await res.json()).deleted).toBe(true);

      // Try to retrieve - should be gone
      const getRes = await app.request('/api/cache/del-ns?namespace=todelete', {
        headers: authHeaders()
      });
      expect((await getRes.json()).found).toBe(false);
    });

    it('should check existence with namespace', async () => {
      // Store with namespace and TTL
      await app.request('/api/cache/set?namespace=testns', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'head-ns', value: 'ns-value', ttl: 120 }),
      });

      // Check existence
      const res = await app.request('/api/cache/head-ns/exists?namespace=testns', {
        headers: authHeaders()
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.exists).toBe(true);
      expect(data.ttl).toBeGreaterThan(0);

      // Check wrong namespace
      const res2 = await app.request('/api/cache/head-ns/exists?namespace=wrongns', {
        headers: authHeaders()
      });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.exists).toBe(false);
    });
  });

  // ============================================
  // Full Lifecycle Tests
  // ============================================

  describe('Full lifecycle', () => {
    it('should support set → get → delete → get returns not found', async () => {
      const key = 'lifecycle-test';
      const value = { test: 'data' };

      // Set
      const setRes = await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      expect(setRes.status).toBe(200);

      // Get - should find it
      const getRes1 = await app.request(`/api/cache/${key}`, {
        headers: authHeaders()
      });
      const data1 = await getRes1.json();
      expect(data1.found).toBe(true);
      expect(data1.value).toEqual(value);

      // Delete
      const delRes = await app.request(`/api/cache/${key}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      const delData = await delRes.json();
      expect(delData.deleted).toBe(true);

      // Get - should not find it
      const getRes2 = await app.request(`/api/cache/${key}`, {
        headers: authHeaders()
      });
      const data2 = await getRes2.json();
      expect(data2.found).toBe(false);
    });

    it('should support lifecycle with TTL', async () => {
      // Set with TTL
      const setRes = await app.request('/api/cache/set', {
        method: "POST",
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ttl-lifecycle', value: 'expires', ttl: 60 }),
      });
      expect(setRes.status).toBe(200);

      // GET /exists should return { exists: true }
      const existsRes1 = await app.request('/api/cache/ttl-lifecycle/exists', {
        headers: authHeaders()
      });
      expect(existsRes1.status).toBe(200);
      const existsData1 = await existsRes1.json();
      expect(existsData1.exists).toBe(true);

      // Delete
      await app.request('/api/cache/ttl-lifecycle', {
        method: 'DELETE',
        headers: authHeaders()
      });

      // GET /exists should return { exists: false }
      const existsRes2 = await app.request('/api/cache/ttl-lifecycle/exists', {
        headers: authHeaders()
      });
      expect(existsRes2.status).toBe(200);
      const existsData2 = await existsRes2.json();
      expect(existsData2.exists).toBe(false);
    });
  });
});