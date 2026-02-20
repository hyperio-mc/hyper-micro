/**
 * Authentication Middleware for hyper-micro
 * API key based authentication using Bearer tokens
 */

import { Context, Next } from 'hono';
import { createHash } from 'crypto';
import { getLmdbClient } from '../db/initialized.js';

// System database name for API keys
export const SYSTEM_DB_NAME = '__system';

// Key prefix for storing API key hashes
const KEY_PREFIX = 'api_key:';

// Types
export interface ApiKeyData {
  id: string;
  keyHash: string;
  name?: string;
  created_at: string;
}

export interface AuthContext {
  keyId: string;
  keyName?: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

/**
 * Hash an API key using SHA256
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Verify an API key against stored hashes
 * Returns the key data if valid, null otherwise
 */
async function verifyApiKey(keyHash: string): Promise<ApiKeyData | null> {
  const client = getLmdbClient();
  if (!client) {
    console.error('LMDB client not initialized');
    return null;
  }

  // Query all API keys to find matching hash
  const result = await client.query<ApiKeyData>(SYSTEM_DB_NAME, {
    prefix: KEY_PREFIX,
  });

  if (!result.ok) {
    console.error('Failed to query API keys:', result.error);
    return null;
  }

  // Find the key with matching hash
  for (const { value } of result.value) {
    if (value.keyHash === keyHash) {
      return value;
    }
  }

  return null;
}

/**
 * Authentication middleware
 * Validates Bearer token against stored API keys
 * 
 * Expects: Authorization: Bearer <api-key>
 * Sets: c.set('auth', { keyId, keyName }) on success
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json(
      {
        ok: false,
        error: 'Unauthorized',
        message: 'Missing Authorization header',
      },
      401
    );
  }

  // Check Bearer format
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return c.json(
      {
        ok: false,
        error: 'Unauthorized',
        message: 'Invalid Authorization header format. Expected: Bearer <api-key>',
      },
      401
    );
  }

  const apiKey = parts[1];
  const keyHash = hashApiKey(apiKey);

  // Verify against stored keys
  const keyData = await verifyApiKey(keyHash);

  if (!keyData) {
    return c.json(
      {
        ok: false,
        error: 'Unauthorized',
        message: 'Invalid API key',
      },
      401
    );
  }

  // Set auth context for downstream handlers
  c.set('auth', {
    keyId: keyData.id,
    keyName: keyData.name,
  });

  await next();
}

/**
 * Optional auth middleware - allows access with or without auth
 * Sets auth context if valid token provided, but doesn't reject if missing
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      const apiKey = parts[1];
      const keyHash = hashApiKey(apiKey);
      const keyData = await verifyApiKey(keyHash);

      if (keyData) {
        c.set('auth', {
          keyId: keyData.id,
          keyName: keyData.name,
        });
      }
    }
  }

  await next();
}