/**
 * Authentication Middleware for hyper-micro
 * API key based authentication using Bearer tokens
 */

import { Context, Next } from 'hono';
import { createHash } from 'crypto';

/**
 * Hash an API key using SHA256
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Authentication middleware - simplified version
 * Validates Bearer token against configured API keys
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
  
  // Get valid keys from context (set by server)
  const validKeys = c.get('validKeys') || [];
  
  if (!validKeys.includes(apiKey)) {
    return c.json(
      {
        ok: false,
        error: 'Unauthorized',
        message: 'Invalid API key',
      },
      401
    );
  }

  // Set auth context
  c.set('auth', {
    keyId: 'default',
    keyName: 'API Key',
  });

  await next();
}

/**
 * Optional auth middleware - allows access with or without auth
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  await next();
}
