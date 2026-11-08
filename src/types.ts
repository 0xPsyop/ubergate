// Shared types between control plane and data plane
// Re-exported from schema for consistency

export type {
  Risk,
  ActorType,
  HttpMethod,
  PolicyEffect,
  ToolRequest,
  Tool,
  ToolsConfig,
  PolicyRule,
  PolicyConfig,
  Caller,
  RateLimitConfig,
  RedactionConfig,
  GatewayConfig,
  RegistrySnapshot,
} from './registry/schema.js';
