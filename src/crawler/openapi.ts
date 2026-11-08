// OpenAPI spec crawler - derives tools from OpenAPI 3.x specs
// Control plane component

import SwaggerParser from '@apidevtools/swagger-parser';
import type { Tool, ToolRequest } from '../types.js';
import { createHash } from 'crypto';
import { calculateRisk } from './risk.js';

interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    in: string;
    name: string;
    schema?: unknown;
    required?: boolean;
  }>;
  requestBody?: {
    content?: {
      'application/json'?: {
        schema?: unknown;
      };
    };
  };
}

interface OpenAPIPathItem {
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  patch?: OpenAPIOperation;
  delete?: OpenAPIOperation;
  parameters?: Array<{
    in: string;
    name: string;
    schema?: unknown;
    required?: boolean;
  }>;
}

interface OpenAPIDocument {
  paths: Record<string, OpenAPIPathItem>;
}

function removeCircularRefs(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(removeCircularRefs);
  }

  if ('$ref' in obj) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = removeCircularRefs(value);
  }
  return result;
}

function generateOperationId(method: string, path: string): string {
  const slug = path
    .replace(/\{[^}]+\}/g, 'by_id')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  return `${method}_${slug}`;
}

function buildInputSchema(
  pathParams: string[],
  queryParams: string[],
  bodySchema: unknown | null,
  requiredPathParams: string[],
  requiredQueryParams: string[],
  bodyRequired: boolean
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of pathParams) {
    properties[param] = { type: 'string' };
  }
  required.push(...requiredPathParams);

  for (const param of queryParams) {
    properties[param] = { type: 'string' };
  }
  required.push(...requiredQueryParams);

  if (bodySchema) {
    properties.body = bodySchema;
    if (bodyRequired) {
      required.push('body');
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: false,
  };
}

function calculateSourceHash(
  method: string,
  path: string,
  inputSchema: Record<string, unknown>,
  description: string
): string {
  const canonical = JSON.stringify({ method, path, input_schema: inputSchema, description });
  return createHash('sha256').update(canonical).digest('hex');
}

export async function crawlOpenApiSpec(specPath: string, serverName: string): Promise<Tool[]> {
  const api = await SwaggerParser.dereference(specPath) as OpenAPIDocument;
  const tools: Tool[] = [];

  for (const [pathStr, pathItem] of Object.entries(api.paths)) {
    const operations: Array<{ method: string; operation: OpenAPIOperation }> = [];

    if (pathItem.get) operations.push({ method: 'GET', operation: pathItem.get });
    if (pathItem.post) operations.push({ method: 'POST', operation: pathItem.post });
    if (pathItem.put) operations.push({ method: 'PUT', operation: pathItem.put });
    if (pathItem.patch) operations.push({ method: 'PATCH', operation: pathItem.patch });
    if (pathItem.delete) operations.push({ method: 'DELETE', operation: pathItem.delete });

    for (const { method, operation } of operations) {
      const operationId = operation.operationId || generateOperationId(method, pathStr);
      const description = [
        operation.summary,
        operation.description,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();

      // Merge path-item and operation parameters (operation wins)
      const allParameters = [
        ...(pathItem.parameters || []),
        ...(operation.parameters || []),
      ];

      const pathParams: string[] = [];
      const queryParams: string[] = [];
      const requiredPathParams: string[] = [];
      const requiredQueryParams: string[] = [];

      for (const param of allParameters) {
        if (param.in === 'path') {
          pathParams.push(param.name);
          if (param.required) {
            requiredPathParams.push(param.name);
          }
        } else if (param.in === 'query') {
          queryParams.push(param.name);
          if (param.required) {
            requiredQueryParams.push(param.name);
          }
        }
        // Ignore header and cookie params (documented limitation)
      }

      // Request body
      let bodySchema: unknown | null = null;
      let bodyRequired = false;
      if (operation.requestBody?.content?.['application/json']?.schema) {
        bodySchema = removeCircularRefs(operation.requestBody.content['application/json'].schema);
        bodyRequired = (operation.requestBody as any).required || false;
      }

      const inputSchema = buildInputSchema(
        pathParams,
        queryParams,
        bodySchema,
        requiredPathParams,
        requiredQueryParams,
        bodyRequired
      );

      const request: ToolRequest = {
        method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: pathStr,
        path_params: pathParams,
        query_params: queryParams,
        has_body: bodySchema !== null,
      };

      const risk = calculateRisk(method);

      const sourceHash = calculateSourceHash(method, pathStr, inputSchema, description);

      tools.push({
        id: `${serverName}.${operationId}`,
        server: serverName,
        description,
        risk,
        owner: 'unassigned',
        enabled: false,
        needs_review: false,
        deprecated: false,
        source_hash: sourceHash,
        request,
        input_schema: inputSchema,
      });
    }
  }

  return tools;
}
