import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { crawlOpenApiSpec } from '../src/crawler/openapi.js';

describe('OpenAPI Crawler', () => {
  const demoSpecPath = path.resolve('examples/demo-api/openapi.yaml');

  it('yields exactly 7 tools from demo spec', async () => {
    const tools = await crawlOpenApiSpec(demoSpecPath, 'demo');
    expect(tools.length).toBe(7);

    const ids = tools.map(t => t.id).sort();
    expect(ids).toEqual([
      'demo.createOrder',
      'demo.createUser',
      'demo.deleteUser',
      'demo.getOrder',
      'demo.getUser',
      'demo.listOrders',
      'demo.listUsers',
    ]);
  });

  it('maps risks correctly (GET=read, POST/PUT/PATCH=write, DELETE=destructive)', async () => {
    const tools = await crawlOpenApiSpec(demoSpecPath, 'demo');
    const byId = new Map(tools.map(t => [t.id, t]));

    expect(byId.get('demo.listUsers')?.risk).toBe('read');
    expect(byId.get('demo.getUser')?.risk).toBe('read');
    expect(byId.get('demo.listOrders')?.risk).toBe('read');
    expect(byId.get('demo.getOrder')?.risk).toBe('read');
    expect(byId.get('demo.createUser')?.risk).toBe('write');
    expect(byId.get('demo.createOrder')?.risk).toBe('write');
    expect(byId.get('demo.deleteUser')?.risk).toBe('destructive');
  });

  it('sets all crawled tools to disabled, unassigned, not needs_review, not deprecated by default', async () => {
    const tools = await crawlOpenApiSpec(demoSpecPath, 'demo');
    for (const tool of tools) {
      expect(tool.enabled).toBe(false);
      expect(tool.owner).toBe('unassigned');
      expect(tool.needs_review).toBe(false);
      expect(tool.deprecated).toBe(false);
    }
  });

  it('builds correct path, query, and body schema shapes', async () => {
    const tools = await crawlOpenApiSpec(demoSpecPath, 'demo');
    const byId = new Map(tools.map(t => [t.id, t]));

    // Path param: getUser (/users/{id})
    const getUser = byId.get('demo.getUser')!;
    expect(getUser.request.path_params).toEqual(['id']);
    expect(getUser.request.query_params).toEqual([]);
    expect(getUser.request.has_body).toBe(false);
    expect(getUser.input_schema.type).toBe('object');
    expect(getUser.input_schema.properties).toHaveProperty('id');
    expect(getUser.input_schema.required).toContain('id');
    expect(getUser.input_schema.additionalProperties).toBe(false);

    // Query param: listUsers (/users?limit)
    const listUsers = byId.get('demo.listUsers')!;
    expect(listUsers.request.path_params).toEqual([]);
    expect(listUsers.request.query_params).toEqual(['limit']);
    expect(listUsers.request.has_body).toBe(false);
    expect(listUsers.input_schema.properties).toHaveProperty('limit');

    // Body schema: createUser (/users)
    const createUser = byId.get('demo.createUser')!;
    expect(createUser.request.has_body).toBe(true);
    expect(createUser.input_schema.properties).toHaveProperty('body');
    expect(createUser.input_schema.required).toContain('body');
    const bodySchema = (createUser.input_schema.properties as any).body;
    expect(bodySchema.type).toBe('object');
    expect(bodySchema.properties).toHaveProperty('name');
    expect(bodySchema.properties).toHaveProperty('email');
  });

  it('handles missing operationId by generating method_path slug', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-test-'));
    const specWithoutOpId = path.join(tmpDir, 'test-spec.yaml');
    const yaml = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /items/{itemId}/details:
    get:
      summary: Get details
      responses:
        '200':
          description: ok
`;
    fs.writeFileSync(specWithoutOpId, yaml);

    try {
      const tools = await crawlOpenApiSpec(specWithoutOpId, 'test');
      expect(tools.length).toBe(1);
      // {itemId} -> by_id -> get_items_by_id_details
      expect(tools[0].id).toBe('test.get_items_by_id_details');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('produces stable source_hash across multiple runs', async () => {
    const run1 = await crawlOpenApiSpec(demoSpecPath, 'demo');
    const run2 = await crawlOpenApiSpec(demoSpecPath, 'demo');

    expect(run1.map(t => t.source_hash)).toEqual(run2.map(t => t.source_hash));
  });

  it('changes source_hash when an operation contract changes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-hash-test-'));
    const specPath = path.join(tmpDir, 'spec.yaml');
    const writeSpec = (summary: string) => fs.writeFileSync(specPath, `
openapi: 3.0.0
info:
  title: Source hash test
  version: 1.0.0
paths:
  /records/{id}:
    get:
      operationId: getRecord
      summary: ${summary}
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: ok
`);

    try {
      writeSpec('Get a record');
      const originalTools = await crawlOpenApiSpec(specPath, 'hash-test');
      writeSpec('Get a record with its latest status');
      const changedTools = await crawlOpenApiSpec(specPath, 'hash-test');

      expect(changedTools[0].id).toBe(originalTools[0].id);
      expect(changedTools[0].source_hash).not.toBe(originalTools[0].source_hash);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
