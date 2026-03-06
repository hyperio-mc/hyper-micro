# hyper-micro

A lightweight microservices backend with LMDB key-value storage and file storage APIs.

## Overview

hyper-micro provides a simple, fast, and persistent data layer for applications:
- **Data API**: Document store backed by LMDB for high-performance key-value operations
- **Storage API**: File storage with bucket-based organization
- **Auth API**: API key management for secure access
- **Admin UI**: Web dashboard at `/admin` for managing databases, buckets, and keys

## Base URL

```
Development: http://localhost:3000
Production: https://your-deployment.example.com
```

## Authentication

All API endpoints (except `/health` and `/api/auth`) require Bearer token authentication:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://api.example.com/api/dbs
```

### Generating API Keys

```bash
# Create a new API key
curl -X POST https://api.example.com/api/auth \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app"}'

# Response:
# { "ok": true, "key": "hm_xxx...", "id": "uuid", "name": "my-app" }
```

**Important**: The API key is returned only once. Store it securely!

---

## API Reference

### Health Check

```bash
GET /health
```

Returns server status, uptime, and admin auth configuration.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-23T00:00:00.000Z",
  "uptime": 12345.67,
  "version": "1.0.0",
  "adminAuth": "configured"
}
```

---

### Data API (LMDB Document Store)

All data API endpoints require authentication.

#### Create Database

```bash
POST /api/dbs/:name
Authorization: Bearer YOUR_API_KEY
```

**Parameters:**
- `:name` - Database name (1-64 chars, alphanumeric/underscore/hyphen only)

**Response:** `201 Created`
```json
{ "ok": true, "db": "mydb" }
```

#### Delete Database

```bash
DELETE /api/dbs/:name
Authorization: Bearer YOUR_API_KEY
```

**Response:** `200 OK`
```json
{ "ok": true }
```

#### List Databases

```bash
GET /api/dbs
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{ "ok": true, "databases": ["users", "products", "sessions"] }
```

#### Create Document

```bash
POST /api/dbs/:db/docs
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "key": "user:123",
  "value": { "name": "Alice", "email": "alice@example.com" }
}
```

**Parameters:**
- `:db` - Database name
- `key` - Document key (1-1024 chars, no null bytes)
- `value` - Any JSON value (object, array, string, number, boolean, null)

**Response:** `201 Created`
```json
{ "ok": true, "key": "user:123" }
```

#### Get Document

```bash
GET /api/dbs/:db/docs/:id
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "ok": true,
  "key": "user:123",
  "value": { "name": "Alice", "email": "alice@example.com" }
}
```

#### Update Document

```bash
PUT /api/dbs/:db/docs/:id
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{ "value": { "name": "Alice Updated", "email": "alice@example.com" } }
```

**Response:** `200 OK`
```json
{ "ok": true }
```

#### Delete Document

```bash
DELETE /api/dbs/:db/docs/:id
Authorization: Bearer YOUR_API_KEY
```

**Response:** `200 OK`
```json
{ "ok": true }
```

#### List Documents

```bash
GET /api/dbs/:db/docs
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `prefix` - Filter by key prefix
- `startKey` - Start key for range query (inclusive)
- `endKey` - End key for range query (exclusive)
- `limit` - Max documents to return (default: 1000, max: 10000)

**Response:**
```json
{
  "ok": true,
  "docs": [
    { "key": "user:1", "value": { "name": "Alice" } },
    { "key": "user:2", "value": { "name": "Bob" } }
  ]
}
```

---

### Storage API (File Storage)

All storage API endpoints require authentication.

#### Create Bucket

```bash
POST /api/storage/:bucket
Authorization: Bearer YOUR_API_KEY
```

**Parameters:**
- `:bucket` - Bucket name (1-64 chars, alphanumeric/underscore/hyphen only)

**Response:** `201 Created`
```json
{ "ok": true, "bucket": "images" }
```

#### Delete Bucket

```bash
DELETE /api/storage/:bucket
Authorization: Bearer YOUR_API_KEY
```

**Response:** `200 OK`
```json
{ "ok": true }
```

#### List Buckets

```bash
GET /api/storage
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{ "ok": true, "buckets": ["images", "documents", "uploads"] }
```

#### Upload File

```bash
PUT /api/storage/:bucket/:key
Authorization: Bearer YOUR_API_KEY
Content-Type: application/octet-stream

