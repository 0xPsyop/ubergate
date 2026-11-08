// Express gateway app with MCP HTTP transport
// Data plane component

import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
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
  server: Server;
  readonly snapshot: RegistrySnapshot;
  close: () => Promise<void>;
  readonly url: string;
}

export function createGateway(options: GatewayOptions): GatewayResult {
  const app = express();
  const configDir = options.configDir;

  // Load initial config
  const holder = new ConfigHolder();
  holder.snapshot = loadConfigDir(configDir);

  const auditHmacKey = process.env.AUDIT_HMAC_KEY;
  if (!auditHmacKey || Buffer.byteLength(auditHmacKey, 'utf8') < 32) {
    throw new Error('AUDIT_HMAC_KEY must be set to a secret of at least 32 bytes before starting the gateway');
  }

  const port = options.port !== undefined ? options.port : (holder.snapshot.gateway.port ?? 3000);

  // Create shared rate limiter and audit logger
  const rateLimiter = new RateLimiter({
    requestsPerMinute: holder.snapshot.gateway.rate_limit.requests_per_minute,
    burst: holder.snapshot.gateway.rate_limit.burst,
  });

  const auditLogger = new AuditLogger({
    auditLogPath: holder.snapshot.gateway.audit_log_path,
    hmacKey: auditHmacKey,
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
    const caller = authenticate(authHeader, holder.snapshot.gateway);

    if (!caller) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Create per-request MCP server and stateless transport
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

  // Unsupported methods return 405 JSON-RPC error
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
  const server = app.listen(port);

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

  return {
    app,
    server,
    get snapshot() {
      return holder.snapshot;
    },
    close,
    get url() {
      const addr = server.address() as AddressInfo | null;
      if (addr && typeof addr === 'object' && addr.port) {
        return `http://localhost:${addr.port}`;
      }
      return `http://localhost:${port}`;
    },
  };
}
