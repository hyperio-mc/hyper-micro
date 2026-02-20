/**
 * @fileoverview LMDB Database Adapter for hyper-micro
 * 
 * This module provides a high-level API for document storage using LMDB (Lightning Memory-Mapped Database).
 * It supports multiple databases, document CRUD operations, and API key management.
 * 
 * @module db
 * @example
 * ```typescript
 * import { initializeLmdb, createDatabase, createDocument, getDocument } from './db';
 * 
 * // Initialize the database
 * await initializeLmdb({ path: './data/lmdb' });
 * 
 * // Create a database and document
 * await createDatabase('users');
 * await createDocument('users', 'user:1', { name: 'Alice', email: 'alice@example.com' });
 * 
 * // Retrieve the document
 * const doc = await getDocument('users', 'user:1');
 * console.log(doc); // { key: 'user:1', value: { name: 'Alice', email: 'alice@example.com' } }
 * ```
 */

import { open, RootDatabase, Database } from 'lmdb';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Configuration options for LMDB initialization.
 * @interface LmdbConfig
 */
export interface LmdbConfig {
  /** 
   * File system path where LMDB will store its data files.
   * The directory will be created if it doesn't exist.
   */
  path: string;
}

/**
 * Represents a document stored in the database.
 * @interface Document
 */
export interface Document {
  /** Unique identifier for the document within its database */
  key: string;
  /** The stored value (can be any JSON-serializable data) */
  value: any;
}

/**
 * Options for querying/listing documents.
 * @interface QueryOptions
 */
export interface QueryOptions {
  /** Start key for range queries (inclusive) */
  startKey?: string;
  /** End key for range queries (exclusive) */
  endKey?: string;
  /** Maximum number of documents to return (default: 1000) */
  limit?: number;
  /** Filter documents by key prefix */
  prefix?: string;
}

/** Root LMDB database instance */
let rootDb: RootDatabase | null = null;

/** Meta database for tracking created databases */
let metaDb: Database<Record<string, string>> | null = null;

/** Cache of opened database instances */
const dbCache = new Map<string, Database>();

/** System-reserved database names that cannot be used for user data */
const SYSTEM_DBS = ['__meta', '__keys'];

/**
 * Initializes the LMDB database system.
 * Must be called before any other database operations.
 * 
 * @param config - Configuration object containing the storage path
 * @returns Promise that resolves when initialization is complete
 * @throws Error if LMDB fails to initialize
 * 
 * @example
 * ```typescript
 * await initializeLmdb({ path: './data/lmdb' });
 * ```
 */
export async function initializeLmdb(config: LmdbConfig): Promise<void> {
  // Ensure directory exists
  const fs = await import('node:fs');
  if (!fs.existsSync(config.path)) {
    fs.mkdirSync(config.path, { recursive: true });
  }

  // Open root database
  rootDb = open({
    path: config.path,
    name: 'root',
  });

  // Open meta database for tracking created databases
  metaDb = rootDb.openDB({
    name: '__meta',
  });

  console.log('✅ LMDB initialized at:', config.path);
}

/**
 * Gracefully shuts down the LMDB database system.
 * Closes all database connections and clears the cache.
 * Should be called when the application is shutting down.
 * 
 * @returns Promise that resolves when shutdown is complete
 * 
 * @example
 * ```typescript
 * process.on('SIGTERM', async () => {
 *   await shutdownLmdb();
 *   process.exit(0);
 * });
 * ```
 */
export async function shutdownLmdb(): Promise<void> {
  if (rootDb) {
    await rootDb.close();
    rootDb = null;
    metaDb = null;
    dbCache.clear();
    console.log('✅ LMDB closed');
  }
}

/**
 * Gets or creates a database instance by name.
 * Internal function that caches database instances for performance.
 * 
 * @param name - The database name
 * @returns The database instance
 * @throws Error if LMDB has not been initialized
 */
