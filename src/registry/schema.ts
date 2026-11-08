// Registry schema definitions using Zod
// This is the shared contract between control plane and data plane

import { z } from 'zod';
import type { Tool, ToolsConfig, PolicyConfig, GatewayConfig, PolicyRule, Caller, RateLimitConfig, RedactionConfig, ToolRequest, RegistrySnapshot } from '../types.js';

// Helper schemas
const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const RiskSchema = z.enum(['read', 'write', 'destructive']);
const ActorTypeSchema = z.enum(['human', 'service', 'agent']);
const PolicyEffectSchema = z.enum(['allow', 'deny']);

const ToolRequestSchema: z.ZodType<ToolRequest> = z.object({
  method: HttpMethodSchema,
  path: z.string(),
  path_params: z.array(z.string()),
  query_params: z.array(z.string()),
  has_body: z.boolean(),
});

const ToolSchema: z.ZodType<Tool> = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  server: z.string(),
  description: z.string(),
  risk: RiskSchema,
  owner: z.string(),
  enabled: z.boolean(),
  needs_review: z.boolean(),
  deprecated: z.boolean(),
  source_hash: z.string(),
  request: ToolRequestSchema,
  input_schema: z.record(z.unknown()),
});

const ToolsConfigSchema: z.ZodType<ToolsConfig> = z.object({
  version: z.literal(1),
  tools: z.array(ToolSchema),
});

const PolicyRuleSchema: z.ZodType<PolicyRule> = z.object({
  actors: z.array(ActorTypeSchema),
  risk: z.array(RiskSchema),
  tools: z.array(z.string()).optional(),
  effect: PolicyEffectSchema,
  require_scope: z.string().optional(),
});

const PolicyConfigSchema: z.ZodType<PolicyConfig> = z.object({
  default: z.enum(['allow', 'deny']),
  rules: z.array(PolicyRuleSchema),
});

const RateLimitConfigSchema: z.ZodType<RateLimitConfig> = z.object({
  requests_per_minute: z.number().positive(),
  burst: z.number().positive(),
});

const RedactionConfigSchema: z.ZodType<RedactionConfig> = z.object({
  patterns: z.array(z.enum(['email', 'phone', 'ssn', 'credit_card'])),
  keys: z.array(z.string()),
  replacement: z.string(),
});

const CallerSchema: z.ZodType<Caller> = z.object({
  id: z.string(),
  type: ActorTypeSchema,
  token: z.string().optional(),
  token_env: z.string().optional(),
  scopes: z.array(z.string()),
});

const GatewayConfigSchema: z.ZodType<GatewayConfig> = z.object({
  port: z.number().positive(),
  audit_log_path: z.string(),
  rate_limit: RateLimitConfigSchema,
  max_response_bytes: z.number().positive(),
  request_timeout_ms: z.number().positive(),
  servers: z.record(z.object({ base_url: z.string() })),
  callers: z.array(CallerSchema),
  redaction: RedactionConfigSchema,
});

const RegistrySnapshotSchema: z.ZodType<RegistrySnapshot> = z.object({
  tools: ToolsConfigSchema,
  policy: PolicyConfigSchema,
  gateway: GatewayConfigSchema,
});

export {
  ToolSchema,
  ToolsConfigSchema,
  PolicyRuleSchema,
  PolicyConfigSchema,
  GatewayConfigSchema,
  CallerSchema,
  RateLimitConfigSchema,
  RedactionConfigSchema,
  ToolRequestSchema,
  HttpMethodSchema,
  RiskSchema,
  ActorTypeSchema,
  PolicyEffectSchema,
  RegistrySnapshotSchema,
};
