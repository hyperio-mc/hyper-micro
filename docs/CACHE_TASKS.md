# hyper-micro Cache Service: Task Breakdown

**Project**: Cache Port Implementation for hyper-micro  
**Goal**: Make hyper-micro compatible with scout-live's CacheAdapter interface  
**Working Directory**: `/Users/mastercontrol/.openclaw/workspace/hyper-micro`  
**Test Command**: `npm test` (current tests should remain passing)

---

## Phase 1: Core Cache API

### Task 1.1: TTL Manager Module

**Priority**: Critical  
**Dependencies**: None

#### Step 1.1.1: Create TTL storage module
- Create `src/lib/ttl.ts`
- Define `TtlManager` class with LMDB backend
- Methods: `setTtl()`, `getTtl()`, `removeTtl()`, `isExpired()`, `cleanupExpired()`
- Store TTL entries in `__ttl` database
- **Output**: `src/lib/ttl.ts`

**Success Criteria**:
- [ ] `TtlManager` class exports correctly
- [ ] `setTtl()` stores entry in `__ttl` database
- [ ] `getTtl()` returns remaining seconds, -1 (no TTL), or -2 (not found)
- [ ] `isExpired()` correctly identifies expired keys
- [ ] Unit tests pass for TTL operations

#### Step 1.1.2: Add TTL tests
- Create `src/lib/ttl.test.ts`
- Test: set TTL, get TTL, expiration detection
- **Output**: `src/lib/ttl.test.ts`

**Success Criteria**:
- [ ] All TTL tests pass
- [ ] `npm test` shows new tests passing

---

### Task 1.2: Cache Service Layer

**Priority**: Critical  
**Dependencies**: Task 1.1

#### Step 1.2.1: Create CacheService class
- Create `src/services/cache.ts`
- Implement `get()`, `set()`, `delete()`, `has()` methods
- Integrate with TtlManager for expiration checks
- Use existing LMDB database infrastructure
- **Output**: `src/services/cache.ts`

**Success Criteria**:
- [ ] `get()` returns `{ value, found }` with TTL expiration check
- [ ] `set()` stores value and optionally sets TTL
- [ ] `delete()` returns true/false based on existence
- [ ] `has()` returns boolean without fetching value

#### Step 1.2.2: Add CacheService tests
- Create `src/services/cache.test.ts`
- Test: get/set/delete/has with and without TTL
- **Output**: `src/services/cache.test.ts`

**Success Criteria**:
- [ ] Basic CRUD tests pass
- [ ] TTL expiration tests pass
- [ ] Existing tests still pass

---

### Task 1.3: Cache API Router

**Priority**: Critical  
**Dependencies**: Task 1.2

#### Step 1.3.1: Create cache routes
- Create `src/routes/cache.ts`
- Endpoints: GET/PUT/DELETE/HEAD `/api/cache/:key`
- Integrate CacheService
- Register router in main app
- **Output**: `src/routes/cache.ts`

**Success Criteria**:
- [ ] `GET /api/cache/:key` returns `{ value, found }`
- [ ] `PUT /api/cache/:key` with `{ value, ttl? }` stores correctly
- [ ] `DELETE /api/cache/:key` returns `{ deleted: boolean }`
- [ ] `HEAD /api/cache/:key` returns 200 or 404 with `X-TTL` header
- [ ] All routes require Bearer token auth

#### Step 1.3.2: Add API integration tests
- Create `src/routes/cache.test.ts`
- Test all endpoints with supertest
- **Output**: `src/routes/cache.test.ts`

**Success Criteria**:
- [ ] All endpoint tests pass
- [ ] Auth rejection tests pass
- [ ] TTL header tests pass

---

## Phase 2: Advanced Operations

### Task 2.1: Pattern Matching

**Priority**: High  
**Dependencies**: Phase 1 complete

#### Step 2.1.1: Implement glob-to-regex conversion
- Add `globToRegex()` utility function
- Implement `keys(pattern, options)` in CacheService
- Support cursor-based pagination
- **Output**: Updated `src/services/cache.ts`

