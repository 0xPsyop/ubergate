// HTTP executor for downstream API calls
// Data plane component

import type { Tool, GatewayConfig } from '../types.js';

export interface ExecutionResult {
  data: unknown;
  status: number;
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

  // Build URL with path params
  let url = serverConfig.base_url;
  const path = tool.request.path;

  // Substitute path params
  let resolvedPath = path;
  for (const param of tool.request.path_params) {
    const value = args[param];
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter: ${param}`);
    }
    resolvedPath = resolvedPath.replace(`{${param}}`, encodeURIComponent(String(value)));
  }

  url += resolvedPath;

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

  if (queryParams.toString()) {
    url += `?${queryParams.toString()}`;
  }

  // Prepare request
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), gatewayConfig.request_timeout_ms);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const body = tool.request.has_body && args.body ? JSON.stringify(args.body) : undefined;

  try {
    const response = await fetch(url, {
      method: tool.request.method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return { data, status: response.status };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}
