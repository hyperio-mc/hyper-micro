/**
 * Authentication Middleware for hyper-micro
 * API key based authentication using Bearer tokens
 */

import { Context, Next } from 'hono';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * Hash an API key using SHA256
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Timing-safe comparison of two strings.
 * Prevents timing attacks by ensuring consistent comparison time
 * regardless of where the mismatch occurs.
 * 
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal, false otherwise
 */
function safeCompare(a: string, b: string): boolean {
  // Handle edge cases
  if (a.length !== b.length) {
    // Still perform a comparison to maintain timing consistency
    // Use the longer string's length to avoid leaking length info
    const maxLen = Math.max(a.length, b.length);
    const paddedA = a.padEnd(maxLen, '\0');
    const paddedB = b.padEnd(maxLen, '\0');
    try {
      return timingSafeEqual(Buffer.from(paddedA), Buffer.from(paddedB)) && a.length === b.length;
    } catch {
      return false;
    }
  }

  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Check if a candidate key matches any of the valid keys using timing-safe comparison.
 * 
 * @param candidate - The key to validate
 * @param validKeys - Array of valid keys to compare against
 * @returns true if candidate matches any valid key
 */
function validateKeyTimingSafe(candidate: string, validKeys: string[]): boolean {
  if (!candidate || validKeys.length === 0) {
    return false;
  }
  
  // Compare against all keys to maintain consistent timing
  let isValid = false;
  for (const key of validKeys) {
    if (safeCompare(candidate, key)) {
      isValid = true;
      // Continue checking all keys to maintain consistent timing
    }
  }
  return isValid;
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
  
  // Use timing-safe comparison to prevent timing attacks
  if (!validateKeyTimingSafe(apiKey, validKeys)) {
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
