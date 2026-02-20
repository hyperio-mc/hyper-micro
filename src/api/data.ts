/**
 * @fileoverview Data API - Database and Document Management
 * 
 * This module provides REST endpoints for managing databases and documents.
 * All endpoints require Bearer token authentication (except health check).
 * 
 * ## Database Operations
 * - `POST /api/dbs/:db` - Create a new database
 * - `DELETE /api/dbs/:db` - Delete a database
 * - `GET /api/dbs` - List all databases
 * 
 * ## Document Operations
 * - `POST /api/dbs/:db/docs` - Create a document
 * - `GET /api/dbs/:db/docs/:id` - Get a document
 * - `PUT /api/dbs/:db/docs/:id` - Update a document
 * - `DELETE /api/dbs/:db/docs/:id` - Delete a document
 * - `GET /api/dbs/:db/docs` - List/query documents
 * 
 * @module api/data
 * @example
 * ```bash
 * # Create a database
 * curl -X POST http://localhost:3000/api/dbs/mydb \
 *   -H "Authorization: Bearer dev-key-change-in-production"
 * 
 * # Create a document
 * curl -X POST http://localhost:3000/api/dbs/mydb/docs \
 *   -H "Authorization: Bearer dev-key-change-in-production" \
 *   -H "Content-Type: application/json" \
 *   -d '{"key": "user:1", "value": {"name": "Alice"}}'
 * ```
 */

import { Hono } from 'hono';
import { 
  createDatabase, 
  deleteDatabase, 
  listDatabases, 
  trackDatabase, 
  untrackDatabase,
  createDocument, 
  getDocument, 
  updateDocument, 
  deleteDocument, 
  listDocuments,
  databaseExists 
} from '../db/index.js';

/** Hono router for data API endpoints */
export const dataApi = new Hono();

// ============================================
// Database Operations
// ============================================

/**
 * Creates a new database.
 * 
 * @route POST /api/dbs/:db
 * @param {string} db - Database name (URL parameter)
 * @returns {Object} 201 - { ok: true, db: string }
 * @returns {Object} 400 - { ok: false, error: string } - Invalid name
 * @returns {Object} 500 - { ok: false, error: string } - Database already exists
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl -X POST http://localhost:3000/api/dbs/users \
 *   -H "Authorization: Bearer your-api-key"
 * ```
 */
