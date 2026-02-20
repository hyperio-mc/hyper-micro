import 'dotenv/config';
import { createApp, startServer, loadConfig } from './server/index.js';
import { shutdownLmdb } from './db/index.js';

// Initialize configuration
const config = loadConfig();

// Create the Hono application
const app = createApp();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await shutdownLmdb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down...');
  await shutdownLmdb();
  process.exit(0);
});

// Start the server
startServer(app, config);

export { app, config };