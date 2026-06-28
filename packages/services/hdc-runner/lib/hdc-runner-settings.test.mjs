import { describe, expect, it } from "vitest";

import {
  hdcRunnerSettingsForDeployment,
  normalizeHdcRunnerBlock,
  resolveScheduleDiscord,
  resolveScheduleMail,
} from "./hdc-runner-settings.mjs";

describe("hdc-runner-settings", () => {
  it("normalizeHdcRunnerBlock includes empty discord by default", () => {
    expect(normalizeHdcRunnerBlock({})).toMatchObject({ discord: {} });
  });

  it("hdcRunnerSettingsForDeployment merges discord from defaults and deployment", () => {
    const runner = hdcRunnerSettingsForDeployment(
      { hdc_runner: { discord: { enabled: true, on_failure_only: false } } },
      { hdc_runner: { discord: { on_failure_only: true } } },
    );
    expect(runner.discord).toEqual({ enabled: true, on_failure_only: true });
  });

  it("resolveScheduleDiscord uses global defaults", () => {
    const runner = normalizeHdcRunnerBlock({
      discord: { enabled: true, on_failure_only: false, title_prefix: "[Ops]" },
    });
    expect(resolveScheduleDiscord(runner, {})).toEqual({
      enabled: true,
      title_prefix: "[Ops]",
      on_failure_only: false,
      webhook_vault_key: "HDC_OPS_DISCORD_WEBHOOK_URL",
    });
  });

  it("resolveScheduleDiscord applies per-schedule overrides", () => {
    const runner = normalizeHdcRunnerBlock({
      discord: { enabled: true, on_failure_only: false },
    });
    expect(
      resolveScheduleDiscord(runner, {
        discord: { enabled: false, on_failure_only: true, webhook_vault_key: "HDC_CUSTOM_WEBHOOK" },
      }),
    ).toEqual({
      enabled: false,
      title_prefix: "[HDC]",
      on_failure_only: true,
      webhook_vault_key: "HDC_CUSTOM_WEBHOOK",
    });
  });

  it("resolveScheduleMail and resolveScheduleDiscord share on_failure_only precedence", () => {
    const runner = normalizeHdcRunnerBlock({
      mail: { enabled: true, on_failure_only: false },
      discord: { enabled: true, on_failure_only: false },
    });
    const schedule = { mail: { on_failure_only: true }, discord: { on_failure_only: true } };
    expect(resolveScheduleMail(runner, schedule).on_failure_only).toBe(true);
    expect(resolveScheduleDiscord(runner, schedule).on_failure_only).toBe(true);
  });
});
