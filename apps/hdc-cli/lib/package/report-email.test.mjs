import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  buildReportMimeMessage,
  parseReportPathFromStderr,
  sendReportEmail,
} from "./report-email.mjs";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawnSync: vi.fn() };
});

describe("report-email", () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: "", stderr: "" });
  });

  it("buildReportMimeMessage creates multipart alternative", () => {
    const mime = buildReportMimeMessage({
      to: "ops@example.test",
      from: "noreply@example.test",
      subject: "Hello",
      markdown: "# Hi",
    });
    expect(mime).toContain("To: ops@example.test");
    expect(mime).toContain("multipart/alternative");
    expect(mime).toContain("Content-Type: text/plain");
    expect(mime).toContain("Content-Type: text/html");
    expect(mime).toContain("# Hi");
    expect(mime).toContain("<h1>Hi</h1>");
  });

  it("parseReportPathFromStderr finds last report line", () => {
    const stderr = `[hdc] gatus maintain: done
report clumps/services/gatus/reports/maintain-2026-01-01.md
`;
    expect(parseReportPathFromStderr(stderr)).toBe(
      "clumps/services/gatus/reports/maintain-2026-01-01.md",
    );
  });

  it("sendReportEmail invokes sendmail -t", () => {
    const dir = mkdtempSync(join(tmpdir(), "hdc-report-email-"));
    const reportPath = join(dir, "report.md");
    writeFileSync(reportPath, "# Test report\n", "utf8");
    const spawnFn = vi.fn().mockReturnValue({ status: 0, stdout: "", stderr: "" });
    const r = sendReportEmail({
      to: "ops@example.test",
      from: "noreply@example.test",
      subject: "Report",
      markdownPath: reportPath,
      spawnSyncFn: spawnFn,
      env: {
        HDC_MAIL_RELAY_HOST: "relay.test",
        HDC_MAIL_RELAY_PORT: "25",
      },
    });
    expect(r.ok).toBe(true);
    expect(spawnFn).toHaveBeenCalledWith(
      "sendmail",
      ["-t", "-oi"],
      expect.objectContaining({ input: expect.stringContaining("multipart/alternative") }),
    );
  });
});
