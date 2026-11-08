import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/middleware/ratelimit.js';

describe('Rate Limiter (Token Bucket)', () => {
  it('allows requests up to burst capacity and denies the next immediate request', () => {
    let now = 1000000;
    const limiter = new RateLimiter({
      requestsPerMinute: 60, // 1 token per second
      burst: 3,
      clock: () => now,
    });

    // 3 requests allowed (burst = 3)
    expect(limiter.check('caller1')).toBe(true);
    expect(limiter.check('caller1')).toBe(true);
    expect(limiter.check('caller1')).toBe(true);

    // 4th request denied immediately
    expect(limiter.check('caller1')).toBe(false);
  });

  it('refills tokens over time using injected clock', () => {
    let now = 1000000;
    const limiter = new RateLimiter({
      requestsPerMinute: 60, // 1 token per 1000ms
      burst: 2,
      clock: () => now,
    });

    // Exhaust burst
    expect(limiter.check('caller1')).toBe(true);
    expect(limiter.check('caller1')).toBe(true);
    expect(limiter.check('caller1')).toBe(false);

    // Advance clock by 500ms (0.5 tokens added -> total 0.5 < 1)
    now += 500;
    expect(limiter.check('caller1')).toBe(false);

    // Advance clock by another 500ms (1.0 total tokens added)
    now += 500;
    expect(limiter.check('caller1')).toBe(true);
    expect(limiter.check('caller1')).toBe(false);

    // Advance clock by 10,000ms (capped at burst = 2)
    now += 10000;
    expect(limiter.check('caller1')).toBe(true);
    expect(limiter.check('caller1')).toBe(true);
    expect(limiter.check('caller1')).toBe(false);
  });

  it('maintains strict isolation between different callers', () => {
    let now = 1000000;
    const limiter = new RateLimiter({
      requestsPerMinute: 60,
      burst: 1,
      clock: () => now,
    });

    // caller1 uses their token
    expect(limiter.check('caller1')).toBe(true);
    expect(limiter.check('caller1')).toBe(false);

    // caller2 is unaffected
    expect(limiter.check('caller2')).toBe(true);
    expect(limiter.check('caller2')).toBe(false);
  });
});
