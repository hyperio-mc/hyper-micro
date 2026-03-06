/**
 * @fileoverview Cache Routes - Cache API Endpoints
 *
 * Provides REST endpoints for cache operations with TTL support.
 * All routes require Bearer token authentication.
 *
 * ## Endpoints
 * - `HEAD /api/cache/:key` - Check existence + X-TTL header
 * - `GET /api/cache/:key` - Get value
 * - `POST /api/cache/:key` - Set value with optional TTL
 * - `DELETE /api/cache/:key` - Delete entry
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

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return c.json({
      ok: false,
      error: 'Unauthorized',
      message: 'Invalid Authorization header format. Expected: Bearer <api-key>',
    }, 401);
  }

  const apiKey = parts[1];
  const config = loadConfig();
  const isValidEnvKey = config.API_KEYS.includes(apiKey);
  const isValidDbKey = await validateApiKey(apiKey);

  if (!isValidEnvKey && !isValidDbKey) {
    return c.json({
      ok: false,
      error: 'Unauthorized',
      message: 'Invalid API key',
    }, 401);
  }

  c.set('auth', { keyId: 'default', keyName: 'API Key' });
  await next();
}

/** Hono router for cache routes */
export const cacheRoutes = new Hono();

// Apply authentication middleware
cacheRoutes.use('/*', cacheAuthMiddleware);

// ============================================
// HEAD /api/cache/:key - Check existence
// ============================================

/**
 * Handle HEAD requests for existence check.
 * This must be registered BEFORE GET to ensure HEAD is handled correctly.
 */
const handleHead = async (c: any) => {
  try {
    const key = c.req.param('key');
    const namespace = c.req.query('namespace');

    const cache = getCacheService();
    const exists = await cache.has(key, namespace);

    if (!exists) {
      return c.json({ error: 'Not found' }, 404);
    }

    const ttl = await cache.getTtl(key, namespace);
    c.header('X-TTL', ttl.toString());
    return c.body(null, 200);
  } catch (err) {
    console.error('HEAD /api/cache/:key error:', err);
    return c.json({ error: 'Internal error' }, 500);
  }
};

// Register HEAD handler - must come before GET
cacheRoutes.on('HEAD', '/:key', handleHead);

// ============================================
// GET /api/cache/:key - Get value
// ============================================

/**
 * Get a value from the cache.
 * Returns { value, found }.
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
    return c.json({ ok: false, error: message }, 500);
  }
});

// ============================================
// POST /api/cache/:key - Set value
// ============================================

/**
 * Store a value with optional TTL.
 */
cacheRoutes.post('/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const queryNamespace = c.req.query('namespace');

    let body: { value: unknown; ttl?: number; namespace?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    if (body.value === undefined) {
      return c.json({ ok: false, error: 'value is required' }, 400);
    }

    if (body.ttl !== undefined && (typeof body.ttl !== 'number' || body.ttl <= 0)) {
      return c.json({ ok: false, error: 'ttl must be a positive number' }, 400);
    }

    const namespace = queryNamespace || body.namespace;
    const cache = getCacheService();
    await cache.set(key, body.value, body.ttl, namespace);

    const response: { ok: boolean; key: string; ttl?: number } = { ok: true, key };
    if (body.ttl) response.ttl = body.ttl;

    return c.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set cache value';
    return c.json({ ok: false, error: message }, 500);
  }
});

// ============================================
// DELETE /api/cache/:key - Delete entry
// ============================================

/**
 * Delete a value from the cache.
 */
cacheRoutes.delete('/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const namespace = c.req.query('namespace');

    const cache = getCacheService();
    const deleted = await cache.delete(key, namespace);

    return c.json({ deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete cache value';
    return c.json({ ok: false, error: message }, 500);
  }
});

export default cacheRoutes;