**Success Criteria**:
- [ ] `globToRegex('*')` matches all keys
- [ ] `globToRegex('user:*')` matches keys starting with 'user:'
- [ ] `globToRegex('session:?:abc')` matches single char wildcard
- [ ] Cursor pagination works correctly

#### Step 2.1.2: Add keys endpoint
- `POST /api/cache/keys` endpoint
- Request: `{ pattern, limit?, cursor? }`
- Response: `{ keys, cursor?, total }`
- **Output**: Updated `src/routes/cache.ts`

**Success Criteria**:
- [ ] Pattern matching works
- [ ] Limit parameter respected
- [ ] Cursor returns next page

---

### Task 2.2: Increment/Decrement

**Priority**: High  
**Dependencies**: Phase 1 complete

#### Step 2.2.1: Implement atomic increment
- Add `incr(key, by)` method to CacheService
- Use LMDB transaction for atomicity
- Handle non-numeric values (throw error)
- Initialize to 0 if key doesn't exist
- **Output**: Updated `src/services/cache.ts`

**Success Criteria**:
- [ ] `incr('counter', 1)` returns new value
- [ ] `incr('counter', -1)` decrements
- [ ] Non-numeric value throws `CACHE_NOT_A_NUMBER` error
- [ ] Missing key initializes to 0 before increment

#### Step 2.2.2: Add incr endpoint
- `POST /api/cache/incr/:key` endpoint
- Request: `{ by? }` (default: 1)
- Response: `{ value }`
- **Output**: Updated `src/routes/cache.ts`

**Success Criteria**:
- [ ] Endpoint works correctly
- [ ] Default increment is 1
- [ ] Error returned for non-numeric values

---

### Task 2.3: Batch Operations

**Priority**: Medium  
**Dependencies**: Task 2.1, Task 2.2

#### Step 2.3.1: Implement batch method
- Add `batch(operations)` method to CacheService
- Support: get, set, delete, has operations
- Execute operations in order
- Return results array in same order
- **Output**: Updated `src/services/cache.ts`

**Success Criteria**:
- [ ] Batch get operations return values
- [ ] Batch set operations store values
- [ ] Batch delete operations return deletion status
- [ ] Batch has operations return existence
- [ ] Max 100 operations per batch (enforced)

#### Step 2.3.2: Add batch endpoint
- `POST /api/cache/batch` endpoint
- Request: `{ operations: BatchOperation[] }`
- Response: `{ results: BatchResult[] }`
- **Output**: Updated `src/routes/cache.ts`

**Success Criteria**:
- [ ] Endpoint accepts batch operations
- [ ] Results match input order
- [ ] Size limit enforced

---

## Phase 3: Integration

### Task 3.1: TTL Endpoint

**Priority**: Medium  
**Dependencies**: Phase 1 complete

#### Step 3.1.1: Add TTL endpoint
- `GET /api/cache/:key/ttl` endpoint
- Response: `{ ttl }` (seconds, -1 for none, -2 for not found)
- **Output**: Updated `src/routes/cache.ts`

**Success Criteria**:
- [ ] Returns remaining TTL for keys with TTL
- [ ] Returns -1 for keys without TTL
- [ ] Returns -2 for non-existent keys

---

### Task 3.2: Health Check

**Priority**: Low  
**Dependencies**: Phase 1 complete

#### Step 3.2.1: Add health endpoint
- `GET /api/cache/health` endpoint
- Response: `{ ok: true, latencyMs }` or error
- Simple ping operation to verify cache works
- **Output**: Updated `src/routes/cache.ts`

**Success Criteria**:
- [ ] Returns `{ ok: true, latencyMs }` when healthy
- [ ] Returns 503 when unhealthy
- [ ] Latency measurement is accurate

---

### Task 3.3: Scout-Live Adapter

**Priority**: High  
**Dependencies**: All previous tasks

#### Step 3.3.1: Create adapter in scout-live
- Create `src/adapters/hyper-micro-adapter.ts` in scout-live
- Implement `CacheAdapter` interface
- Configure base URL and API key
- **Output**: `scout-live/src/adapters/hyper-micro-adapter.ts`

**Success Criteria**:
- [ ] All CacheAdapter methods implemented
- [ ] HTTP client configured for hyper-micro API
- [ ] Error handling matches Cache Port spec

