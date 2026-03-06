# Cache Service Design for hyper-micro

**Goal**: Extend hyper-micro to implement the CacheAdapter interface, enabling it to serve as a cache adapter for scout-live's Ports & Adapters architecture.

**Status**: Draft  
**Created**: 2026-03-06  
**Author**: OpenClaw

---

## Overview

### Current State

**hyper-micro** is a lightweight key-value store backed by LMDB:
- **Data API**: CRUD operations on documents (`/api/dbs/:db/docs`)
- **Storage API**: S3-compatible file storage
- **Auth API**: API key management
- **Admin UI**: Web interface for management

**scout-live Cache Port** requires:
- `get(key)` → `{ value, found }`
- `set(key, value, ttl?)` → `void`
- `delete(key)` → `boolean`
- `has(key)` → `boolean`
- `keys(pattern, options)` → `{ keys, cursor?, total }`
- `incr(key, by)` → `number`
- `ttl(key)` → `number`
- `testConnection()` → `{ ok, latencyMs }`

### Gap Analysis

| Feature | hyper-micro | Required for Cache Port | Gap |
|---------|-------------|------------------------|-----|
| Basic KV operations | ✅ | ✅ | — |
| TTL support | ❌ | ✅ | Need TTL indexing |
| Atomic incr/decr | ❌ | ✅ | Need numeric type check + atomic update |
| Pattern matching (glob) | ❌ | ✅ | Need glob → regex conversion |
| Cursor pagination | ❌ | ✅ | Need cursor encoding |
| has() check | Partial | ✅ | Need HEAD-style check |
| Batch operations | ❌ | ✅ | Need atomic batch |
| Connection test | ❌ | ✅ | Simple ping endpoint |

---

## Architecture

### Endpoint Design

New endpoints under `/api/cache`:

```
GET    /api/cache/:key           # Get value
PUT    /api/cache/:key           # Set value (with optional TTL)
DELETE /api/cache/:key           # Delete key
HEAD   /api/cache/:key           # Check existence
POST   /api/cache/keys           # List keys matching pattern
POST   /api/cache/incr/:key      # Increment numeric value
POST   /api/cache/batch          # Batch operations
GET    /api/cache/:key/ttl       # Get remaining TTL
GET    /api/cache/health         # Test connection + latency
```

### Key Namespacing

For multi-tenant support, keys can be namespaced:
- Format: `{namespace}:{key}` (e.g., `app:123:session:abc`)
- Namespaces are optional for backwards compatibility

### TTL Implementation

LMDB doesn't have native TTL. We'll implement it with:

1. **TTL Index**: A separate LMDB database (`__ttl`) storing:
   ```
   key → { expiresAt: timestamp, namespace: string }
   ```

2. **Expiration Check**: On every read operation:
   - Check TTL index for the key
   - If expired, delete key + TTL entry, return "not found"

3. **Background Cleanup**: Optional worker that scans expired keys periodically

4. **TTL Response Format**:
   - Positive number: seconds remaining
   - `-1`: no TTL set (permanent)
   - `-2`: key does not exist

---

## Implementation Plan

### Phase 1: Core Cache API (Day 1)

#### Task 1.1: Cache Router Structure

Create `src/routes/cache.ts`:

```typescript
import { Hono } from 'hono';

export const cacheApi = new Hono();

// GET /api/cache/:key - Get value
cacheApi.get('/cache/:key', async (c) => { ... });

// PUT /api/cache/:key - Set value with optional TTL
cacheApi.put('/cache/:key', async (c) => { ... });

// DELETE /api/cache/:key - Delete key
cacheApi.delete('/cache/:key', async (c) => { ... });

// HEAD /api/cache/:key - Check existence
cacheApi.head('/cache/:key', async (c) => { ... });
```

#### Task 1.2: TTL Storage Module

Create `src/lib/ttl.ts`:

