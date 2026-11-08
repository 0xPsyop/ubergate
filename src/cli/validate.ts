// CLI command for validating configuration
// Control plane component

import { loadConfigDir } from '../registry/loader.js';

export interface ValidateOptions {
  configDir?: string;
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  const configDir = options.configDir ?? 'config';

  try {
    const snapshot = loadConfigDir(configDir);

    const errors: string[] = [];

    // Check for enabled tools with unassigned owner
    for (const tool of snapshot.tools.tools) {
      if (tool.enabled && tool.owner === 'unassigned') {
        errors.push(`Tool ${tool.id} is enabled but has owner: unassigned`);
      }
    }

    // Check for enabled tools that need review or are deprecated
    for (const tool of snapshot.tools.tools) {
      if (tool.enabled && tool.needs_review) {
        errors.push(`Tool ${tool.id} is enabled but needs review`);
      }
      if (tool.enabled && tool.deprecated) {
        errors.push(`Tool ${tool.id} is enabled but is deprecated`);
      }
    }

    // Check for tools referencing unknown servers
    for (const tool of snapshot.tools.tools) {
      if (!snapshot.gateway.servers[tool.server]) {
        errors.push(`Tool ${tool.id} references unknown server: ${tool.server}`);
      }
    }

    if (errors.length > 0) {
      console.error('Validation failed:');
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log('OK');
  } catch (error) {
    console.error(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
