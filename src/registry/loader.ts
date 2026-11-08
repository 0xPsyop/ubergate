// Configuration loader with environment variable interpolation and hot-reload support
// Data plane component

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import chokidar from 'chokidar';
import { z } from 'zod';
import {
  ToolsConfigSchema,
  PolicyConfigSchema,
  GatewayConfigSchema,
} from './schema.js';
import type {
  RegistrySnapshot,
  ToolsConfig,
  PolicyConfig,
  GatewayConfig,
} from '../types.js';

function interpolateEnvVars(text: string): string {
  return text.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (_match, varName, defaultValue) => {
    const envValue = process.env[varName];
    if (envValue !== undefined) {
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return '';
  });
}

function loadYamlFile<T>(filePath: string, schema: z.ZodType<T, any, any>, configName: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Configuration file not found: ${filePath}`);
  }

  const rawContent = fs.readFileSync(filePath, 'utf-8');
  const interpolated = interpolateEnvVars(rawContent);
  const parsed = parseYaml(interpolated);

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join('; ');
    throw new Error(`Invalid ${configName} configuration: ${errors}`);
  }

  return result.data;
}

function validateSnapshot(tools: ToolsConfig, policy: PolicyConfig, gateway: GatewayConfig): void {
  // Check for duplicate tool IDs
  const toolIds = new Set<string>();
  for (const tool of tools.tools) {
    if (toolIds.has(tool.id)) {
      throw new Error(`Duplicate tool ID: ${tool.id}`);
    }
    toolIds.add(tool.id);
  }

  // Check for duplicate caller IDs
  const callerIds = new Set<string>();
  for (const caller of gateway.callers) {
    if (callerIds.has(caller.id)) {
      throw new Error(`Duplicate caller ID: ${caller.id}`);
    }
    callerIds.add(caller.id);
  }

  // Check for duplicate tokens
  const tokens = new Set<string>();
  for (const caller of gateway.callers) {
    const token = caller.token ?? (caller.token_env ? process.env[caller.token_env] : undefined);
    if (token !== undefined) {
      if (tokens.has(token)) {
        throw new Error(`Duplicate token found for caller: ${caller.id}`);
      }
      tokens.add(token);
    }
  }

  // Check that all referenced servers exist
  for (const tool of tools.tools) {
    if (!gateway.servers[tool.server]) {
      throw new Error(`Tool ${tool.id} references unknown server: ${tool.server}`);
    }
  }

  // Validate policy has at least one rule if default is deny
  if (policy.default === 'deny' && policy.rules.length === 0) {
    console.warn('Policy is set to deny with no rules - all requests will be denied');
  }
}

export class ConfigHolder {
  private _snapshot: RegistrySnapshot | null = null;

  get snapshot(): RegistrySnapshot {
    if (!this._snapshot) {
      throw new Error('Config not loaded');
    }
    return this._snapshot;
  }

  set snapshot(value: RegistrySnapshot) {
    this._snapshot = value;
  }
}

export function loadConfigDir(dir: string): RegistrySnapshot {
  const toolsPath = path.join(dir, 'tools.yaml');
  const policyPath = path.join(dir, 'policy.yaml');
  const gatewayPath = path.join(dir, 'gateway.yaml');

  const tools = loadYamlFile(toolsPath, ToolsConfigSchema, 'tools');
  const policy = loadYamlFile(policyPath, PolicyConfigSchema, 'policy');
  const gateway = loadYamlFile(gatewayPath, GatewayConfigSchema, 'gateway');

  // Filter out callers without tokens first
  const validCallers = gateway.callers.filter(caller => {
    const hasToken = caller.token !== undefined;
    const hasEnvToken = caller.token_env !== undefined && process.env[caller.token_env] !== undefined;
    if (!hasToken && !hasEnvToken) {
      console.warn(`Skipping caller ${caller.id}: no token or token_env configured`);
      return false;
    }
    return true;
  });

  gateway.callers = validCallers;

  validateSnapshot(tools, policy, gateway);

  return { tools, policy, gateway };
}

export function watchConfigDir(dir: string, holder: ConfigHolder, onReload: (error?: Error) => void): () => void {
  let debounceTimer: NodeJS.Timeout | null = null;

  const reload = () => {
    try {
      // Atomic reload: parse and validate first.
      const newSnapshot = loadConfigDir(dir);
      // Only swap if completely valid
      holder.snapshot = newSnapshot;
      onReload();
    } catch (error) {
      // Keep previous snapshot on invalid config and log error
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`Config reload failed (keeping existing snapshot): ${err.message}`);
      onReload(err);
    }
  };

  const watcher = chokidar.watch(dir, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
  });

  watcher.on('change', () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(reload, 100);
  });

  return () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    watcher.close();
  };
}
