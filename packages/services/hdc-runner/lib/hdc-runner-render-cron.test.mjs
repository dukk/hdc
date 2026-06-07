import { describe, expect, it } from "vitest";
import {
  cronFileBasename,
  renderAllCronFiles,
  renderCronFileContent,
  sanitizeScheduleId,
  validateCronExpression,
} from "./hdc-runner-render-cron.mjs";

describe("hdc-runner-render-cron", () => {
  it("sanitizeScheduleId accepts valid ids", () => {
    expect(sanitizeScheduleId("daily-maintain")).toBe("daily-maintain");
  });

  it("sanitizeScheduleId rejects invalid ids", () => {
    expect(() => sanitizeScheduleId("bad id!")).toThrow(/invalid schedule id/);
  });

  it("validateCronExpression requires 5 fields", () => {
    expect(validateCronExpression("0 3 * * *")).toBe("0 3 * * *");
    expect(() => validateCronExpression("0 3 * *")).toThrow(/5 fields/);
  });

  it("renderCronFileContent includes hdc user and job script", () => {
    const content = renderCronFileContent({
      scheduleId: "daily-maintain",
      cron: "0 3 * * *",
      jobScriptPath: "/opt/hdc-runner/bin/run-scheduled-job.mjs",
    });
    expect(content).toContain("hdc /usr/bin/node /opt/hdc-runner/bin/run-scheduled-job.mjs daily-maintain");
    expect(content).toContain("0 3 * * *");
  });

  it("renderAllCronFiles builds one file per schedule", () => {
    const files = renderAllCronFiles(
      [
        { id: "a", cron: "0 1 * * *" },
        { id: "b", cron: "0 2 * * *" },
      ],
      { jobScriptPath: "/opt/hdc-runner/bin/run-scheduled-job.mjs" },
    );
    expect(files).toHaveLength(2);
    expect(cronFileBasename("a")).toBe("hdc-runner-a");
  });
});
