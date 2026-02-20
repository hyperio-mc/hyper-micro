# hyper-micro

A minimal Node.js + LMDB data and storage API server.

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Server runs at http://localhost:3000
```

## API Endpoints

### Health
- `GET /health` - Server health check

### Data API (LMDB)
- `POST /api/dbs/:name` - Create database
- `DELETE /api/dbs/:name` - Delete database
- `GET /api/dbs` - List databases
- `POST /api/dbs/:db/docs` - Create document `{key, value}`
- `GET /api/dbs/:db/docs/:id` - Get document
- `PUT /api/dbs/:db/docs/:id` - Update document `{value}`
- `DELETE /api/dbs/:db/docs/:id` - Delete document
- `GET /api/dbs/:db/docs` - List documents

### Storage API
- `POST /api/storage/:bucket` - Create bucket
- `DELETE /api/storage/:bucket` - Delete bucket
- `GET /api/storage` - List buckets
- `PUT /api/storage/:bucket/:key` - Upload file
- `GET /api/storage/:bucket/:key` - Download file
- `DELETE /api/storage/:bucket/:key` - Delete file
- `GET /api/storage/:bucket` - List files

### Auth
- `POST /api/auth` - Generate API key
- `GET /api/auth` - List API keys
- `DELETE /api/auth/:id` - Revoke key

## Authentication

All API endpoints (except `/health` and `/api/auth`) require an API key:

```
Authorization: Bearer <your-api-key>
```

Default key: `dev-key-change-in-production`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |
| LMDB_PATH | ./data/lmdb | LMDB data path |
| STORAGE_PATH | ./data/storage | File storage path |
| API_KEYS | dev-key-change-in-production | Comma-separated API keys |

## Deployment

### Railway (Recommended)

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

Set environment variables in Railway dashboard:
- `PORT` = 8080 (Railway uses port 8080)
- `LMDB_PATH` = /data/lmdb
- `STORAGE_PATH` = /data/storage
- `API_KEYS` = your-api-key

Add a volume in Railway for persistent data:
```toml
# railway.toml
[[volume]]
  name = "hyper-data"
  mountDir = "/data"
```

### Render

```bash
# Install Render CLI
npm i -g @render/cli
render login
```

Create `render.yaml`:
```yaml
services:
  - name: hyper-micro
    type: static
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: PORT
        value: 10000
      - key: LMDB_PATH
        value: /data/lmdb
      - key: STORAGE_PATH
        value: /data/storage
      - key: API_KEYS
        sync: false
```

Render requires a persistent disk for LMDB + storage. Use Render's "Persistent Disk" feature.

### Fly.io

```bash
# Install Fly CLI
brew install flyctl
fly auth login
```

Create `fly.toml`:
```toml
app = "hyper-micro"

[build]
  builder = "heroku/buildpack:20"

[env]
  PORT = "8080"
  LMDB_PATH = "/data/lmdb"
  STORAGE_PATH = "/data/storage"

[[mounts]]
  source = "hyper_data"
  destination = "/data"
```

Deploy:
```bash
fly launch
fly deploy
```

## Docker

```bash
docker-compose up --build
```
