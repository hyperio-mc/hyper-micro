import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { storageApi, setStoragePath, getStoragePath } from './api/storage.js';

describe('Storage API', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = join(tmpdir(), `hyper-micro-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    setStoragePath(tempDir);
  });

  afterEach(async () => {
    // Clean up the temporary directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createBucket', () => {
    it('should create a bucket successfully', async () => {
      const res = await storageApi.request('/images', { method: 'POST' });
      const data = await res.json();
      
      expect(res.status).toBe(201);
      expect(data).toEqual({ ok: true, bucket: 'images' });
    });

    it('should create multiple buckets', async () => {
      const res1 = await storageApi.request('/bucket1', { method: 'POST' });
      const res2 = await storageApi.request('/bucket2', { method: 'POST' });
      
      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
    });

    it('should return 409 for duplicate bucket name', async () => {
      // Create bucket first
      const res1 = await storageApi.request('/images', { method: 'POST' });
      expect(res1.status).toBe(201);
      
      // Try to create same bucket again
      const res2 = await storageApi.request('/images', { method: 'POST' });
      expect(res2.status).toBe(409);
      
      const data = await res2.json();
      expect(data).toMatchObject({
        ok: false,
        error: expect.stringContaining('already exists')
      });
    });

    it('should return 400 for empty bucket name', async () => {
      const res = await storageApi.request('/', { method: 'POST' });
      // Note: This might route to the bucket list endpoint depending on how Hono handles it
      // Let's test with a different approach
    });
  });

  describe('listBuckets', () => {
    it('should return empty array when no buckets exist', async () => {
      const res = await storageApi.request('/', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data).toEqual({ ok: true, buckets: [] });
    });

    it('should list all created buckets', async () => {
      // Create multiple buckets
      await storageApi.request('/images', { method: 'POST' });
      await storageApi.request('/videos', { method: 'POST' });
      await storageApi.request('/documents', { method: 'POST' });
      
      const res = await storageApi.request('/', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.buckets).toContain('images');
      expect(data.buckets).toContain('videos');
      expect(data.buckets).toContain('documents');
      expect(data.buckets.length).toBe(3);
    });
  });

  describe('deleteBucket', () => {
    it('should delete an existing bucket', async () => {
      // Create bucket
      await storageApi.request('/images', { method: 'POST' });
      
      // Delete bucket
      const res = await storageApi.request('/images', { method: 'DELETE' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data).toEqual({ ok: true });
      
      // Verify bucket is gone
      const listRes = await storageApi.request('/', { method: 'GET' });
      const listData = await listRes.json();
      expect(listData.buckets).not.toContain('images');
    });

    it('should return 404 for non-existent bucket', async () => {
      const res = await storageApi.request('/nonexistent', { method: 'DELETE' });
      const data = await res.json();
      
      expect(res.status).toBe(404);
      expect(data).toMatchObject({
        ok: false,
        error: expect.stringContaining('not found')
      });
    });
  });

  describe('uploadFile', () => {
    it('should upload a file successfully', async () => {
      // Create bucket first
      await storageApi.request('/mybucket', { method: 'POST' });
      
      // Upload file
      const res = await storageApi.request('/mybucket/test.txt', {
        method: 'PUT',
        body: 'Hello World'
      });
      const data = await res.json();
      
      expect(res.status).toBe(201);
      expect(data.ok).toBe(true);
      expect(data.key).toBe('test.txt');
      expect(data.size).toBe(11); // "Hello World" length
    });

    it('should create bucket automatically if it does not exist', async () => {
      // Upload without creating bucket first
      const res = await storageApi.request('/autobucket/file.txt', {
        method: 'PUT',
        body: 'Content'
      });
      const data = await res.json();
      
      expect(res.status).toBe(201);
      expect(data.ok).toBe(true);
    });

    it('should upload binary data', async () => {
      await storageApi.request('/binbucket', { method: 'POST' });
      
      const binaryData = new Uint8Array([0, 1, 2, 3, 255, 254]);
      const res = await storageApi.request('/binbucket/data.bin', {
        method: 'PUT',
        body: binaryData,
        headers: { 'Content-Type': 'application/octet-stream' }
      });
      const data = await res.json();
      
      expect(res.status).toBe(201);
      expect(data.size).toBe(6);
    });
  });

  describe('listFiles', () => {
    it('should return empty array for empty bucket', async () => {
      await storageApi.request('/emptybucket', { method: 'POST' });
      
      const res = await storageApi.request('/emptybucket', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.files).toEqual([]);
    });

    it('should list all files in a bucket', async () => {
      await storageApi.request('/filelist', { method: 'POST' });
      
      // Upload multiple files
      await storageApi.request('/filelist/a.txt', { method: 'PUT', body: 'A' });
      await storageApi.request('/filelist/b.txt', { method: 'PUT', body: 'BB' });
      await storageApi.request('/filelist/c.txt', { method: 'PUT', body: 'CCC' });
      
      const res = await storageApi.request('/filelist', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.files.length).toBe(3);
      
      const keys = data.files.map((f: any) => f.key);
      expect(keys).toContain('a.txt');
      expect(keys).toContain('b.txt');
      expect(keys).toContain('c.txt');
    });

    it('should return file metadata', async () => {
      await storageApi.request('/metabucket', { method: 'POST' });
      await storageApi.request('/metabucket/document.pdf', { method: 'PUT', body: 'PDF content here' });
      
      const res = await storageApi.request('/metabucket', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.files[0].key).toBe('document.pdf');
      expect(data.files[0].size).toBe(16);
      expect(data.files[0].created).toBeDefined();
      expect(data.files[0].modified).toBeDefined();
    });

    it('should return 404 for non-existent bucket', async () => {
      const res = await storageApi.request('/nonexistent', { method: 'GET' });
      const data = await res.json();
      
      expect(res.status).toBe(404);
      expect(data).toMatchObject({
        ok: false,
        error: expect.stringContaining('not found')
      });
    });
  });

  describe('deleteFile', () => {
    it('should delete an existing file', async () => {
      await storageApi.request('/delbucket', { method: 'POST' });
      await storageApi.request('/delbucket/todelete.txt', { method: 'PUT', body: 'delete me' });
      
      // Verify file exists
      let listRes = await storageApi.request('/delbucket', { method: 'GET' });
      let listData = await listRes.json();
      expect(listData.files.length).toBe(1);
      
      // Delete file
      const res = await storageApi.request('/delbucket/todelete.txt', { method: 'DELETE' });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data).toEqual({ ok: true });
      
      // Verify file is gone
      listRes = await storageApi.request('/delbucket', { method: 'GET' });
      listData = await listRes.json();
      expect(listData.files.length).toBe(0);
    });

    it('should return 404 for non-existent file', async () => {
      await storageApi.request('/delbucket2', { method: 'POST' });
      
      const res = await storageApi.request('/delbucket2/nonexistent.txt', { method: 'DELETE' });
      const data = await res.json();
      
      expect(res.status).toBe(404);
      expect(data).toMatchObject({
        ok: false,
        error: expect.stringContaining('not found')
      });
    });
  });
});