function getDb(name: string): Database {
  if (!rootDb) {
    throw new Error('LMDB not initialized');
  }

  if (!dbCache.has(name)) {
    const db = rootDb.openDB({
      name,
      compression: true,
    });
    dbCache.set(name, db);
  }

  return dbCache.get(name)!;
}

/**
 * Creates a new database with the given name.
 * The database is tracked in the meta store for listing purposes.
 * 
 * @param name - Unique name for the database (alphanumeric, underscore, hyphen only)
 * @returns Promise that resolves when the database is created
 * @throws Error if the database already exists or LMDB is not initialized
 * 
 * @example
 * ```typescript
 * await createDatabase('users');
 * await createDatabase('products');
 * ```
 */
export async function createDatabase(name: string): Promise<void> {
  if (!metaDb) {
    throw new Error('LMDB not initialized');
  }

  // Check if already exists
  if (await metaDb.get(name)) {
    throw new Error(`Database '${name}' already exists`);
  }

  // Create the database by opening it
  getDb(name);

  // Track in meta
  await metaDb.put(name, JSON.stringify({
    created: new Date().toISOString(),
    name
  }));
}

/**
 * Deletes a database and all its documents.
 * The database is removed from the meta store and its data is cleared.
 * 
 * @param name - Name of the database to delete
 * @returns Promise that resolves when deletion is complete
 * @throws Error if the database doesn't exist or LMDB is not initialized
 * 
 * @example
 * ```typescript
 * await deleteDatabase('old-data');
 * ```
 */
export async function deleteDatabase(name: string): Promise<void> {
  if (!rootDb || !metaDb) {
    throw new Error('LMDB not initialized');
  }

  // Check if exists
  if (!(await metaDb.get(name))) {
    throw new Error(`Database '${name}' not found`);
  }

  // Remove from cache
  const db = dbCache.get(name);
  if (db) {
    // LMDB doesn't have explicit delete, we clear the data
    await db.clear();
    dbCache.delete(name);
  }

  // Remove from meta
  await metaDb.remove(name);
}

/**
 * Lists all user-created databases.
 * System databases (prefixed with '__') are excluded from the list.
 * 
 * @returns Promise resolving to an array of database names, sorted alphabetically
 * @throws Error if LMDB is not initialized
 * 
 * @example
 * ```typescript
 * const databases = await listDatabases();
 * console.log(databases); // ['products', 'users']
 * ```
 */
export async function listDatabases(): Promise<string[]> {
  if (!metaDb) {
    throw new Error('LMDB not initialized');
  }

  const dbs: string[] = [];
  
  // Iterate through meta database
  for await (const { key, value } of metaDb.getRange()) {
    if (!SYSTEM_DBS.includes(key)) {
      dbs.push(key);
    }
  }

  return dbs.sort();
}

/**
 * Checks if a database with the given name exists.
 * 
 * @param name - Database name to check
 * @returns Promise resolving to true if database exists, false otherwise
 * 
 * @example
 * ```typescript
 * if (await databaseExists('users')) {
 *   console.log('Users database already exists');
 * }
 * ```
 */
export async function databaseExists(name: string): Promise<boolean> {
  if (!metaDb) {
    return false;
  }
  return !!(await metaDb.get(name));
}

/**
 * Tracks a database in the meta store.
 * Used internally to register databases for listing.
 * 
 * @param name - Database name to track
 * @returns Promise that resolves when tracking is complete
 * @throws Error if LMDB is not initialized
 * @internal
 */
export async function trackDatabase(name: string): Promise<void> {
  if (!metaDb) {
    throw new Error('LMDB not initialized');
  }
  
  if (!(await metaDb.get(name))) {
    await metaDb.put(name, JSON.stringify({
      created: new Date().toISOString(),
      name
    }));
  }
}

/**
 * Removes a database from tracking in the meta store.
 * Used internally when deleting databases.
 * 
 * @param name - Database name to untrack
 * @returns Promise that resolves when untracking is complete
 * @throws Error if LMDB is not initialized
 * @internal
 */
