import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { once } from 'node:events';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfigDir } from '../src/registry/loader.js';
import { crawlOpenApiSpec } from '../src/crawler/openapi.js';
import { executeTool } from '../src/gateway/executor.js';
import { getSchema, searchTools } from '../src/gateway/discovery.js';
import { redact } from '../src/middleware/redact.js';
import type { Caller, RegistrySnapshot, Tool } from '../src/types.js';
import { startDemoApi } from '../examples/demo-api/server.js';

const endpointCount = 200;
const benchmarkCaller: Caller = { id: 'token-benchmark', type: 'agent', scopes: [] };
const metaTools = [
  {
    name: 'search_tools',
    description: 'Search for available tools by query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 20,
          default: 8,
          description: 'Maximum number of results',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_schema',
    description: 'Get the input schema for a specific tool',
    inputSchema: {
      type: 'object',
      properties: { tool_id: { type: 'string', description: 'Tool ID' } },
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

function createSyntheticSpec(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (let index = 0; index < endpointCount / 4; index++) {
    const resource = index === 0 ? 'users' : `synthetic-resources-${index}`;
    const singular = index === 0 ? 'user' : `synthetic-resource-${index}`;
    const title = index === 0 ? 'User' : `Synthetic resource ${index}`;
    const collectionPath = `/${resource}`;

    paths[collectionPath] = {
      get: {
        operationId: index === 0 ? 'listUsers' : `listSyntheticResources${index}`,
        summary: `List ${title.toLowerCase()} records`,
        description: `Retrieve a paginated list of ${title.toLowerCase()} records with filtering and sorting options.`,
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: `A list of ${title.toLowerCase()} records` } },
      },
      post: {
        operationId: index === 0 ? 'createUser' : `createSyntheticResource${index}`,
        summary: `Create ${singular}`,
        description: `Create a ${singular} record with identifying fields and metadata.`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', description: `Name of the ${singular}` },
                  status: { type: 'string', enum: ['active', 'pending', 'archived'] },
                  external_id: { type: 'string', description: 'External system identifier' },
                  metadata: { type: 'object', additionalProperties: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: { '201': { description: `Created ${singular}` } },
      },
    };

    paths[`${collectionPath}/{id}`] = {
      get: {
        operationId: index === 0 ? 'getUser' : `getSyntheticResource${index}`,
        summary: `Get ${singular} by ID`,
        description: `Retrieve the complete ${singular} record and its metadata by unique ID.`,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: `${title} record` } },
      },
      delete: {
        operationId: index === 0 ? 'deleteUser' : `deleteSyntheticResource${index}`,
        summary: `Delete ${singular} by ID`,
        description: `Delete the ${singular} record identified by its unique ID.`,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: `Deleted ${singular}` } },
      },
    };
  }

  return {
    openapi: '3.0.0',
    info: {
      title: 'Synthetic 200-endpoint API',
      version: '1.0.0',
      description: 'A generated synthetic catalog for token-size comparison.',
    },
    paths,
  };
}

function toolList(tools: Tool[]) {
  return {
    tools: tools.map(tool => ({
      name: tool.id,
      description: tool.description,
      inputSchema: tool.input_schema,
    })),
  };
}

function callRequest(name: string, args: Record<string, unknown>) {
  return { method: 'tools/call', params: { name, arguments: args } };
}

