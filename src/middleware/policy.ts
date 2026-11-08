// Policy evaluation with first-match-wins logic
// Data plane component

import type { PolicyConfig, Tool, Caller } from '../types.js';

export interface PolicyEvaluationOptions {
  ignoreScope?: boolean;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  reason: string;
}

export function matchesGlob(pattern: string, text: string): boolean {
  // Escape regex special chars except * and ?
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexPattern = escaped
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(text);
}

export function evaluate(
  policy: PolicyConfig,
  caller: Caller,
  tool: Tool,
  opts?: PolicyEvaluationOptions
): PolicyEvaluationResult {
  const ignoreScope = opts?.ignoreScope ?? false;

  for (const rule of policy.rules) {
    // Check actor type
    if (!rule.actors.includes(caller.type)) {
      continue;
    }

    // Check risk
    if (!rule.risk.includes(tool.risk)) {
      continue;
    }

    // Check tool glob pattern if specified
    if (rule.tools && rule.tools.length > 0) {
      const matchesTool = rule.tools.some(pattern => matchesGlob(pattern, tool.id));
      if (!matchesTool) {
        continue;
      }
    }

    // Rule matches - check scope if required
    if (rule.require_scope && !ignoreScope) {
      if (!caller.scopes.includes(rule.require_scope)) {
        return {
          allowed: false,
          reason: `missing scope: ${rule.require_scope}`,
        };
      }
    }

    // Rule matches and scope check passed
    return {
      allowed: rule.effect === 'allow',
      reason: rule.effect === 'allow' ? 'policy allow' : 'policy deny',
    };
  }

  // No rule matched - use default
  return {
    allowed: policy.default === 'allow',
    reason: policy.default === 'allow' ? 'default allow' : 'default deny',
  };
}