<binary data>
```

**Parameters:**
- `:bucket` - Bucket name
- `:key` - File key/path (1-512 chars, no path traversal)

**Query Parameters:**
- `encoding=base64` - Use base64 decoding for the body

**Response:** `201 Created`
```json
{ "ok": true, "key": "avatar.png", "size": 12345 }
```

#### Download File

```bash
GET /api/storage/:bucket/:key
Authorization: Bearer YOUR_API_KEY
```

**Response:** Binary file content with headers:
- `Content-Type: application/octet-stream` (or custom via `?contentType=`)
- `Content-Length: <size>`
- `Content-Disposition: inline; filename="<key>"`

#### Delete File

```bash
DELETE /api/storage/:bucket/:key
Authorization: Bearer YOUR_API_KEY
```

**Response:** `200 OK`
```json
{ "ok": true }
```

#### List Files in Bucket

```bash
GET /api/storage/:bucket
Authorization: Bearer YOUR_API_KEY
```

**Query Parameters:**
- `prefix` - Filter by key prefix
- `limit` - Max files to return (default: 1000)

**Response:**
```json
{
  "ok": true,
  "files": [
    {
      "key": "avatar.png",
      "size": 12345,
      "created": "2026-02-23T00:00:00.000Z",
      "modified": "2026-02-23T00:05:00.000Z"
    }
  ]
}
```

---

### Auth API (API Key Management)

Auth endpoints are publicly accessible (for initial key generation).

#### Generate API Key

```bash
POST /api/auth
Content-Type: application/json

{ "name": "my-app" }  // optional friendly name
```

**Response:** `201 Created`
```json
{
  "ok": true,
  "key": "hm_abc123...",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "my-app"
}
```

#### List API Keys

```bash
GET /api/auth
```

**Response:**
```json
{
  "ok": true,
  "keys": [
    { "id": "uuid", "name": "my-app", "created": "2026-02-23T00:00:00.000Z" }
  ]
}
```

Note: Actual key values are not returned for security.

#### Revoke API Key

```bash
DELETE /api/auth/:id
```

**Parameters:**
- `:id` - API key UUID

**Response:** `200 OK`
```json
{ "ok": true }
```

#### Validate API Key

```bash
POST /api/auth/validate
Content-Type: application/json

{ "key": "hm_abc123..." }
```

**Response:**
```json
{ "ok": true, "valid": true }
```

---

### Admin API (Protected)

Admin routes require JWT authentication (set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET` env vars).

#### Admin Login

```bash
POST /api/login
Content-Type: application/json

{ "email": "admin@example.com", "password": "your-password" }
```

**Response:**
```json
{ "ok": true, "token": "eyJhbGciOiJ..." }
```

#### Get Current Admin

```bash
GET /api/me
Authorization: Bearer JWT_TOKEN
```

**Response:**
```json
{ "ok": true, "user": { "email": "admin@example.com" } }
```

#### Admin Logout

```bash
POST /api/logout
Authorization: Bearer JWT_TOKEN
```

#### Admin Stats

```bash
GET /api/admin/stats
Authorization: Bearer JWT_TOKEN
```

**Response:**
```json
{
  "databases": 5,
  "totalRecords": 1234,
  "storageUsage": "15.5 MB",
  "totalFiles": 42,
  "buckets": 3,
  "apiKeys": 2
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `NODE_ENV` | development | Environment mode |
| `LMDB_PATH` | ./data/lmdb | LMDB data directory |
| `STORAGE_PATH` | ./data/storage | File storage directory |
| `API_KEYS` | dev-key-change-in-production | Comma-separated API keys |
| `ADMIN_EMAIL` | - | Admin login email |
| `ADMIN_PASSWORD` | - | Admin password (bcrypt hash) |
| `JWT_SECRET` | - | JWT signing secret |

## Deployment

Quick deploy buttons available for:
- Railway (recommended)
- Render
- Fly.io
- DigitalOcean
- AWS Amplify

See [README.md](README.md) for detailed deployment guides.

## Error Responses

All errors follow this format:

```json
{
  "ok": false,
  "error": "Error message describing what went wrong"
}
```

Common HTTP status codes:
- `400` - Bad Request (validation error, missing parameters)
- `401` - Unauthorized (missing or invalid API key)
- `404` - Not Found (database, document, bucket, or file not found)
- `409` - Conflict (resource already exists)
- `500` - Internal Server Error

## Rate Limiting

Not currently implemented. Consider adding a reverse proxy with rate limiting for production use.

## Limits

- Database name: 1-64 characters
- Document key: 1-1024 characters
- File key: 1-512 characters
- List limit: max 10,000 items
- API key name: 1-100 characters

## Quick Start Examples

```bash
# Generate an API key
curl -X POST http://localhost:3000/api/auth

# Create a database
curl -X POST http://localhost:3000/api/dbs/users \
  -H "Authorization: Bearer YOUR_API_KEY"

# Store a user document
curl -X POST http://localhost:3000/api/dbs/users/docs \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key": "user:1", "value": {"name": "Alice", "email": "alice@example.com"}}'

# Retrieve the document
curl http://localhost:3000/api/dbs/users/docs/user:1 \
  -H "Authorization: Bearer YOUR_API_KEY"

# Create a storage bucket
curl -X POST http://localhost:3000/api/storage/images \
  -H "Authorization: Bearer YOUR_API_KEY"

# Upload a file
curl -X PUT http://localhost:3000/api/storage/images/avatar.png \
  -H "Authorization: Bearer YOUR_API_KEY" \
  --data-binary @avatar.png

# Download a file
curl http://localhost:3000/api/storage/images/avatar.png \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -o downloaded-avatar.png
```