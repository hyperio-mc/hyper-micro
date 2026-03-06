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

    describe('PUT /api/cache/:key', () => {
      it('should return 401 without Authorization header', async () => {
        const res = await app.request('/api/cache/test-key', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 'test' })
        });
        expect(res.status).toBe(401);

        const data = await res.json();
        expect(data.error).toBe('Unauthorized');
      });

      it('should return 401 with invalid API key', async () => {
        const res = await app.request('/api/cache/test-key', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer invalid-key'
          },
          body: JSON.stringify({ value: 'test' })
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

    describe('HEAD /api/cache/:key', () => {
      it('should return 401 without Authorization header', async () => {
        const res = await app.request('/api/cache/test-key', {
          method: 'HEAD'
        });
        expect(res.status).toBe(401);
      });

      it('should return 401 with invalid API key', async () => {
        const res = await app.request('/api/cache/test-key', {
          method: 'HEAD',
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
      await app.request('/api/cache/mykey', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 'stored-value' }),
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
      await app.request('/api/cache/complex', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: complexValue }),
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
      await app.request('/api/cache/user:123', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 'user-data' }),
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
  // PUT /api/cache/:key
  // ============================================

  describe('PUT /api/cache/:key', () => {
    it('should store value and return { ok, key }', async () => {
      const res = await app.request('/api/cache/newkey', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 'my-value' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({
        ok: true,
        key: 'newkey',
      });
    });

    it('should store value with TTL and return ttl in response', async () => {
      const res = await app.request('/api/cache/ttlkey', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 'expires-soon', ttl: 3600 }),
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
      await app.request('/api/cache/overwrite', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 'first' }),
      });

      // Overwrite with new value
      await app.request('/api/cache/overwrite', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 'second' }),
      });

      // Retrieve and verify
      const res = await app.request('/api/cache/overwrite', {
        headers: authHeaders()
      });

      const data = await res.json();
      expect(data.value).toBe('second');
    });

    it('should return 400 for missing value', async () => {
      const res = await app.request('/api/cache/no-value', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}), // No value field
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('value is required');
    });

    it('should return 400 for invalid TTL (non-positive)', async () => {
      const res = await app.request('/api/cache/bad-ttl', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 'test', ttl: -100 }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('ttl must be a positive number');
    });

    it('should return 400 for invalid TTL (zero)', async () => {
      const res = await app.request('/api/cache/zero-ttl', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: 'test', ttl: 0 }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('ttl must be a positive number');
    });

    it('should return 400 for invalid JSON body', async () => {
      const res = await app.request('/api/cache/bad-json', {
        method: 'PUT',
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
      const res = await app.request('/api/cache/null-value', {
        method: 'PUT',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: null }),
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
      let res = await app.request('/api/cache/type-string', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'hello' }),
      });
      expect(res.status).toBe(200);

      // Number
      res = await app.request('/api/cache/type-number', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 42 }),
      });
      expect(res.status).toBe(200);

      // Boolean
      res = await app.request('/api/cache/type-bool', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: true }),
      });
      expect(res.status).toBe(200);

      // Array
      res = await app.request('/api/cache/type-array', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: [1, 2, 3] }),
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
      await app.request('/api/cache/to-delete', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'delete-me' }),
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
      await app.request('/api/cache/ttl-delete', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'has-ttl', ttl: 60 }),
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
  // HEAD /api/cache/:key
  // ============================================

  describe('HEAD /api/cache/:key', () => {
    it('should return 200 with X-TTL header for existing key without TTL', async () => {
      // Store a value without TTL
      await app.request('/api/cache/head-check', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'exists' }),
      });

      // Check with HEAD
      const res = await app.request('/api/cache/head-check', {
        method: 'HEAD',
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-TTL')).toBe('-1'); // -1 for permanent (no TTL)
    });

    it('should return 200 with X-TTL header for existing key with TTL', async () => {
      // Store a value with TTL
      await app.request('/api/cache/head-ttl', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'expires', ttl: 60 }),
      });

      // Check with HEAD
      const res = await app.request('/api/cache/head-ttl', {
        method: 'HEAD',
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const ttlHeader = res.headers.get('X-TTL');
      expect(ttlHeader).not.toBeNull();
      // TTL should be positive (around 60 seconds, but might be slightly less due to time elapsed)
      const ttl = parseInt(ttlHeader!, 10);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('should return 404 for non-existent key', async () => {
      const res = await app.request('/api/cache/nonexistent-head', {
        method: 'HEAD',
        headers: authHeaders()
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 for expired key', async () => {
      // Store with very short TTL
      await app.request('/api/cache/expired-head', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'expires-fast', ttl: 0.001 }), // 1ms
      });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 50));

      // Check with HEAD
      const res = await app.request('/api/cache/expired-head', {
        method: 'HEAD',
        headers: authHeaders()
      });

      expect(res.status).toBe(404);
    });

    it('should return empty body', async () => {
      // Store a value
      await app.request('/api/cache/head-empty', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'test' }),
      });

      // HEAD request should have empty body
      const res = await app.request('/api/cache/head-empty', {
        method: 'HEAD',
        headers: authHeaders()
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('');
    });
  });

  // ============================================
  // Namespace Support (Phase 2 Preview)
  // ============================================

  describe('Namespace support', () => {
    it('should store and retrieve values with namespace', async () => {
      // Store in namespace
      const res = await app.request('/api/cache/nskey?namespace=app1', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'namespaced-value' }),
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
      await app.request('/api/cache/shared?namespace=ns1', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'value-ns1' }),
      });

      await app.request('/api/cache/shared?namespace=ns2', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'value-ns2' }),
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
      await app.request('/api/cache/isolated', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'no-namespace' }),
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
      await app.request('/api/cache/del-ns?namespace=todelete', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'will-delete' }),
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

    it('should HEAD check with namespace', async () => {
      // Store with namespace and TTL
      await app.request('/api/cache/head-ns?namespace=testns', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'ns-value', ttl: 120 }),
      });

      // HEAD check
      const res = await app.request('/api/cache/head-ns?namespace=testns', {
        method: 'HEAD',
        headers: authHeaders()
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('X-TTL')).not.toBeNull();

      // HEAD check wrong namespace
      const res2 = await app.request('/api/cache/head-ns?namespace=wrongns', {
        method: 'HEAD',
        headers: authHeaders()
      });
      expect(res2.status).toBe(404);
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
      const setRes = await app.request(`/api/cache/${key}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
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
      const setRes = await app.request('/api/cache/ttl-lifecycle', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'expires', ttl: 60 }),
      });
      expect(setRes.status).toBe(200);

      // HEAD should return 200
      const headRes1 = await app.request('/api/cache/ttl-lifecycle', {
        method: 'HEAD',
        headers: authHeaders()
      });
      expect(headRes1.status).toBe(200);

      // Delete
      await app.request('/api/cache/ttl-lifecycle', {
        method: 'DELETE',
        headers: authHeaders()
      });

      // HEAD should return 404
      const headRes2 = await app.request('/api/cache/ttl-lifecycle', {
        method: 'HEAD',
        headers: authHeaders()
      });
      expect(headRes2.status).toBe(404);
    });
  });
});