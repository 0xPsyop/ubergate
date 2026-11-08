// Pipeline orchestration for invoke_tool
// Data plane component

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { Caller, RegistrySnapshot } from '../types.js';
import { RateLimiter } from './ratelimit.js';
import { evaluate } from './policy.js';
import { redact } from './redact.js';
import { AuditLogger, type AuditDecision } from './audit.js';
import { project } from '../gateway/projection.js';
import { executeTool } from '../gateway/executor.js';

const ajv = new (Ajv as any).default({ allErrors: false, strict: false });
(addFormats as any).default(ajv);

export interface PipelineOptions {
  toolId: string;
  caller: Caller;
  arguments: Record<string, unknown> | undefined;
  fields?: string[];
  snapshot: RegistrySnapshot;
  rateLimiter: RateLimiter;
  auditLogger: AuditLogger;
}

export interface PipelineResult {
  success: boolean;
  data?: unknown;
  error?: string;
  decision: AuditDecision;
  reason: string;
  status?: number;
  redactions?: number;
}

const schemaCache = new Map<string, any>();

function getValidator(toolId: string, sourceHash: string, schema: Record<string, unknown>): any {
  const cacheKey = `${toolId}:${sourceHash}`;
  let validator = schemaCache.get(cacheKey);

  if (!validator) {
    validator = ajv.compile(schema);
    schemaCache.set(cacheKey, validator);
  }

  return validator;
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const startTime = Date.now();
  const { toolId, caller, arguments: args, fields, snapshot, rateLimiter, auditLogger } = options;

  // 1. Rate limit check
  if (!rateLimiter.check(caller.id)) {
    const duration = Date.now() - startTime;
    const record = auditLogger.createRecord(
      caller.id,
      caller.type,
      'invoke_tool',
      'rate_limited',
      'Rate limit exceeded',
      duration,
      0,
      args,
      toolId
    );
    auditLogger.log(record);
    return {
      success: false,
      error: 'Rate limit exceeded',
      decision: 'rate_limited',
      reason: 'Rate limit exceeded',
    };
  }

  // 2. Tool lookup (enabled, non-deprecated, non-needs_review)
  const tool = snapshot.tools.tools.find(t => t.id === toolId);
  if (!tool || !tool.enabled || tool.deprecated || tool.needs_review) {
    const duration = Date.now() - startTime;
    const record = auditLogger.createRecord(
      caller.id,
      caller.type,
      'invoke_tool',
      'not_found',
      'Tool not found or not available',
      duration,
      0,
      args,
      toolId,
      tool?.risk
    );
    auditLogger.log(record);
    return {
      success: false,
      error: 'Tool not found or not available',
      decision: 'not_found',
      reason: 'Tool not found or not available',
    };
  }

  // 3. Policy check
  const policyResult = evaluate(snapshot.policy, caller, tool);
  if (!policyResult.allowed) {
    const duration = Date.now() - startTime;
    const record = auditLogger.createRecord(
      caller.id,
      caller.type,
      'invoke_tool',
      'deny',
      policyResult.reason,
      duration,
      0,
      args,
      tool.id,
      tool.risk
    );
    auditLogger.log(record);
    return {
      success: false,
      error: policyResult.reason,
      decision: 'deny',
      reason: policyResult.reason,
    };
  }

  // 4. Validate arguments against input_schema
  const validator = getValidator(tool.id, tool.source_hash, tool.input_schema);
  const valid = validator(args || {});
  if (!valid) {
    const duration = Date.now() - startTime;
    const errorMessage = validator.errors && validator.errors.length > 0
      ? `${validator.errors[0].instancePath || 'arguments'} ${validator.errors[0].message}`
      : 'Invalid arguments';
    const record = auditLogger.createRecord(
      caller.id,
      caller.type,
      'invoke_tool',
      'invalid_args',
      errorMessage,
      duration,
      0,
      args,
      tool.id,
      tool.risk
    );
    auditLogger.log(record);
    return {
      success: false,
      error: `Invalid arguments: ${errorMessage}`,
      decision: 'invalid_args',
      reason: errorMessage,
    };
  }

  // 5. Execute downstream
  let execResult: { data: unknown; status: number; isError: boolean };
  try {
    execResult = await executeTool(tool, args || {}, snapshot.gateway);
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Execution failed';
    const record = auditLogger.createRecord(
      caller.id,
      caller.type,
      'invoke_tool',
      'error',
      errorMessage,
      duration,
      0,
      args,
      tool.id,
      tool.risk
    );
    auditLogger.log(record);
    return {
      success: false,
      error: 'Internal gateway error',
      decision: 'error',
      reason: errorMessage,
    };
  }

  // 6. Redact full response
  const redactResult = redact(execResult.data, snapshot.gateway.redaction);

  // Handle downstream non-2xx
  if (execResult.isError) {
    const duration = Date.now() - startTime;
    const bodyStr = typeof redactResult.value === 'string'
      ? redactResult.value
      : JSON.stringify(redactResult.value);
    const truncatedBody = bodyStr.length > 500 ? bodyStr.slice(0, 500) + '...' : bodyStr;
    const errorMsg = `Downstream HTTP ${execResult.status}: ${truncatedBody}`;

    const record = auditLogger.createRecord(
      caller.id,
      caller.type,
      'invoke_tool',
      'error',
      errorMsg,
      duration,
      redactResult.count,
      args,
      tool.id,
      tool.risk,
      execResult.status
    );
    auditLogger.log(record);
    return {
      success: false,
      error: errorMsg,
      decision: 'error',
      reason: errorMsg,
      status: execResult.status,
      redactions: redactResult.count,
    };
  }

  // 7. Apply projection
  const projected = fields && fields.length > 0
    ? project(redactResult.value, fields)
    : redactResult.value;

  // 8. Size check
  const projectedStr = JSON.stringify(projected);
  const sizeBytes = Buffer.byteLength(projectedStr, 'utf8');
  if (sizeBytes > snapshot.gateway.max_response_bytes) {
    const duration = Date.now() - startTime;
    const record = auditLogger.createRecord(
      caller.id,
      caller.type,
      'invoke_tool',
      'error',
      'Response too large',
      duration,
      redactResult.count,
      args,
      tool.id,
      tool.risk,
      execResult.status
    );
    auditLogger.log(record);
    return {
      success: false,
      error: 'Response too large',
      decision: 'error',
      reason: 'Response too large',
      status: execResult.status,
      redactions: redactResult.count,
    };
  }

  // 9. Success audit
  const duration = Date.now() - startTime;
  const record = auditLogger.createRecord(
    caller.id,
    caller.type,
    'invoke_tool',
    'allow',
    'Allowed',
    duration,
    redactResult.count,
    args,
    tool.id,
    tool.risk,
    execResult.status
  );
  auditLogger.log(record);

  return {
    success: true,
    data: projected,
    decision: 'allow',
    reason: 'Allowed',
    status: execResult.status,
    redactions: redactResult.count,
  };
}
