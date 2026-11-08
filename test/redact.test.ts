import { describe, it, expect } from 'vitest';
import { redact } from '../src/middleware/redact.js';
import type { RedactionConfig } from '../src/types.js';

describe('PII Redaction', () => {
  const baseConfig: RedactionConfig = {
    patterns: ['email', 'phone', 'ssn', 'credit_card'],
    keys: ['password', 'ssn', 'token', 'secret', 'api_key', 'cardNumber'],
    replacement: '[REDACTED]',
  };

  it('redacts email addresses', () => {
    const input = { text: 'Contact us at support@example.com or admin@foo.org' };
    const res = redact(input, { ...baseConfig, patterns: ['email'] });
    expect(res.value).toEqual({ text: 'Contact us at [REDACTED] or [REDACTED]' });
    expect(res.count).toBe(2);
  });

  it('redacts US and international phone numbers', () => {
    const input = {
      us1: 'Call 123-456-7890',
      us2: 'Call (555) 019-2834',
      int1: 'Call +1-555-010-1234',
      int2: 'Call +44 20 7123 4567',
    };
    const res = redact(input, { ...baseConfig, patterns: ['phone'] });
    expect(res.value).toEqual({
      us1: 'Call [REDACTED]',
      us2: 'Call [REDACTED]',
      int1: 'Call [REDACTED]',
      int2: 'Call [REDACTED]',
    });
    expect(res.count).toBe(4);
  });

  it('redacts US SSN numbers (\d{3}-\d{2}-\d{4})', () => {
    const input = { ssnText: 'Government ID: 123-45-6789 here' };
    const res = redact(input, { ...baseConfig, patterns: ['ssn'] });
    expect(res.value).toEqual({ ssnText: 'Government ID: [REDACTED] here' });
    expect(res.count).toBe(1);
  });

  it('redacts valid credit cards and rejects non-card digit strings via Luhn check', () => {
    const input = {
      validCardSpaced: 'Visa: 4111 1111 1111 1111',
      validCardDashed: 'Visa: 4111-1111-1111-1111',
      validCardPlain: 'Card: 4111111111111111',
      validCard13: 'Visa: 4222222222222',
      invalidCardLuhn: 'Card: 4111 1111 1111 1112', // fails Luhn
      otherDigits: 'Product barcode: 12345678901234', // 14 digits, fails Luhn
    };

    const res = redact(input, { ...baseConfig, patterns: ['credit_card', 'phone'] });
    expect((res.value as any).validCardSpaced).toBe('Visa: [REDACTED]');
    expect((res.value as any).validCardDashed).toBe('Visa: [REDACTED]');
    expect((res.value as any).validCardPlain).toBe('Card: [REDACTED]');
    expect((res.value as any).validCard13).toBe('Visa: [REDACTED]');
    expect((res.value as any).invalidCardLuhn).toBe('Card: 4111 1111 1111 1112'); // preserved!
    expect((res.value as any).otherDigits).toBe('Product barcode: 12345678901234'); // preserved!
    expect(res.count).toBe(4);
  });

  it('preserves non-Luhn numeric identifiers from 13 through 19 digits', () => {
    const input = Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => {
        const length = index + 13;
        return [`barcode${length}`, '1'.repeat(length)];
      })
    );

    const res = redact(input, { ...baseConfig, patterns: ['credit_card'] });

    expect(res.value).toEqual(input);
    expect(res.count).toBe(0);
  });

  it('applies key-based redaction with case-insensitive exact matching', () => {
    const input = {
      PASSWORD: 'supersecretpassword',
      cardNumber: '9999-9999-9999-9999',
      Secret: 123456,
      normalKey: 'normalValue',
    };

    const res = redact(input, { ...baseConfig, patterns: [] }); // key-only
    expect(res.value).toEqual({
      PASSWORD: '[REDACTED]',
      cardNumber: '[REDACTED]',
      Secret: '[REDACTED]',
      normalKey: 'normalValue',
    });
    expect(res.count).toBe(3);
  });

  it('handles nested objects and arrays cleanly', () => {
    const input = {
      users: [
        { id: 1, email: 'user1@test.com', secret: 'abc' },
        { id: 2, email: 'user2@test.com', secret: 'def' },
      ],
      metadata: {
        lastEditedBy: 'admin@company.com',
      },
    };

    const res = redact(input, baseConfig);
    expect(res.value).toEqual({
      users: [
        { id: 1, email: '[REDACTED]', secret: '[REDACTED]' },
        { id: 2, email: '[REDACTED]', secret: '[REDACTED]' },
      ],
      metadata: {
        lastEditedBy: '[REDACTED]',
      },
    });
    expect(res.count).toBe(5); // 2 emails + 2 secrets + 1 metadata email
  });

  it('redacts sensitive keys recursively inside nested arrays', () => {
    const input = {
      accounts: [
        {
          credentials: [{ api_key: 'key-1' }, { api_key: 'key-2' }],
          nested: { password: 'pass-1' },
        },
      ],
    };

    const res = redact(input, { ...baseConfig, patterns: [] });

    expect(res.value).toEqual({
      accounts: [
        {
          credentials: [{ api_key: '[REDACTED]' }, { api_key: '[REDACTED]' }],
          nested: { password: '[REDACTED]' },
        },
      ],
    });
    expect(res.count).toBe(3);
  });

  it('does not mutate the input object', () => {
    const original = {
      email: 'original@example.com',
      profile: {
        ssn: '000-00-0000',
      },
    };
    const cloned = JSON.parse(JSON.stringify(original));

    const res = redact(original, baseConfig);

    expect(original).toEqual(cloned);
    expect(res.value).not.toBe(original);
  });
});