export async function untrackDatabase(name: string): Promise<void> {
  if (!metaDb) {
    throw new Error('LMDB not initialized');
  }
  
  await metaDb.remove(name);
}

/**
 * Creates a new document in the specified database.
 * 
 * @param dbName - Name of the database
 * @param key - Unique key for the document
 * @param value - Document value (must be JSON-serializable)
 * @returns Promise that resolves when the document is created
 * @throws Error if a document with the same key already exists
 * 
 * @example
 * ```typescript
 * await createDocument('users', 'user:1', { name: 'Alice', role: 'admin' });
 * ```
 */
export async function createDocument(dbName: string, key: string, value: any): Promise<void> {
  const db = getDb(dbName);
  
  // Check if exists
  if (await db.get(key)) {
    throw new Error(`Document with key '${key}' already exists`);
  }
  
  await db.put(key, value);
}

/**
 * Retrieves a document from the specified database.
 * 
 * @param dbName - Name of the database
 * @param key - Key of the document to retrieve
 * @returns Promise resolving to the document, or null if not found
 * 
 * @example
 * ```typescript
 * const doc = await getDocument('users', 'user:1');
 * if (doc) {
 *   console.log(doc.value); // { name: 'Alice', role: 'admin' }
 * }
 * ```
 */
export async function getDocument(dbName: string, key: string): Promise<Document | null> {
  const db = getDb(dbName);
  const value = await db.get(key);
  
  if (value === undefined) {
    return null;
  }
  
  return { key, value };
}

/**
 * Updates an existing document in the specified database.
 * Replaces the entire document value.
 * 
 * @param dbName - Name of the database
 * @param key - Key of the document to update
 * @param value - New document value (must be JSON-serializable)
 * @returns Promise that resolves when the document is updated
 * @throws Error if the document doesn't exist
 * 
 * @example
 * ```typescript
 * await updateDocument('users', 'user:1', { name: 'Alice', role: 'superadmin' });
 * ```
 */
export async function updateDocument(dbName: string, key: string, value: any): Promise<void> {
  const db = getDb(dbName);
  
  // Check if exists
  if (!(await db.get(key))) {
    throw new Error(`Document with key '${key}' not found`);
  }
  
  await db.put(key, value);
}

/**
 * Deletes a document from the specified database.
 * 
 * @param dbName - Name of the database
 * @param key - Key of the document to delete
 * @returns Promise that resolves when the document is deleted
 * @throws Error if the document doesn't exist
 * 
 * @example
 * ```typescript
 * await deleteDocument('users', 'user:1');
 * ```
 */
export async function deleteDocument(dbName: string, key: string): Promise<void> {
  const db = getDb(dbName);
  
  // Check if exists
  if (!(await db.get(key))) {
    throw new Error(`Document with key '${key}' not found`);
  }
  
  await db.remove(key);
}

/**
 * Lists documents from the specified database with optional filtering.
 * Supports range queries, prefix filtering, and pagination.
 * 
 * @param dbName - Name of the database
 * @param options - Query options
 * @param options.startKey - Start key for range query (inclusive)
 * @param options.endKey - End key for range query (exclusive)
 * @param options.limit - Maximum number of documents to return (default: 1000, max: 10000)
 * @param options.prefix - Filter by key prefix
 * @returns Promise resolving to an array of documents
 * 
 * @example
 * ```typescript
 * // List all documents (up to 1000)
 * const docs = await listDocuments('users');
 * 
 * // List documents with prefix filter
 * const userDocs = await listDocuments('users', { prefix: 'user:' });
 * 
 * // Paginated query
 * const page1 = await listDocuments('users', { limit: 10 });
 * const page2 = await listDocuments('users', { 
 *   startKey: page1[page1.length - 1].key,
 *   limit: 10 
 * });
 * ```
 */
