// Benchmark script comparing naive MCP server registration vs Gateway meta-tools discovery
// Control & evaluation component

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { stringify as stringifyYaml } from 'yaml';
import { generateLargeOpenApiSpec } from './gen-large-spec.js';
import { crawlOpenApiSpec } from '../src/crawler/openapi.js';
import { searchTools, getSchema } from '../src/gateway/discovery.js';
import { project } from '../src/gateway/projection.js';
import type { RegistrySnapshot, Caller } from '../src/types.js';

async function runBenchmark(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bench-'));
  const specPath = path.join(tmpDir, 'large-spec.yaml');

  try {
    const rawSpec = generateLargeOpenApiSpec();
    fs.writeFileSync(specPath, stringifyYaml(rawSpec));

    // 1. Crawl synthetic spec
    const crawledTools = await crawlOpenApiSpec(specPath, 'enterprise');
    const enabledTools = crawledTools.map(t => ({ ...t, enabled: true, owner: '@enterprise-team' }));

    console.log(`Generated and crawled ${enabledTools.length} tools across 30 resources.`);

    // 2. Naive MCP baseline: tools/list contains all 120 tools with schemas
    const naiveToolsListPayload = JSON.stringify({
      tools: enabledTools.map(t => ({
        name: t.id,
        description: t.description,
        inputSchema: t.input_schema,
      })),
    });

    const naiveChars = naiveToolsListPayload.length;
    const naiveTokens = Math.ceil(naiveChars / 4);

    // 3. Gateway MCP: tools/list contains only the 3 meta-tools
    const gatewayMetaTools = [
      {
        name: 'search_tools',
        description: 'Search for available tools by query',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', minimum: 1, maximum: 20, default: 8, description: 'Maximum number of results' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_schema',
        description: 'Get the input schema for a specific tool',
        inputSchema: {
          type: 'object',
          properties: {
            tool_id: { type: 'string', description: 'Tool ID' },
          },
          required: ['tool_id'],
        },
      },
      {
        name: 'invoke_tool',
        description: 'Invoke a specific tool with arguments',
        inputSchema: {
          type: 'object',
          properties: {
            tool_id: { type: 'string', description: 'Tool ID' },
            arguments: { type: 'object', description: 'Tool arguments' },
            fields: { type: 'array', items: { type: 'string' }, description: 'Fields to project from response' },
          },
          required: ['tool_id'],
        },
      },
    ];

    const gatewayToolsListPayload = JSON.stringify({ tools: gatewayMetaTools });
    const gatewayMetaChars = gatewayToolsListPayload.length;
    const gatewayMetaTokens = Math.ceil(gatewayMetaChars / 4);

    // 4. One discovery flow: search_tools query + get_schema for chosen tool
    const snapshot: RegistrySnapshot = {
      tools: { version: 1, tools: enabledTools },
      policy: {
        default: 'allow',
        rules: [],
      },
      gateway: {
        port: 3000,
        audit_log_path: './logs/audit.jsonl',
        rate_limit: { requests_per_minute: 60, burst: 20 },
        max_response_bytes: 1048576,
        request_timeout_ms: 10000,
        servers: { enterprise: { base_url: 'http://localhost:5000' } },
        callers: [],
        redaction: { patterns: [], keys: [], replacement: '[REDACTED]' },
      },
    };

    const caller: Caller = {
      id: 'bench-agent',
      type: 'agent',
      scopes: ['write', 'destructive'],
    };

    // Execute discovery flow
    const searchResults = searchTools(snapshot, caller, 'user', 8);
    const searchPayload = JSON.stringify(searchResults);

    const schemaResult = getSchema(snapshot, caller, 'enterprise.createUser');
    const schemaPayload = JSON.stringify(schemaResult);

    const discoveryChars = searchPayload.length + schemaPayload.length;
    const discoveryTokens = Math.ceil(discoveryChars / 4);

    const totalGatewayChars = gatewayMetaChars + discoveryChars;
    const totalGatewayTokens = Math.ceil(totalGatewayChars / 4);

    const tokenSavingsPct = (((naiveTokens - totalGatewayTokens) / naiveTokens) * 100).toFixed(1);
    const catalogTokensReductionPct = (((naiveTokens - gatewayMetaTokens) / naiveTokens) * 100).toFixed(1);

    // 5. Response projection example
    const sampleFullResponse = {
      id: 'usr_987234',
      name: 'Dr. Jane Doe',
      status: 'active',
      created_at: '2026-01-15T10:30:00Z',
      updated_at: '2026-03-20T14:45:00Z',
      external_id: 'ext_legacy_00491823',
      tags: ['vip', 'healthcare', 'beta_tester', 'enterprise_tier'],
      metadata: {
        region: 'us-west-2',
        compliance: 'hipaa',
        encryption_key_id: 'arn:aws:kms:us-west-2:111122223333:key/12345678',
        assigned_rep: 'agent_mark_smith',
        login_count: 148,
        preferences: { theme: 'dark', notifications: { email: true, sms: false, push: true } },
      },
    };

    const fullResponseChars = JSON.stringify(sampleFullResponse).length;
    const fullResponseTokens = Math.ceil(fullResponseChars / 4);

    const projectedResponse = project(sampleFullResponse, ['name', 'status']);
    const projectedChars = JSON.stringify(projectedResponse).length;
    const projectedTokens = Math.ceil(projectedChars / 4);
    const projectionSavingsPct = (((fullResponseTokens - projectedTokens) / fullResponseTokens) * 100).toFixed(1);

    const today = new Date().toISOString().split('T')[0];

    const markdown = `# Benchmark Results: MCP Gateway vs Naive MCP Server

Date of benchmark run: **${today}**

## Methodology
- **Synthetic API Catalog**: 30 resources with 4 CRUD operations each (= **120 operations**), generated dynamically by \`bench/gen-large-spec.ts\`.
- **Token Estimation Heuristic**: \`ceil(characters / 4)\` (standard LLM token approximation rule-of-thumb).
- **Naive MCP Baseline**: Conventional MCP server exposing all 120 endpoints in the initial \`tools/list\` catalog payload.
- **MCP Gateway**: Exposes only 3 lightweight discovery meta-tools (\`search_tools\`, \`get_schema\`, \`invoke_tool\`).
- **Discovery Flow**: Simulates an agent performing \`search_tools { query: "user", limit: 8 }\` followed by \`get_schema { tool_id: "enterprise.createUser" }\`.
- **Response Projection**: Demonstrates selective field trimming on downstream responses.

---

## 1. Catalog Context Consumption (Initial \`tools/list\`)

| Architecture | Characters | Est. Tokens | Initial Context Reduction |
| :--- | :--- | :--- | :--- |
| **Naive MCP (\`tools/list\` all 120 tools)** | ${naiveChars.toLocaleString()} | **${naiveTokens.toLocaleString()}** | Baseline (0.0%) |
| **MCP Gateway (\`tools/list\` 3 meta-tools)** | ${gatewayMetaChars.toLocaleString()} | **${gatewayMetaTokens.toLocaleString()}** | **-${catalogTokensReductionPct}%** |

---

## 2. End-to-End Task Flow Comparison

| Step / Flow | Payload | Characters | Est. Tokens |
| :--- | :--- | :--- | :--- |
| **Naive MCP: Initial Catalog** | 120 tool schemas upfront | ${naiveChars.toLocaleString()} | ${naiveTokens.toLocaleString()} |
| **Gateway: Initial Catalog** | 3 meta-tools (\`search_tools\`, \`get_schema\`, \`invoke_tool\`) | ${gatewayMetaChars.toLocaleString()} | ${gatewayMetaTokens.toLocaleString()} |
| **Gateway: \`search_tools\` Result** | 8 tool summaries (id, server, risk, description) | ${searchPayload.length.toLocaleString()} | ${Math.ceil(searchPayload.length / 4).toLocaleString()} |
| **Gateway: \`get_schema\` Result** | Full schema for 1 chosen tool | ${schemaPayload.length.toLocaleString()} | ${Math.ceil(schemaPayload.length / 4).toLocaleString()} |
| **Gateway: Total Discovery Flow** | Initial catalog + search + schema | **${totalGatewayChars.toLocaleString()}** | **${totalGatewayTokens.toLocaleString()}** |

> **Net Token Savings on Discovery Flow: ${tokenSavingsPct}% reduction** (${totalGatewayTokens.toLocaleString()} vs ${naiveTokens.toLocaleString()} tokens).

---

## 3. Response Projection Savings

| Response Type | Payload | Characters | Est. Tokens | Size Reduction |
| :--- | :--- | :--- | :--- | :--- |
| **Full Downstream Response** | Full resource with metadata & arrays | ${fullResponseChars.toLocaleString()} | ${fullResponseTokens.toLocaleString()} | Baseline |
| **Projected Response (\`name, status\`)** | Only requested fields retained | ${projectedChars.toLocaleString()} | ${projectedTokens.toLocaleString()} | **-${projectionSavingsPct}%** |

---

*Generated automatically by \`npm run bench\` (tsx bench/compare.ts).*
`;

    const outPath = path.resolve('bench/RESULTS.md');
    fs.writeFileSync(outPath, markdown);
    console.log(`\nBenchmark complete. Results written to ${outPath}\n`);
    console.log(markdown);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
