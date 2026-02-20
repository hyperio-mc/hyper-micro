/**
 * @fileoverview Storage API - File Storage Management
 * 
 * This module provides REST endpoints for file storage using buckets.
 * Supports binary, base64, and multipart uploads.
 * 
 * ## Bucket Operations
 * - `POST /api/storage/:bucket` - Create a bucket
 * - `DELETE /api/storage/:bucket` - Delete a bucket
 * - `GET /api/storage` - List all buckets
 * 
 * ## File Operations
 * - `PUT /api/storage/:bucket/:key` - Upload a file
 * - `GET /api/storage/:bucket/:key` - Download a file
 * - `DELETE /api/storage/:bucket/:key` - Delete a file
 * - `GET /api/storage/:bucket` - List files in a bucket
 * 
 * @module api/storage
 * @example
 * ```bash
 * # Create a bucket
 * curl -X POST http://localhost:3000/api/storage/images \
 *   -H "Authorization: Bearer dev-key-change-in-production"
 * 
 * # Upload a file
 * curl -X PUT http://localhost:3000/api/storage/images/avatar.png \
 *   -H "Authorization: Bearer your-api-key" \
 *   --data-binary @avatar.png
 * 
 * # Download a file
 * curl http://localhost:3000/api/storage/images/avatar.png \
 *   -H "Authorization: Bearer your-api-key" \
 *   -o avatar.png
 * ```
 */

import { Hono } from 'hono';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/**
 * Configuration options for storage initialization.
 * @interface StorageConfig
 */
export interface StorageConfig {
  /** File system path where files will be stored */
  path: string;
}

/**
 * Information about a stored file.
 * @interface FileInfo
 */
export interface FileInfo {
  /** File key (path within bucket) */
  key: string;
  /** File size in bytes */
  size: number;
  /** ISO 8601 creation timestamp */
  created: string;
  /** ISO 8601 last modified timestamp */
  modified: string;
}

// Default storage path
let storagePath = './data/storage';

// Initialize storage
export async function initializeStorage(config: StorageConfig): Promise<void> {
  storagePath = config.path;
  
  // Ensure storage directory exists
  if (!existsSync(storagePath)) {
    await fs.mkdir(storagePath, { recursive: true });
  }
  
  console.log('✅ Storage initialized at:', storagePath);
}

/**
 * Sets the storage path (for testing purposes).
 * 
 * @param path - New storage path
 */
export function setStoragePath(path: string): void {
  storagePath = path;
}

/**
 * Gets the full file system path for a bucket and key.
 * Sanitizes names to prevent path traversal attacks.
 * 
 * @param bucket - Bucket name
 * @param key - File key
 * @returns Full file system path
 * @internal
 */
function getFilePath(bucket: string, key: string): string {
  // Sanitize bucket and key to prevent path traversal
  const safeBucket = bucket.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(storagePath, safeBucket, safeKey);
}

/**
 * Gets the file system path for a bucket.
 * 
 * @param bucket - Bucket name
 * @returns Bucket directory path
 * @internal
 */
function getBucketPath(bucket: string): string {
  const safeBucket = bucket.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(storagePath, safeBucket);
}

/**
 * Ensures a bucket directory exists.
 * 
 * @param bucket - Bucket name
 * @internal
 */
async function ensureBucket(bucket: string): Promise<void> {
  const bucketPath = getBucketPath(bucket);
  if (!existsSync(bucketPath)) {
    await fs.mkdir(bucketPath, { recursive: true });
  }
}

/** Hono router for storage API endpoints */
export const storageApi = new Hono();

// ============================================
// Bucket Operations
// ============================================

/**
 * Creates a new storage bucket.
 * 
 * @route POST /api/storage/:bucket
 * @param {string} bucket - Bucket name (URL parameter)
 * @returns {Object} 201 - { ok: true, bucket: string }
 * @returns {Object} 400 - { ok: false, error: string } - Invalid name
 * @returns {Object} 409 - { ok: false, error: string } - Bucket already exists
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl -X POST http://localhost:3000/api/storage/images \
 *   -H "Authorization: Bearer your-api-key"
 * ```
 */
