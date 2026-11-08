// Discovery logic for search_tools and get_schema
// Data plane component

import type { Tool, RegistrySnapshot, Caller } from '../types.js';
import { evaluate } from '../middleware/policy.js';

export interface SearchResult {
  id: string;
  server: string;
  risk: string;
  description: string;
}

export interface SchemaResult {
  id: string;
  description: string;
  risk: string;
  input_schema: Record<string, unknown>;
}

function scoreTool(tool: Tool, query: string): number {
  const queryLower = query.toLowerCase();
  const idLower = tool.id.toLowerCase();
  const serverLower = tool.server.toLowerCase();
  const descriptionLower = tool.description.toLowerCase();

  let score = 0;

  // Exact match on id gets highest score
  if (idLower === queryLower) {
    score += 100;
  }

  // Word matches
  const queryWords = queryLower.split(/\s+/);
  const idWords = idLower.split(/[^a-z0-9]+/);
  const serverWords = serverLower.split(/[^a-z0-9]+/);
  const descriptionWords = descriptionLower.split(/\s+/);

  for (const word of queryWords) {
    if (idWords.includes(word)) score += 5;
    if (serverWords.includes(word)) score += 3;
    if (descriptionWords.includes(word)) score += 2;
  }

  return score;
}

export function searchTools(
  snapshot: RegistrySnapshot,
  caller: Caller,
  query: string,
  limit: number
): SearchResult[] {
  const results: Array<{ tool: Tool; score: number }> = [];

  for (const tool of snapshot.tools.tools) {
    // Only consider enabled, non-deprecated, non-needs_review tools
    if (!tool.enabled || tool.deprecated || tool.needs_review) {
      continue;
    }

    // Check policy (ignore scope requirements for search)
    const policyResult = evaluate(snapshot.policy, caller, tool, { ignoreScope: true });
    if (!policyResult.allowed) {
      continue;
    }

    const score = scoreTool(tool, query);
    if (score > 0) {
      results.push({ tool, score });
    }
  }

  // Sort by score (descending), then by id for ties
  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.tool.id.localeCompare(b.tool.id);
  });

  // Return top results
  return results.slice(0, limit).map(r => ({
    id: r.tool.id,
    server: r.tool.server,
    risk: r.tool.risk,
    description: r.tool.description,
  }));
}

export function getSchema(
  snapshot: RegistrySnapshot,
  caller: Caller,
  toolId: string
): SchemaResult | null {
  const tool = snapshot.tools.tools.find(t => t.id === toolId);

  if (!tool) {
    return null;
  }

  // Check visibility
  if (!tool.enabled || tool.deprecated || tool.needs_review) {
    return null;
  }

  // Check policy (ignore scope requirements for schema)
  const policyResult = evaluate(snapshot.policy, caller, tool, { ignoreScope: true });
  if (!policyResult.allowed) {
    return null;
  }

  return {
    id: tool.id,
    description: tool.description,
    risk: tool.risk,
    input_schema: tool.input_schema,
  };
}
