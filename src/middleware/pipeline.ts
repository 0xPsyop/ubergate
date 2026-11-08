// Pipeline orchestration for invoke_tool
// Data plane component

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { Tool, Caller, RegistrySnapshot } from '../types.js';
import { RateLimiter } from './ratelimit.js';
import { evaluate } from './policy.js';
import { redact } from './redact.js';
import { AuditLogger, type AuditDecision } from './audit.js';
import { project } from '../gateway/projection.js';
import { executeTool } from '../gateway/executor.js';

const ajv = new Ajv.default({ allErrors: false, strict: false });
addFormats.default(ajv);

export interface PipelineOptions {
  tool: Tool;
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
  decision?: AuditDecision;
  reason?: string;
  status?: number;
  redactions?: number;
}

const schemaCache = new Map<string, Ajv.ValidateFunction>();

function getValidator(toolId: string, sourceHash: string, schema: Record<string, unknown>): Ajv.ValidateFunction {
  const cacheKey = `${toolId}:${sourceHash}`;
  let validator = schemaCache.get(cacheKey);

  if (!validator) {
    validator = ajv.compile(schema);
    if (!validator) {
      throw new Error('Failed to compile schema validator');
    }
    schemaCache.set(cacheKey, validator);
  }

  return validator;
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const startTime = Date.now();
  const { tool, caller, arguments: args, fields, snapshot, rateLimiter, auditLogger } = options;

  // Rate limit
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
      tool.id,
      tool.risk
    );
    auditLogger.log(record);
    return {
      success: false,
      error: 'Rate limit exceeded',
      decision: 'rate_limited',
      reason: 'Rate limit exceeded',
    };
  }

  // Lookup tool
  if (!tool.enabled || tool.deprecated || tool.needs_review) {
    const duration = Date.now() - startTime;
    const record = auditLogger.createRecord(
      caller.id,
      caller.type,
      'invoke_tool',
      'not_found',
      'Tool not available',
      duration,
      0,
      args,
      tool.id,
      tool.risk
    );
    auditLogger.log(record);
    return {
      success: false,
      error: 'Tool not found or not available',
      decision: 'not_found',
      reason: 'Tool not available',
    };
  }

  // Policy check
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

  // Validate arguments
  const validator = getValidator(tool.id, tool.source_hash, tool.input_schema);
  if (!validator(args || {})) {
    const duration = Date.now() - startTime;
    const errorMessage = validator.errors ? validator.errors[0]?.message : 'Invalid arguments';
    const record = auditLogger.createRecord(
      caller.id,
      caller.type,
      'invoke_tool',
      'invalid_args',
      errorMessage || 'Invalid arguments',
      duration,
      0,
      args,
      tool.id,
      tool.risk
    );
    auditLogger.log(record);
    return {
      success: false,
      error: errorMessage || 'Invalid arguments',
      decision: 'invalid_args',
      reason: errorMessage || 'Invalid arguments',
    };
  }

  // Execute
  let execResult: { data: unknown; status: number };
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

  // Redact full response
  const redactResult = redact(execResult.data, snapshot.gateway.redaction);

  // Apply projection
  const projected = fields ? project(redactResult.value, fields) : redactResult.value;

  // Size check
  const sizeBytes = JSON.stringify(projected).length;
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
      tool.risk
    );
    auditLogger.log(record);
    return {
      success: false,
      error: 'Response too large',
      decision: 'error',
      reason: 'Response too large',
    };
  }

  // Success audit
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
