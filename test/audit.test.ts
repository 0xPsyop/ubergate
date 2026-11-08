import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuditLogger } from '../src/middleware/audit.js';
import { createGateway, type GatewayResult } from '../src/gateway/createGateway.js';
import { createTempConfigDir, makeGatewayConfig, makePolicy } from './helpers.js';

describe('Audit argument HMAC', () => {
  it('stores the HMAC-SHA256 of serialized arguments', () => {
    const key = 'audit-test-key-with-at-least-32-bytes';
    const logger = new AuditLogger({
      auditLogPath: '',
      hmacKey: key,
      inMemory: true,
    });
    const args = { pin: '1234' };
    const expected = createHmac('sha256', key).update(JSON.stringify(args)).digest('hex');

    expect(logger.hashArgs(args)).toBe(expected);
    expect(logger.hashArgs(args)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different digests for the same low-entropy arguments with different keys', () => {
    const args = { pin: '1234' };
    const first = new AuditLogger({
      auditLogPath: '',
      hmacKey: 'first-audit-key-with-at-least-32-bytes',
      inMemory: true,
    });
    const second = new AuditLogger({
      auditLogPath: '',
      hmacKey: 'second-audit-key-with-at-least-32-bytes',
      inMemory: true,
    });

    expect(first.hashArgs(args)).not.toBe(second.hashArgs(args));
  });

  it('rejects keys shorter than 32 bytes', () => {
    expect(() => new AuditLogger({
      auditLogPath: '',
      hmacKey: 'too-short',
      inMemory: true,
    })).toThrow('AUDIT_HMAC_KEY must be at least 32 bytes');
  });

  it('fails gateway startup with a clear error when the HMAC key is missing', async () => {
    const originalKey = process.env.AUDIT_HMAC_KEY;
    delete process.env.AUDIT_HMAC_KEY;
    const tempConfig = createTempConfigDir({
      tools: { version: 1, tools: [] },
      policy: makePolicy('allow'),
      gateway: makeGatewayConfig(),
    });
    let gateway: GatewayResult | undefined;

    try {
      expect(() => {
        gateway = createGateway({ configDir: tempConfig.dir, watch: false });
      }).toThrow('AUDIT_HMAC_KEY must be set to a secret of at least 32 bytes');
    } finally {
      if (gateway) {
        await gateway.close();
      }
      tempConfig.cleanup();
      if (originalKey === undefined) {
        delete process.env.AUDIT_HMAC_KEY;
      } else {
        process.env.AUDIT_HMAC_KEY = originalKey;
      }
    }
  });
});
