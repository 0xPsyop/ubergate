// In-memory token bucket rate limiting
// Data plane component

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimiterOptions {
  requestsPerMinute: number;
  burst: number;
  clock?: () => number;
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private readonly requestsPerSecond: number;
  private readonly burst: number;
  private readonly clock: () => number;

  constructor(options: RateLimiterOptions) {
    this.requestsPerSecond = options.requestsPerMinute / 60;
    this.burst = options.burst;
    this.clock = options.clock ?? (() => Date.now());
  }

  check(callerId: string): boolean {
    const now = this.clock();
    let bucket = this.buckets.get(callerId);

    if (!bucket) {
      bucket = { tokens: this.burst, lastRefill: now };
      this.buckets.set(callerId, bucket);
    }

    // Refill tokens
    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = elapsedSeconds * this.requestsPerSecond;
    bucket.tokens = Math.min(this.burst, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    // Check if request can proceed
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  reset(callerId: string): void {
    this.buckets.delete(callerId);
  }

  resetAll(): void {
    this.buckets.clear();
  }
}