function callResponse(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function measure(chars: number) {
  return { chars, estimatedTokens: Math.ceil(chars / 4) };
}

async function benchmarkScenario(
  name: string,
  tools: Tool[],
  baseSnapshot: RegistrySnapshot,
  baseUrl: string
) {
  const enabledTools = tools.filter(tool => tool.enabled && !tool.deprecated && !tool.needs_review);
  const snapshot: RegistrySnapshot = {
    ...baseSnapshot,
    tools: { ...baseSnapshot.tools, tools: enabledTools },
  };
  const targetId = 'demo.getUser';
  const target = enabledTools.find(tool => tool.id === targetId);
  if (!target) {
    throw new Error(`${name}: ${targetId} is not enabled in the benchmark catalog`);
  }

  const gateway = {
    ...snapshot.gateway,
    servers: {
      ...snapshot.gateway.servers,
      [target.server]: { base_url: baseUrl },
    },
  };
  const scenarioSnapshot = { ...snapshot, gateway };
  const searchResults = searchTools(scenarioSnapshot, benchmarkCaller, 'get user', 8);
  const schema = getSchema(scenarioSnapshot, benchmarkCaller, targetId);
  if (!schema || !searchResults.some(result => result.id === targetId)) {
    throw new Error(`${name}: progressive discovery did not return ${targetId}`);
  }

  const invocation = await executeTool(target, { id: '1' }, gateway);
  if (invocation.isError) {
    throw new Error(`${name}: demo API invocation failed with HTTP ${invocation.status}`);
  }
  const invocationResult = redact(invocation.data, gateway.redaction).value;

  const conventionalMessages = [
    toolList(enabledTools),
    callRequest(targetId, { id: '1' }),
    callResponse(invocationResult),
  ];
  const progressiveMessages = [
    { tools: metaTools },
    callRequest('search_tools', { query: 'get user' }),
    callResponse(searchResults),
    callRequest('get_schema', { tool_id: targetId }),
    callResponse(schema),
    callRequest('invoke_tool', { tool_id: targetId, arguments: { id: '1' } }),
    callResponse(invocationResult),
  ];

  const conventionalChars = JSON.stringify(conventionalMessages).length;
  const progressiveChars = JSON.stringify(progressiveMessages).length;
  const conventional = measure(conventionalChars);
  const progressive = measure(progressiveChars);
  const conventionalCatalog = measure(JSON.stringify(toolList(enabledTools)).length);
  const progressiveCatalog = measure(JSON.stringify({ tools: metaTools }).length);

  return {
    scenario: name,
    enabledTools: enabledTools.length,
    conventionalCatalog,
    progressiveCatalog,
    conventional,
    progressive,
    estimatedReductionPercent: Number(
      (((conventional.estimatedTokens - progressive.estimatedTokens) / conventional.estimatedTokens) * 100).toFixed(1)
    ),
  };
}

async function main(): Promise<void> {
  for (const tokenEnv of ['ALICE_TOKEN', 'BILLING_TOKEN', 'AGENT_TOKEN']) {
    process.env[tokenEnv] ??= `benchmark-only-${tokenEnv.toLowerCase()}`;
  }

  const config = loadConfigDir(path.resolve('config'));
  const demo = startDemoApi(0);
  await once(demo.server, 'listening');
  const address = demo.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Demo API did not bind to a TCP port');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubergate-token-benchmark-'));
  try {
    const demoTools = config.tools.tools;
    const syntheticSpecPath = path.join(tempDir, 'synthetic-openapi.yaml');
    fs.writeFileSync(syntheticSpecPath, stringifyYaml(createSyntheticSpec()));
    const syntheticTools = (await crawlOpenApiSpec(syntheticSpecPath, 'demo'))
      .map(tool => ({ ...tool, enabled: true, owner: 'synthetic-benchmark' }));

    if (syntheticTools.length !== endpointCount) {
      throw new Error(`Expected ${endpointCount} synthetic endpoints, crawled ${syntheticTools.length}`);
    }

    const results = [
      await benchmarkScenario('Demo API config', demoTools, config, baseUrl),
      await benchmarkScenario(`Synthetic ${endpointCount}-endpoint API`, syntheticTools, config, baseUrl),
    ];

    console.log(JSON.stringify({
      estimator: 'ceil(serialized JSON UTF-16 characters / 4); estimate, not tokenizer output',
      measurement: 'MCP tool definitions and tools/call request/response payloads; downstream results came from the local demo API',
      results,
    }, null, 2));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await demo.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
