// Per-request MCP server with three meta-tools
// Data plane component

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Caller, RegistrySnapshot } from '../types.js';
import { RateLimiter } from '../middleware/ratelimit.js';
import { AuditLogger } from '../middleware/audit.js';
import { runPipeline } from '../middleware/pipeline.js';
import { searchTools, getSchema } from './discovery.js';

export function createMcpServer(
  caller: Caller,
  snapshot: RegistrySnapshot,
  rateLimiter: RateLimiter,
  auditLogger: AuditLogger
): McpServer {
  const server = new McpServer(
    {
      name: 'mcp-gateway',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register search_tools
  server.registerTool(
    'search_tools',
    {
      description: 'Search for available tools by query',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().min(1).max(20).default(8).describe('Maximum number of results'),
      }),
    },
    async (args, _extra) => {
      try {
        const results = searchTools(snapshot, caller, args.query, args.limit);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Search failed',
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register get_schema
  server.registerTool(
    'get_schema',
    {
      description: 'Get the input schema for a specific tool',
      inputSchema: z.object({
        tool_id: z.string().describe('Tool ID'),
      }),
    },
    async (args, _extra) => {
      try {
        const schema = getSchema(snapshot, caller, args.tool_id);
        if (!schema) {
          return {
            content: [
              {
                type: 'text',
                text: 'Tool not found or not available',
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(schema),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Schema lookup failed',
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Register invoke_tool
  server.registerTool(
    'invoke_tool',
    {
      description: 'Invoke a specific tool with arguments',
      inputSchema: z.object({
        tool_id: z.string().describe('Tool ID'),
        arguments: z.record(z.unknown()).optional().describe('Tool arguments'),
        fields: z.array(z.string()).optional().describe('Fields to project from response'),
      }),
    },
    async (args, _extra) => {
      try {
        const tool = snapshot.tools.tools.find(t => t.id === args.tool_id);
        if (!tool) {
          return {
            content: [
              {
                type: 'text',
                text: 'Tool not found or not available',
              },
            ],
            isError: true,
          };
        }

        const result = await runPipeline({
          tool,
          caller,
          arguments: args.arguments,
          fields: args.fields,
          snapshot,
          rateLimiter,
          auditLogger,
        });

        if (!result.success) {
          return {
            content: [
              {
                type: 'text',
                text: result.error || 'Invocation failed',
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.data),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: 'Internal gateway error',
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
