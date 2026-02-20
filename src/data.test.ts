import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { dataApi } from './api/data.js';
import { initializeLmdb, shutdownLmdb } from './db/index.js';

describe('Data API', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = join(tmpdir(), `hyper-micro-data-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    await initializeLmdb({ path: tempDir });
  });

  afterEach(async () => {
    // Clean up
    await shutdownLmdb();
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createDatabase', () => {
    it('should create a database successfully', async () => {
      const res = await dataApi.request('/dbs/mydb', { method: 'POST' });
      const data = await res.json();
      
      expect(res.status).toBe(201);
      expect(data).toMatchObject({
        ok: true,
        db: 'mydb'
      });
    });

    it('should create multiple databases', async () => {
      const res1 = await dataApi.request('/dbs/db1', { method: 'POST' });
      const res2 = await dataApi.request('/dbs/db2', { method: 'POST' });
      const res3 = await dataApi.request('/dbs/users', { method: 'POST' });
      
      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res3.status).toBe(201);
    });

    it('should accept valid database names with underscores and hyphens', async () => {
      const res1 = await dataApi.request('/dbs/my_database', { method: 'POST' });
      const res2 = await dataApi.request('/dbs/my-database', { method: 'POST' });
      const res3 = await dataApi.request('/dbs/db123', { method: 'POST' });
      
      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res3.status).toBe(201);
    });

    it('should return 400 for invalid database names', async () => {
      const res = await dataApi.request('/dbs/my database', { method: 'POST' });
      expect(res.status).toBe(400);
      
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('letters, numbers, underscores, and hyphens');
    });
  });

  describe('listDatabases', () => {
    it('should return empty array when no databases exist', async () => {
      const res = await dataApi.request('/dbs', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data).toEqual({ ok: true, databases: [] });
    });

    it('should list all created databases', async () => {
      // Create multiple databases
      await dataApi.request('/dbs/products', { method: 'POST' });
      await dataApi.request('/dbs/orders', { method: 'POST' });
      await dataApi.request('/dbs/customers', { method: 'POST' });
      
      const res = await dataApi.request('/dbs', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.databases).toContain('products');
      expect(data.databases).toContain('orders');
      expect(data.databases).toContain('customers');
      expect(data.databases.length).toBe(3);
    });

    it('should return databases in sorted order', async () => {
      // Create databases in random order
      await dataApi.request('/dbs/zebra', { method: 'POST' });
      await dataApi.request('/dbs/apple', { method: 'POST' });
      await dataApi.request('/dbs/mango', { method: 'POST' });
      
      const res = await dataApi.request('/dbs', { method: 'GET' });
      const data = await res.json();
      
      expect(data.databases).toEqual(['apple', 'mango', 'zebra']);
    });
  });

  describe('createDoc', () => {
    it('should create a document successfully', async () => {
      await dataApi.request('/dbs/testdb', { method: 'POST' });
      
      const res = await dataApi.request('/dbs/testdb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'user:1', value: { name: 'Alice', email: 'alice@example.com' } })
      });
      const data = await res.json();
      
      expect(res.status).toBe(201);
      expect(data).toMatchObject({
        ok: true,
        key: 'user:1'
      });
    });

    it('should create documents with various value types', async () => {
      await dataApi.request('/dbs/typedb', { method: 'POST' });
      
      // Object value
      let res = await dataApi.request('/dbs/typedb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'obj', value: { foo: 'bar' } })
      });
      expect(res.status).toBe(201);
      
      // Array value
      res = await dataApi.request('/dbs/typedb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'arr', value: [1, 2, 3] })
      });
      expect(res.status).toBe(201);
      
      // String value
      res = await dataApi.request('/dbs/typedb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'str', value: 'hello world' })
      });
      expect(res.status).toBe(201);
      
      // Number value
      res = await dataApi.request('/dbs/typedb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'num', value: 42 })
      });
      expect(res.status).toBe(201);
      
      // Null value
      res = await dataApi.request('/dbs/typedb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'null', value: null })
      });
      expect(res.status).toBe(201);
    });

    it('should return 400 for missing key', async () => {
      await dataApi.request('/dbs/testdb2', { method: 'POST' });
      
      const res = await dataApi.request('/dbs/testdb2/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: { name: 'Alice' } })
      });
      
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('key');
    });

    it('should return 400 for missing value', async () => {
      await dataApi.request('/dbs/testdb3', { method: 'POST' });
      
      const res = await dataApi.request('/dbs/testdb3/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'user:1' })
      });
      
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('value');
    });

    it('should return 409 for duplicate key', async () => {
      await dataApi.request('/dbs/dupdb', { method: 'POST' });
      
      // Create first document
      const res1 = await dataApi.request('/dbs/dupdb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'unique', value: 'first' })
      });
      expect(res1.status).toBe(201);
      
      // Try to create with same key
      const res2 = await dataApi.request('/dbs/dupdb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'unique', value: 'second' })
      });
      expect(res2.status).toBe(409);
      const data = await res2.json();
      expect(data.error).toContain('already exists');
    });
  });

  describe('listDocs', () => {
    it('should return empty array for empty database', async () => {
      await dataApi.request('/dbs/emptydb', { method: 'POST' });
      
      const res = await dataApi.request('/dbs/emptydb/docs', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data).toMatchObject({ ok: true, docs: [] });
    });

    it('should list all documents in a database', async () => {
      await dataApi.request('/dbs/listdb', { method: 'POST' });
      
      // Create documents
      await dataApi.request('/dbs/listdb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'doc1', value: 'value1' })
      });
      await dataApi.request('/dbs/listdb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'doc2', value: 'value2' })
      });
      await dataApi.request('/dbs/listdb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'doc3', value: 'value3' })
      });
      
      const res = await dataApi.request('/dbs/listdb/docs', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.docs.length).toBe(3);
    });

    it('should filter by prefix', async () => {
      await dataApi.request('/dbs/prefixdb', { method: 'POST' });
      
      // Create documents with different prefixes
      await dataApi.request('/dbs/prefixdb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'user:1', value: 'Alice' })
      });
      await dataApi.request('/dbs/prefixdb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'user:2', value: 'Bob' })
      });
      await dataApi.request('/dbs/prefixdb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'product:1', value: 'Widget' })
      });
      
      const res = await dataApi.request('/dbs/prefixdb/docs?prefix=user:', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.docs.length).toBe(2);
      
      const keys = data.docs.map((d: any) => d.key);
      expect(keys).toContain('user:1');
      expect(keys).toContain('user:2');
      expect(keys).not.toContain('product:1');
    });

    it('should respect limit parameter', async () => {
      await dataApi.request('/dbs/limitdb', { method: 'POST' });
      
      // Create multiple documents
      for (let i = 0; i < 10; i++) {
        await dataApi.request('/dbs/limitdb/docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: `doc${i}`, value: `value${i}` })
        });
      }
      
      const res = await dataApi.request('/dbs/limitdb/docs?limit=5', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.docs.length).toBe(5);
    });
  });

  describe('getDoc', () => {
    it('should get a document by key', async () => {
      await dataApi.request('/dbs/getdb', { method: 'POST' });
      
      await dataApi.request('/dbs/getdb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'user:1', value: { name: 'Alice', email: 'alice@example.com' } })
      });
      
      const res = await dataApi.request('/dbs/getdb/docs/user:1', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data).toMatchObject({
        ok: true,
        key: 'user:1',
        value: { name: 'Alice', email: 'alice@example.com' }
      });
    });

    it('should return 404 for non-existent document', async () => {
      await dataApi.request('/dbs/getdb2', { method: 'POST' });
      
      const res = await dataApi.request('/dbs/getdb2/docs/nonexistent', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(404);
      expect(data.ok).toBe(false);
      expect(data.error).toContain('not found');
    });
  });

  describe('updateDoc', () => {
    it('should update an existing document', async () => {
      await dataApi.request('/dbs/updatedb', { method: 'POST' });
      
      // Create document
      await dataApi.request('/dbs/updatedb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'user:1', value: { name: 'Alice' } })
      });
      
      // Update document
      const res = await dataApi.request('/dbs/updatedb/docs/user:1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: { name: 'Alice Updated', email: 'alice@example.com' } })
      });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      
      // Verify update
      const getRes = await dataApi.request('/dbs/updatedb/docs/user:1', { method: 'GET' });
      const getData = await getRes.json();
      expect(getData.value).toEqual({ name: 'Alice Updated', email: 'alice@example.com' });
    });

    it('should return 404 for non-existent document', async () => {
      await dataApi.request('/dbs/updatedb2', { method: 'POST' });
      
      const res = await dataApi.request('/dbs/updatedb2/docs/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: { name: 'New' } })
      });
      
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain('not found');
    });

    it('should return 400 for missing value', async () => {
      await dataApi.request('/dbs/updatedb3', { method: 'POST' });
      await dataApi.request('/dbs/updatedb3/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'doc1', value: 'original' })
      });
      
      const res = await dataApi.request('/dbs/updatedb3/docs/doc1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('value');
    });
  });

  describe('deleteDoc', () => {
    it('should delete an existing document', async () => {
      await dataApi.request('/dbs/deldocdb', { method: 'POST' });
      
      // Create document
      await dataApi.request('/dbs/deldocdb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'todelete', value: 'delete me' })
      });
      
      // Delete document
      const res = await dataApi.request('/dbs/deldocdb/docs/todelete', { method: 'DELETE' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data).toEqual({ ok: true });
      
      // Verify deleted
      const getRes = await dataApi.request('/dbs/deldocdb/docs/todelete', { method: 'GET' });
      expect(getRes.status).toBe(404);
    });

    it('should return 404 for non-existent document', async () => {
      await dataApi.request('/dbs/deldocdb2', { method: 'POST' });
      
      const res = await dataApi.request('/dbs/deldocdb2/docs/nonexistent', { method: 'DELETE' });
      const data = await res.json();
      
      expect(res.status).toBe(404);
      expect(data.error).toContain('not found');
    });
  });

  describe('deleteDatabase', () => {
    it('should delete a database and its documents', async () => {
      // Create database and documents
      await dataApi.request('/dbs/toDelDb', { method: 'POST' });
      await dataApi.request('/dbs/toDelDb/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'doc1', value: 'data' })
      });
      
      // Delete database
      const res = await dataApi.request('/dbs/toDelDb', { method: 'DELETE' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data).toEqual({ ok: true });
      
      // Verify database is gone
      const listRes = await dataApi.request('/dbs', { method: 'GET' });
      const listData = await listRes.json();
      expect(listData.databases).not.toContain('toDelDb');
    });
  });
});