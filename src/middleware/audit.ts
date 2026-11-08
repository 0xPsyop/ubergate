// Audit logging with pino
// Data plane component

import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type AuditDecision = 'allow' | 'deny' | 'rate_limited' | 'not_found' | 'invalid_args' | 'error';

export interface AuditRecord {
  ts: string;
  caller: string;
  caller_type: string;
  action: 'search_tools' | 'get_schema' | 'invoke_tool';
  tool?: string;
  risk?: string;
  decision: AuditDecision;
  reason: string;
  status?: number;
  duration_ms: number;
  redactions: number;
  args_hmac_sha256: string;
}

export interface AuditLoggerOptions {
  auditLogPath: string;
  hmacKey: string;
  inMemory?: boolean;
}

export class AuditLogger {
  private logger?: pino.Logger;
  private inMemoryRecords: AuditRecord[] = [];
  private readonly inMemory: boolean;
  private readonly hmacKey: string;

  constructor(options: AuditLoggerOptions) {
    if (Buffer.byteLength(options.hmacKey, 'utf8') < 32) {
      throw new Error('AUDIT_HMAC_KEY must be at least 32 bytes');
    }

    this.inMemory = options.inMemory ?? false;
    this.hmacKey = options.hmacKey;

    if (!this.inMemory) {
      // Ensure log directory exists
      const logDir = path.dirname(options.auditLogPath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const destination = pino.destination({
        dest: options.auditLogPath,
        sync: true,
        mkdir: true,
      });

      this.logger = pino({
        base: undefined,
        timestamp: false,
      }, destination);
    }
  }

  hashArgs(args: unknown): string {
    const argsJson = JSON.stringify(args ?? {});
    return crypto.createHmac('sha256', this.hmacKey).update(argsJson).digest('hex');
  }

  log(record: AuditRecord): void {
    if (this.inMemory) {
      this.inMemoryRecords.push(record);
    } else if (this.logger) {
      this.logger.info(record);
    }
  }

  getInMemoryRecords(): AuditRecord[] {
    return [...this.inMemoryRecords];
  }

  clearInMemoryRecords(): void {
    this.inMemoryRecords = [];
  }

  createRecord(
    caller: string,
    callerType: string,
    action: AuditRecord['action'],
    decision: AuditDecision,
    reason: string,
    durationMs: number,
    redactions: number,
    args: unknown,
    tool?: string,
    risk?: string,
    status?: number
  ): AuditRecord {
    return {
      ts: new Date().toISOString(),
      caller,
      caller_type: callerType,
      action,
      tool,
      risk,
      decision,
      reason,
      status,
      duration_ms: durationMs,
      redactions,
      args_hmac_sha256: this.hashArgs(args),
    };
  }
}
