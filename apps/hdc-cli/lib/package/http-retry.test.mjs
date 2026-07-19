import { describe, expect, it, vi } from "vitest";

import { isRetryableHttpError, retryDelayMs, withRetries } from "./http-retry.mjs";

describe("isRetryableHttpError", () => {
  it("retries 5xx, 429, timeouts, and connection errors", () => {
    expect(isRetryableHttpError(new Error("Proxmox HTTP 503 /nodes"))).toBe(true);
    expect(isRetryableHttpError(new Error("Proxmox HTTP 429"))).toBe(true);
    expect(isRetryableHttpError(new Error("request timed out after 1000ms"))).toBe(true);
    expect(isRetryableHttpError(new Error("connect ECONNRESET"))).toBe(true);
  });

  it("does not retry 4xx client errors (except 408/425/429)", () => {
    expect(isRetryableHttpError(new Error("Proxmox HTTP 401"))).toBe(false);
    expect(isRetryableHttpError(new Error("Proxmox HTTP 404"))).toBe(false);
    expect(isRetryableHttpError(new Error("invalid json"))).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("grows with attempt and caps at max", () => {
    expect(retryDelayMs(0, 100, 10_000)).toBeGreaterThanOrEqual(100);
    expect(retryDelayMs(10, 100, 400)).toBeLessThanOrEqual(400 + 250);
  });
});

describe("withRetries", () => {
  it("returns on first success", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetries(fn, { retries: 2 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries retryable failures then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Proxmox HTTP 503"))
      .mockResolvedValueOnce("ok");
    const sleep = vi.fn(async () => {});
    await expect(withRetries(fn, { retries: 2, sleep, baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn(async () => {
      throw new Error("Proxmox HTTP 401");
    });
    await expect(withRetries(fn, { retries: 3, sleep: async () => {} })).rejects.toThrow(/401/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
