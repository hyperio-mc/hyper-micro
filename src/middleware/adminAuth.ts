/**
 * @fileoverview Admin Authentication Middleware
 * 
 * JWT-based authentication middleware for protecting admin routes.
 * Validates JWT tokens issued via the /api/login endpoint.
 * 
 * ## Environment Variables Required
 * - `ADMIN_EMAIL` - Admin email address
 * - `ADMIN_PASSWORD` - Bcrypt hash of admin password
 * - `JWT_SECRET` - Secret key for JWT signing/verification
 * 
 * ## Usage
 * Applied to all /api/admin/* routes to require valid JWT authentication.
 * 
 * @module middleware/adminAuth
 * @example
 * ```typescript
 * import { adminAuthMiddleware } from './middleware/adminAuth.js';
 * 
 * app.use('/api/admin/*', adminAuthMiddleware);
 * ```
 */

import { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';

/**
 * JWT payload structure for admin tokens.
 * Contains user identity and standard JWT claims.
 * 
 * @interface AdminJwtPayload
 * @property {string} email - Admin user's email address
 * @property {'admin'} role - User role (always 'admin' for admin tokens)
 * @property {number} iat - Issued at timestamp (Unix seconds)
 * @property {number} exp - Expiration timestamp (Unix seconds)
 */
export interface AdminJwtPayload {
  email: string;
  role: 'admin';
  iat: number;
  exp: number;
}

/**
 * Admin user information stored in Hono context.
 * Available in route handlers after successful authentication.
 * 
 * @interface AdminUser
 * @property {string} email - Admin user's email address
 * @property {'admin'} role - User role (always 'admin')
 * 
 * @example
 * ```typescript
 * // Access admin user in a route handler
 * const adminUser = c.get('adminUser') as AdminUser;
 * console.log(`Request from admin: ${adminUser.email}`);
 * ```
 */
export interface AdminUser {
  email: string;
  role: 'admin';
}

/**
 * Retrieves the admin authentication configuration from environment variables.
 * 
 * Reads ADMIN_EMAIL, ADMIN_PASSWORD (bcrypt hash), and JWT_SECRET from
 * the process environment. These must all be set for admin auth to function.
 * 
 * @returns {Object} Configuration object containing:
 *   - adminEmail: string | undefined - Admin email address
 *   - adminPassword: string | undefined - Bcrypt hash of admin password
 *   - jwtSecret: string | undefined - Secret for JWT signing/verification
 * 
 * @example
 * ```typescript
 * const config = getAdminAuthConfig();
 * if (config.jwtSecret) {
 *   // JWT operations can proceed
 * }
 * ```
 */
export function getAdminAuthConfig() {
  return {
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD, // bcrypt hash
    jwtSecret: process.env.JWT_SECRET,
  };
}

/**
 * Checks whether admin authentication is properly configured.
 * 
 * All three environment variables must be set:
 * - ADMIN_EMAIL
 * - ADMIN_PASSWORD (bcrypt hash)
 * - JWT_SECRET
 * 
 * @returns {boolean} True if all required environment variables are set
 * 
 * @example
 * ```typescript
 * if (!isAdminAuthConfigured()) {
 *   console.error('Admin auth not configured. Check environment variables.');
 * }
 * ```
 */
export function isAdminAuthConfigured(): boolean {
  const config = getAdminAuthConfig();
  return !!(config.adminEmail && config.adminPassword && config.jwtSecret);
}

/**
 * Verifies and decodes a JWT admin token.
 * 
 * Validates the token signature using JWT_SECRET, checks that it hasn't
 * expired, and verifies the role is 'admin'. Returns the decoded payload
 * if valid, or null if the token is invalid, expired, or malformed.
 * 
 * @param {string} token - JWT token string to verify
 * @returns {AdminJwtPayload | null} Decoded payload if valid, null otherwise
 * 
 * @example
 * ```typescript
 * const payload = verifyAdminToken(token);
 * if (payload) {
 *   console.log(`Token valid for admin: ${payload.email}`);
 *   console.log(`Expires at: ${new Date(payload.exp * 1000)}`);
 * } else {
 *   console.log('Invalid or expired token');
 * }
 * ```
 */
export function verifyAdminToken(token: string): AdminJwtPayload | null {
  const config = getAdminAuthConfig();
  
  if (!config.jwtSecret) {
    return null;
  }
  
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AdminJwtPayload;
    
    // Verify it's an admin token
    if (decoded.role !== 'admin') {
      return null;
    }
    
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Generates a new JWT token for an admin user.
 * 
 * Creates a token with the admin's email and role, signed with JWT_SECRET.
 * Tokens expire 24 hours after issuance.
 * 
 * @param {string} email - Admin user's email address
 * @returns {string | null} JWT token string, or null if JWT_SECRET not configured
 * 
 * @example
 * ```typescript
 * const token = generateAdminToken('admin@example.com');
 * if (token) {
 *   // Return token to client
 *   res.json({ token, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
 * }
 * ```
 */
export function generateAdminToken(email: string): string | null {
  const config = getAdminAuthConfig();
  
  if (!config.jwtSecret) {
    return null;
  }
  
  return jwt.sign(
    {
      email,
      role: 'admin',
    },
    config.jwtSecret,
    {
      expiresIn: '24h', // Token expires in 24 hours
    }
  );
}

/**
 * Hono middleware that requires valid admin JWT authentication.
 * 
 * Validates the JWT token from the Authorization header (Bearer token format).
 * On success, sets `adminUser` in the Hono context for use in route handlers.
 * On failure, returns a 401 or 500 JSON error response.
 * 
 * @param {Context} c - Hono context object
 * @param {Next} next - Next middleware/handler function
 * @returns {Promise<Response | void>} JSON error response on auth failure, otherwise continues
 * 
 * @throws {Response} 500 if admin auth not configured (missing env vars)
 * @throws {Response} 401 if missing/invalid Authorization header or expired token
 * 
 * @auth Requires Bearer token in Authorization header (valid admin JWT)
 * 
 * @example
 * ```typescript
 * import { adminAuthMiddleware } from './middleware/adminAuth.js';
 * 
 * const app = new Hono();
 * 
 * // Protect admin routes
 * app.use('/api/admin/*', adminAuthMiddleware);
 * 
 * // Route handler can access admin user
 * app.get('/api/admin/dashboard', (c) => {
 *   const adminUser = c.get('adminUser');
 *   return c.json({ message: `Hello, ${adminUser.email}` });
 * });
 * ```
 * 
 * @see {@link optionalAdminAuthMiddleware} for optional auth variant
 */
export async function adminAuthMiddleware(c: Context, next: Next) {
  // Check if admin auth is configured
  if (!isAdminAuthConfigured()) {
    return c.json(
      {
        ok: false,
        error: 'Admin authentication not configured',
        message: 'Set ADMIN_EMAIL, ADMIN_PASSWORD, and JWT_SECRET environment variables',
      },
      500
    );
  }

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
        message: 'Invalid Authorization header format. Expected: Bearer <jwt-token>',
      },
      401
    );
  }

  const token = parts[1];
  
  // Verify the token
  const payload = verifyAdminToken(token);
  
  if (!payload) {
    return c.json(
      {
        ok: false,
        error: 'Unauthorized',
        message: 'Invalid or expired JWT token',
      },
      401
    );
  }

  // Set admin user in context
  c.set('adminUser', {
    email: payload.email,
    role: payload.role,
  } as AdminUser);

  await next();
}