storageApi.post('/:bucket', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    
    if (!bucket || bucket.trim() === '') {
      return c.json({
        ok: false,
        error: 'Bucket name is required'
      }, 400);
    }
    
    // Check if bucket already exists
    const bucketPath = getBucketPath(bucket);
    if (existsSync(bucketPath)) {
      return c.json({
        ok: false,
        error: `Bucket '${bucket}' already exists`
      }, 409);
    }
    
    // Create bucket
    await fs.mkdir(bucketPath, { recursive: true });
    
    return c.json({
      ok: true,
      bucket
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create bucket';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Deletes a bucket and all its files.
 * 
 * @route DELETE /api/storage/:bucket
 * @param {string} bucket - Bucket name (URL parameter)
 * @returns {Object} 200 - { ok: true }
 * @returns {Object} 404 - { ok: false, error: string } - Bucket not found
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl -X DELETE http://localhost:3000/api/storage/images \
 *   -H "Authorization: Bearer your-api-key"
 * ```
 */
storageApi.delete('/:bucket', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    
    if (!bucket) {
      return c.json({
        ok: false,
        error: 'Bucket name is required'
      }, 400);
    }
    
    const bucketPath = getBucketPath(bucket);
    
    // Check if bucket exists
    if (!existsSync(bucketPath)) {
      return c.json({
        ok: false,
        error: `Bucket '${bucket}' not found`
      }, 404);
    }
    
    // Delete bucket and all files
    await fs.rm(bucketPath, { recursive: true, force: true });
    
    return c.json({
      ok: true
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete bucket';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Lists all storage buckets.
 * 
 * @route GET /api/storage
 * @returns {Object} 200 - { ok: true, buckets: string[] }
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl http://localhost:3000/api/storage \
 *   -H "Authorization: Bearer your-api-key"
 * ```
 */
storageApi.get('/', async (c) => {
  try {
    // Check if storage path exists
    if (!existsSync(storagePath)) {
      return c.json({
        ok: true,
        buckets: []
      });
    }
    
    // List directories
    const entries = await fs.readdir(storagePath, { withFileTypes: true });
    const buckets = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    
    return c.json({
      ok: true,
      buckets
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list buckets';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

// ============================================
// File Operations
// ============================================

/**
 * Uploads a file to a bucket.
 * Supports binary upload, base64-encoded content, and multipart form data.
 * 
 * @route PUT /api/storage/:bucket/:key
 * @param {string} bucket - Bucket name (URL parameter)
 * @param {string} key - File key/path (URL parameter)
 * @body Binary data, or base64 with Content-Type: application/base64
 * @query {string} [encoding=base64] - Use base64 decoding
 * @returns {Object} 201 - { ok: true, key: string, size: number }
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * # Binary upload
 * curl -X PUT http://localhost:3000/api/storage/images/avatar.png \
 *   -H "Authorization: Bearer your-api-key" \
 *   --data-binary @avatar.png
 * 
 * # Base64 upload
 * curl -X PUT "http://localhost:3000/api/storage/images/avatar.png?encoding=base64" \
 *   -H "Authorization: Bearer your-api-key" \
 *   -d "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..."
 * ```
 */
storageApi.put('/:bucket/:key', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    const key = c.req.param('key');
    const contentType = c.req.header('Content-Type') || 'application/octet-stream';
    
    if (!bucket || !key) {
      return c.json({
        ok: false,
        error: 'Bucket and key are required'
      }, 400);
    }
    
    // Ensure bucket exists
    await ensureBucket(bucket);
    
    const filePath = getFilePath(bucket, key);
    const fileDir = path.dirname(filePath);
    
    // Ensure directory exists
    await fs.mkdir(fileDir, { recursive: true });
    
    // Check content type for base64
    if (contentType.includes('base64') || c.req.query('encoding') === 'base64') {
      // Handle base64 encoded body
      const body = await c.req.text();
      const base64Data = body.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(filePath, buffer);
    } else {
      // Handle binary stream
      const arrayBuffer = await c.req.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(filePath, buffer);
    }
    
    // Get file stats
    const stats = await fs.stat(filePath);
    
    return c.json({
      ok: true,
      key,
      size: stats.size
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upload file';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Downloads a file from a bucket.
 * Streams the file content with appropriate headers.
 * 
 * @route GET /api/storage/:bucket/:key
 * @param {string} bucket - Bucket name (URL parameter)
 * @param {string} key - File key/path (URL parameter)
 * @query {string} [contentType] - Override content type for response
 * @returns {Stream} File content with Content-Type and Content-Length headers
 * @returns {Object} 404 - { ok: false, error: string } - File not found
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl http://localhost:3000/api/storage/images/avatar.png \
 *   -H "Authorization: Bearer your-api-key" \
 *   -o avatar.png
 * ```
 */
storageApi.get('/:bucket/:key', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    const key = c.req.param('key');
    
    if (!bucket || !key) {
      return c.json({
        ok: false,
        error: 'Bucket and key are required'
      }, 400);
    }
    
    const filePath = getFilePath(bucket, key);
    
    // Check if file exists
    if (!existsSync(filePath)) {
      return c.json({
        ok: false,
        error: `File '${key}' not found in bucket '${bucket}'`
      }, 404);
    }
    
    // Get file stats for headers
    const stats = await fs.stat(filePath);
    
    // Set appropriate headers
    const contentType = c.req.query('contentType') || 'application/octet-stream';
    
    c.header('Content-Type', contentType);
    c.header('Content-Length', stats.size.toString());
    c.header('Content-Disposition', `inline; filename="${key}"`);
    
    // Stream the file
    const fileStream = createReadStream(filePath);
    
    return c.body(fileStream as any);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to download file';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Deletes a file from a bucket.
 * 
 * @route DELETE /api/storage/:bucket/:key
 * @param {string} bucket - Bucket name (URL parameter)
 * @param {string} key - File key/path (URL parameter)
 * @returns {Object} 200 - { ok: true }
 * @returns {Object} 404 - { ok: false, error: string } - File not found
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl -X DELETE http://localhost:3000/api/storage/images/avatar.png \
 *   -H "Authorization: Bearer your-api-key"
 * ```
 */
storageApi.delete('/:bucket/:key', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    const key = c.req.param('key');
    
    if (!bucket || !key) {
      return c.json({
        ok: false,
        error: 'Bucket and key are required'
      }, 400);
    }
    
    const filePath = getFilePath(bucket, key);
    
    // Check if file exists
    if (!existsSync(filePath)) {
      return c.json({
        ok: false,
        error: `File '${key}' not found in bucket '${bucket}'`
      }, 404);
    }
    
    // Delete file
    await fs.unlink(filePath);
    
    return c.json({
      ok: true
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete file';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Lists files in a bucket with optional filtering.
 * 
 * @route GET /api/storage/:bucket
 * @param {string} bucket - Bucket name (URL parameter)
 * @query {string} [prefix] - Filter by key prefix
 * @query {number} [limit=1000] - Max files to return
 * @returns {Object} 200 - { ok: true, files: FileInfo[] }
 * @returns {Object} 404 - { ok: false, error: string } - Bucket not found
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * # List all files
 * curl http://localhost:3000/api/storage/images \
 *   -H "Authorization: Bearer your-api-key"
 * 
 * # List files with prefix
 * curl "http://localhost:3000/api/storage/images?prefix=avatars/" \
 *   -H "Authorization: Bearer your-api-key"
 * ```
 */
storageApi.get('/:bucket', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    const prefix = c.req.query('prefix');
    const limitStr = c.req.query('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : 1000;
    
    if (!bucket) {
      return c.json({
        ok: false,
        error: 'Bucket name is required'
      }, 400);
    }
    
    const bucketPath = getBucketPath(bucket);
    
    // Check if bucket exists
    if (!existsSync(bucketPath)) {
      return c.json({
        ok: false,
        error: `Bucket '${bucket}' not found`
      }, 404);
    }
    
    // List files recursively
    const files: FileInfo[] = [];
    
    async function walkDir(dir: string, basePath: string = '') {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = basePath ? path.join(basePath, entry.name) : entry.name;
        
        // Apply prefix filter
        if (prefix && !relativePath.startsWith(prefix)) {
          continue;
        }
        
        if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          files.push({
            key: relativePath,
            size: stats.size,
            created: stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString()
          });
          
          if (files.length >= limit) {
            return;
          }
        } else if (entry.isDirectory()) {
          await walkDir(fullPath, relativePath);
        }
      }
    }
    
    await walkDir(bucketPath);
    
    // Sort by key
    files.sort((a, b) => a.key.localeCompare(b.key));
    
    return c.json({
      ok: true,
      files: files.slice(0, limit)
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list files';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

export default storageApi;