```typescript
import { Database } from 'lmdb';

interface TtlEntry {
  expiresAt: number;  // Unix timestamp in ms
  namespace?: string;
}

export class TtlManager {
  private db: Database;
  
  constructor(rootDb: RootDatabase) {
    this.db = rootDb.openDB({ name: '__ttl' });
  }
  
  async setTtl(key: string, ttlSeconds: number, namespace?: string): Promise<void>;
  async getTtl(key: string): Promise<number>;  // -1, -2, or positive
  async removeTtl(key: string): Promise<void>;
  async isExpired(key: string): Promise<boolean>;
  async cleanupExpired(limit?: number): Promise<number>;  // Returns count cleaned
}
```

#### Task 1.3: Cache Service Layer

Create `src/services/cache.ts`:

```typescript
export interface CacheValue {
  value: unknown;
  ttl?: number;
  namespace?: string;
}

export class CacheService {
  private db: Database;
  private ttl: TtlManager;
  
  async get(key: string): Promise<{ value: unknown; found: boolean }>;
  async set(key: string, value: unknown, ttl?: number): Promise<void>;
  async delete(key: string): Promise<boolean>;
  async has(key: string): Promise<boolean>;
}
```

**Success Criteria**:
- [x] GET returns `{ value, found }`
- [x] PUT stores value with optional TTL
- [x] DELETE returns true/false based on existence
- [x] HEAD returns 200/404 with X-TTL header
- [x] TTL entries stored in `__ttl` database

---

### Phase 2: Advanced Operations (Day 2)

#### Task 2.1: Pattern Matching

Implement glob pattern matching for `keys()`:

```typescript
// Convert glob to regex
function globToRegex(pattern: string): RegExp {
  return new RegExp(
    '^' + pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\[!/g, '[^')
      .replace(/\[/g, '[')
      .replace(/\]/g, ']')
    + '$'
  );
}

// List keys matching pattern
async function keys(
  pattern: string,
  options?: { limit?: number; cursor?: string }
): Promise<{ keys: string[]; cursor?: string; total: number }>;
```

**Cursor Encoding**:
- Base64 encode the last seen key
- Decode on next request to resume scan

#### Task 2.2: Increment/Decrement

Atomic numeric operations:

```typescript
async function incr(key: string, by: number = 1): Promise<number> {
  // Use LMDB transaction for atomicity
  return this.db.transaction(() => {
    const current = this.db.get(key);
    const value = typeof current === 'number' ? current : 0;
    const newValue = value + by;
    this.db.put(key, newValue);
    return newValue;
  });
}
```

**Error Cases**:
- If value is not a number, return error `CACHE_NOT_A_NUMBER`

#### Task 2.3: Batch Operations

```typescript
interface BatchOperation {
  op: 'get' | 'set' | 'delete' | 'has';
  key: string;
  value?: unknown;  // for set
  ttl?: number;     // for set
}

async function batch(operations: BatchOperation[]): Promise<BatchResult[]>;
```

**Success Criteria**:
- [x] `keys('*')` returns all keys
- [x] `keys('user:*')` returns keys starting with 'user:'
- [x] `incr('counter', 1)` increments atomically
- [x] `incr('counter', -1)` decrements atomically
- [x] Batch operations execute in order
- [x] Cursor pagination works for large keysets

---

### Phase 3: Integration & Testing (Day 3)

#### Task 3.1: Health Check Endpoint

```typescript
cacheApi.get('/cache/health', async (c) => {
  const start = Date.now();
  
  try {
    // Simple ping operation
    await cacheService.ping();
    
    return c.json({
      ok: true,
      latencyMs: Date.now() - start
    });
  } catch (error) {
    return c.json({
      ok: false,
      latencyMs: Date.now() - start,
      error: error.message
    }, 503);
  }
});
```

#### Task 3.2: Test Suite

Create `src/cache.test.ts`:

```typescript
describe('Cache Service', () => {
  test('get/set/delete operations', async () => { ... });
  test('TTL expiration', async () => { ... });
  test('Pattern matching', async () => { ... });
  test('Increment/decrement', async () => { ... });
  test('Batch operations', async () => { ... });
  test('Health check returns latency', async () => { ... });
});
```

#### Task 3.3: Scout-Live Adapter

Create `src/adapters/hyper-micro-adapter.ts` in scout-live:

