#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { evaluate, matchesGlob } from '../../../../src/middleware/policy.js';
import {
  PolicyConfigSchema,
  ToolsConfigSchema,
  type ActorType,
  type PolicyConfig,
  type Tool,
  type ToolsConfig,
} from '../../../../src/registry/schema.js';

const ACTOR_TYPES: ActorType[] = ['human', 'service', 'agent'];
const TOOL_FIELDS = [
  'id', 'server', 'description', 'risk', 'owner', 'enabled', 'needs_review',
  'deprecated', 'source_hash', 'request', 'input_schema',
];
const REQUEST_FIELDS = ['method', 'path', 'path_params', 'query_params', 'has_body'];
const ROOT_TOOL_FIELDS = ['version', 'tools'];
const ROOT_POLICY_FIELDS = ['default', 'rules'];
const POLICY_RULE_FIELDS = ['actors', 'risk', 'tools', 'effect', 'require_scope'];

export type FindingSeverity = 'FAIL' | 'WARN';

export interface ToolDiffFinding {
  severity: FindingSeverity;
  code: string;
  message: string;
}

export interface ActorPolicyResult {
  matchingRuleIndexes: number[];
  firstMatch?: {
    effect: 'allow' | 'deny';
    requireScope?: string;
  };
  decisionWithoutScopes: string;
}

export interface EnabledToolReview {
  id: string;
  owner: string;
  ownerPresent: boolean;
  needsReview: boolean;
  sourceHashChanged: boolean | null;
  risk: Tool['risk'];
  explicitPolicyRule: boolean;
  policyByActor: Record<ActorType, ActorPolicyResult>;
  findings: ToolDiffFinding[];
}