/**
 * Hono middleware that optionally checks admin JWT authentication.
 * 
 * If a valid Bearer token is present in the Authorization header, sets
 * `adminUser` in the Hono context. Unlike {@link adminAuthMiddleware},
 * this does NOT reject requests without authentication - it silently
 * continues, allowing the request to proceed without an admin user.
 * 
 * Useful for routes that have different behavior for authenticated vs.
 * unauthenticated users (e.g., showing additional admin-only data).
 * 
 * @param {Context} c - Hono context object
 * @param {Next} next - Next middleware/handler function
 * @returns {Promise<void>} Always continues to next handler
 * 
 * @example
 * ```typescript
 * import { optionalAdminAuthMiddleware } from './middleware/adminAuth.js';
 * 
 * const app = new Hono();
 * 
 * // Optional auth - adminUser will be set if token present
 * app.use('/api/public-data', optionalAdminAuthMiddleware);
 * 
 * app.get('/api/public-data', (c) => {
 *   const adminUser = c.get('adminUser');
 *   // Return extra data if admin is authenticated
 *   const data = adminUser ? { ...publicData, adminNotes } : publicData;
 *   return c.json(data);
 * });
 * ```
 * 
 * @see {@link adminAuthMiddleware} for required auth variant
 */
export async function optionalAdminAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      const token = parts[1];
      const payload = verifyAdminToken(token);
      
      if (payload) {
        c.set('adminUser', {
          email: payload.email,
          role: payload.role,
        } as AdminUser);
      }
    }
  }

  await next();
}

export default adminAuthMiddleware;