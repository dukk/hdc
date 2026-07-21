import { describe, expect, it, vi } from "vitest";

import {
  buildNotificationsJson,
  MANAGER_ROUTE_KEYS,
  normalizeNotificationsConfig,
  parseNotificationsJson,
} from "./notifications-config.mjs";
import {
  appendDecisionFooter,
  formatNotifyBody,
  sendNotify,
  sendNotifyRoute,
} from "./ops-notify.mjs";
import { sendPlainEmail } from "./package/report-email.mjs";

describe("notifications-config", () => {
  it("defaults all manager routes to discord", () => {
    const cfg = normalizeNotificationsConfig();
    for (const key of MANAGER_ROUTE_KEYS) {
      expect(cfg.routes[key]).toEqual(["discord"]);
    }
  });

  it("merges mail into email channel and custom routes", () => {
    const cfg = normalizeNotificationsConfig({
      mail: {
        enabled: true,
        to: "ops@example.invalid",
        from: "manager@example.invalid",
        subject_prefix: "[HDC]",
      },
      notifications: {
        routes: {
          needs_decision: ["email"],
          mailbox_spoof: ["email", "slack"],
        },
        channels: {
          slack: { enabled: true },
        },
      },
    });
    expect(cfg.channels.email.to).toBe("ops@example.invalid");
    expect(cfg.routes.needs_decision).toEqual(["email"]);
    expect(cfg.routes.mailbox_spoof).toEqual(["email", "slack-incoming-webhook"]);
    expect(cfg.channels["slack-incoming-webhook"].enabled).toBe(true);
  });

  it("buildNotificationsJson round-trips", () => {
    const json = buildNotificationsJson({
      notifications: { routes: { needs_decision: ["email"] } },
    });
    const parsed = parseNotificationsJson(json);
    expect(parsed.routes.needs_decision).toEqual(["email"]);
  });
});

describe("ops-notify", () => {
  it("formatNotifyBody includes system and app when provided", () => {
    const text = formatNotifyBody("Alert", "body", {
      system: "hdc-agents-a",
      app: "cli",
    });
    expect(text).toContain("Alert · `hdc-agents-a` · `cli`");
    expect(text).toContain("body");
  });

  it("appendDecisionFooter adds approve/reject and tasks URL", () => {
    const text = appendDecisionFooter(
      { decision: true, taskId: "task-1", publicUrl: "https://agents.example.invalid" },
      "Needs approval",
    );
    expect(text).toContain("APPROVE task-1");
    expect(text).toContain("REJECT task-1");
    expect(text).toContain("https://agents.example.invalid/tasks");
  });

  it("sendNotify slack-incoming-webhook posts webhook JSON", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));
    const result = await sendNotify({
      channel: "slack-incoming-webhook",
      title: "Test",
      message: "hello",
      channelConfig: { enabled: true, webhook_vault_key: "HDC_AGENTS_SLACK_WEBHOOK_URL" },
      env: { HDC_AGENTS_SLACK_WEBHOOK_URL: "https://hooks.slack.example.invalid/abc" },
      fetchFn: fetchMock,
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("slack-incoming-webhook");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.text).toContain("hello");
  });

  it("sendNotifyRoute normalizes legacy slack channel id", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));
    const config = normalizeNotificationsConfig({
      notifications: {
        routes: { needs_decision: ["slack", "teams"] },
        channels: {
          slack: { enabled: true },
          teams: { enabled: true },
        },
      },
    });
    const result = await sendNotifyRoute({
      routeKey: "needs_decision",
      config,
      title: "Decision",
      message: "Please review",
      env: {
        HDC_AGENTS_SLACK_WEBHOOK_URL: "https://hooks.slack.example.invalid/abc",
      },
      fetchFn: fetchMock,
    });
    expect(result.ok).toBe(true);
    expect(result.results["slack-incoming-webhook"]?.ok).toBe(true);
    expect(result.results.teams?.skipped).toBe(true);
  });

  it("sendPlainEmail uses sendmail", () => {
    const spawnMock = vi.fn(() => ({ status: 0, stdout: "", stderr: "" }));
    const result = sendPlainEmail({
      to: "ops@example.invalid",
      from: "manager@example.invalid",
      subject: "[HDC] test",
      markdown: "body",
      env: {},
      spawnSyncFn: spawnMock,
    });
    expect(result.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith(
      "sendmail",
      ["-t", "-oi"],
      expect.objectContaining({ input: expect.stringContaining("ops@example.invalid") }),
    );
  });
});
