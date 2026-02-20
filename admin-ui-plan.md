# hyper-micro Admin UI Project Plan

## Overview
Add a web UI to hyper-micro for self-hosted data management:
- Landing page (public)
- Admin dashboard (protected)
- Database browser
- File storage browser
- Usage stats

---

## Phase 1: Authentication (task-076)

### Goals
- Env-based admin login (email + password)
- JWT session management
- Protected admin routes

### Tasks
- [ ] task-076a: Add auth middleware (env-based)
- [ ] task-076b: Create `/api/login` endpoint
- [ ] task-076c: Create `/api/logout` endpoint
- [ ] task-076d: Add JWT validation middleware for admin routes

### Implementation
```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=bcrypt-hash
JWT_SECRET=your-secret
```

---

## Phase 2: Admin UI - Landing & Login (task-077)

### Goals
- Public landing page showing hyper-micro info
- Login form for admin

### Tasks
- [ ] task-077a: Create landing page HTML template
- [ ] task-077b: Add login form with email/password
- [ ] task-077c: Create login API handler
- [ ] task-077d: Add JWT cookie/session handling

### Pages
- `GET /` - Landing page (public)
- `GET /login` - Login form
- `POST /api/auth/login` - Login handler

---

## Phase 3: Admin Dashboard Layout (task-078)

### Goals
- Main dashboard with tabs
- Sidebar navigation
- Responsive design

### Tasks
- [ ] task-078a: Create dashboard HTML template
- [ ] task-078b: Add sidebar with nav items
- [ ] task-078c: Add tab navigation (Overview, Databases, Storage, Settings)
- [ ] task-078d: Add logout button

### Pages
- `GET /admin` - Dashboard (protected)
- `GET /admin/overview` - Stats tab
- `GET /admin/databases` - DB browser tab
- `GET /admin/storage` - File browser tab
- `GET /admin/settings` - Settings tab

---

## Phase 4: Overview/Settings Tab (task-079)

### Goals
- Server stats (uptime, storage used, DB count)
- API key management
- Environment variable display (non-sensitive)

### Tasks
- [ ] task-079a: Add `/api/admin/stats` endpoint
- [ ] task-079b: Add `/api/admin/keys` endpoints (CRUD)
- [ ] task-079c: Create overview tab UI
- [ ] task-079d: Create API key management UI

### API
- `GET /api/admin/stats` - Server stats
- `GET /api/admin/keys` - List API keys
- `POST /api/admin/keys` - Create API key
- `DELETE /api/admin/keys/:id` - Revoke API key
- `GET /api/admin/config` - View config (filtered)

---

## Phase 5: Database Browser Tab (task-080)

### Goals
- List all databases
- Browse records in a database
- View/edit/delete records

### Tasks
- [ ] task-080a: Add `/api/admin/dbs` endpoint
- [ ] task-080b: Add `/api/admin/dbs/:name/docs` endpoint
- [ ] task-080c: Create database list UI
- [ ] task-080d: Create record browser UI
- [ ] task-080e: Add inline record editing

### API
- `GET /api/admin/dbs` - List databases
- `GET /api/admin/dbs/:db` - Database info
- `GET /api/admin/dbs/:db/docs` - List documents
- `GET /api/admin/dbs/:db/docs/:id` - Get document
- `PUT /api/admin/dbs/:db/docs/:id` - Update document
- `DELETE /api/admin/dbs/:db/docs/:id` - Delete document

---

## Phase 6: Storage Browser Tab (task-081)

### Goals
- List all buckets
- Browse files in buckets
- Upload/delete files

### Tasks
- [ ] task-081a: Add `/api/admin/storage` endpoints
- [ ] task-081b: Create bucket list UI
- [ ] task-081c: Create file browser UI
- [ ] task-081d: Add file upload UI
- [ ] task-081e: Add file delete functionality

### API
- `GET /api/admin/storage` - List buckets
- `GET /api/admin/storage/:bucket` - List files
- `GET /api/admin/storage/:bucket/:key` - Download file
- `PUT /api/admin/storage/:bucket/:key` - Upload file
- `DELETE /api/admin/storage/:bucket/:key` - Delete file

---

## Phase 7: Styling & Polish (task-082)

### Goals
- Clean, modern UI
- Responsive design
- Loading states
- Error handling

### Tasks
- [ ] task-082a: Add CSS styling
- [ ] task-082b: Add loading spinners
- [ ] task-082c: Add error toasts/notifications
- [ ] task-082d: Mobile responsive fixes

---

## Dependencies

### Tech Stack
- Hono (server)
- HTMX or vanilla JS (frontend)
- Simple CSS (no framework)
- JWT for auth

### New Dependencies
- `jsonwebtoken` - JWT handling
- `bcryptjs` - Password hashing

---

## File Structure

```
hyper-micro/
├── src/
│   ├── routes/
│   │   ├── admin.ts      # Admin API routes
│   │   ├── auth.ts       # Login/logout
│   │   └── ui.ts         # HTML page routes
│   ├── middleware/
│   │   └── auth.ts        # JWT validation
│   └── templates/
│       ├── layout.html   # Base template
│       ├── index.html    # Landing page
│       ├── login.html    # Login form
│       └── dashboard.html # Admin dashboard
```

---

## Acceptance Criteria

1. ✅ Landing page shows hyper-micro info at `/`
2. ✅ Admin can login with env credentials
3. ✅ Dashboard shows server stats
4. ✅ Can list/create/revoke API keys
5. ✅ Can browse databases and records
6. ✅ Can browse buckets and files
7. ✅ Can upload files via UI
8. ✅ Responsive on mobile
