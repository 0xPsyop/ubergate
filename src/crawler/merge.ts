// Merge logic for "discovery is not exposure" - human edits preserved on unchanged tools
// Control plane component

import type { Tool } from '../types.js';

export interface MergeResult {
  new: number;
  unchanged: number;
  changed: number;
  deprecated: number;
}

export function mergeTools(
  existingTools: Tool[],
  crawledTools: Tool[],
  serverName: string,
  owner: string
): { tools: Tool[]; result: MergeResult } {
  const existingMap = new Map(existingTools.map(t => [t.id, t]));
  const crawledMap = new Map(crawledTools.map(t => [t.id, t]));

  const result: MergeResult = {
    new: 0,
    unchanged: 0,
    changed: 0,
    deprecated: 0,
  };

  const merged: Tool[] = [];

  // Process crawled tools
  for (const [id, crawled] of crawledMap) {
    const existing = existingMap.get(id);

    if (!existing) {
      // New tool
      merged.push({
        ...crawled,
        enabled: false,
        needs_review: false,
        owner,
      });
      result.new++;
    } else if (existing.source_hash === crawled.source_hash) {
      // Unchanged - preserve all human edits
      merged.push(existing);
      result.unchanged++;
    } else {
      // Changed - reset to disabled, mark for review, preserve owner
      merged.push({
        ...crawled,
        owner: existing.owner,
        enabled: false,
        needs_review: true,
      });
      result.changed++;
    }
  }

  // Process existing tools that are missing from crawl (same server only)
  for (const [id, existing] of existingMap) {
    if (existing.server === serverName && !crawledMap.has(id)) {
      // Tool removed from spec - mark as deprecated
      merged.push({
        ...existing,
        deprecated: true,
        enabled: false,
      });
      result.deprecated++;
    } else if (existing.server !== serverName) {
      // Other servers - keep as-is
      merged.push(existing);
    }
  }

  // Sort by id for stable diffs
  merged.sort((a, b) => a.id.localeCompare(b.id));

  return { tools: merged, result };
}
