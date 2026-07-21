// Basic abuse protection — MOO-67 Commit 6.
//
// A private tool that's still publicly addressable (Railway gives it a
// public URL) needs at least a floor against a leaked token being
// hammered, or a client bug looping requests. In-memory, per-key
// fixed-window counter -- adequate for a single-instance private tool;
// not meant to survive a restart or scale across instances.
export class RateLimiter {
  /** @param {number} limitPerMinute */
  constructor(limitPerMinute) {
    this.limitPerMinute = limitPerMinute;
    this.windows = new Map(); // key -> { count, windowStart }
  }

  /** @returns {{allowed: boolean, remaining: number}} */
  check(key) {
    const now = Date.now();
    const windowMs = 60_000;
    const entry = this.windows.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      this.windows.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: this.limitPerMinute - 1 };
    }
    if (entry.count >= this.limitPerMinute) {
      return { allowed: false, remaining: 0 };
    }
    entry.count += 1;
    return { allowed: true, remaining: this.limitPerMinute - entry.count };
  }

  /** Prevent unbounded growth from many distinct keys over a long-running process. */
  sweep() {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (now - entry.windowStart >= 60_000) this.windows.delete(key);
    }
  }
}