export interface ToolDiffReport {
  enabledTools: EnabledToolReview[];
  failures: number;
  warnings: number;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a YAML mapping`);
  }
}

function assertKnownFields(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknownFields = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknownFields.length > 0) {
    throw new Error(`${label} contains unknown field(s): ${unknownFields.join(', ')}`);
  }
}

function parseYamlFile(filePath: string): unknown {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return parseYaml(contents, { prettyErrors: true });
  } catch (error) {
    throw new Error(`Malformed YAML in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateToolsConfig(value: unknown, label: string): ToolsConfig {
  assertRecord(value, label);
  assertKnownFields(value, ROOT_TOOL_FIELDS, label);
  if (Array.isArray(value.tools)) {
    for (let index = 0; index < value.tools.length; index++) {
      const toolLabel = `${label}.tools[${index}]`;
      const rawTool = value.tools[index];
      assertRecord(rawTool, toolLabel);
      assertKnownFields(rawTool, TOOL_FIELDS, toolLabel);
      if (rawTool.request !== undefined) {
        assertRecord(rawTool.request, `${toolLabel}.request`);
        assertKnownFields(rawTool.request, REQUEST_FIELDS, `${toolLabel}.request`);
      }
    }
  }

  const result = ToolsConfigSchema.safeParse(value);
  if (!result.success) {
    const errors = result.error.issues
      .map(issue => `${issue.path.join('.') || label}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid ${label}: ${errors}`);
  }

  const ids = new Set<string>();
  for (const tool of result.data.tools) {
    if (ids.has(tool.id)) {
      throw new Error(`${label} contains duplicate tool ID: ${tool.id}`);
    }
    ids.add(tool.id);
  }
  return result.data;
}

function validatePolicyConfig(value: unknown, label: string): PolicyConfig {
  assertRecord(value, label);
  assertKnownFields(value, ROOT_POLICY_FIELDS, label);
  if (Array.isArray(value.rules)) {
    for (let index = 0; index < value.rules.length; index++) {
      const ruleLabel = `${label}.rules[${index}]`;
      const rule = value.rules[index];
      assertRecord(rule, ruleLabel);
      assertKnownFields(rule, POLICY_RULE_FIELDS, ruleLabel);
    }
  }

  const result = PolicyConfigSchema.safeParse(value);
  if (!result.success) {
    const errors = result.error.issues
      .map(issue => `${issue.path.join('.') || label}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid ${label}: ${errors}`);
  }
  return result.data;
}

function matchingRuleIndexes(policy: PolicyConfig, actor: ActorType, tool: Tool): number[] {
  const matches: number[] = [];

  policy.rules.forEach((rule, index) => {
    if (!rule.actors.includes(actor) || !rule.risk.includes(tool.risk)) {
      return;
    }
    if (rule.tools && rule.tools.length > 0 && !rule.tools.some(pattern => matchesGlob(pattern, tool.id))) {
      return;
    }
    matches.push(index);
  });

  return matches;
}

function getActorPolicyResult(policy: PolicyConfig, actor: ActorType, tool: Tool): ActorPolicyResult {
  const indexes = matchingRuleIndexes(policy, actor, tool);
  const firstRuleIndex = indexes[0];
  const firstRule = firstRuleIndex === undefined ? undefined : policy.rules[firstRuleIndex];
  const decision = evaluate(policy, { id: `review-${actor}`, type: actor, scopes: [] }, tool);

  return {
    matchingRuleIndexes: indexes,
    firstMatch: firstRule
      ? { effect: firstRule.effect, requireScope: firstRule.require_scope }
      : undefined,
    decisionWithoutScopes: decision.reason,
  };
}

export function analyzeToolEnableDiff(
  baseValue: unknown,
  headValue: unknown,
  policyValue: unknown
): ToolDiffReport {
  const baseConfig = validateToolsConfig(baseValue, 'base tools configuration');
  const headConfig = validateToolsConfig(headValue, 'head tools configuration');
  const policy = validatePolicyConfig(policyValue, 'policy configuration');
  const baseById = new Map(baseConfig.tools.map(tool => [tool.id, tool]));
  const rawHeadTools = (headValue as { tools: Array<Record<string, unknown>> }).tools;
  const enabledTools: EnabledToolReview[] = [];

  headConfig.tools.forEach(tool => {
    const baseTool = baseById.get(tool.id);
    if (!baseTool || baseTool.enabled || !tool.enabled) {
      return;
    }

    const rawTool = rawHeadTools.find(candidate => candidate.id === tool.id);
    if (!rawTool) {
      throw new Error(`Could not locate raw head configuration for tool ${tool.id}`);
    }

    const owner = typeof rawTool.owner === 'string' ? rawTool.owner.trim() : '';
    const ownerPresent = owner.length > 0 && owner.toLowerCase() !== 'unassigned';
    const sourceHashChanged = baseTool.source_hash === tool.source_hash ? false : true;
    const policyByActor = Object.fromEntries(
      ACTOR_TYPES.map(actor => [actor, getActorPolicyResult(policy, actor, tool)])
    ) as Record<ActorType, ActorPolicyResult>;
    const hasExplicitPolicyRule = ACTOR_TYPES.some(
      actor => policyByActor[actor].matchingRuleIndexes.length > 0
    );
    const findings: ToolDiffFinding[] = [];
    const addFinding = (severity: FindingSeverity, code: string, message: string) => {
      findings.push({ severity, code, message });
    };

    if (!ownerPresent) {
      addFinding('FAIL', 'missing-owner', 'Tool owner is missing, blank, or unassigned.');
    }
    if (tool.needs_review) {
      addFinding('FAIL', 'needs-review', 'Tool is enabled while needs_review is true.');
    }
    if (sourceHashChanged && !tool.needs_review) {
      addFinding('FAIL', 'changed-source-without-review', 'source_hash changed while the tool is enabled without needs_review.');
    }
    if (tool.risk === 'destructive' && !hasExplicitPolicyRule) {
      addFinding('FAIL', 'destructive-without-policy', 'Destructive tool has no matching explicit policy rule for any caller type.');
    }
    if (tool.risk === 'write' && policyByActor.agent.matchingRuleIndexes.length === 0) {
      addFinding('WARN', 'write-without-agent-rule', 'Write-tier tool has no matching policy rule for agents.');
    }

    const shadowedRules = ACTOR_TYPES.flatMap(actor => {
      const indexes = policyByActor[actor].matchingRuleIndexes;
      return indexes.length > 1
        ? [{ actor, first: indexes[0] + 1, shadowed: indexes.slice(1).map(index => index + 1) }]
        : [];
    });
    if (shadowedRules.length > 0) {
      const details = shadowedRules
        .map(item => `${item.actor}: rule ${item.first} shadows rule(s) ${item.shadowed.join(', ')}`)
        .join('; ');
      addFinding('WARN', 'shadowed-policy-rules', `First-match-wins ordering shadows later matching rules (${details}).`);
    }

    enabledTools.push({
      id: tool.id,
      owner,
      ownerPresent,
      needsReview: tool.needs_review,
      sourceHashChanged,
      risk: tool.risk,
      explicitPolicyRule: hasExplicitPolicyRule,
      policyByActor,
      findings,
    });
  });

  return {
    enabledTools,
    failures: enabledTools.reduce(
      (count, review) => count + review.findings.filter(finding => finding.severity === 'FAIL').length,
      0
    ),
    warnings: enabledTools.reduce(
      (count, review) => count + review.findings.filter(finding => finding.severity === 'WARN').length,
      0
    ),
  };
}

function renderText(report: ToolDiffReport): string {
  if (report.enabledTools.length === 0) {
    return 'No tools changed from enabled: false to enabled: true.';
  }

  const lines: string[] = [];
  for (const review of report.enabledTools) {
    lines.push(`${review.id} [${review.risk}]`);
    lines.push(`  owner present: ${review.ownerPresent}${review.owner ? ` (${review.owner})` : ''}`);
    lines.push(`  needs_review: ${review.needsReview}`);
    lines.push(`  source_hash changed: ${review.sourceHashChanged === null ? 'not applicable' : review.sourceHashChanged}`);
    lines.push(`  explicit policy rule: ${review.explicitPolicyRule}`);
    for (const actor of ACTOR_TYPES) {
      const actorResult = review.policyByActor[actor];
      const matched = actorResult.matchingRuleIndexes.map(index => index + 1);
      const firstMatch = actorResult.firstMatch
        ? `rule ${matched[0]} ${actorResult.firstMatch.effect}${actorResult.firstMatch.requireScope ? ` (requires scope: ${actorResult.firstMatch.requireScope})` : ''}`
        : 'no explicit matching rule';
      lines.push(`  ${actor}: ${firstMatch}; effective with no scopes: ${actorResult.decisionWithoutScopes}`);
    }
    for (const finding of review.findings) {
      lines.push(`  ${finding.severity}: ${finding.message}`);
    }
  }

  lines.push(`Summary: ${report.enabledTools.length} newly enabled; ${report.failures} failure(s); ${report.warnings} warning(s).`);
  lines.push('Note: gateway.yaml is not an input; configured caller scopes cannot be verified.');
  return lines.join('\n');
}

function usage(): string {
  return [
    'Usage: check-tool-diff.ts <base-tools.yaml> <head-tools.yaml> <policy.yaml> [--json]',
    'Checks tools changed from enabled: false to enabled: true.',
    'Policy scope decisions are shown with no scopes because gateway.yaml is not an input.',
  ].join('\n');
}

export function runCli(args: string[]): number {
  const json = args.includes('--json');
  const positional = args.filter(argument => argument !== '--json');
  if (positional.includes('--help') || positional.includes('-h')) {
    console.log(usage());
    return 0;
  }
  if (positional.length !== 3) {
    console.error(usage());
    return 2;
  }

  const [basePath, headPath, policyPath] = positional.map(filePath => path.resolve(filePath));
  try {
    const report = analyzeToolEnableDiff(
      parseYamlFile(basePath),
      parseYamlFile(headPath),
      parseYamlFile(policyPath)
    );
    console.log(json ? JSON.stringify(report, null, 2) : renderText(report));
    return report.failures > 0 ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
