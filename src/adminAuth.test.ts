import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import {
  generateAdminToken,
  verifyAdminToken,
  adminAuthMiddleware,
  getAdminAuthConfig,
  AdminJwtPayload
} from './middleware/adminAuth.js';
import { adminAuthRoutes } from './routes/adminAuth.js';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

describe('Admin Auth', () => {
  const originalEnv = process.env;
  const testSecret = 'test-secret-key-for-jwt-signing';
  const testEmail = 'admin@test.com';
  const testPassword = 'testpassword123';
  let testPasswordHash: string;

  beforeAll(async () => {
    // Generate a real bcrypt hash for testing
    testPasswordHash = await bcrypt.hash(testPassword, 10);
  });

  beforeEach(() => {
    // Reset environment variables for each test
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.JWT_SECRET = testSecret;
    process.env.ADMIN_EMAIL = testEmail;
    process.env.ADMIN_PASSWORD = testPasswordHash;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('generateAdminToken', () => {
    it('should create a valid JWT token', () => {
      const token = generateAdminToken(testEmail);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT has 3 parts
    });

    it('should include email and role in the token payload', () => {
      const token = generateAdminToken(testEmail);
      const decoded = jwt.verify(token!, testSecret) as AdminJwtPayload;
      
      expect(decoded.email).toBe(testEmail);
      expect(decoded.role).toBe('admin');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should set expiration to 24 hours', () => {
      const token = generateAdminToken(testEmail);
      const decoded = jwt.verify(token!, testSecret) as AdminJwtPayload;
      
      const expectedExp = decoded.iat + 24 * 60 * 60; // 24 hours in seconds
      expect(decoded.exp).toBe(expectedExp);
    });

    it('should return null when JWT_SECRET is not set', () => {
      delete process.env.JWT_SECRET;
      
      const token = generateAdminToken(testEmail);
      expect(token).toBeNull();
    });

    it('should generate different tokens for different emails', () => {
      const token1 = generateAdminToken('admin1@test.com');
      const token2 = generateAdminToken('admin2@test.com');
      
      expect(token1).not.toBe(token2);
      
      const decoded1 = jwt.verify(token1!, testSecret) as AdminJwtPayload;
      const decoded2 = jwt.verify(token2!, testSecret) as AdminJwtPayload;
      
      expect(decoded1.email).toBe('admin1@test.com');
      expect(decoded2.email).toBe('admin2@test.com');
    });
  });

  describe('verifyAdminToken', () => {
    it('should validate a valid JWT token', () => {
      const token = generateAdminToken(testEmail);
      const payload = verifyAdminToken(token!);
      
      expect(payload).toBeDefined();
      expect(payload!.email).toBe(testEmail);
      expect(payload!.role).toBe('admin');
    });

    it('should return null for invalid token', () => {
      const payload = verifyAdminToken('invalid-token');
      expect(payload).toBeNull();
    });

    it('should return null for token signed with different secret', () => {
      const wrongSecret = 'wrong-secret';
      const token = jwt.sign({ email: testEmail, role: 'admin' }, wrongSecret, { expiresIn: '24h' });
      
      const payload = verifyAdminToken(token);
      expect(payload).toBeNull();
    });

    it('should return null for expired token', () => {
      // Create an expired token (expired 1 second ago)
      const token = jwt.sign(
        { email: testEmail, role: 'admin' },
        testSecret,
        { expiresIn: '-1s' }
      );
      
      const payload = verifyAdminToken(token);
      expect(payload).toBeNull();
    });

    it('should return null for token without admin role', () => {
      const token = jwt.sign(
        { email: testEmail, role: 'user' },
        testSecret,
        { expiresIn: '24h' }
      );
      
      const payload = verifyAdminToken(token);
      expect(payload).toBeNull();
    });

    it('should return null when JWT_SECRET is not set', () => {
      const token = generateAdminToken(testEmail);
      delete process.env.JWT_SECRET;
      
      const payload = verifyAdminToken(token!);
      expect(payload).toBeNull();
    });
  });

  describe('adminAuthMiddleware', () => {
    it('should reject requests without Authorization header', async () => {
      const app = new Hono();
      app.use('*', adminAuthMiddleware);
      app.get('/protected', (c) => c.json({ ok: true }));
      
      const res = await app.request('/protected');
      const data = await res.json();
      
      expect(res.status).toBe(401);
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Unauthorized');
      expect(data.message).toContain('Missing Authorization header');
    });

    it('should reject requests with invalid Authorization format', async () => {
      const app = new Hono();
      app.use('*', adminAuthMiddleware);
      app.get('/protected', (c) => c.json({ ok: true }));
      
      const res = await app.request('/protected', {
        headers: { Authorization: 'Basic abc123' }
      });
      const data = await res.json();
      
      expect(res.status).toBe(401);
      expect(data.ok).toBe(false);
      expect(data.message).toContain('Invalid Authorization header format');
    });

    it('should reject requests with invalid token', async () => {
      const app = new Hono();
      app.use('*', adminAuthMiddleware);
      app.get('/protected', (c) => c.json({ ok: true }));
      
      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer invalid-token' }
      });
      const data = await res.json();
      
      expect(res.status).toBe(401);
      expect(data.ok).toBe(false);
      expect(data.message).toContain('Invalid or expired JWT token');
    });

    it('should reject requests with expired token', async () => {
      const expiredToken = jwt.sign(
        { email: testEmail, role: 'admin' },
        testSecret,
        { expiresIn: '-1s' }
      );
      
      const app = new Hono();
      app.use('*', adminAuthMiddleware);
      app.get('/protected', (c) => c.json({ ok: true }));
      
      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${expiredToken}` }
      });
      const data = await res.json();
      
      expect(res.status).toBe(401);
      expect(data.ok).toBe(false);
    });

    it('should reject requests with token missing admin role', async () => {
      const userToken = jwt.sign(
        { email: testEmail, role: 'user' },
        testSecret,
        { expiresIn: '24h' }
      );
      
      const app = new Hono();
      app.use('*', adminAuthMiddleware);
      app.get('/protected', (c) => c.json({ ok: true }));
      
      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      const data = await res.json();
      
      expect(res.status).toBe(401);
      expect(data.ok).toBe(false);
    });

    it('should allow requests with valid admin token', async () => {
      const token = generateAdminToken(testEmail);
      
      const app = new Hono();
      app.use('*', adminAuthMiddleware);
      app.get('/protected', (c) => {
        const adminUser = c.get('adminUser');
        return c.json({ ok: true, adminUser });
      });
      
      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.adminUser).toBeDefined();
      expect(data.adminUser.email).toBe(testEmail);
      expect(data.adminUser.role).toBe('admin');
    });

    it('should return 500 when admin auth is not configured', async () => {
      delete process.env.JWT_SECRET;
      delete process.env.ADMIN_EMAIL;
      delete process.env.ADMIN_PASSWORD;
      
      const app = new Hono();
      app.use('*', adminAuthMiddleware);
      app.get('/protected', (c) => c.json({ ok: true }));
      
      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer some-token' }
      });
      const data = await res.json();
      
      expect(res.status).toBe(500);
      expect(data.ok).toBe(false);
      expect(data.error).toContain('not configured');
    });

    it('should set adminUser in context for downstream handlers', async () => {
      const token = generateAdminToken('custom@example.com');
      
      const app = new Hono();
      app.use('*', adminAuthMiddleware);
      app.get('/protected', (c) => {
        const adminUser = c.get('adminUser');
        return c.json({
          email: adminUser.email,
          role: adminUser.role
        });
      });
      
      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      
      expect(data.email).toBe('custom@example.com');
      expect(data.role).toBe('admin');
    });
  });

  describe('getAdminAuthConfig', () => {
    it('should return auth configuration from environment', () => {
      const config = getAdminAuthConfig();
      
      expect(config.jwtSecret).toBe(testSecret);
      expect(config.adminEmail).toBe(testEmail);
      expect(config.adminPassword).toBeDefined();
    });

    it('should return undefined values when env vars not set', () => {
      delete process.env.JWT_SECRET;
      delete process.env.ADMIN_EMAIL;
      delete process.env.ADMIN_PASSWORD;
      
      const config = getAdminAuthConfig();
      
      expect(config.jwtSecret).toBeUndefined();
      expect(config.adminEmail).toBeUndefined();
      expect(config.adminPassword).toBeUndefined();
    });
  });
});