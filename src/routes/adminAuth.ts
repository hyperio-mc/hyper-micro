/**
 * @fileoverview Admin Authentication Routes
 * 
 * Provides REST endpoints for admin authentication via JWT tokens.
 * These endpoints allow login with email/password credentials.
 * 
 * ## Endpoints
 * - `POST /api/login` - Login with email/password, returns JWT token
 * - `POST /api/logout` - Logout (client-side token removal)
 * - `GET /api/me` - Get current admin user info
 * 
 * @module routes/adminAuth
 * @example
 * ```bash
 * # Login
 * curl -X POST http://localhost:3000/api/login \
 *   -H "Content-Type: application/json" \
 *   -d '{"email": "admin@example.com", "password": "secret123"}'
 * 
 * # Get current user
 * curl http://localhost:3000/api/me \
 *   -H "Authorization: Bearer <jwt-token>"
 * ```
 */

import { Hono, Context } from 'hono';
import bcrypt from 'bcryptjs';
import {
  getAdminAuthConfig,
  isAdminAuthConfigured,
  generateAdminToken,
  verifyAdminToken,
} from '../middleware/adminAuth.js';

// ============================================
// Rate Limiting for Login Endpoint
// ============================================

/**
 * Simple in-memory rate limiter for login attempts.
 * Limits: 5 attempts per minute per IP address.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Map of IP -> rate limit entry
const loginAttempts = new Map<string, RateLimitEntry>();

// Rate limit configuration
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Check if an IP is rate limited and get remaining attempts.
 * Returns null if not limited, or the reset time if limited.
 */
function checkRateLimit(ip: string): { limited: false; remaining: number } | { limited: true; resetAt: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  
  // No entry or window expired - reset
  if (!entry || now > entry.resetAt) {
    return { limited: false, remaining: RATE_LIMIT_MAX_ATTEMPTS };
  }
  
  // Check if limit exceeded
  if (entry.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    return { limited: true, resetAt: entry.resetAt };
  }
  
  return { limited: false, remaining: RATE_LIMIT_MAX_ATTEMPTS - entry.count };
}

/**
 * Record a login attempt for an IP.
 */
function recordLoginAttempt(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  
  if (!entry || now > entry.resetAt) {
    // Start new window
    loginAttempts.set(ip, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
  } else {
    // Increment existing entry
    entry.count++;
  }
}

/**
 * Get client IP address from request.
 * Handles X-Forwarded-For header for proxied requests.
 */
function getClientIp(c: Context): string {
  // Check X-Forwarded-For header first (for proxied requests)
  const forwardedFor = c.req.header('X-Forwarded-For');
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    return forwardedFor.split(',')[0].trim();
  }
  
  // Fall back to direct connection IP
  // Note: In Node.js, this may need to be extracted from the socket
  return 'unknown';
}

