/**
 * Admin Authentication Middleware for hyper-micro
 * JWT-based authentication for admin routes
 * 
 * Validates JWT tokens issued via /api/login endpoint
 * Protects all /api/admin/* routes
 */

import { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';

// Admin JWT payload interface
export interface AdminJwtPayload {
  email: string;
  role: 'admin';
  iat: number;
  exp: number;
}

// Admin user info stored in context
export interface AdminUser {
  email: string;
  role: 'admin';
}

/**
 * Get admin auth configuration from environment
 */
export function getAdminAuthConfig() {
  return {
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD, // bcrypt hash
    jwtSecret: process.env.JWT_SECRET,
  };
}

/**
 * Check if admin authentication is configured
 */
export function isAdminAuthConfigured(): boolean {
  const config = getAdminAuthConfig();
  return !!(config.adminEmail && config.adminPassword && config.jwtSecret);
}

/**
 * Verify and decode a JWT token
 * Returns the payload if valid, null if invalid
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
 * Generate a JWT token for admin user
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
 * Admin authentication middleware
 * Validates JWT token from Authorization header (Bearer token)
 * Sets c.set('adminUser', { email, role }) on success
 * 
 * Note: This is separate from API key auth middleware
 * Admin auth uses JWT tokens, API key auth uses static keys
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
 * Optional admin auth middleware
 * Sets admin user if valid token present, but doesn't require it
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