// Express gateway app with MCP HTTP transport
// Data plane component

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { RegistrySnapshot } from '../types.js';
import { ConfigHolder, loadConfigDir, watchConfigDir } from '../registry/loader.js';
import { authenticate } from '../middleware/auth.js';
import { RateLimiter } from '../middleware/ratelimit.js';
import { AuditLogger } from '../middleware/audit.js';
import { createMcpServer } from './mcpServer.js';

export interface GatewayOptions {
  configDir: string;
  port?: number;
  watch?: boolean;
}

export interface GatewayResult {
  app: express.Express;
  server: ReturnType<express.Application['listen']>;
  snapshot: RegistrySnapshot;
  close: () => Promise<void>;
  url: string;
}

export function createGateway(options: GatewayOptions): GatewayResult {
  const app = express();
  const port = options.port ?? 3000;
  const configDir = options.configDir;

  // Load initial config
  const holder = new ConfigHolder();
  holder.snapshot = loadConfigDir(configDir);

  // Create shared rate limiter and audit logger
  const rateLimiter = new RateLimiter({
    requestsPerMinute: holder.snapshot.gateway.rate_limit.requests_per_minute,
    burst: holder.snapshot.gateway.rate_limit.burst,
  });

  const auditLogger = new AuditLogger({
    auditLogPath: holder.snapshot.gateway.audit_log_path,
  });

  // Watch config if enabled
  let unwatch: (() => void) | null = null;
  if (options.watch ?? true) {
    unwatch = watchConfigDir(configDir, holder, (error) => {
      if (error) {
        console.error('Config reload failed:', error.message);
      } else {
        console.log('Config reloaded successfully');
      }
    });
  }

  // Health check
  app.get('/healthz', (_req, res) => {
    const toolsEnabled = holder.snapshot.tools.tools.filter((t: any) => t.enabled).length;
    res.json({ status: 'ok', tools_enabled: toolsEnabled });
  });

  // Middleware
  app.use(express.json());

  // MCP endpoint
  app.post('/mcp', async (req, res) => {
    const authHeader = req.headers.authorization;
    const authResult = authenticate(authHeader, holder.snapshot.gateway);

    if (!authResult) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { caller } = authResult;

    // Create per-request MCP server
    const mcpServer = createMcpServer(caller, holder.snapshot, rateLimiter, auditLogger);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await mcpServer.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, req.body);

    // Cleanup when response closes
    res.on('close', async () => {
      await mcpServer.close();
    });
  });

  // Unsupported methods
  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32601,
        message: 'Method not supported',
      },
    });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32601,
        message: 'Method not supported',
      },
    });
  });

  // Start server
  const server = app.listen(port, () => {
    console.log(`Gateway listening on port ${port}`);
  });

  const close = async (): Promise<void> => {
    if (unwatch) {
      unwatch();
    }
    await new Promise<void>((resolve, reject) => {
      server.close(err => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  const url = `http://localhost:${port}`;

  return {
    app,
    server,
    snapshot: holder.snapshot,
    close,
    url,
  };
}
