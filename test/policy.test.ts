import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/middleware/policy.js';
import { makeCaller, makeTool, makePolicy } from './helpers.js';

describe('Policy Evaluation', () => {
  it('enforces first-match-wins ordering', () => {
    // First rule allows read for humans; second rule denies read for all
    const policy = makePolicy('deny', [
      {
        actors: ['human'],
        risk: ['read'],
        effect: 'allow',
      },
      {
        actors: ['human', 'agent'],
        risk: ['read'],
        effect: 'deny',
      },
    ]);

    const human = makeCaller('alice', 'human');
    const tool = makeTool('demo.getUser', 'read');

    const result = evaluate(policy, human, tool);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('policy allow');
  });

  it('enforces require_scope and denies if caller lacks scope', () => {
    const policy = makePolicy('deny', [
      {
        actors: ['agent'],
        risk: ['write'],
        effect: 'allow',
        require_scope: 'write',
      },
    ]);

    const agentWithScope = makeCaller('agent1', 'agent', ['write']);
    const agentWithoutScope = makeCaller('agent2', 'agent', ['read']);
    const tool = makeTool('demo.createOrder', 'write');

    expect(evaluate(policy, agentWithScope, tool).allowed).toBe(true);

    const deniedResult = evaluate(policy, agentWithoutScope, tool);
    expect(deniedResult.allowed).toBe(false);
    expect(deniedResult.reason).toBe('missing scope: write');
  });

  it('bypasses scope check when ignoreScope: true is passed', () => {
    const policy = makePolicy('deny', [
      {
        actors: ['agent'],
        risk: ['write'],
        effect: 'allow',
        require_scope: 'write',
      },
    ]);

    const agentWithoutScope = makeCaller('agent2', 'agent', ['read']);
    const tool = makeTool('demo.createOrder', 'write');

    const result = evaluate(policy, agentWithoutScope, tool, { ignoreScope: true });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('policy allow');
  });

  it('falls back to default policy (allow or deny) when no rules match', () => {
    const denyPolicy = makePolicy('deny', []);
    const allowPolicy = makePolicy('allow', []);

    const caller = makeCaller('alice', 'human');
    const tool = makeTool('demo.getUser', 'read');

    const denyResult = evaluate(denyPolicy, caller, tool);
    expect(denyResult.allowed).toBe(false);
    expect(denyResult.reason).toBe('default deny');

    const allowResult = evaluate(allowPolicy, caller, tool);
    expect(allowResult.allowed).toBe(true);
    expect(allowResult.reason).toBe('default allow');
  });

  it('supports glob tool matching with * wildcard', () => {
    const policy = makePolicy('deny', [
      {
        actors: ['agent'],
        risk: ['read'],
        tools: ['demo.user.*', 'demo.list*'],
        effect: 'allow',
      },
    ]);

    const agent = makeCaller('bot', 'agent');

    expect(evaluate(policy, agent, makeTool('demo.user.get', 'read')).allowed).toBe(true);
    expect(evaluate(policy, agent, makeTool('demo.listOrders', 'read')).allowed).toBe(true);
    expect(evaluate(policy, agent, makeTool('demo.otherTool', 'read')).allowed).toBe(false);
  });
});
