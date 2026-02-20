/**
 * @fileoverview Admin Routes - Admin Dashboard API
 * 
 * Provides REST endpoints for the admin dashboard.
 * All routes require JWT-based admin authentication.
 * 
 * ## Endpoints
 * - `GET /api/admin/stats` - Server stats (databases, storage, API keys)
 * - `GET /api/admin/databases` - List databases with record counts
 * - `GET /api/admin/storage` - List storage files with sizes
 * - `GET /api/admin/keys` - List API keys
 * - `POST /api/admin/keys` - Create new API key
 * - `DELETE /api/admin/keys/:id` - Revoke API key
 * 
 * @module routes/admin
 */

import { Hono } from 'hono';
import { 
  listDatabases, 
  listDocuments, 
  listApiKeys, 
  generateApiKey, 
  deleteApiKey,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  createDatabase,
  deleteDatabase,
  databaseExists,
} from '../db/index.js';
import { getStoragePath } from '../api/storage.js';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** Hono router for admin routes */
export const adminRoutes = new Hono();

/**
 * Get server statistics.
 * Returns overview stats for the dashboard.
 * 
 * @route GET /api/admin/stats
 * @returns {Object} 200 - { databases, storageUsage, apiKeys, lmdbPath, storagePath }
 */
adminRoutes.get('/stats', async (c) => {
  try {
    // Get database count
    const databases = await listDatabases();
    
    // Get total records across all databases
    let totalRecords = 0;
    for (const dbName of databases) {
      try {
        const docs = await listDocuments(dbName, { limit: 10000 });
        totalRecords += docs.length;
      } catch {
        // Skip databases we can't read
      }
    }
    
    // Get storage stats
    const storagePath = getStoragePath();
    let totalFiles = 0;
    let totalSize = 0;
    const buckets: string[] = [];
    
    if (existsSync(storagePath)) {
      const entries = await readdir(storagePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          buckets.push(entry.name);
          const bucketPath = path.join(storagePath, entry.name);
          await walkDir(bucketPath, (size) => {
            totalFiles++;
            totalSize += size;
          });
        }
      }
    }
    
    // Get API key count
    const apiKeys = await listApiKeys();
    
    // Get LMDB path from env
    const lmdbPath = process.env.LMDB_PATH || './data/lmdb';
    
    return c.json({
      databases: databases.length,
      totalRecords,
      storageUsage: formatBytes(totalSize),
      storageBytes: totalSize,
      totalFiles,
      buckets: buckets.length,
      apiKeys: apiKeys.length,
      lmdbPath,
      storagePath,
      nodeVersion: process.version,
      platform: process.platform,
      uptime: Math.floor(process.uptime()),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get stats';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * List all databases with record counts.
 * 
 * @route GET /api/admin/databases
 * @returns {Object} 200 - { databases: Array<{ name, keys }> }
 */
adminRoutes.get('/databases', async (c) => {
  try {
    const dbNames = await listDatabases();
    const databases = [];
    
    for (const name of dbNames) {
      try {
        const docs = await listDocuments(name, { limit: 10000 });
        databases.push({
          name,
          keys: docs.length,
        });
      } catch {
        databases.push({
          name,
          keys: null,
        });
      }
    }
    
    return c.json({
      ok: true,
      databases,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list databases';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * List all storage buckets with file counts.
 * 
 * @route GET /api/admin/storage
 * @returns {Object} 200 - { ok: true, buckets: Array<{ name, fileCount, totalSize }> }
 */
adminRoutes.get('/storage', async (c) => {
  try {
    const storagePath = getStoragePath();
    const buckets: Array<{ name: string; fileCount: number; totalSize: number }> = [];
    
    if (!existsSync(storagePath)) {
      return c.json({
        ok: true,
        buckets: [],
      });
    }
    
    const entries = await readdir(storagePath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const bucketName = entry.name;
        const bucketPath = path.join(storagePath, bucketName);
        
        let fileCount = 0;
        let totalSize = 0;
        
        await walkDir(bucketPath, (size) => {
          fileCount++;
          totalSize += size;
        });
        
        buckets.push({
          name: bucketName,
          fileCount,
          totalSize,
        });
      }
    }
    
    // Sort by name
    buckets.sort((a, b) => a.name.localeCompare(b.name));
    
    return c.json({
      ok: true,
      buckets,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list storage';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * List files in a bucket.
 * 
 * @route GET /api/admin/storage/:bucket
 * @returns {Object} 200 - { ok: true, bucket: string, files: Array<{ name, size, modified }> }
 */
adminRoutes.get('/storage/:bucket', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    const storagePath = getStoragePath();
    const bucketPath = path.join(storagePath, bucket);
    
    if (!existsSync(bucketPath)) {
      return c.json({
        ok: false,
        error: `Bucket '${bucket}' not found`,
      }, 404);
    }
    
    const files: Array<{ name: string; size: number; modified: string }> = [];
    
    await walkDirWithStats(bucketPath, '', (filePath, size, modified) => {
      files.push({
        name: filePath,
        size,
        modified,
      });
    });
    
    // Sort by name
    files.sort((a, b) => a.name.localeCompare(b.name));
    
    return c.json({
      ok: true,
      bucket,
      files,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list bucket files';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Download a file from a bucket.
 * 
 * @route GET /api/admin/storage/:bucket/:key
 * @returns {Binary} File content
 */
adminRoutes.get('/storage/:bucket/:key', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    const key = decodeURIComponent(c.req.param('key'));
    const storagePath = getStoragePath();
    
    // Sanitize bucket and key to prevent path traversal
    const safeBucket = bucket.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeKey = key.replace(/[^a-zA-Z0-9_.\/-]/g, '_');
    const filePath = path.join(storagePath, safeBucket, safeKey);
    
    // Ensure path is within storage
    const resolvedPath = path.resolve(filePath);
    const resolvedStorage = path.resolve(storagePath);
    if (!resolvedPath.startsWith(resolvedStorage)) {
      return c.json({
        ok: false,
        error: 'Invalid path',
      }, 400);
    }
    
    if (!existsSync(filePath)) {
      return c.json({
        ok: false,
        error: `File '${key}' not found`,
      }, 404);
    }
    
    const stats = await stat(filePath);
    
    c.header('Content-Type', 'application/octet-stream');
    c.header('Content-Length', stats.size.toString());
    c.header('Content-Disposition', `attachment; filename="${path.basename(key)}"`);
    
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(filePath);
    
    return c.body(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to download file';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Upload a file to a bucket.
 * 
 * @route PUT /api/admin/storage/:bucket/:key
 * @body Binary file content
 * @returns {Object} 201 - { ok: true, key: string, size: number }
 */
adminRoutes.put('/storage/:bucket/:key', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    const key = decodeURIComponent(c.req.param('key'));
    const storagePath = getStoragePath();
    
    // Sanitize bucket and key
    const safeBucket = bucket.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeKey = key.replace(/[^a-zA-Z0-9_.\/-]/g, '_');
    const filePath = path.join(storagePath, safeBucket, safeKey);
    
    // Ensure path is within storage
    const resolvedPath = path.resolve(filePath);
    const resolvedStorage = path.resolve(storagePath);
    if (!resolvedPath.startsWith(resolvedStorage)) {
      return c.json({
        ok: false,
        error: 'Invalid path',
      }, 400);
    }
    
    // Ensure bucket directory exists
    const bucketDir = path.dirname(filePath);
    await import('node:fs/promises').then(fs => fs.mkdir(bucketDir, { recursive: true }));
    
    // Write file
    const buffer = await c.req.arrayBuffer();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, Buffer.from(buffer));
    
    const stats = await stat(filePath);
    
    return c.json({
      ok: true,
      key,
      size: stats.size,
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upload file';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Delete a file from a bucket.
 * 
 * @route DELETE /api/admin/storage/:bucket/:key
 * @returns {Object} 200 - { ok: true }
 */
adminRoutes.delete('/storage/:bucket/:key', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    const key = decodeURIComponent(c.req.param('key'));
    const storagePath = getStoragePath();
    
    // Sanitize bucket and key
    const safeBucket = bucket.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeKey = key.replace(/[^a-zA-Z0-9_.\/-]/g, '_');
    const filePath = path.join(storagePath, safeBucket, safeKey);
    
    // Ensure path is within storage
    const resolvedPath = path.resolve(filePath);
    const resolvedStorage = path.resolve(storagePath);
    if (!resolvedPath.startsWith(resolvedStorage)) {
      return c.json({
        ok: false,
        error: 'Invalid path',
      }, 400);
    }
    
    if (!existsSync(filePath)) {
      return c.json({
        ok: false,
        error: `File '${key}' not found`,
      }, 404);
    }
    
    const { unlink } = await import('node:fs/promises');
    await unlink(filePath);
    
    return c.json({
      ok: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete file';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * List all API keys.
 * Returns key metadata without exposing the actual key values.
 * 
 * @route GET /api/admin/keys
 * @returns {Object} 200 - { keys: Array<{ id, name, created }> }
 */
adminRoutes.get('/keys', async (c) => {
  try {
    const keys = await listApiKeys();
    
    return c.json({
      ok: true,
      keys,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list API keys';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Create a new API key.
 * The key is returned only once - it cannot be retrieved again.
 * 
 * @route POST /api/admin/keys
 * @body { name?: string } - Optional friendly name for the key
 * @returns {Object} 201 - { ok: true, id, key, name }
 */
adminRoutes.post('/keys', async (c) => {
  try {
    let body: { name?: string } = {};
    
    try {
      body = await c.req.json();
    } catch {
      // Empty body is fine
    }
    
    const result = await generateApiKey(body.name);
    
    return c.json({
      ok: true,
      id: result.id,
      key: result.key,
      name: result.name,
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create API key';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Revoke (delete) an API key.
 * 
 * @route DELETE /api/admin/keys/:id
 * @param {string} id - API key ID (UUID)
 * @returns {Object} 200 - { ok: true }
 */
adminRoutes.delete('/keys/:id', async (c) => {
  try {
    const id = c.req.param('id');
    
    if (!id) {
      return c.json({
        ok: false,
        error: 'API key ID is required',
      }, 400);
    }
    
    await deleteApiKey(id);
    
    return c.json({
      ok: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to revoke API key';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Get filtered environment variables.
 * Returns only safe-to-display environment settings.
 * 
 * @route GET /api/admin/env
 * @returns {Object} 200 - { env: Object }
 */
adminRoutes.get('/env', async (c) => {
  // Only expose safe environment variables
  const safeEnv: Record<string, string> = {};
  
  const safeKeys = [
    'NODE_ENV',
    'PORT',
    'HOST',
  ];
  
  for (const key of safeKeys) {
    if (process.env[key]) {
      safeEnv[key] = process.env[key]!;
    }
  }
  
  // Add paths (safe to expose)
  safeEnv.LMDB_PATH = process.env.LMDB_PATH || './data/lmdb';
  safeEnv.STORAGE_PATH = process.env.STORAGE_PATH || './data/storage';
  
  // Indicate admin auth status (not the actual values)
  safeEnv.ADMIN_AUTH_CONFIGURED = (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && process.env.JWT_SECRET) ? 'true' : 'false';
  
  // Indicate API keys status (not the actual keys)
  safeEnv.API_KEYS_CONFIGURED = process.env.API_KEYS ? 'true' : 'false';
  
  return c.json({
    ok: true,
    env: safeEnv,
  });
});

// ============================================
// Database Browser API
// ============================================

/**
 * List all databases (alternative endpoint for database browser).
 * 
 * @route GET /api/admin/dbs
 * @returns {Object} 200 - { ok: true, databases: Array<{ name, keys }> }
 */
adminRoutes.get('/dbs', async (c) => {
  try {
    const dbNames = await listDatabases();
    const databases = [];
    
    for (const name of dbNames) {
      try {
        const docs = await listDocuments(name, { limit: 10000 });
        databases.push({
          name,
          keys: docs.length,
        });
      } catch {
        databases.push({
          name,
          keys: null,
        });
      }
    }
    
    return c.json({
      ok: true,
      databases,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list databases';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Get database info.
 * 
 * @route GET /api/admin/dbs/:name
 * @returns {Object} 200 - { ok: true, name, keys, size }
 */
adminRoutes.get('/dbs/:name', async (c) => {
  try {
    const name = c.req.param('name');
    
    if (!await databaseExists(name)) {
      return c.json({
        ok: false,
        error: `Database '${name}' not found`,
      }, 404);
    }
    
    const docs = await listDocuments(name, { limit: 10000 });
    
    return c.json({
      ok: true,
      name,
      keys: docs.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get database info';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * List documents in a database.
 * 
 * @route GET /api/admin/dbs/:name/docs
 * @returns {Object} 200 - { ok: true, documents: Array<{ key, value }> }
 */
adminRoutes.get('/dbs/:name/docs', async (c) => {
  try {
    const name = c.req.param('name');
    const limit = parseInt(c.req.query('limit') || '100');
    
    if (!await databaseExists(name)) {
      return c.json({
        ok: false,
        error: `Database '${name}' not found`,
      }, 404);
    }
    
    const documents = await listDocuments(name, { limit: Math.min(limit, 1000) });
    
    return c.json({
      ok: true,
      documents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list documents';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Get a single document.
 * 
 * @route GET /api/admin/dbs/:name/docs/:key
 * @returns {Object} 200 - { ok: true, document: { key, value } }
 */
adminRoutes.get('/dbs/:name/docs/:key', async (c) => {
  try {
    const name = c.req.param('name');
    const key = decodeURIComponent(c.req.param('key'));
    
    const doc = await getDocument(name, key);
    
    if (!doc) {
      return c.json({
        ok: false,
        error: `Document '${key}' not found`,
      }, 404);
    }
    
    return c.json({
      ok: true,
      document: doc,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get document';
    return c.json({
      ok: false,
      error: message,
    }, 500);
  }
});

/**
 * Create a new document.
 * 
 * @route POST /api/admin/dbs/:name/docs
 * @body { key: string, value: any } - Document key and value
 * @returns {Object} 201 - { ok: true, document: { key, value } }
 */
adminRoutes.post('/dbs/:name/docs', async (c) => {
  try {
    const name = c.req.param('name');
    const body = await c.req.json();
    
    const { key, value } = body;
    
    if (!key) {
      return c.json({
        ok: false,
        error: 'Document key is required',
      }, 400);
    }
    
    // Create database if it doesn't exist
    if (!await databaseExists(name)) {
      await createDatabase(name);
    }
    
    await createDocument(name, key, value);
    
    return c.json({
      ok: true,
      document: { key, value },
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create document';
    return c.json({
      ok: false,
      error: message,
    }, 400);
  }
});

/**
 * Update an existing document.
 * 
 * @route PUT /api/admin/dbs/:name/docs/:key
 * @body { value: any } - New document value
 * @returns {Object} 200 - { ok: true }
 */
adminRoutes.put('/dbs/:name/docs/:key', async (c) => {
  try {
    const name = c.req.param('name');
    const key = decodeURIComponent(c.req.param('key'));
    const body = await c.req.json();
    
    const { value } = body;
    
    await updateDocument(name, key, value);
    
    return c.json({
      ok: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update document';
    const status = message.includes('not found') ? 404 : 400;
    return c.json({
      ok: false,
      error: message,
    }, status);
  }
});

/**
 * Delete a document.
 * 
 * @route DELETE /api/admin/dbs/:name/docs/:key
 * @returns {Object} 200 - { ok: true }
 */
adminRoutes.delete('/dbs/:name/docs/:key', async (c) => {
  try {
    const name = c.req.param('name');
    const key = decodeURIComponent(c.req.param('key'));
    
    await deleteDocument(name, key);
    
    return c.json({
      ok: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete document';
    const status = message.includes('not found') ? 404 : 400;
    return c.json({
      ok: false,
      error: message,
    }, status);
  }
});

/**
 * Create a new database.
 * 
 * @route POST /api/admin/dbs
 * @body { name: string } - Database name
 * @returns {Object} 201 - { ok: true, name }
 */
adminRoutes.post('/dbs', async (c) => {
  try {
    const body = await c.req.json();
    const { name } = body;
    
    if (!name) {
      return c.json({
        ok: false,
        error: 'Database name is required',
      }, 400);
    }
    
    await createDatabase(name);
    
    return c.json({
      ok: true,
      name,
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create database';
    return c.json({
      ok: false,
      error: message,
    }, 400);
  }
});

/**
 * Delete a database.
 * 
 * @route DELETE /api/admin/dbs/:name
 * @returns {Object} 200 - { ok: true }
 */
adminRoutes.delete('/dbs/:name', async (c) => {
  try {
    const name = c.req.param('name');
    
    await deleteDatabase(name);
    
    return c.json({
      ok: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete database';
    const status = message.includes('not found') ? 404 : 400;
    return c.json({
      ok: false,
      error: message,
    }, status);
  }
});

// ============================================
// Helper Functions
// ============================================

/**
 * Walk a directory and call callback for each file with its size.
 */
async function walkDir(dir: string, onFile: (size: number) => void): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isFile()) {
      const stats = await stat(fullPath);
      onFile(stats.size);
    } else if (entry.isDirectory()) {
      await walkDir(fullPath, onFile);
    }
  }
}

/**
 * Walk a directory and call callback for each file with its path and size.
 */
async function walkDirWithPaths(
  dir: string, 
  basePath: string, 
  onFile: (filePath: string, size: number) => void
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    
    if (entry.isFile()) {
      const stats = await stat(fullPath);
      onFile(relativePath, stats.size);
    } else if (entry.isDirectory()) {
      await walkDirWithPaths(fullPath, relativePath, onFile);
    }
  }
}

/**
 * Walk a directory and call callback for each file with its path, size, and modified time.
 */
async function walkDirWithStats(
  dir: string, 
  basePath: string, 
  onFile: (filePath: string, size: number, modified: string) => void
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    
    if (entry.isFile()) {
      const stats = await stat(fullPath);
      onFile(relativePath, stats.size, stats.mtime.toISOString());
    } else if (entry.isDirectory()) {
      await walkDirWithStats(fullPath, relativePath, onFile);
    }
  }
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default adminRoutes;