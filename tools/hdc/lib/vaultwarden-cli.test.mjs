import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bwGetPassword,
  bwSetPassword,
  clearBwSessionProcessCache,
  ensureBwUnlocked,
  resolveBwExecutable,
} from "./vaultwarden-cli.mjs";

describe("vaultwarden-cli", () => {
  afterEach(() => {
    clearBwSessionProcessCache();
    vi.restoreAllMocks();
  });

  function makeDeps(/** @type {Record<string, unknown>} */ o = {}) {
    const capture = { log: [], warn: [], err: [] };
    /** @type {Record<string, { status: number; stdout?: string; stderr?: string }>} */
    const responses = o.responses ?? {};
    const spawnSync = vi.fn((exe, args) => {
      const key = args.join(" ");
      const hit = responses[key] ?? responses[`bw:${key}`] ?? responses[`${exe}:${key}`];
      if (hit) {
        return {
          status: hit.status,
          stdout: hit.stdout ?? "",
          stderr: hit.stderr ?? "",
        };
      }
      return { status: 1, stdout: "", stderr: `unexpected: ${key}` };
    });
    return {
      env: {
        HDC_VAULTWARDEN_URL: "https://vault.example.test",
        HDC_VAULTWARDEN_EMAIL: "ops@example.test",
        ...(o.envVars ?? {}),
      },
      log: (...a) => capture.log.push(a.join(" ")),
      error: (...a) => capture.err.push(a.join(" ")),
      warn: (...a) => capture.warn.push(a.join(" ")),
      readLineQuestion: o.readLineQuestion ?? (async () => ""),
      spawnSync,
      _capture: capture,
    };
  }

  it("resolveBwExecutable finds bw via --version", () => {
    const deps = makeDeps({
      responses: {
        "--version": { status: 0, stdout: "2024.1.0" },
        "bw:--version": { status: 0, stdout: "2024.1.0" },
      },
    });
    expect(resolveBwExecutable(deps)).toBe("bw");
  });

  it("ensureBwUnlocked uses stored master password and caches session", async () => {
    const deps = makeDeps({
      responses: {
        "--version": { status: 0, stdout: "2024.1.0" },
        "bw:--version": { status: 0, stdout: "2024.1.0" },
        "config server https://vault.example.test": { status: 0 },
        "login --check": { status: 0 },
        "unlock --passwordenv BW_PASSWORD --raw": { status: 0, stdout: "session-key-1" },
      },
    });
    const readLocal = vi.fn(async () => "master-pass");
    const writeLocal = vi.fn(async () => {});
    const s1 = await ensureBwUnlocked(deps, readLocal, writeLocal);
    const s2 = await ensureBwUnlocked(deps, readLocal, writeLocal);
    expect(s1).toBe("session-key-1");
    expect(s2).toBe("session-key-1");
    expect(readLocal).toHaveBeenCalledTimes(1);
  });

  it("ensureBwUnlocked prompts and optionally stores master password", async () => {
    const q = vi.fn();
    q.mockResolvedValueOnce("typed-master");
    q.mockResolvedValueOnce("y");
    const deps = makeDeps({
      readLineQuestion: q,
      responses: {
        "--version": { status: 0, stdout: "2024.1.0" },
        "bw:--version": { status: 0, stdout: "2024.1.0" },
        "config server https://vault.example.test": { status: 0 },
        "login --check": { status: 1 },
        "login ops@example.test typed-master --raw": { status: 0 },
        "unlock --passwordenv BW_PASSWORD --raw": { status: 0, stdout: "session-key-2" },
      },
    });
    const readLocal = vi.fn(async () => null);
    const writeLocal = vi.fn(async () => {});
    const session = await ensureBwUnlocked(deps, readLocal, writeLocal);
    expect(session).toBe("session-key-2");
    expect(writeLocal).toHaveBeenCalledWith("HDC_VAULTWARDEN_MASTER_PASSWORD", "typed-master");
  });

  it("bwGetPassword returns value on success", () => {
    const deps = makeDeps({
      responses: {
        "--version": { status: 0, stdout: "2024.1.0" },
        "bw:--version": { status: 0, stdout: "2024.1.0" },
        "get password HDC_X": { status: 0, stdout: "secret-value" },
      },
    });
    expect(bwGetPassword(deps, "sess", "HDC_X")).toBe("secret-value");
  });

  it("bwSetPassword creates login item when missing", () => {
    const deps = makeDeps({
      responses: {
        "--version": { status: 0, stdout: "2024.1.0" },
        "bw:--version": { status: 0, stdout: "2024.1.0" },
        "list items --search HDC_Y": { status: 0, stdout: "[]" },
        "create item login --name HDC_Y --username HDC_Y --password new-secret": { status: 0 },
      },
    });
    bwSetPassword(deps, "sess", "HDC_Y", "new-secret");
    expect(deps.spawnSync).toHaveBeenCalled();
  });
});