export async function listDocuments(dbName: string, options: QueryOptions = {}): Promise<Document[]> {
  const db = getDb(dbName);
  const docs: Document[] = [];
  
  const {
    startKey,
    endKey,
    limit = 1000,
    prefix
  } = options;

  // Build the range options
  let start: string | undefined;
  let end: string | undefined;
  
  if (prefix) {
    start = prefix;
    // Create end key by appending a high character
    end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
  } else {
    start = startKey;
    end = endKey;
  }

  const rangeOptions: any = {
    limit,
  };
  
  if (start !== undefined) {
    rangeOptions.start = start;
  }
  if (end !== undefined) {
    rangeOptions.end = end;
  }

  // Iterate through the database
  for await (const { key, value } of db.getRange(rangeOptions)) {
    docs.push({ key, value });
    
    if (docs.length >= limit) {
      break;
    }
  }

  return docs;
}

// ============================================
// API Key Management
// ============================================

const SYSTEM_DB = '__system';

/**
 * Hashes an API key using SHA-256.
 * Keys are stored as hashes for security.
 * 
 * @param key - The raw API key to hash
 * @returns Hexadecimal string of the hash
 * @internal
 */
function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Generates a new API key for authentication.
 * The key is returned only once and cannot be retrieved again.
 * 
 * @param name - Optional friendly name for the key
 * @returns Promise resolving to an object with id, key, and name
 * 
 * @example
 * ```typescript
 * const result = await generateApiKey('my-app-key');
 * console.log(result.key); // 'hm_abc123...' (save this!)
 * console.log(result.id);  // UUID for key management
 * ```
 */
export async function generateApiKey(name?: string): Promise<{ id: string; key: string; name?: string }> {
  const db = getDb(SYSTEM_DB);
  
  const id = crypto.randomUUID();
  const rawKey = `hm_${crypto.randomBytes(16).toString('hex')}`;
  const keyHash = hashKey(rawKey);
  
  await db.put(`key:${id}`, JSON.stringify({
    id,
    keyHash,
    name: name || 'Unnamed key',
    created: new Date().toISOString()
  }));
  
  return { id, key: rawKey, name };
}

/**
 * Validates an API key by checking against stored hashes.
 * 
 * @param key - The API key to validate
 * @returns Promise resolving to true if valid, false otherwise
 * 
 * @example
 * ```typescript
 * const isValid = await validateApiKey('hm_abc123...');
 * if (isValid) {
 *   // Allow access
 * }
 * ```
 */
export async function validateApiKey(key: string): Promise<boolean> {
  if (!rootDb) return false;
  
  const db = rootDb.openDB({ name: SYSTEM_DB });
  const keyHash = hashKey(key);
  
  // Iterate through stored keys
  for await (const { value } of db.getRange({ prefix: 'key:' })) {
    const stored = JSON.parse(value);
    if (stored.keyHash === keyHash) {
      return true;
    }
  }
  
  return false;
}

/**
 * Lists all API keys (without exposing the actual key values).
 * Returns metadata about each key for management purposes.
 * 
 * @returns Promise resolving to an array of key metadata objects
 * 
 * @example
 * ```typescript
 * const keys = await listApiKeys();
 * keys.forEach(k => console.log(`${k.name} (${k.id})`));
 * ```
 */
export async function listApiKeys(): Promise<Array<{ id: string; name: string; created: string }>> {
  const db = getDb(SYSTEM_DB);
  const keys: Array<{ id: string; name: string; created: string }> = [];
  
  for await (const { value } of db.getRange({ prefix: 'key:' })) {
    const stored = JSON.parse(value);
    keys.push({
      id: stored.id,
      name: stored.name,
      created: stored.created
    });
  }
  
  return keys.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
}

/**
 * Deletes (revokes) an API key by its ID.
 * After deletion, the key will no longer be accepted for authentication.
 * 
 * @param id - The UUID of the API key to delete
 * @returns Promise that resolves when deletion is complete
 * 
 * @example
 * ```typescript
 * await deleteApiKey('550e8400-e29b-41d4-a716-446655440000');
 * ```
 */
export async function deleteApiKey(id: string): Promise<void> {
  const db = getDb(SYSTEM_DB);
  await db.remove(`key:${id}`);
}
