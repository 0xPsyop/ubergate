import { describe, it, expect } from 'vitest';
import { mergeTools } from '../src/crawler/merge.js';
import { makeTool } from './helpers.js';
import type { Tool } from '../src/types.js';

describe('Merge Logic (Discovery is not exposure)', () => {
  it('case 1: new tool starts disabled: false, needs_review: false, with specified owner', () => {
    const existing: Tool[] = [];
    const crawled: Tool[] = [makeTool('demo.newTool', 'read')];

    const { tools, result } = mergeTools(existing, crawled, 'demo', '@team-alpha');

    expect(result.new).toBe(1);
    expect(result.unchanged).toBe(0);
    expect(result.changed).toBe(0);
    expect(result.deprecated).toBe(0);

    expect(tools.length).toBe(1);
    expect(tools[0].enabled).toBe(false);
    expect(tools[0].needs_review).toBe(false);
    expect(tools[0].deprecated).toBe(false);
    expect(tools[0].owner).toBe('@team-alpha');
  });

  it('case 2: unchanged tool (same source_hash) preserves all human edits (enabled, owner, description)', () => {
    const existingTool = makeTool('demo.tool1', 'read', {
      source_hash: 'hash_123',
      enabled: true,
      owner: '@human-owner',
      description: 'Human refined description',
    });
    const crawledTool = makeTool('demo.tool1', 'read', {
      source_hash: 'hash_123',
      description: 'Original spec description',
      owner: 'unassigned',
      enabled: false,
    });

    const { tools, result } = mergeTools([existingTool], [crawledTool], 'demo', '@new-owner');

    expect(result.unchanged).toBe(1);
    expect(result.new).toBe(0);
    expect(result.changed).toBe(0);

    expect(tools.length).toBe(1);
    expect(tools[0].enabled).toBe(true);
    expect(tools[0].owner).toBe('@human-owner');
    expect(tools[0].description).toBe('Human refined description');
    expect(tools[0].needs_review).toBe(false);
  });

  it('case 3: changed tool (different source_hash) updates request/schema/hash/desc/risk, preserves owner, resets enabled: false and needs_review: true', () => {
    const existingTool = makeTool('demo.tool1', 'read', {
      source_hash: 'old_hash',
      enabled: true,
      owner: '@original-owner',
      description: 'Old description',
    });
    const crawledTool = makeTool('demo.tool1', 'write', {
      source_hash: 'new_hash',
      description: 'New crawled description',
      owner: 'unassigned',
      enabled: false,
      request: {
        method: 'POST',
        path: '/tool1',
        path_params: [],
        query_params: ['v2'],
        has_body: true,
      },
      input_schema: {
        type: 'object',
        properties: { v2: { type: 'string' } },
        additionalProperties: false,
      },
    });

    const { tools, result } = mergeTools([existingTool], [crawledTool], 'demo', '@ignored-owner');

    expect(result.changed).toBe(1);
    expect(tools.length).toBe(1);
    const updated = tools[0];
    expect(updated.source_hash).toBe('new_hash');
    expect(updated.risk).toBe('write');
    expect(updated.description).toBe('New crawled description');
    expect(updated.request.method).toBe('POST');
    expect(updated.input_schema.properties).toHaveProperty('v2');
    expect(updated.owner).toBe('@original-owner'); // Preserved!
    expect(updated.enabled).toBe(false); // Reset!
    expect(updated.needs_review).toBe(true); // Flagged!
  });

  it('case 4: removed tool from spec (scoped to same server) is kept, deprecated: true, enabled: false', () => {
    const existingTool = makeTool('demo.removedTool', 'read', {
      enabled: true,
      owner: '@owner',
    });
    const crawled: Tool[] = []; // empty crawl for demo

    const { tools, result } = mergeTools([existingTool], crawled, 'demo', '@owner');

    expect(result.deprecated).toBe(1);
    expect(tools.length).toBe(1);
    expect(tools[0].id).toBe('demo.removedTool');
    expect(tools[0].deprecated).toBe(true);
    expect(tools[0].enabled).toBe(false);
  });

  it('leaves tools of other servers completely untouched', () => {
    const otherServerTool = makeTool('billing.charge', 'write', {
      server: 'billing',
      enabled: true,
      owner: '@billing-team',
    });
    const demoTool = makeTool('demo.list', 'read');

    const crawled: Tool[] = [demoTool]; // Only crawled demo server

    const { tools } = mergeTools([otherServerTool], crawled, 'demo', '@team-demo');

    expect(tools.length).toBe(2);
    const billing = tools.find(t => t.id === 'billing.charge')!;
    expect(billing).toBeDefined();
    expect(billing.enabled).toBe(true);
    expect(billing.deprecated).toBe(false);
    expect(billing.owner).toBe('@billing-team');
  });

  it('produces output sorted by id for stable diffs', () => {
    const crawled = [
      makeTool('demo.zebra'),
      makeTool('demo.apple'),
      makeTool('demo.mango'),
    ];

    const { tools } = mergeTools([], crawled, 'demo', '@team');
    expect(tools.map(t => t.id)).toEqual([
      'demo.apple',
      'demo.mango',
      'demo.zebra',
    ]);
  });
});
