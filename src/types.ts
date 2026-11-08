// Shared types between control plane and data plane
// These represent the registry schema contract

export type Risk = 'read' | 'write' | 'destructive';
export type ActorType = 'human' | 'service' | 'agent';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type PolicyEffect = 'allow' | 'deny';

export interface ToolRequest {
  method: HttpMethod;
  path: string;
  path_params: string[];
  query_params: string[];
  has_body: boolean;
}

export interface Tool {
  id: string;
  server: string;
  description: string;
  risk: Risk;
  owner: string;
  enabled: boolean;
  needs_review: boolean;
  deprecated: boolean;
  source_hash: string;
  request: ToolRequest;
  input_schema: Record<string, unknown>;
}

export interface ToolsConfig {
  version: number;
  tools: Tool[];
}

export interface PolicyRule {
  actors: ActorType[];
  risk: Risk[];
  tools?: string[];
  effect: PolicyEffect;
  require_scope?: string;
}

export interface PolicyConfig {
  default: 'allow' | 'deny';
  rules: PolicyRule[];
}

export interface Caller {
  id: string;
  type: ActorType;
  token?: string;
  token_env?: string;
  scopes: string[];
}

export interface RateLimitConfig {
  requests_per_minute: number;
  burst: number;
}

export interface RedactionConfig {
  patterns: ('email' | 'phone' | 'ssn' | 'credit_card')[];
  keys: string[];
  replacement: string;
}

export interface GatewayConfig {
  port: number;
  audit_log_path: string;
  rate_limit: RateLimitConfig;
  max_response_bytes: number;
  request_timeout_ms: number;
  servers: Record<string, { base_url: string }>;
  callers: Caller[];
  redaction: RedactionConfig;
}

export interface RegistrySnapshot {
  tools: ToolsConfig;
  policy: PolicyConfig;
  gateway: GatewayConfig;
}
