/**
 * Counts failed attempts per key (client IP, or '*' for all) in a sliding window. Protects the
 * sign-in form, and the NAS itself: DSM auto-block would ban the container's IP.
 */
export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  private recent(key: string): number[] {
    const since = Date.now() - this.windowMs;
    const list = (this.attempts.get(key) ?? []).filter((time) => time > since);
    if (list.length) this.attempts.set(key, list);
    else this.attempts.delete(key);
    return list;
  }

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }

  fail(key: string): void {
    this.attempts.set(key, [...this.recent(key), Date.now()]);
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}
