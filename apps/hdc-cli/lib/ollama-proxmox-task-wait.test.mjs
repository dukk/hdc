import { describe, expect, it } from "vitest";
import { extractPveUpid } from "hdc/clump/services/ollama/lib/proxmox-task-wait.mjs";

describe("extractPveUpid", () => {
  it("returns trimmed UPID string", () => {
    const upid = "UPID:hypervisor-d:00007F8A:12345678:ABCDEF12:qmcreate:470:root@pam:";
    expect(extractPveUpid(`  ${upid}  `)).toBe(upid);
  });

  it("returns null for non-string task data", () => {
    expect(extractPveUpid(null)).toBeNull();
    expect(extractPveUpid({ upid: "UPID:x" })).toBeNull();
    expect(extractPveUpid("")).toBeNull();
    expect(extractPveUpid("   ")).toBeNull();
  });
});
