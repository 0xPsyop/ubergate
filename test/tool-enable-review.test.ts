import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import {
  analyzeToolEnableDiff,
  runCli,
} from '../.claude/skills/tool-enable-review/scripts/check-tool-diff.js';

interface MutableToolsConfig {
  version: 1;
  tools: Array<Record<string, unknown>>;
}

interface MutablePolicy {
  default: 'allow' | 'deny';
  rules: Array<Record<string, unknown>>;
}

const fixturesDir = fileURLToPath(new URL('../.claude/skills/tool-enable-review/examples/fixtures/', import.meta.url));

function readFixture<T>(name: string): T {
  return parseYaml(fs.readFileSync(path.join(fixturesDir, name), 'utf8')) as T;
}

function baseCase() {
  return {
    base: readFixture<MutableToolsConfig>('base-tools.yaml'),
    head: readFixture<MutableToolsConfig>('head-tools.yaml'),
    policy: readFixture<MutablePolicy>('policy.yaml'),
  };
}

function onlyTool(config: MutableToolsConfig): Record<string, unknown> {
  return config.tools[0];
}

describe('tool-enable review checker', () => {
  it('passes a clean reviewed enable and reports matching policy for each actor type', () => {
    const { base, head, policy } = baseCase();
    const report = analyzeToolEnableDiff(base, head, policy);

    expect(report.failures).toBe(0);
    expect(report.warnings).toBe(0);
    expect(report.enabledTools).toHaveLength(1);
    expect(report.enabledTools[0]).toMatchObject({
      ownerPresent: true,
      needsReview: false,
      sourceHashChanged: false,
      risk: 'read',
      explicitPolicyRule: true,
    });
    expect(report.enabledTools[0].policyByActor.human.firstMatch?.effect).toBe('allow');
    expect(report.enabledTools[0].policyByActor.service.firstMatch?.effect).toBe('allow');
    expect(report.enabledTools[0].policyByActor.agent.firstMatch?.effect).toBe('allow');
  });

  it('fails when owner is missing or unassigned', () => {
    const { base, head, policy } = baseCase();
    delete onlyTool(head).owner;

    const report = analyzeToolEnableDiff(base, head, policy);

    expect(report.failures).toBe(1);
    expect(report.enabledTools[0].findings.map(finding => finding.code)).toContain('missing-owner');
  });

  it('fails when the tool is enabled while needs_review is true', () => {
    const { base, head, policy } = baseCase();
    onlyTool(head).needs_review = true;

    const report = analyzeToolEnableDiff(base, head, policy);

    expect(report.failures).toBe(1);
    expect(report.enabledTools[0].findings.map(finding => finding.code)).toContain('needs-review');
  });

  it('fails when source_hash changed but the enabled tool was not marked for review', () => {
    const { base, head, policy } = baseCase();
    onlyTool(head).source_hash = 'source-v2';

    const report = analyzeToolEnableDiff(base, head, policy);

    expect(report.failures).toBe(1);
    expect(report.enabledTools[0].sourceHashChanged).toBe(true);
    expect(report.enabledTools[0].findings.map(finding => finding.code)).toContain('changed-source-without-review');
  });

  it('fails for a destructive tool that has no explicit applicable policy rule', () => {
    const { base, head, policy } = baseCase();
    onlyTool(base).risk = 'destructive';
    onlyTool(head).risk = 'destructive';
    policy.rules = [];

    const report = analyzeToolEnableDiff(base, head, policy);

    expect(report.failures).toBe(1);
    expect(report.enabledTools[0].explicitPolicyRule).toBe(false);
    expect(report.enabledTools[0].findings.map(finding => finding.code)).toContain('destructive-without-policy');
  });

  it('warns when a write tool has no matching agent rule', () => {
    const { base, head, policy } = baseCase();
    onlyTool(base).risk = 'write';
    onlyTool(head).risk = 'write';
    policy.rules = [{
      actors: ['human', 'service'],
      risk: ['write'],
      effect: 'allow',
      tools: ['demo.*'],
    }];

    const report = analyzeToolEnableDiff(base, head, policy);

    expect(report.failures).toBe(0);
    expect(report.warnings).toBe(1);
    expect(report.enabledTools[0].findings.map(finding => finding.code)).toContain('write-without-agent-rule');
  });

  it('warns when later matching policy rules are shadowed for an actor', () => {
    const { base, head, policy } = baseCase();
    policy.rules.push({
      actors: ['human'],
      risk: ['read'],
      effect: 'deny',
      tools: ['demo.read*'],
    });

    const report = analyzeToolEnableDiff(base, head, policy);
    const review = report.enabledTools[0];

    expect(report.warnings).toBe(1);
    expect(review.policyByActor.human.matchingRuleIndexes).toEqual([0, 1]);
    expect(review.policyByActor.human.firstMatch?.effect).toBe('allow');
    expect(review.findings.map(finding => finding.code)).toContain('shadowed-policy-rules');
  });

  it('uses first-match-wins for conflicting allow and deny rules', () => {
    const { base, head, policy } = baseCase();
    policy.rules = [
      { actors: ['human'], risk: ['read'], effect: 'deny', tools: ['demo.read*'] },
      { actors: ['human'], risk: ['read'], effect: 'allow', tools: ['demo.*'] },
    ];

    const report = analyzeToolEnableDiff(base, head, policy);

    expect(report.enabledTools[0].policyByActor.human.firstMatch?.effect).toBe('deny');
    expect(report.enabledTools[0].policyByActor.human.decisionWithoutScopes).toBe('policy deny');
    expect(report.enabledTools[0].findings.map(finding => finding.code)).toContain('shadowed-policy-rules');
  });

  it('rejects unknown configuration fields instead of silently ignoring them', () => {
    const { base, head, policy } = baseCase();
    (head as unknown as Record<string, unknown>).unexpected = true;

    expect(() => analyzeToolEnableDiff(base, head, policy)).toThrow(/unknown field.*unexpected/);
  });

  it('returns a clear nonzero CLI result for malformed YAML', () => {
    const { base, policy } = baseCase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-review-yaml-'));
    const basePath = path.join(tempDir, 'base.yaml');
    const headPath = path.join(tempDir, 'head.yaml');
    const policyPath = path.join(tempDir, 'policy.yaml');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      fs.writeFileSync(basePath, stringifyYaml(base));
      fs.writeFileSync(headPath, 'version: [unterminated');
      fs.writeFileSync(policyPath, stringifyYaml(policy));

      expect(runCli([basePath, headPath, policyPath])).toBe(2);
      expect(errors.mock.calls.flat().join(' ')).toContain('Malformed YAML in');
    } finally {
      errors.mockRestore();
      vi.restoreAllMocks();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
