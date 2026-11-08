import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeTool } from '../src/gateway/executor.js';
import { makeGatewayConfig, makeTool } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP executor URL construction', () => {
  it.each([
    '..',
    '.',
    '../admin',
    '%2e%2e',
    '%2E%2E',
    '%252e%252e',
    '%2f..%2fadmin',
    '%255c..%255cadmin',
    'folder\\..\\admin',
  ])('rejects traversal path parameter %s before making a request', async id => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const tool = makeTool('demo.getUser', 'read', {
      request: {
        method: 'GET',
        path: '/users/{id}',
        path_params: ['id'],
        query_params: [],
        has_body: false,
      },
    });

    await expect(executeTool(tool, { id }, makeGatewayConfig())).rejects.toThrow(
      /Path parameter id must not contain path separators or dot segments/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encodes path and query values without allowing arguments to change the configured origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const tool = makeTool('demo.getUser', 'read', {
      request: {
        method: 'GET',
        path: '/users/{id}',
        path_params: ['id'],
        query_params: ['next'],
        has_body: false,
      },
    });
    const config = makeGatewayConfig({
      servers: { demo: { base_url: 'https://trusted.example/api/' } },
    });

    await executeTool(tool, {
      id: 'alice smith',
      next: 'https://evil.example/steal?x=1#fragment',
      base_url: 'https://evil.example',
    }, config);

    const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestUrl.origin).toBe('https://trusted.example');
    expect(requestUrl.pathname).toBe('/api/users/alice%20smith');
    expect(requestUrl.searchParams.get('next')).toBe('https://evil.example/steal?x=1#fragment');
    expect(requestUrl.hash).toBe('');
  });

  it('rejects tool paths containing encoded dot segments', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const tool = makeTool('demo.getUser', 'read', {
      request: {
        method: 'GET',
        path: '/users/%2e%2e/admin',
        path_params: [],
        query_params: [],
        has_body: false,
      },
    });

    await expect(executeTool(tool, {}, makeGatewayConfig())).rejects.toThrow(
      /Tool path segment must not contain path separators or dot segments/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