#### Step 3.3.2: Add integration tests
- Create test that uses hyper-micro adapter
- Test full lifecycle: set → get → incr → delete
- **Output**: Test file in scout-live

**Success Criteria**:
- [ ] Integration tests pass
- [ ] All 390 scout-live tests still pass

---

## Task Execution Protocol

When executing tasks via Hive:

1. **Post task to scout-live-ports room** (or dedicated hyper-micro room)
2. **Mention the agent** (e.g., `@opus`) with the task reference
3. **Include step number** from this document
4. **Validate success criteria** before marking complete
5. **Run tests** after each task

Example mention:
```
@opus TASK-1.1: Implement Step 1.1.1 from hyper-micro Cache Tasks

Create src/lib/ttl.ts with TtlManager class.

Success criteria:
- setTtl() stores entry in __ttl database
- getTtl() returns remaining seconds, -1, or -2
- isExpired() correctly identifies expired keys

Post completion to this room when done. Run: npm test
```

---

## Progress Tracking

| Task | Status | Agent | Commit |
|------|--------|-------|--------|
| 1.1.1 TTL Module | ✅ Complete | main | b74e2f8 |
| 1.1.2 TTL Tests | ✅ Complete | main | 25d8cc0 |
| 1.2.1 CacheService | ⬜ Not started | — | — |
| 1.2.2 CacheService Tests | ⬜ Not started | — | — |
| 1.3.1 Cache Routes | ⬜ Not started | — | — |
| 1.3.2 API Tests | ⬜ Not started | — | — |
| 2.1.1 Pattern Matching | ⬜ Not started | — | — |
| 2.1.2 Keys Endpoint | ⬜ Not started | — | — |
| 2.2.1 Atomic Incr | ⬜ Not started | — | — |
| 2.2.2 Incr Endpoint | ⬜ Not started | — | — |
| 2.3.1 Batch Method | ⬜ Not started | — | — |
| 2.3.2 Batch Endpoint | ⬜ Not started | — | — |
| 3.1.1 TTL Endpoint | ⬜ Not started | — | — |
| 3.2.1 Health Endpoint | ⬜ Not started | — | — |
| 3.3.1 Scout-Live Adapter | ⬜ Not started | — | — |
| 3.3.2 Integration Tests | ⬜ Not started | — | — |

---

## Phase 4: Dashboard UI

### Task 4.1: Cache Admin Endpoints

**Priority**: Medium  
**Dependencies**: Phase 1, 2, 3 complete

#### Step 4.1.1: Add cache admin stats endpoint
- `GET /api/admin/cache/stats` - Returns cache statistics
- Response: `{ ok: true, totalKeys, withTtl, expired, namespaces }`
- **Output**: Updated `src/routes/admin.ts`

**Success Criteria**:
- [ ] Returns total key count
- [ ] Returns count of keys with TTL
- [ ] Returns count of expired keys (not yet cleaned)
- [ ] Returns breakdown by namespace

#### Step 4.1.2: Add cache admin list endpoint
- `GET /api/admin/cache/keys?pattern=*&limit=100&namespace=` - List cache keys
- Response: `{ ok: true, keys: Array<{ key, ttl, namespace, expiresAt }>, cursor?, total }`
- **Output**: Updated `src/routes/admin.ts`

**Success Criteria**:
- [ ] Pattern filtering works
- [ ] Namespace filtering works
- [ ] Pagination with cursor works

#### Step 4.1.3: Add cache admin delete endpoints
- `DELETE /api/admin/cache/:key` - Delete single key
- `DELETE /api/admin/cache?namespace=` - Flush namespace
- `POST /api/admin/cache/cleanup` - Trigger TTL cleanup
- **Output**: Updated `src/routes/admin.ts`

**Success Criteria**:
- [ ] Single key deletion works
- [ ] Namespace flush works
- [ ] Cleanup removes expired keys

---

### Task 4.2: Dashboard UI

**Priority**: Medium  
**Dependencies**: Task 4.1

#### Step 4.2.1: Add Cache navigation item
- Add "Cache" tab to sidebar in `dashboard.html`
- Icon: database/cache icon
- **Output**: Updated `src/templates/dashboard.html`

