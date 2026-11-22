/**
 * Production Hardening: Native Edge Rate Limiter
 * Zero external packages, backed by SQLite / D1
 */

export async function checkRateLimit(env, key, maxAttempts = 5, windowSeconds = 60) {
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + windowSeconds;

  try {
    const existing = await env.DB.prepare(
      `SELECT attempts, reset_at FROM rate_limits WHERE key = ?`
    ).bind(key).first();

    if (!existing) {
      // First attempt in this window
      await env.DB.prepare(
        `INSERT INTO rate_limits (key, attempts, reset_at) VALUES (?, 1, ?)`
      ).bind(key, resetAt).run();
      return { allowed: true, remaining: maxAttempts - 1, retryAfter: 0 };
    }

    // If existing window has expired, reset it
    if (existing.reset_at < now) {
      await env.DB.prepare(
        `UPDATE rate_limits SET attempts = 1, reset_at = ? WHERE key = ?`
      ).bind(resetAt, key).run();
      return { allowed: true, remaining: maxAttempts - 1, retryAfter: 0 };
    }

    // If within window and over limit
    if (existing.attempts >= maxAttempts) {
      const retryAfter = existing.reset_at - now;
      return { allowed: false, remaining: 0, retryAfter };
    }

    // Increment attempts
    await env.DB.prepare(
      `UPDATE rate_limits SET attempts = attempts + 1 WHERE key = ?`
    ).bind(key).run();

    return { allowed: true, remaining: maxAttempts - (existing.attempts + 1), retryAfter: 0 };
  } catch (e) {
    // Fail open in case of DB error so service is not blocked
    console.error('Rate limit check error:', e);
    return { allowed: true, remaining: 1, retryAfter: 0 };
  }
}
