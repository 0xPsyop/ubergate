// Registry schema definitions using Zod
// This is the shared contract between control plane and data plane

import { z } from 'zod';

// Helper schemas
const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const RiskSchema = z.enum(['read', 'write', 'destructive']);
const ActorTypeSchema = z.enum(['human', 'service', 'agent']);
const PolicyEffectSchema = z.enum(['allow', 'deny']);

const ToolRequestSchema = z.object({
  method: HttpMethodSchema,
  path: z.string(),
  path_params: z.array(z.string()),
  query_params: z.array(z.string()),
  has_body: z.boolean(),
});

const ToolSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  server: z.string(),
  description: z.string(),
  risk: RiskSchema,
  owner: z.string().default('unassigned'),
  enabled: z.boolean().default(false),
  needs_review: z.boolean().default(false),
  deprecated: z.boolean().default(false),
  source_hash: z.string(),
  request: ToolRequestSchema,
  input_schema: z.record(z.unknown()),
});

const ToolsConfigSchema = z.object({
  version: z.literal(1),
  tools: z.array(ToolSchema),
});

const PolicyRuleSchema = z.object({
  actors: z.array(ActorTypeSchema),
  risk: z.array(RiskSchema),
  tools: z.array(z.string()).optional(),
  effect: PolicyEffectSchema,
  require_scope: z.string().optional(),
}).strict();

const PolicyConfigSchema = z.object({
  default: z.enum(['allow', 'deny']),
  rules: z.array(PolicyRuleSchema),
}).strict();

const RateLimitConfigSchema = z.object({
  requests_per_minute: z.number().positive(),
  burst: z.number().positive(),
});

const RedactionConfigSchema = z.object({
  patterns: z.array(z.enum(['email', 'phone', 'ssn', 'credit_card'])),
  keys: z.array(z.string()),
  replacement: z.string(),
});

const CallerSchema = z.object({
  id: z.string(),
  type: ActorTypeSchema,
  token: z.string().optional(),
  token_env: z.string().optional(),
  scopes: z.array(z.string()),
});

const GatewayConfigSchema = z.object({
  port: z.number().positive(),
  audit_log_path: z.string(),
  rate_limit: RateLimitConfigSchema,
  max_response_bytes: z.number().positive(),
  request_timeout_ms: z.number().positive(),
  servers: z.record(z.object({ base_url: z.string() })),
  callers: z.array(CallerSchema),
  redaction: RedactionConfigSchema,
});

const RegistrySnapshotSchema = z.object({
  tools: ToolsConfigSchema,
  policy: PolicyConfigSchema,
  gateway: GatewayConfigSchema,
});

// Inferred types from Zod schemas (output types)
export type Tool = z.output<typeof ToolSchema>;
export type ToolsConfig = z.output<typeof ToolsConfigSchema>;
export type PolicyRule = z.output<typeof PolicyRuleSchema>;
export type PolicyConfig = z.output<typeof PolicyConfigSchema>;
export type GatewayConfig = z.output<typeof GatewayConfigSchema>;
export type Caller = z.output<typeof CallerSchema>;
export type RateLimitConfig = z.output<typeof RateLimitConfigSchema>;
export type RedactionConfig = z.output<typeof RedactionConfigSchema>;
export type ToolRequest = z.output<typeof ToolRequestSchema>;
export type HttpMethod = z.output<typeof HttpMethodSchema>;
export type Risk = z.output<typeof RiskSchema>;
export type ActorType = z.output<typeof ActorTypeSchema>;
export type PolicyEffect = z.output<typeof PolicyEffectSchema>;
export type RegistrySnapshot = z.output<typeof RegistrySnapshotSchema>;

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
