// HTTP executor for downstream API calls
// Data plane component

import type { Tool, GatewayConfig } from '../types.js';

export interface ExecutionResult {
  data: unknown;
  status: number;
  isError: boolean;
}

export async function executeTool(
  tool: Tool,
  args: Record<string, unknown>,
  gatewayConfig: GatewayConfig
): Promise<ExecutionResult> {
  const serverConfig = gatewayConfig.servers[tool.server];
  if (!serverConfig) {
    throw new Error(`Server not found: ${tool.server}`);
  }

  // Substitute path params
  let resolvedPath = tool.request.path;
  for (const param of tool.request.path_params) {
    const value = args[param];
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter: ${param}`);
    }
    resolvedPath = resolvedPath.replace(`{${param}}`, encodeURIComponent(String(value)));
  }

  // Build full URL
  const baseUrl = serverConfig.base_url.replace(/\/+$/, '');
  const pathPrefix = resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`;
  let url = `${baseUrl}${pathPrefix}`;

  // Build query params
  const queryParams = new URLSearchParams();
  for (const param of tool.request.query_params) {
    const value = args[param];
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        for (const v of value) {
          queryParams.append(param, String(v));
        }
      } else {
        queryParams.append(param, String(value));
      }
    }
  }

  const queryString = queryParams.toString();
  if (queryString) {
    url += `?${queryString}`;
  }

  // Prepare request
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), gatewayConfig.request_timeout_ms);

  const headers: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
  };

  let body: string | undefined;
  if (tool.request.has_body && args.body !== undefined) {
    body = JSON.stringify(args.body);
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(url, {
      method: tool.request.method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > gatewayConfig.max_response_bytes) {
      throw new Error(`Response exceeds max_response_bytes (${contentLength} > ${gatewayConfig.max_response_bytes})`);
    }

    const rawText = await response.text();
    const byteLength = Buffer.byteLength(rawText, 'utf8');
    if (byteLength > gatewayConfig.max_response_bytes) {
      throw new Error(`Response exceeds max_response_bytes (${byteLength} > ${gatewayConfig.max_response_bytes})`);
    }

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;
    if (contentType.includes('application/json') && rawText.length > 0) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = rawText;
      }
    } else {
      data = rawText;
    }

    const isError = !response.ok;
    return { data, status: response.status, isError };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}
