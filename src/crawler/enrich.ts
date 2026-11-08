// AI-powered tool description enrichment using Anthropic API
// Control plane component

import type { Tool } from '../types.js';

export async function enrichToolDescriptions(
  tools: Tool[],
  options?: { concurrency?: number }
): Promise<Tool[]> {
  const concurrency = options?.concurrency ?? 4;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required for --enrich');
  }

  // Dynamically import @anthropic-ai/sdk only when needed
  let Anthropic: any;
  try {
    Anthropic = (await import('@anthropic-ai/sdk')).default;
  } catch {
    throw new Error('@anthropic-ai/sdk is not installed. Install it with: npm install @anthropic-ai/sdk');
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const client = new Anthropic({ apiKey });

  const enrichedTools = [...tools];

  async function processBatch(batch: Tool[]): Promise<void> {
    await Promise.all(
      batch.map(async (tool) => {
        try {
          const message = await client.messages.create({
            model,
            max_tokens: 100,
            messages: [
              {
                role: 'user',
                content: `Write a 1-2 sentence agent-oriented description for this tool. Focus on what it does and when an agent would use it. Be concise.

Method: ${tool.request.method}
Path: ${tool.request.path}
Parameters: ${[...tool.request.path_params, ...tool.request.query_params].join(', ') || 'none'}
Original description: ${tool.description}

Return only the description, no other text.`,
              },
            ],
          });

          const newDescription = message.content[0]?.type === 'text' ? message.content[0].text.trim() : tool.description;
          if (newDescription) {
            const idx = enrichedTools.findIndex(t => t.id === tool.id);
            if (idx !== -1) {
              enrichedTools[idx] = { ...enrichedTools[idx], description: newDescription };
            }
          }
        } catch (error) {
          console.warn(`Failed to enrich tool ${tool.id}: ${error instanceof Error ? error.message : String(error)}`);
          // Keep original description on failure
        }
      })
    );
  }

  // Process in batches
  for (let i = 0; i < enrichedTools.length; i += concurrency) {
    const batch = enrichedTools.slice(i, i + concurrency);
    await processBatch(batch);
  }

  return enrichedTools;
}