// Periodic cleanup of old rate limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts.entries()) {
    if (now > entry.resetAt) {
      loginAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

/** Hono router for admin auth routes */
export const adminAuthRoutes = new Hono();

// ============================================
// Login / Logout / Me
// ============================================

/**
 * Login with email and password.
 * Returns a JWT token valid for 24 hours.
 * 
 * Rate limited: 5 attempts per minute per IP address.
 * 
 * @route POST /api/login
 * @body { email: string, password: string }
 * @returns {Object} 200 - { ok: true, token: string, expiresAt: string }
 * @returns {Object} 400 - { ok: false, error: string } - Missing credentials
 * @returns {Object} 401 - { ok: false, error: string } - Invalid credentials
 * @returns {Object} 429 - { ok: false, error: string } - Too many attempts
 * @returns {Object} 500 - { ok: false, error: string } - Auth not configured
 * 
 * @example
 * ```bash
 * curl -X POST http://localhost:3000/api/login \
 *   -H "Content-Type: application/json" \
 *   -d '{"email": "admin@example.com", "password": "secret123"}'
 * ```
 */
adminAuthRoutes.post('/login', async (c) => {
  try {
    // Get client IP for rate limiting
    const clientIp = getClientIp(c);
    
    // Check rate limit before processing
    const rateLimitStatus = checkRateLimit(clientIp);
    if (rateLimitStatus.limited) {
      const retryAfter = Math.ceil((rateLimitStatus.resetAt - Date.now()) / 1000);
      c.header('Retry-After', retryAfter.toString());
      return c.json({
        ok: false,
        error: 'Too many login attempts',
        message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        retryAfter,
      }, 429);
    }

    // Check if admin auth is configured
    if (!isAdminAuthConfigured()) {
      return c.json({
        ok: false,
        error: 'Admin authentication not configured',
        message: 'Set ADMIN_EMAIL, ADMIN_PASSWORD, and JWT_SECRET environment variables',
      }, 500);
    }

    // Parse request body
    let body: { email?: string; password?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        ok: false,
        error: 'Invalid JSON body',
      }, 400);
    }

    // Validate required fields
    if (!body.email || !body.password) {
      return c.json({
        ok: false,
        error: 'Email and password are required',
      }, 400);
    }

    const config = getAdminAuthConfig();

    // Check email matches
    if (body.email !== config.adminEmail) {
      // Record failed attempt
      recordLoginAttempt(clientIp);
      const remaining = checkRateLimit(clientIp);
      const remainingAttempts = remaining.limited ? 0 : remaining.remaining;
      
      return c.json({
        ok: false,
        error: 'Invalid credentials',
        remainingAttempts,
      }, 401);
    }

    // Verify password against bcrypt hash
    const passwordMatch = await bcrypt.compare(body.password, config.adminPassword!);
    
    if (!passwordMatch) {
      // Record failed attempt
      recordLoginAttempt(clientIp);
      const remaining = checkRateLimit(clientIp);
      const remainingAttempts = remaining.limited ? 0 : remaining.remaining;
      
      return c.json({
        ok: false,
        error: 'Invalid credentials',
        remainingAttempts,
      }, 401);
    }

    // Generate JWT token
    const token = generateAdminToken(body.email);
    
    if (!token) {
      return c.json({
        ok: false,
        error: 'Failed to generate token',
      }, 500);
    }

    // Calculate expiration (24 hours from now)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    return c.json({
      ok: true,
      token,
      expiresAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Login failed';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Logout endpoint.
 * JWT tokens are stateless, so this is primarily for client-side token removal.
 * Returns success to acknowledge the logout request.
 * 
 * @route POST /api/logout
 * @returns {Object} 200 - { ok: true, message: string }
 * 
 * @example
 * ```bash
 * curl -X POST http://localhost:3000/api/logout
 * ```
 */
adminAuthRoutes.post('/logout', async (c) => {
  // JWT is stateless - actual logout is client-side token removal
  // This endpoint exists for:
  // 1. Consistency with typical auth flows
  // 2. Future token blacklist implementation if needed
  // 3. Client-side UX (e.g., calling /logout on sign out button)
  
  return c.json({
    ok: true,
    message: 'Logged out successfully. Please discard your token on the client side.',
  });
});

/**
 * Get current admin user info.
 * Validates the JWT token and returns user details.
 * 
 * @route GET /api/me
 * @header Authorization: Bearer <jwt-token>
 * @returns {Object} 200 - { ok: true, user: { email: string, role: string } }
 * @returns {Object} 401 - { ok: false, error: string } - Missing/invalid token
 * 
 * @example
 * ```bash
 * curl http://localhost:3000/api/me \
 *   -H "Authorization: Bearer <jwt-token>"
 * ```
 */
adminAuthRoutes.get('/me', async (c) => {
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
      message: 'Invalid Authorization header format. Expected: Bearer <jwt-token>',
    }, 401);
  }

  const token = parts[1];
  
  // Verify the token
  const payload = verifyAdminToken(token);
  
  if (!payload) {
    return c.json({
      ok: false,
      error: 'Unauthorized',
      message: 'Invalid or expired JWT token',
    }, 401);
  }

  return c.json({
    ok: true,
    user: {
      email: payload.email,
      role: payload.role,
    },
  });
});

/**
 * Check if admin auth is configured.
 * Useful for health checks and configuration validation.
 * 
 * @route GET /api/admin-status
 * @returns {Object} 200 - { ok: true, configured: boolean }
 * 
 * @example
 * ```bash
 * curl http://localhost:3000/api/admin-status
 * ```
 */
adminAuthRoutes.get('/admin-status', async (c) => {
  const configured = isAdminAuthConfigured();
  
  return c.json({
    ok: true,
    configured,
    message: configured 
      ? 'Admin authentication is configured'
      : 'Admin authentication not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD, and JWT_SECRET.',
  });
});

export default adminAuthRoutes;