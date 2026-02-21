import 'dotenv/config';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { z } from 'zod';
import { initializeLmdb } from '../db/index.js';
import { initializeStorage } from '../api/storage.js';
import { dataApi, storageApi, authApi } from '../api/index.js';
import { validateApiKey } from '../db/index.js';
import { adminAuthMiddleware, isAdminAuthConfigured } from '../middleware/adminAuth.js';
import { adminAuthRoutes } from '../routes/adminAuth.js';
import { adminRoutes } from '../routes/admin.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const templatesDir = join(__dirname, '../templates');

// Types
export interface EnvConfig {
  PORT: number;
  HOST: string;
  NODE_ENV: string;
  LMDB_PATH: string;
  STORAGE_PATH: string;
  API_KEYS: string[];
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string; // bcrypt hash
  JWT_SECRET?: string;
}

// Load and validate environment configuration
export function loadConfig(): EnvConfig {
  return {
    PORT: parseInt(process.env.PORT || '3000', 10),
    HOST: process.env.HOST || '0.0.0.0',
    NODE_ENV: process.env.NODE_ENV || 'development',
    LMDB_PATH: process.env.LMDB_PATH || './data/lmdb',
    STORAGE_PATH: process.env.STORAGE_PATH || './data/storage',
    API_KEYS: (process.env.API_KEYS || 'dev-key-change-in-production').split(',').map(k => k.trim()),
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    JWT_SECRET: process.env.JWT_SECRET,
  };
}

/**
 * Validates API keys in production environment.
 * Refuses to start if default/insecure keys are detected.
 * @throws Error if insecure API keys are detected in production
 */
export function validateProductionApiKeys(config: EnvConfig): void {
  if (config.NODE_ENV === 'production') {
    const insecureKeys = config.API_KEYS.filter(key => 
      key.startsWith('dev-') || 
      key === 'dev-key-change-in-production' ||
      key.length < 20
    );
    
    if (insecureKeys.length > 0) {
      console.error('❌ SECURITY ERROR: Insecure API keys detected in production!');
      console.error('The following keys are insecure:');
      insecureKeys.forEach(key => {
        const reason = key.startsWith('dev-') 
          ? 'starts with "dev-"'
          : key === 'dev-key-change-in-production'
            ? 'is the default dev key'
            : 'is too short (minimum 20 characters)';
        console.error(`  - "${key.substring(0, 8)}..." ${reason}`);
      });
      console.error('\nSet the API_KEYS environment variable with secure keys:');
      console.error('  API_KEYS=your-secure-key-1,your-secure-key-2');
      console.error('\nSecure keys should:');
      console.error('  - Be at least 20 characters long');
      console.error('  - Not start with "dev-"');
      console.error('  - Be randomly generated');
      throw new Error('Insecure API keys detected in production environment');
    }
  } else {
    // Development warning
    console.log('⚠️  Running in development mode with potentially insecure API keys.');
    console.log('⚠️  Set proper API_KEYS for production!');
  }
}

// Auth middleware for API key authentication
// This middleware validates API keys for general API routes
// Admin routes (/api/admin/*) are handled separately by adminAuthMiddleware
async function authMiddleware(c: any, next: any) {
  const path = c.req.path;
  
  // Skip auth for:
  // - Landing page
  // - Login page
  // - Health check
  // - API key auth routes (/api/auth)
  // - Admin auth routes (login, logout, me, admin-status)
  // - Admin routes (/api/admin/*) - these are protected by adminAuthMiddleware
  // - Storage routes (/api/storage/*) - admin dashboard uses JWT
  if (
    path === '/' ||
    path === '/login' ||
    path === '/health' ||
    path.startsWith('/api/auth') ||
    path === '/api/login' ||
    path === '/api/logout' ||
    path === '/api/me' ||
    path === '/api/admin-status' ||
    path.startsWith('/api/admin/') ||
    path.startsWith('/api/storage/') ||
    path === '/api/storage'
  ) {
    return next();
  }

  // Check for API key
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({
      ok: false,
      error: 'Authorization header required'
    }, 401);
  }

  // Extract key from Bearer token
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return c.json({
      ok: false,
      error: 'API key required'
    }, 401);
  }

  // Validate API key (also allow env-defined keys for simplicity)
  const config = loadConfig();
  const isValidEnvKey = config.API_KEYS.includes(token);
  const isValidDbKey = await validateApiKey(token);

  if (!isValidEnvKey && !isValidDbKey) {
    return c.json({
      ok: false,
      error: 'Invalid API key'
    }, 401);
  }

  return next();
}

