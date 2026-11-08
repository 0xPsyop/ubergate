// Main entry point for the gateway server
// Data plane component

import { createGateway } from './gateway/createGateway.js';

const configDir = process.env.GATEWAY_CONFIG_DIR || './config';

const gateway = createGateway({
  configDir,
  watch: true,
});

console.log(`Gateway started at ${gateway.url}`);

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await gateway.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await gateway.close();
  process.exit(0);
});
