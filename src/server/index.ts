import 'dotenv/config';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { initializeLmdb } from '../db/index.js';
import { initializeStorage } from '../api/storage.js';
import { dataApi, storageApi, authApi } from '../api/index.js';
import { validateApiKey } from '../db/index.js';

// Types
export interface EnvConfig {
  PORT: number;
  HOST: string;
  NODE_ENV: string;
  LMDB_PATH: string;
  STORAGE_PATH: string;
  API_KEYS: string[];
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
  };
}

// Auth middleware
async function authMiddleware(c: any, next: any) {
  // Skip auth for health check and certain paths
  const path = c.req.path;
  if (path === '/health' || path.startsWith('/api/auth')) {
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
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
    });
  });

  // Mount auth API (no auth required for creating keys)
  app.route('/api/auth', authApi);

  // Apply auth middleware to protected routes
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

  return server;
}
