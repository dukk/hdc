/**
 * Shared retry/backoff for Proxmox API and similar HTTP calls.
 */

/** @typedef {{ retries?: number; baseDelayMs?: number; maxDelayMs?: number; shouldRetry?: (err: unknown, attempt: number) => boolean; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void }} RetryOpts */

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isRetryableHttpError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/timed out/i.test(msg)) return true;
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg)) return true;
  const m = /HTTP\s+(\d{3})/i.exec(msg);
  if (!m) return false;
  const code = Number(m[1]);
  return code === 408 || code === 425 || code === 429 || (code >= 500 && code <= 599);
}

/**
 * @param {number} attempt 0-based
 * @param {number} baseDelayMs
 * @param {number} maxDelayMs
 */
export function retryDelayMs(attempt, baseDelayMs = 500, maxDelayMs = 8_000) {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt));
  const jitter = Math.floor(Math.random() * Math.min(250, exp / 4));
  return Math.min(maxDelayMs, exp + jitter);
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {RetryOpts} [opts]
 * @returns {Promise<T>}
 */
export async function withRetries(fn, opts = {}) {
  const retries = Number.isFinite(opts.retries) && /** @type {number} */ (opts.retries) >= 0
    ? Math.round(/** @type {number} */ (opts.retries))
    : 2;
  const baseDelayMs = Number.isFinite(opts.baseDelayMs) && /** @type {number} */ (opts.baseDelayMs) > 0
    ? Math.round(/** @type {number} */ (opts.baseDelayMs))
    : 500;
  const maxDelayMs = Number.isFinite(opts.maxDelayMs) && /** @type {number} */ (opts.maxDelayMs) > 0
    ? Math.round(/** @type {number} */ (opts.maxDelayMs))
    : 8_000;
  const shouldRetry = opts.shouldRetry ?? ((err) => isRetryableHttpError(err));
  const sleep =
    opts.sleep ??
    ((ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
  const log = opts.log ?? (() => {});

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt >= retries || !shouldRetry(e, attempt)) throw e;
      const delay = retryDelayMs(attempt, baseDelayMs, maxDelayMs);
      log(`retry ${attempt + 1}/${retries} after ${delay}ms: ${e instanceof Error ? e.message : String(e)}`);
      await sleep(delay);
    }
  }
  throw lastErr;
}
