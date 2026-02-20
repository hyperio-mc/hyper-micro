// API module exports
import { dataApi } from './data.js';
import { storageApi } from './storage.js';
import { authApi } from './auth.js';

export const API_VERSION = 'v1';

// Export all API routes
export { dataApi, storageApi, authApi };