// Create and configure the Hono app
export function createApp(): Hono {
  const app = new Hono();

  // Apply middleware
  app.use('*', logger());
  app.use('*', cors());

  // Health check endpoint
  app.get('/health', (c) => {
    // Include admin auth status in health check
    const adminAuthConfigured = isAdminAuthConfigured();
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      adminAuth: adminAuthConfigured ? 'configured' : 'not configured',
    });
  });

  // Landing page - serve HTML template
  app.get('/', (c) => {
    try {
      const html = readFileSync(join(templatesDir, 'index.html'), 'utf-8');
      return c.html(html);
    } catch (err) {
      // Fallback to JSON if template not found
      return c.json({
        name: 'hyper',
        version: '1.0.0',
        status: 'ok',
      });
    }
  });

  // Login page - serve HTML template
  app.get('/login', (c) => {
    try {
      const html = readFileSync(join(templatesDir, 'login.html'), 'utf-8');
      return c.html(html);
    } catch (err) {
      return c.json({
        error: 'Login template not found',
      }, 500);
    }
  });

  // Admin dashboard - serve HTML template
  app.get('/admin', (c) => {
    try {
      const html = readFileSync(join(templatesDir, 'dashboard.html'), 'utf-8');
      return c.html(html);
    } catch (err) {
      return c.json({
        error: 'Dashboard template not found',
      }, 500);
    }
  });

  // Mount admin auth routes (login, logout, me, admin-status)
  // These handle JWT-based admin authentication
  app.route('/api', adminAuthRoutes);

  // Mount auth API (no auth required for creating API keys)
  app.route('/api/auth', authApi);

  // Apply admin auth middleware to admin routes (must come before API key middleware)
  // Admin routes require JWT token from /api/login
  app.use('/api/admin/*', adminAuthMiddleware);

  // Mount admin API routes (protected by adminAuthMiddleware)
  app.route('/api/admin', adminRoutes);

  // Apply API key auth middleware to other protected routes
  app.use('/api/*', authMiddleware);

  // Mount API routes
  // dataApi already has routes like /dbs/:db, so mount at /api
  app.route('/api', dataApi);
  app.route('/api/storage', storageApi);

  // 404 handler
  app.notFound((c) => {
    return c.json(
      {
        error: 'Not Found',
        message: `Route ${c.req.method} ${c.req.path} not found`,
        timestamp: new Date().toISOString(),
      },
      404
    );
  });

  // Global error handler
  app.onError((err, c) => {
    console.error('Error:', err);
    
    // Check for specific error types
    if (err.name === 'ZodError') {
      return c.json(
        {
          error: 'Validation Error',
          message: 'Invalid request data',
          details: err.message,
          timestamp: new Date().toISOString(),
        },
        400
      );
    }

    // Generic error response
    const status = (err as any).status || 500;
    return c.json(
      {
        error: err.name || 'Internal Server Error',
        message: err.message || 'An unexpected error occurred',
        timestamp: new Date().toISOString(),
      },
      status
    );
  });

  return app;
}

// Start server function
export async function startServer(app: Hono, config: EnvConfig) {
  // Validate API keys before starting
  validateProductionApiKeys(config);
  
  // Initialize LMDB
  console.log('📦 Initializing LMDB...');
  await initializeLmdb({
    path: config.LMDB_PATH,
  });
  console.log(`📂 LMDB path: ${config.LMDB_PATH}`);
  
  // Initialize Storage
  console.log('📁 Initializing Storage...');
  await initializeStorage({
    path: config.STORAGE_PATH,
  });
  console.log(`📂 Storage path: ${config.STORAGE_PATH}`);
  
  // Start server using @hono/node-server
  const server = serve({
    fetch: app.fetch,
    port: config.PORT,
    hostname: config.HOST,
  });
  
  console.log(`🚀 hyper-micro server running at http://${config.HOST}:${config.PORT}`);
  console.log(`📊 Environment: ${config.NODE_ENV}`);
  console.log(`🏥 Health check: http://${config.HOST}:${config.PORT}/health`);
  console.log(`📡 Data API: http://${config.HOST}:${config.PORT}/api/dbs`);
  console.log(`📦 Storage API: http://${config.HOST}:${config.PORT}/api/storage`);
  
  // Admin auth status
  const adminAuthConfigured = isAdminAuthConfigured();
  if (adminAuthConfigured) {
    console.log(`🔐 Admin auth: Configured (${config.ADMIN_EMAIL})`);
    console.log(`   POST /api/login - Login with email/password`);
    console.log(`   GET /api/me - Get current admin user (requires JWT)`);
    console.log(`   /api/admin/* - Protected admin routes (requires JWT)`);
  } else {
    console.log(`⚠️  Admin auth: Not configured (set ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET)`);
  }

  return server;
}