dataApi.post('/dbs/:db', async (c) => {
  try {
    const dbName = c.req.param('db');
    
    // Validate database name
    if (!dbName || dbName.trim() === '') {
      return c.json({
        ok: false,
        error: 'Database name is required'
      }, 400);
    }
    
    // Sanitize name (basic validation)
    if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
      return c.json({
        ok: false,
        error: 'Database name can only contain letters, numbers, underscores, and hyphens'
      }, 400);
    }
    
    // Create the database
    await createDatabase(dbName);
    await trackDatabase(dbName);
    
    return c.json({
      ok: true,
      db: dbName
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create database';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Deletes a database and all its documents.
 * 
 * @route DELETE /api/dbs/:db
 * @param {string} db - Database name (URL parameter)
 * @returns {Object} 200 - { ok: true }
 * @returns {Object} 400 - { ok: false, error: string } - Invalid name
 * @returns {Object} 500 - { ok: false, error: string } - Database not found
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl -X DELETE http://localhost:3000/api/dbs/users \
 *   -H "Authorization: Bearer your-api-key"
 * ```
 */
dataApi.delete('/dbs/:db', async (c) => {
  try {
    const dbName = c.req.param('db');
    
    if (!dbName) {
      return c.json({
        ok: false,
        error: 'Database name is required'
      }, 400);
    }
    
    // Delete the database
    await deleteDatabase(dbName);
    await untrackDatabase(dbName);
    
    return c.json({
      ok: true
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete database';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Lists all databases.
 * 
 * @route GET /api/dbs
 * @returns {Object} 200 - { ok: true, databases: string[] }
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl http://localhost:3000/api/dbs \
 *   -H "Authorization: Bearer your-api-key"
 * ```
 */
dataApi.get('/dbs', async (c) => {
  try {
    const databases = await listDatabases();
    
    return c.json({
      ok: true,
      databases
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list databases';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

// ============================================
// Document Operations
// ============================================

/**
 * Creates a new document in a database.
 * 
 * @route POST /api/dbs/:db/docs
 * @param {string} db - Database name (URL parameter)
 * @body { key: string, value: any }
 * @returns {Object} 201 - { ok: true, key: string }
 * @returns {Object} 400 - { ok: false, error: string } - Missing key or value
 * @returns {Object} 409 - { ok: false, error: string } - Key already exists
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl -X POST http://localhost:3000/api/dbs/users/docs \
 *   -H "Authorization: Bearer your-api-key" \
 *   -H "Content-Type: application/json" \
 *   -d '{"key": "user:1", "value": {"name": "Alice", "email": "alice@example.com"}}'
 * ```
 */
dataApi.post('/dbs/:db/docs', async (c) => {
  try {
    const dbName = c.req.param('db');
    
    if (!dbName) {
      return c.json({
        ok: false,
        error: 'Database name is required'
      }, 400);
    }
    
    // Parse request body
    let body: { key?: string; value?: any };
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        ok: false,
        error: 'Invalid JSON body'
      }, 400);
    }
    
    // Validate key
    if (!body.key || typeof body.key !== 'string') {
      return c.json({
        ok: false,
        error: 'Document key is required and must be a string'
      }, 400);
    }
    
    // Validate value exists
    if (body.value === undefined) {
      return c.json({
        ok: false,
        error: 'Document value is required'
      }, 400);
    }
    
    // Create the document
    try {
      await createDocument(dbName, body.key, body.value);
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        return c.json({
          ok: false,
          error: err.message
        }, 409); // Conflict
      }
      throw err;
    }
    
    return c.json({
      ok: true,
      key: body.key
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create document';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Retrieves a document by its key.
 * 
 * @route GET /api/dbs/:db/docs/:id
 * @param {string} db - Database name (URL parameter)
 * @param {string} id - Document key (URL parameter)
 * @returns {Object} 200 - { ok: true, key: string, value: any }
 * @returns {Object} 404 - { ok: false, error: string } - Document not found
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl http://localhost:3000/api/dbs/users/docs/user:1 \
 *   -H "Authorization: Bearer your-api-key"
 * ```
 */
dataApi.get('/dbs/:db/docs/:id', async (c) => {
  try {
    const dbName = c.req.param('db');
    const key = c.req.param('id');
    
    if (!dbName) {
      return c.json({
        ok: false,
        error: 'Database name is required'
      }, 400);
    }
    
    if (!key) {
      return c.json({
        ok: false,
        error: 'Document key is required'
      }, 400);
    }
    
    // Get the document
    const doc = await getDocument(dbName, key);
    
    if (!doc) {
      return c.json({
        ok: false,
        error: `Document with key '${key}' not found`
      }, 404);
    }
    
    return c.json({
      ok: true,
      key: doc.key,
      value: doc.value
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get document';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Updates an existing document.
 * Replaces the entire document value.
 * 
 * @route PUT /api/dbs/:db/docs/:id
 * @param {string} db - Database name (URL parameter)
 * @param {string} id - Document key (URL parameter)
 * @body { value: any }
 * @returns {Object} 200 - { ok: true }
 * @returns {Object} 400 - { ok: false, error: string } - Missing value
 * @returns {Object} 404 - { ok: false, error: string } - Document not found
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl -X PUT http://localhost:3000/api/dbs/users/docs/user:1 \
 *   -H "Authorization: Bearer your-api-key" \
 *   -H "Content-Type: application/json" \
 *   -d '{"value": {"name": "Alice Updated", "email": "alice@example.com"}}'
 * ```
 */
dataApi.put('/dbs/:db/docs/:id', async (c) => {
  try {
    const dbName = c.req.param('db');
    const key = c.req.param('id');
    
    if (!dbName) {
      return c.json({
        ok: false,
        error: 'Database name is required'
      }, 400);
    }
    
    if (!key) {
      return c.json({
        ok: false,
        error: 'Document key is required'
      }, 400);
    }
    
    // Parse request body
    let body: { value?: any };
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        ok: false,
        error: 'Invalid JSON body'
      }, 400);
    }
    
    // Validate value exists
    if (body.value === undefined) {
      return c.json({
        ok: false,
        error: 'Document value is required'
      }, 400);
    }
    
    // Update the document
    try {
      await updateDocument(dbName, key, body.value);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return c.json({
          ok: false,
          error: err.message
        }, 404);
      }
      throw err;
    }
    
    return c.json({
      ok: true
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update document';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Deletes a document from a database.
 * 
 * @route DELETE /api/dbs/:db/docs/:id
 * @param {string} db - Database name (URL parameter)
 * @param {string} id - Document key (URL parameter)
 * @returns {Object} 200 - { ok: true }
 * @returns {Object} 404 - { ok: false, error: string } - Document not found
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * curl -X DELETE http://localhost:3000/api/dbs/users/docs/user:1 \
 *   -H "Authorization: Bearer your-api-key"
 * ```
 */
dataApi.delete('/dbs/:db/docs/:id', async (c) => {
  try {
    const dbName = c.req.param('db');
    const key = c.req.param('id');
    
    if (!dbName) {
      return c.json({
        ok: false,
        error: 'Database name is required'
      }, 400);
    }
    
    if (!key) {
      return c.json({
        ok: false,
        error: 'Document key is required'
      }, 400);
    }
    
    // Delete the document
    try {
      await deleteDocument(dbName, key);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return c.json({
          ok: false,
          error: err.message
        }, 404);
      }
      throw err;
    }
    
    return c.json({
      ok: true
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete document';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

/**
 * Lists documents in a database with optional filtering.
 * Supports range queries, prefix filtering, and pagination.
 * 
 * @route GET /api/dbs/:db/docs
 * @param {string} db - Database name (URL parameter)
 * @query {string} [startKey] - Start key for range query (inclusive)
 * @query {string} [endKey] - End key for range query (exclusive)
 * @query {number} [limit] - Max documents to return (default: 1000, max: 10000)
 * @query {string} [prefix] - Filter by key prefix
 * @returns {Object} 200 - { ok: true, docs: Array<{key: string, value: any}> }
 * @auth Bearer token required
 * 
 * @example
 * ```bash
 * # List all documents
 * curl http://localhost:3000/api/dbs/users/docs \
 *   -H "Authorization: Bearer your-api-key"
 * 
 * # Filter by prefix
 * curl "http://localhost:3000/api/dbs/users/docs?prefix=user:" \
 *   -H "Authorization: Bearer your-api-key"
 * 
 * # Paginate
 * curl "http://localhost:3000/api/dbs/users/docs?limit=10" \
 *   -H "Authorization: Bearer your-api-key"
 * ```
 */
dataApi.get('/dbs/:db/docs', async (c) => {
  try {
    const dbName = c.req.param('db');
    
    if (!dbName) {
      return c.json({
        ok: false,
        error: 'Database name is required'
      }, 400);
    }
    
    // Parse query parameters
    const startKey = c.req.query('startKey');
    const endKey = c.req.query('endKey');
    const limitStr = c.req.query('limit');
    const prefix = c.req.query('prefix');
    
    // Parse limit
    let limit: number | undefined;
    if (limitStr) {
      const parsed = parseInt(limitStr, 10);
      if (isNaN(parsed) || parsed < 1) {
        return c.json({
          ok: false,
          error: 'limit must be a positive integer'
        }, 400);
      }
      limit = Math.min(parsed, 10000); // Cap at 10000
    }
    
    // Query documents
    const docs = await listDocuments(dbName, {
      startKey,
      endKey,
      limit,
      prefix
    });
    
    return c.json({
      ok: true,
      docs
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list documents';
    return c.json({
      ok: false,
      error: message
    }, 500);
  }
});

export default dataApi;