/**
 * @fileoverview Auth API - API Key Management
 * 
 * This module provides REST endpoints for managing API keys.
 * These endpoints are exempt from authentication requirements.
 * 
 * ## Endpoints
 * - `POST /api/auth` - Generate a new API key
 * - `GET /api/auth` - List all API keys (without actual key values)
 * - `DELETE /api/auth/:id` - Revoke an API key
 * - `POST /api/auth/validate` - Validate an API key
 * 
 * @module api/auth
 * @example
 * ```bash
 * # Generate a new API key
 * curl -X POST http://localhost:3000/api/auth \
 *   -H "Content-Type: application/json" \
 *   -d '{"name": "my-app"}'
 * 
 * # List keys
 * curl http://localhost:3000/api/auth
 * 
 * # Validate a key
 * curl -X POST http://localhost:3000/api/auth/validate \
 *   -H "Content-Type: application/json" \
 *   -d '{"key": "hm_abc123..."}'
 * ```
 */

import { Hono } from 'hono';
import { generateApiKey, listApiKeys, deleteApiKey, validateApiKey } from '../db/index.js';

/** Hono router for auth API endpoints */
export const authApi = new Hono();

// ============================================
// API Key Management
// ============================================

/**
 * Generates a new API key.
 * The key is returned only once - store it securely!
 * 
 * @route POST /api/auth
 * @body { name?: string } - Optional friendly name for the key
 * @returns {Object} 201 - { ok: true, key: string, id: string, name?: string }
 * @auth None required (this creates keys for authentication)
 * 
 * @example
 * ```bash
 * curl -X POST http://localhost:3000/api/auth \
 *   -H "Content-Type: application/json" \
 *   -d '{"name": "my-app"}'
 * ```
 */
authApi.post('/', async (c) => {
  try {
    let body: { name?: string } = {};
    
    // Try to parse JSON body
    const contentType = c.req.header('Content-Type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await c.req.json();
      } catch {
        // Ignore parse errors, use defaults
      }
    }
    
    // Generate new key
    const result = await generateApiKey(body.name);
    
    return c.json({
      ok: true,
      key: result.key,
      id: result.id,
      name: result.name
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate API key';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Lists all API keys (without exposing actual key values).
 * Returns metadata for key management purposes.
 * 
 * @route GET /api/auth
 * @returns {Object} 200 - { ok: true, keys: Array<{id: string, name: string, created: string}> }
 * @auth None required
 * 
 * @example
 * ```bash
 * curl http://localhost:3000/api/auth
 * ```
 */
authApi.get('/', async (c) => {
  try {
    const keys = await listApiKeys();
    
    return c.json({
      ok: true,
      keys
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list API keys';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Revokes (deletes) an API key.
 * After revocation, the key will no longer work for authentication.
 * 
 * @route DELETE /api/auth/:id
 * @param {string} id - API key UUID (URL parameter)
 * @returns {Object} 200 - { ok: true }
 * @auth None required
 * 
 * @example
 * ```bash
 * curl -X DELETE http://localhost:3000/api/auth/550e8400-e29b-41d4-a716-446655440000
 * ```
 */
authApi.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    
    if (!id) {
      return c.json({
        ok: false,
        error: 'Key ID is required'
      }, 400);
    }
    
    await deleteApiKey(id);
    
    return c.json({
      ok: true
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete API key';
    return c.json({
      Ok: false,
      error: message
    }, 500);
  }
});

/**
 * Validates an API key.
 * Useful for checking if a key is still valid before making authenticated requests.
 * 
 * @route POST /api/auth/validate
 * @body { key: string } - The API key to validate
 * @returns {Object} 200 - { ok: true, valid: boolean }
 * @returns {Object} 400 - { ok: false, error: string } - Key is required
 * @auth None required
 * 
 * @example
 * ```bash
 * curl -X POST http://localhost:3000/api/auth/validate \
 *   -H "Content-Type: application/json" \
 *   -d '{"key": "hm_abc123..."}'
 * ```
 */
authApi.post('/validate', async (c) => {
  try {
    let body: { key?: string } = {};
    
    const contentType = c.req.header('Content-Type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await c.req.json();
      } catch {
        // Ignore
      }
    }
    
    if (!body.key) {
      return c.json({
        ok: false,
        error: 'API key is required'
      }, 400);
    }
    
    const valid = await validateApiKey(body.key);
    
    return c.json({
      ok: true,
      valid
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to validate API key';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

export default authApi;
