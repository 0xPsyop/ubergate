// PII redaction middleware with pattern matching and key-based redaction
// Data plane component

import type { RedactionConfig } from '../types.js';

export interface RedactionResult {
  value: unknown;
  count: number;
}

function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

function redactString(
  value: string,
  patterns: RedactionConfig['patterns'],
  replacement: string
): { value: string; count: number } {
  let count = 0;
  let result = value;

  if (patterns.includes('email')) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    result = result.replace(emailRegex, () => {
      count++;
      return replacement;
    });
  }

  if (patterns.includes('ssn')) {
    const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/g;
    result = result.replace(ssnRegex, () => {
      count++;
      return replacement;
    });
  }

  if (patterns.includes('credit_card')) {
    // 13-19 digits optionally separated by spaces or dashes
    const cardRegex = /\b(?:\d[ -]*?){13,19}\b/g;
    result = result.replace(cardRegex, (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
        count++;
        return replacement;
      }
      return match;
    });
  }

  if (patterns.includes('phone')) {
    // US: (123) 456-7890, 123-456-7890, +1-123-456-7890
    // Int: +44 20 7123 4567, +1-555-010-1234
    const phoneRegex = /(?<!\w)(?:(?:\+?1[-.\s]?)?(?:\(\d{3}\)[-.\s]?|\d{3}[-.\s])\d{3}[-.\s]?\d{4}|\+\d[\d\s\-()]{8,}\d)(?!\w)/g;
    result = result.replace(phoneRegex, (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 15) {
        count++;
        return replacement;
      }
      return match;
    });
  }

  return { value: result, count };
}

function redactValue(
  value: unknown,
  config: RedactionConfig,
  parentKey: string | null = null
): { value: unknown; count: number } {
  if (value === null || value === undefined) {
    return { value, count: 0 };
  }

  // Key-based redaction: case-insensitive exact match replaces whole value
  if (parentKey && config.keys.some(k => k.toLowerCase() === parentKey.toLowerCase())) {
    return { value: config.replacement, count: 1 };
  }

  if (typeof value === 'string') {
    return redactString(value, config.patterns, config.replacement);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return { value, count: 0 };
  }

  if (Array.isArray(value)) {
    let totalCount = 0;
    const newArray = value.map(item => {
      const result = redactValue(item, config, null);
      totalCount += result.count;
      return result.value;
    });
    return { value: newArray, count: totalCount };
  }

  if (typeof value === 'object') {
    let totalCount = 0;
    const newObj: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = redactValue(item, config, key);
      totalCount += result.count;
      newObj[key] = result.value;
    }
    return { value: newObj, count: totalCount };
  }

  return { value, count: 0 };
}

export function redact(value: unknown, config: RedactionConfig): RedactionResult {
  return redactValue(value, config);
}
