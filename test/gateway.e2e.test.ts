import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startDemoApi } from '../examples/demo-api/server.js';
import { createGateway, type GatewayResult } from '../src/gateway/createGateway.js';
import { crawlOpenApiSpec } from '../src/crawler/openapi.js';
import type { ToolsConfig } from '../src/types.js';

describe('Gateway E2E Integration', () => {
  let demoApi: { close: () => Promise<void>; port: number };
  let gateway: GatewayResult;
  let tempConfigDir: string;
  let auditLogPath: string;

  const aliceToken = 'test-alice-token';
  const agentToken = 'test-agent-token';
  const originalAuditHmacKey = process.env.AUDIT_HMAC_KEY;

  beforeAll(async () => {
    process.env.AUDIT_HMAC_KEY = 'test-audit-hmac-key-with-at-least-32-bytes';

    // 1. Start demo API on ephemeral port
    demoApi = startDemoApi(0);

    // 2. Setup temp config dir
    tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubergate-e2e-'));
    auditLogPath = path.join(tempConfigDir, 'audit.jsonl');

    // Crawl demo API spec
    const demoSpecPath = path.resolve('examples/demo-api/openapi.yaml');
    const crawledTools = await crawlOpenApiSpec(demoSpecPath, 'demo');

    // Enable chosen tools: listUsers, getUser, listOrders, getOrder, createUser, deleteUser
    // Leave createOrder disabled
    const tools: ToolsConfig = {
      version: 1,
      tools: crawledTools.map(t => {
        if (t.id === 'demo.createOrder') {
          return { ...t, enabled: false, owner: '@team-demo' };
        }
        return { ...t, enabled: true, owner: '@team-demo' };
      }),
    };

    fs.writeFileSync(path.join(tempConfigDir, 'tools.yaml'), stringifyYaml(tools));

    // Gateway config with inline tokens and dynamic demo base_url
    const gatewayConfig = {
      port: 0,
      audit_log_path: auditLogPath,
      rate_limit: {
        requests_per_minute: 60,
        burst: 5,
      },
      max_response_bytes: 1048576,
      request_timeout_ms: 10000,
      servers: {
        demo: { base_url: `http://localhost:${demoApi.port}` },
      },
      callers: [
        { id: 'alice', type: 'human', token: aliceToken, scopes: ['write', 'destructive'] },
        { id: 'agent', type: 'agent', token: agentToken, scopes: ['write'] },
      ],
      redaction: {
        patterns: ['email', 'phone', 'ssn', 'credit_card'],
        keys: ['password', 'ssn', 'token', 'secret', 'api_key', 'cardNumber'],
        replacement: '[REDACTED]',
      },
    };
    fs.writeFileSync(path.join(tempConfigDir, 'gateway.yaml'), stringifyYaml(gatewayConfig));

    // Policy config
    const policyConfig = {
      default: 'deny',
      rules: [
        {
          actors: ['human', 'service', 'agent'],
          risk: ['read'],
          effect: 'allow',
        },
        {
          actors: ['human', 'service', 'agent'],
          risk: ['write'],
          effect: 'allow',
          require_scope: 'write',
        },
        {
          actors: ['human', 'service'],
          risk: ['destructive'],
          effect: 'allow',
          require_scope: 'destructive',
        },
      ],
    };
    fs.writeFileSync(path.join(tempConfigDir, 'policy.yaml'), stringifyYaml(policyConfig));

    // 3. Start gateway on ephemeral port (port 0) with watch enabled
    gateway = createGateway({
      configDir: tempConfigDir,
      port: 0,
      watch: true,
    });
  });

  afterAll(async () => {
    if (gateway) {
      await gateway.close();
    }
    if (demoApi) {
      await demoApi.close();
    }
    try {
      fs.rmSync(tempConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
    if (originalAuditHmacKey === undefined) {
      delete process.env.AUDIT_HMAC_KEY;
    } else {
      process.env.AUDIT_HMAC_KEY = originalAuditHmacKey;
    }
  });

  async function createClient(token?: string) {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', gateway.url), {
      requestInit: { headers },
    });
    const client = new Client({ name: 'e2e-client', version: '1.0.0' });
    await client.connect(transport);
    return { client, transport };
  }

  it('1. returns 401 with WWW-Authenticate header when no token is provided', async () => {
    const res = await fetch(`${gateway.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('2. tools/list returns exactly the three meta-tools', async () => {
    const { client } = await createClient(aliceToken);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map(t => t.name).sort();
      expect(names).toEqual(['get_schema', 'invoke_tool', 'search_tools']);
    } finally {
      await client.close();
    }
  });

  it('3. search_tools finds demo.getUser and does NOT return disabled demo.createOrder', async () => {
    const { client } = await createClient(aliceToken);
    try {
      const res = await client.callTool({
        name: 'search_tools',
        arguments: { query: 'user' },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as any).text;
      const results = JSON.parse(text);
      const ids = results.map((r: any) => r.id);

      expect(ids).toContain('demo.getUser');
      expect(ids).not.toContain('demo.createOrder');
    } finally {
      await client.close();
    }
  });

  it('4. invoke_tool on a disabled tool fails with "Tool not found or not available"', async () => {
    const { client } = await createClient(aliceToken);
    try {
      const res = await client.callTool({
        name: 'invoke_tool',
        arguments: { tool_id: 'demo.createOrder' },
      });

      expect(res.isError).toBe(true);
      expect((res.content[0] as any).text).toContain('Tool not found or not available');
    } finally {
      await client.close();
    }
  });

  it('5. getUser response has email, phone, and ssn redacted', async () => {
    const { client } = await createClient(aliceToken);
    try {
      const res = await client.callTool({
        name: 'invoke_tool',
        arguments: {
          tool_id: 'demo.getUser',
          arguments: { id: '1' },
        },
      });

      expect(res.isError).toBeFalsy();
      const data = JSON.parse((res.content[0] as any).text);

      expect(data.id).toBe('1');
      expect(data.name).toBe('Alice Johnson');
      expect(data.email).toBe('[REDACTED]');
      expect(data.phone).toBe('[REDACTED]');
      expect(data.ssn).toBe('[REDACTED]');
    } finally {
      await client.close();
    }
  });

  it('6. fields: ["name"] projection trims the response to requested field', async () => {
    const { client } = await createClient(aliceToken);
    try {
      const res = await client.callTool({
        name: 'invoke_tool',
        arguments: {
          tool_id: 'demo.getUser',
          arguments: { id: '1' },
          fields: ['name'],
        },
      });

      expect(res.isError).toBeFalsy();
      const data = JSON.parse((res.content[0] as any).text);
      expect(data).toEqual({ name: 'Alice Johnson' });
    } finally {
      await client.close();
    }
  });

  it('7. agent caller is denied demo.deleteUser while human caller succeeds', async () => {
    const { client: agentClient } = await createClient(agentToken);
    const { client: humanClient } = await createClient(aliceToken);

    try {
      // Agent call -> denied by policy
      const agentRes = await agentClient.callTool({
        name: 'invoke_tool',
        arguments: {
          tool_id: 'demo.deleteUser',
          arguments: { id: '3' },
        },
      });
      expect(agentRes.isError).toBe(true);
      expect((agentRes.content[0] as any).text).toMatch(/deny/);

      // Human call -> allowed
      const humanRes = await humanClient.callTool({
        name: 'invoke_tool',
        arguments: {
          tool_id: 'demo.deleteUser',
          arguments: { id: '3' },
        },
      });
      expect(humanRes.isError).toBeFalsy();
    } finally {
      await agentClient.close();
      await humanClient.close();
    }
  });

  it('8. invalid arguments are rejected with a schema error', async () => {
    const { client } = await createClient(aliceToken);
    try {
      // createUser requires body.name and body.email
      const res = await client.callTool({
        name: 'invoke_tool',
        arguments: {
          tool_id: 'demo.createUser',
          arguments: { body: { name: 'Incomplete' } },
        },
      });

      expect(res.isError).toBe(true);
      expect((res.content[0] as any).text).toContain('Invalid arguments');
    } finally {
      await client.close();
    }
  });

  it('9. rate limiting kicks in after burst is exhausted', async () => {
    const { client } = await createClient(aliceToken);
    try {
      // Burst is 5. Fire 10 rapid invoke_tool calls.
      let rateLimited = false;
      for (let i = 0; i < 10; i++) {
        const res = await client.callTool({
          name: 'invoke_tool',
          arguments: {
            tool_id: 'demo.getUser',
            arguments: { id: '1' },
          },
        });
        if (res.isError && (res.content[0] as any).text.includes('Rate limit exceeded')) {
          rateLimited = true;
          break;
        }
      }
      expect(rateLimited).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('10. editing tools.yaml on disk is picked up by hot-reload without restart', async () => {
    const { client } = await createClient(aliceToken);
    try {
      // Read tools.yaml, enable demo.createOrder, and write back
      const toolsPath = path.join(tempConfigDir, 'tools.yaml');
      const raw = fs.readFileSync(toolsPath, 'utf8');
      const parsed = parseYaml(raw) as ToolsConfig;
      const orderTool = parsed.tools.find(t => t.id === 'demo.createOrder')!;
      orderTool.enabled = true;
      fs.writeFileSync(toolsPath, stringifyYaml(parsed));

      // Poll search_tools up to 3s until demo.createOrder appears
      let pickedUp = false;
      const start = Date.now();
      while (Date.now() - start < 3000) {
        const res = await client.callTool({
          name: 'search_tools',
          arguments: { query: 'order' },
        });
        if (!res.isError) {
          const items = JSON.parse((res.content[0] as any).text);
          if (items.some((item: any) => item.id === 'demo.createOrder')) {
            pickedUp = true;
            break;
          }
        }
        await new Promise(r => setTimeout(r, 200));
      }
      expect(pickedUp).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('11. audit records are produced for allow and deny decisions and contain no raw PII', async () => {
    expect(fs.existsSync(auditLogPath)).toBe(true);
    const content = fs.readFileSync(auditLogPath, 'utf8').trim();
    const lines = content.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    let foundAllow = false;
    let foundDeny = false;

    for (const line of lines) {
      const record = JSON.parse(line);
      expect(record).toHaveProperty('ts');
      expect(record).toHaveProperty('caller');
      expect(record).toHaveProperty('action');
      expect(record).toHaveProperty('decision');
      expect(record).toHaveProperty('args_hmac_sha256');
      expect(record.args_hmac_sha256).toMatch(/^[a-f0-9]{64}$/);

      if (record.decision === 'allow') foundAllow = true;
      if (record.decision === 'deny') foundDeny = true;

      // Verify no raw argument PII (such as raw emails, phones, or card numbers) in audit line
      expect(line).not.toContain('alice.johnson@example.com');
      expect(line).not.toContain('123-45-6789');
      expect(line).not.toContain('4111 1111 1111 1111');
    }

    expect(foundAllow).toBe(true);
    expect(foundDeny).toBe(true);
  });
});
