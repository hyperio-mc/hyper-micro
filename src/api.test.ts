import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const BASE_URL = 'http://127.0.0.1:3000';
const API_KEY = 'dev-key-change-in-production';
const HEADERS = { 'Authorization': `Bearer ${API_KEY}` };

describe('hyper-micro API', () => {
  
  describe('Health', () => {
    it('should return health status', async () => {
      const res = await fetch(`${BASE_URL}/health`);
      const data = await res.json();
      assert.equal(data.status, 'ok');
    });
  });

  describe('Data API', () => {
    const testDb = 'test-db-' + Date.now();

    it('should create a database', async () => {
      const res = await fetch(`${BASE_URL}/api/dbs/${testDb}`, {
        method: 'POST',
        headers: HEADERS
      });
      const data = await res.json();
      assert.equal(data.ok, true);
    });

    it('should list databases', async () => {
      const res = await fetch(`${BASE_URL}/api/dbs`, { headers: HEADERS });
      const data = await res.json();
      assert.equal(data.ok, true);
      assert(Array.isArray(data.databases));
    });

    it('should create a document', async () => {
      const res = await fetch(`${BASE_URL}/api/dbs/${testDb}/docs`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'test-key', value: { hello: 'world' } })
      });
      const data = await res.json();
      assert.equal(data.ok, true);
    });

    it('should get a document', async () => {
      const res = await fetch(`${BASE_URL}/api/dbs/${testDb}/docs/test-key`, { headers: HEADERS });
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.deepEqual(data.value, { hello: 'world' });
    });

    it('should list documents', async () => {
      const res = await fetch(`${BASE_URL}/api/dbs/${testDb}/docs`, { headers: HEADERS });
      const data = await res.json();
      assert.equal(data.ok, true);
      assert(Array.isArray(data.docs));
    });

    it('should update a document', async () => {
      const res = await fetch(`${BASE_URL}/api/dbs/${testDb}/docs/test-key`, {
        method: 'PUT',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: { hello: 'updated' } })
      });
      const data = await res.json();
      assert.equal(data.ok, true);
    });

    it('should delete a document', async () => {
      const res = await fetch(`${BASE_URL}/api/dbs/${testDb}/docs/test-key`, {
        method: 'DELETE',
        headers: HEADERS
      });
      const data = await res.json();
      assert.equal(data.ok, true);
    });

    it('should delete a database', async () => {
      const res = await fetch(`${BASE_URL}/api/dbs/${testDb}`, {
        method: 'DELETE',
        headers: HEADERS
      });
      const data = await res.json();
      assert.equal(data.ok, true);
    });
  });

  describe('Storage API', () => {
    const testBucket = 'test-bucket-' + Date.now();

    it('should create a bucket', async () => {
      const res = await fetch(`${BASE_URL}/api/storage/${testBucket}`, {
        method: 'POST',
        headers: HEADERS
      });
      const data = await res.json();
      assert.equal(data.ok, true);
    });

    it('should upload a file', async () => {
      const res = await fetch(`${BASE_URL}/api/storage/${testBucket}/test.txt`, {
        method: 'PUT',
        headers: HEADERS,
        body: 'Hello World'
      });
      const data = await res.json();
      assert.equal(data.ok, true);
    });

    it('should list files', async () => {
      const res = await fetch(`${BASE_URL}/api/storage/${testBucket}`, { headers: HEADERS });
      const data = await res.json();
      assert.equal(data.ok, true);
      assert(Array.isArray(data.files));
    });

    it('should delete a file', async () => {
      const res = await fetch(`${BASE_URL}/api/storage/${testBucket}/test.txt`, {
        method: 'DELETE',
        headers: HEADERS
      });
      const data = await res.json();
      assert.equal(data.ok, true);
    });

    it('should delete a bucket', async () => {
      const res = await fetch(`${BASE_URL}/api/storage/${testBucket}`, {
        method: 'DELETE',
        headers: HEADERS
      });
      const data = await res.json();
      assert.equal(data.ok, true);
    });
  });
});
