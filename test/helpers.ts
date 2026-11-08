// Test helpers and fixtures

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { stringify as stringifyYaml } from 'yaml';
import type { Tool, Caller, PolicyConfig, GatewayConfig, RegistrySnapshot, Risk, ActorType, PolicyRule } from '../src/types.js';

export function makeTool(id: string, risk: Risk = 'read', overrides?: Partial<Tool>): Tool {
  const parts = id.split('.');
  const server = parts[0] || 'demo';
  const op = parts[1] || 'op';

  return {
    id,
    server,
    description: `Description for ${id}`,
    risk,
    owner: 'unassigned',
    enabled: false,
    needs_review: false,
    deprecated: false,
    source_hash: `hash_${id}`,
    request: {
      method: risk === 'read' ? 'GET' : risk === 'destructive' ? 'DELETE' : 'POST',
      path: `/${op}`,
      path_params: [],
      query_params: [],
      has_body: risk === 'write',
    },
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    ...overrides,
  };
}

export function makeCaller(id: string, type: ActorType = 'human', scopes: string[] = [], overrides?: Partial<Caller>): Caller {
  return {
    id,
    type,
    token: `token-${id}`,
    scopes,
    ...overrides,
  };
}

export function makePolicy(defaultEffect: 'allow' | 'deny' = 'deny', rules: PolicyRule[] = []): PolicyConfig {
  return {
    default: defaultEffect,
    rules,
  };
}

export function makeGatewayConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  return {
    port: 3000,
    audit_log_path: './logs/audit.jsonl',
    rate_limit: {
      requests_per_minute: 60,
      burst: 20,
    },
    max_response_bytes: 1048576,
    request_timeout_ms: 10000,
    servers: {
      demo: { base_url: 'http://localhost:4000' },
    },
    callers: [
      { id: 'alice', type: 'human', token: 'dev-alice-token', scopes: ['write', 'destructive'] },
      { id: 'billing-svc', type: 'service', token: 'dev-billing-token', scopes: ['write'] },
      { id: 'helper-agent', type: 'agent', token: 'dev-agent-token', scopes: ['write'] },
    ],
    redaction: {
      patterns: ['email', 'phone', 'ssn', 'credit_card'],
      keys: ['password', 'ssn', 'token', 'secret', 'api_key', 'cardNumber'],
      replacement: '[REDACTED]',
    },
    ...overrides,
  };
}

export function createTempConfigDir(snapshot: RegistrySnapshot): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-gateway-test-'));

  fs.writeFileSync(
    path.join(dir, 'tools.yaml'),
    '# Generated test tools\n' + stringifyYaml(snapshot.tools)
  );
  fs.writeFileSync(
    path.join(dir, 'policy.yaml'),
    stringifyYaml(snapshot.policy)
  );
  fs.writeFileSync(
    path.join(dir, 'gateway.yaml'),
    stringifyYaml(snapshot.gateway)
  );

  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}