**Success Criteria**:
- [ ] Cache tab appears in sidebar
- [ ] Active state works
- [ ] Navigation switches to cache view

#### Step 4.2.2: Create Cache stats panel
- Show total keys, with TTL, expired, namespaces
- Add refresh button
- **Output**: Updated `src/templates/dashboard.html`

**Success Criteria**:
- [ ] Stats panel displays correctly
- [ ] Data loads from `/api/admin/cache/stats`
- [ ] Refresh button reloads stats

#### Step 4.2.3: Create Cache keys browser
- Pattern filter input
- Keys table with Key, TTL, Actions columns
- Pagination (cursor-based)
- Delete button per key
- **Output**: Updated `src/templates/dashboard.html`

**Success Criteria**:
- [ ] Keys table displays
- [ ] Pattern filter works
- [ ] Delete key works with confirmation
- [ ] Pagination works

#### Step 4.2.4: Add admin actions
- "Cleanup Expired" button - calls `POST /api/admin/cache/cleanup`
- "Flush Namespace" dropdown - calls `DELETE /api/admin/cache?namespace=`
- Confirmation dialogs for destructive actions
- **Output**: Updated `src/templates/dashboard.html`

**Success Criteria**:
- [ ] Cleanup button works
- [ ] Flush namespace works with confirmation
- [ ] Success/error toasts display

---

### Task 4.3: Dashboard Tests

**Priority**: Low  
**Dependencies**: Task 4.1, Task 4.2

#### Step 4.3.1: Add admin cache endpoint tests
- Test all admin cache endpoints
- Test auth requirements
- **Output**: `src/routes/admin-cache.test.ts`

**Success Criteria**:
- [ ] All endpoint tests pass
- [ ] Auth rejection tests pass

---

## Progress Tracking (Updated)

| Task | Status | Agent | Commit |
|------|--------|-------|--------|
| 1.1.1 TTL Module | ✅ Complete | main | b74e2f8 |
| 1.1.2 TTL Tests | ⬜ Not started | — | — |
| 1.2.1 CacheService | ⬜ Not started | — | — |
| 1.2.2 CacheService Tests | ⬜ Not started | — | — |
| 1.3.1 Cache Routes | ⬜ Not started | — | — |
| 1.3.2 API Tests | ⬜ Not started | — | — |
| 2.1.1 Pattern Matching | ⬜ Not started | — | — |
| 2.1.2 Keys Endpoint | ⬜ Not started | — | — |
| 2.2.1 Atomic Incr | ⬜ Not started | — | — |
| 2.2.2 Incr Endpoint | ⬜ Not started | — | — |
| 2.3.1 Batch Method | ⬜ Not started | — | — |
| 2.3.2 Batch Endpoint | ⬜ Not started | — | — |
| 3.1.1 TTL Endpoint | ⬜ Not started | — | — |
| 3.2.1 Health Endpoint | ⬜ Not started | — | — |
| 3.3.1 Scout-Live Adapter | ⬜ Not started | — | — |
| 3.3.2 Integration Tests | ⬜ Not started | — | — |
| 4.1.1 Admin Stats Endpoint | ⬜ Not started | — | — |
| 4.1.2 Admin List Endpoint | ⬜ Not started | — | — |
| 4.1.3 Admin Delete Endpoints | ⬜ Not started | — | — |
| 4.2.1 Cache Nav Item | ⬜ Not started | — | — |
| 4.2.2 Stats Panel | ⬜ Not started | — | — |
| 4.2.3 Keys Browser | ⬜ Not started | — | — |
| 4.2.4 Admin Actions | ⬜ Not started | — | — |
| 4.3.1 Dashboard Tests | ⬜ Not started | — | — |

---

## Estimation (Updated)

| Phase | Tasks | Est. Time |
|-------|-------|-----------|
| Phase 1: Core API | 6 | 1 day |
| Phase 2: Advanced Ops | 6 | 1 day |
| Phase 3: Integration | 4 | 1 day |
| Phase 4: Dashboard UI | 7 | 1 day |
| **Total** | **23** | **4 days** |