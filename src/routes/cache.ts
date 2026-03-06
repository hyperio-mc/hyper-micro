/**
 * @fileoverview Cache Routes - Cache API Endpoints
 *
 * Provides REST endpoints for cache operations with TTL support.
 * All routes require Bearer token authentication.
 *
 * ## Phase 1 Endpoints (Implemented)
 * - `GET /api/cache/:key` - Get cache value
 * - `PUT /api/cache/:key` - Set cache value with optional TTL
 * - `DELETE /api/cache/:key` - Delete cache entry
 * - `HEAD /api/cache/:key` - Check if key exists (returns X-TTL header)
 *
 * ## Phase 2 Endpoints (Future Tasks)
 * - `POST /api/cache/keys` - List keys by pattern
 * - `POST /api/cache/incr/:key` - Increment counter
 * - `POST /api/cache/batch` - Batch operations
 * - `GET /api/cache/:key/ttl` - Get remaining TTL
 * - `GET /api/cache/health` - Health check with latency
 *
 * @module routes/cache
 */

import { Hono } from 'hono';
import { Context, Next } from 'hono';
import { getCacheService } from '../services/cache.js';
import { validateApiKey } from '../db/index.js';
import { loadConfig } from '../server/index.js';

/**
 * Cache authentication middleware.
 * Validates API keys from Authorization header against environment
 * config and database-stored keys.
 */
async function cacheAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json({
      ok: false,
      error: 'Unauthorized',
      message: 'Missing Authorization header',
    }, 401);
  }

  // Check Bearer format
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return c.json({
      ok: false,
      error: 'Unauthorized',
      message: 'Invalid Authorization header format. Expected: Bearer <api-key>',
    }, 401);
  }

  const apiKey = parts[1];

  // Validate against environment keys
  const config = loadConfig();
  const isValidEnvKey = config.API_KEYS.includes(apiKey);

  // Validate against database keys
  const isValidDbKey = await validateApiKey(apiKey);

  if (!isValidEnvKey && !isValidDbKey) {
    return c.json({
      ok: false,
      error: 'Unauthorized',
      message: 'Invalid API key',
    }, 401);
  }

  // Set auth context
  c.set('auth', {
    keyId: 'default',
    keyName: 'API Key',
  });

  await next();
}

/** Hono router for cache routes */
export const cacheRoutes = new Hono();

// Apply authentication middleware to all cache routes
cacheRoutes.use('/*', cacheAuthMiddleware);

/**
 * Get a value from the cache.
 * Returns the value and found status.
 *
 * @route GET /api/cache/:key
 * @returns {Object} 200 - { value, found: true }
 * @returns {Object} 404 - { value: null, found: false }
 *
 * @example
 * // Request
 * GET /api/cache/user:123
 * Authorization: Bearer <api-key>
 *
 * // Response (found)
 * { "value": { "name": "Alice" }, "found": true }
 *
 * // Response (not found)
 * { "value": null, "found": false }
 */
cacheRoutes.get('/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const namespace = c.req.query('namespace');

    const cache = getCacheService();
    const result = await cache.get(key, namespace);

    return c.json({
      value: result.value,
      found: result.found,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get cache value';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Store a value in the cache with optional TTL.
 *
 * @route PUT /api/cache/:key
 * @body { value: any, ttl?: number, namespace?: string }
 * @returns {Object} 200 - { ok: true, key, ttl? }
 *
 * @example
 * // Request (permanent)
 * PUT /api/cache/config
 * Authorization: Bearer <api-key>
 * { "value": { "theme": "dark" } }
 *
 * // Request (with TTL)
 * PUT /api/cache/session:abc
 * Authorization: Bearer <api-key>
 * { "value": { "userId": 123 }, "ttl": 3600 }
 *
 * // Response
 * { "ok": true, "key": "session:abc", "ttl": 3600 }
 */
cacheRoutes.put('/:key', async (c) => {
  try {
    const key = c.req.param('key');

    let body: { value: unknown; ttl?: number; namespace?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        ok: false,
        error: 'Invalid JSON body',
      }, 400);
    }

    if (body.value === undefined) {
      return c.json({
        ok: false,
        error: 'value is required',
      }, 400);
    }

    if (body.ttl !== undefined && (typeof body.ttl !== 'number' || body.ttl <= 0)) {
      return c.json({
        ok: false,
        error: 'ttl must be a positive number',
      }, 400);
    }

    const cache = getCacheService();
    await cache.set(key, body.value, body.ttl, body.namespace);

    const response: { ok: boolean; key: string; ttl?: number } = {
      ok: true,
      key,
    };

    if (body.ttl) {
      response.ttl = body.ttl;
    }

    return c.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set cache value';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Delete a value from the cache.
 *
 * @route DELETE /api/cache/:key
 * @returns {Object} 200 - { deleted: boolean }
 *
 * @example
 * // Request
 * DELETE /api/cache/user:123?namespace=sessions
 * Authorization: Bearer <api-key>
 *
 * // Response
 * { "deleted": true }
 */
cacheRoutes.delete('/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const namespace = c.req.query('namespace');

    const cache = getCacheService();
    const deleted = await cache.delete(key, namespace);

    return c.json({
      deleted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete cache value';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Check if a key exists in the cache.
 * Returns 200 if found, 404 if not found.
 * Includes X-TTL header with remaining TTL in seconds (-1 if no TTL).
 *
 * @route HEAD /api/cache/:key
 * @returns {void} 200 - Key exists (X-TTL header)
 * @returns {void} 404 - Key not found
 *
 * @example
 * // Request
 * HEAD /api/cache/user:123?namespace=sessions
 * Authorization: Bearer <api-key>
 *
 * // Response (found)
 * HTTP/1.1 200 OK
 * X-TTL: 45
 *
 * // Response (not found)
 * HTTP/1.1 404 Not Found
 */
cacheRoutes.on('HEAD', '/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const namespace = c.req.query('namespace');

    const cache = getCacheService();
    const exists = await cache.has(key, namespace);

    if (!exists) {
      // Return empty body with 404 status
      return c.body(null, 404);
    }

    // Get TTL info
    const ttl = await cache.getTtl(key, namespace);

    // Set X-TTL header
    // ttl is: -1 for permanent (no TTL), positive for remaining seconds
    c.header('X-TTL', ttl.toString());

    return c.body(null, 200);
  } catch (err) {
    console.error('HEAD /api/cache/:key error:', err);
    return c.body(null, 500);
  }
});

export default cacheRoutes;