import { describe, expect, it } from "vitest";
import {
  confirmTeardown,
  teardownConfirmed,
  teardownDryRun,
} from "../../../packages/services/ollama/lib/teardown-confirm.mjs";

describe("ollama teardown confirm", () => {
  it("teardownDryRun detects --dry-run", () => {
    expect(teardownDryRun({ "dry-run": "1" })).toBe(true);
    expect(teardownDryRun({})).toBe(false);
  });

  it("teardownConfirmed detects --yes", () => {
    expect(teardownConfirmed({ yes: "1" })).toBe(true);
    expect(teardownConfirmed({ y: "1" })).toBe(true);
    expect(teardownConfirmed({})).toBe(false);
  });

  it("confirmTeardown returns false for dry-run without prompting", async () => {
    const ok = await confirmTeardown("ollama-a", "vmid 470 on hypervisor-d", { "dry-run": "1" });
    expect(ok).toBe(false);
  });

  it("confirmTeardown returns true when --yes", async () => {
    const ok = await confirmTeardown("ollama-a", "vmid 470 on hypervisor-d", { yes: "1" });
    expect(ok).toBe(true);
  });

  it("confirmTeardown throws on non-TTY without --yes", async () => {
    await expect(
      confirmTeardown("ollama-a", "vmid 470 on hypervisor-d", {}),
    ).rejects.toThrow(/requires --yes/);
  });
});
