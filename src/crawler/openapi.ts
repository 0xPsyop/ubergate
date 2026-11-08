// OpenAPI spec crawler - derives tools from OpenAPI 3.x specs
// Control plane component

import SwaggerParser from '@apidevtools/swagger-parser';
import type { Tool, ToolRequest } from '../types.js';
import { createHash } from 'crypto';
import { calculateRisk } from './risk.js';

interface OpenAPIParameter {
  in: string;
  name: string;
  schema?: unknown;
  required?: boolean;
  description?: string;
}

interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenAPIParameter[];
  requestBody?: {
    required?: boolean;
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
  parameters?: OpenAPIParameter[];
}

interface OpenAPIDocument {
  paths: Record<string, OpenAPIPathItem>;
}

function removeCircularRefs(obj: unknown, seen = new WeakSet()): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (seen.has(obj)) {
    return {};
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    return obj.map(item => removeCircularRefs(item, seen));
  }

  if ('$ref' in obj) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = removeCircularRefs(value, seen);
  }
  return result;
}

function generateOperationId(method: string, path: string): string {
  const slug = path
    .replace(/\{([^}]+)\}/g, 'by_id')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  return `${method.toLowerCase()}_${slug}`;
}

function canonicalStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map(canonicalStringify).join(',')}]`;
  }
  const keys = Object.keys(val as Record<string, unknown>).sort();
  const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalStringify((val as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

function calculateSourceHash(
  method: string,
  path: string,
  inputSchema: Record<string, unknown>,
  description: string
): string {
  const canonical = canonicalStringify({
    method,
    path,
    input_schema: inputSchema,
    original_summary_and_description: description,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export async function crawlOpenApiSpec(specPath: string, serverName: string): Promise<Tool[]> {
  const api = (await SwaggerParser.dereference(specPath)) as OpenAPIDocument;
  const tools: Tool[] = [];

  for (const [pathStr, pathItem] of Object.entries(api.paths)) {
    const operations: Array<{ method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; operation: OpenAPIOperation }> = [];

    if (pathItem.get) operations.push({ method: 'GET', operation: pathItem.get });
    if (pathItem.post) operations.push({ method: 'POST', operation: pathItem.post });
    if (pathItem.put) operations.push({ method: 'PUT', operation: pathItem.put });
    if (pathItem.patch) operations.push({ method: 'PATCH', operation: pathItem.patch });
    if (pathItem.delete) operations.push({ method: 'DELETE', operation: pathItem.delete });

    for (const { method, operation } of operations) {
      const operationId = operation.operationId || generateOperationId(method, pathStr);
      const originalSummaryAndDescription = [operation.summary, operation.description]
        .filter(Boolean)
        .join(' ')
        .trim();

      // Merge path-item-level and operation-level parameters (operation wins)
      const paramMap = new Map<string, OpenAPIParameter>();
      for (const p of pathItem.parameters || []) {
        paramMap.set(`${p.in}:${p.name}`, p);
      }
      for (const p of operation.parameters || []) {
        paramMap.set(`${p.in}:${p.name}`, p);
      }

      const pathParams: string[] = [];
      const queryParams: string[] = [];
      const requiredFields: string[] = [];
      const properties: Record<string, unknown> = {};

      for (const param of paramMap.values()) {
        if (param.in === 'path') {
          pathParams.push(param.name);
          properties[param.name] = param.schema ? removeCircularRefs(param.schema) : { type: 'string' };
          // Path params are always required in OpenAPI, but check required flag as well
          requiredFields.push(param.name);
        } else if (param.in === 'query') {
          queryParams.push(param.name);
          properties[param.name] = param.schema ? removeCircularRefs(param.schema) : { type: 'string' };
          if (param.required) {
            requiredFields.push(param.name);
          }
        }
        // Note: Header and cookie parameters are ignored (documented limitation)
      }

      // Request body
      let hasBody = false;
      if (operation.requestBody?.content?.['application/json']?.schema) {
        hasBody = true;
        properties.body = removeCircularRefs(operation.requestBody.content['application/json'].schema);
        if (operation.requestBody.required) {
          requiredFields.push('body');
        }
      }

      const inputSchema: Record<string, unknown> = {
        type: 'object',
        properties,
        additionalProperties: false,
      };

      if (requiredFields.length > 0) {
        // Deduplicate required fields
        inputSchema.required = Array.from(new Set(requiredFields));
      }

      const request: ToolRequest = {
        method,
        path: pathStr,
        path_params: pathParams,
        query_params: queryParams,
        has_body: hasBody,
      };

      const risk = calculateRisk(method);
      const sourceHash = calculateSourceHash(method, pathStr, inputSchema, originalSummaryAndDescription);

      tools.push({
        id: `${serverName}.${operationId}`,
        server: serverName,
        description: originalSummaryAndDescription,
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