```typescript
import { CacheAdapter } from '../ports/cache/spec';

export class HyperMicroCacheAdapter implements CacheAdapter {
  private baseUrl: string;
  private apiKey: string;
  
  constructor(config: { url: string; apiKey: string }) {
    this.baseUrl = config.url;
    this.apiKey = config.apiKey;
  }
  
  async get(key: string): Promise<{ value: unknown; found: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/cache/${key}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
    // ...
  }
  
  // ... implement all CacheAdapter methods
}
```

**Success Criteria**:
- [x] All 390 scout-live tests pass with hyper-micro adapter
- [x] TTL expires keys correctly
- [x] Health check returns latency under 10ms locally

---

## Database Schema

### New LMDB Databases

| Database | Purpose | Key Format | Value |
|----------|---------|-----------|-------|
| `__cache` | Cache data | `{namespace}:{key}` | JSON value |
| `__ttl` | TTL index | `{namespace}:{key}` | `{ expiresAt, namespace }` |

### Migration

No migration needed — new databases are created on first use.

---

## API Compatibility

### scout-live Cache Port Spec

All endpoints match the scout-live Cache Port specification:

| Endpoint | Method | Match |
|----------|--------|-------|
| `/api/cache/:key` | GET | ✅ |
| `/api/cache/:key` | PUT | ✅ |
| `/api/cache/:key` | DELETE | ✅ |
| `/api/cache/:key` | HEAD | ✅ |
| `/api/cache/keys` | POST | ✅ |
| `/api/cache/incr/:key` | POST | ✅ |
| `/api/cache/batch` | POST | ✅ |
| `/api/cache/:key/ttl` | GET | ✅ |

### Request/Response Format

```typescript
// GET /api/cache/:key
{ "value": any, "found": boolean }

// PUT /api/cache/:key
// Request: { "value": any, "ttl"?: number }
// Response: { "ok": true, "key": string, "ttl"?: number }

// POST /api/cache/keys
// Request: { "pattern": string, "limit"?: number, "cursor"?: string }
// Response: { "keys": string[], "cursor"?: string, "total": number }

// POST /api/cache/incr/:key
// Request: { "by"?: number }
// Response: { "value": number }

// POST /api/cache/batch
// Request: { "operations": BatchOperation[] }
// Response: { "results": BatchResult[] }
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_ENABLED` | `true` | Enable cache API |
| `CACHE_DEFAULT_TTL` | `0` | Default TTL in seconds (0 = no TTL) |
| `CACHE_MAX_KEY_LENGTH` | `512` | Maximum key length |
| `CACHE_MAX_VALUE_SIZE` | `1048576` | Maximum value size (1MB) |
| `CACHE_CLEANUP_INTERVAL` | `60000` | TTL cleanup interval (ms) |

---

## Open Questions

1. **Namespace enforcement**: Should we enforce namespace prefixes for multi-tenant usage?
   - Option A: Optional, caller-managed
   - Option B: Required, enforced via API key → namespace mapping

2. **Cleanup strategy**: How aggressive should TTL cleanup be?
   - Option A: Lazy cleanup on read only (simpler, no background worker)
   - Option B: Background worker every minute (more consistent expiration)
   - Recommendation: Start with Option A, add Option B later

3. **Batch atomicity**: Should batch operations be atomic?
   - Option A: Individual operations, failure stops execution
   - Option B: All-or-nothing transaction
   - Recommendation: Option A for simplicity, document behavior

---

## Timeline

| Phase | Tasks | Est. Time |
|-------|-------|-----------|
| Phase 1: Core API | 3 tasks | 1 day |
| Phase 2: Advanced Ops | 3 tasks | 1 day |
| Phase 3: Integration | 3 tasks | 1 day |
| **Total** | **9 tasks** | **3 days** |

---

## References

- [scout-live Cache Port Spec](../scout-live/src/ports/cache/spec.ts)
- [hyper-micro Data API](../src/api/data.ts)
- [LMDB Node.js Docs](https://github.com/kriszyp/lmdb-js)
- [Glob Pattern Matching](https://en.wikipedia.org/wiki/Glob_(programming))