// HTTP executor for downstream API calls
// Data plane component

import type { Tool, GatewayConfig } from '../types.js';

export interface ExecutionResult {
  data: unknown;
  status: number;
  isError: boolean;
}

function assertSafePathSegment(value: string, label: string): void {
  let decoded = value;

  for (let pass = 0; pass < 8; pass++) {
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      throw new Error(`${label} must not contain path separators or dot segments`);
    }

    if (!decoded.includes('%')) {
      return;
    }

    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error(`${label} contains invalid percent encoding`);
    }

    if (next === decoded) {
      return;
    }
    decoded = next;
  }

  throw new Error(`${label} contains excessive percent encoding`);
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
    const pathValue = String(value);
    assertSafePathSegment(pathValue, `Path parameter ${param}`);
    resolvedPath = resolvedPath.split(`{${param}}`).join(encodeURIComponent(pathValue));
  }

  const baseUrl = new URL(serverConfig.base_url);
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new Error('Configured server base URL must use HTTP or HTTPS');
  }

  const pathPrefix = resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`;
  if (pathPrefix.startsWith('//')) {
    throw new Error('Tool path must not be protocol-relative');
  }
  for (const segment of pathPrefix.split('/')) {
    if (segment) {
      assertSafePathSegment(segment, 'Tool path segment');
    }
  }

  const url = new URL(baseUrl);
  url.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}${pathPrefix}`;
  url.search = '';
  url.hash = '';
  if (url.origin !== baseUrl.origin) {
    throw new Error('Resolved tool URL changed the configured server origin');
  }

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

  url.search = queryParams.toString();

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
