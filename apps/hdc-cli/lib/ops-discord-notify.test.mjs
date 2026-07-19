import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.hoisted(() =>
  vi.fn(() => ({
    status: 0,
    stdout: "",
    stderr: "",
    pid: 1,
    output: [null, "", ""],
    signal: null,
  })),
);

vi.mock("node:child_process", () => ({
  spawnSync: (...args) => spawnSyncMock(...args),
}));

import {
  buildDecisionMessageComponents,
  buildOperationReportDiscordSummary,
  buildProxmoxMaintainDiscordSummary,
  DISCORD_BUTTON_STYLE_DANGER,
  DISCORD_BUTTON_STYLE_SUCCESS,
  DISCORD_SUPPRESS_NOTIFICATIONS_FLAG,
  formatDiscordContent,
  maybeNotifyOpsDiscordFromOperationReport,
  maybeNotifyOpsDiscordFromProxmoxMaintain,
  OPS_DISCORD_APPLICATION_ID_ENV,
  OPS_DISCORD_BOT_TOKEN_ENV,
  OPS_DISCORD_CHANNEL_ID_ENV,
  OPS_DISCORD_HOST_ENV,
  OPS_DISCORD_NOTIFY_ENV,
  OPS_DISCORD_PUBLIC_KEY_ENV,
  OPS_NOTIFY_APP_ENV,
  OPS_SYSTEM_ID_ENV,
  postDiscordWebhook,
  redactIpsFromText,
  resolveOpsDiscordHost,
  resolveOpsDiscordInteractiveConfig,
  resolveOpsNotifyApp,
  resolveOpsNotifySystem,
  sendOpsDiscordMessage,
  sendOpsDiscordNotifyBestEffort,
} from "./ops-discord-notify.mjs";

describe("ops-discord-notify", () => {
  describe("formatDiscordContent", () => {
    it("includes system and app in header when provided", () => {
      const content = formatDiscordContent("Pi-hole maintain — OK", "completed", {
        system: "hdc-agents-a",
        app: "cli",
      });
      expect(content).toBe(
        "**Pi-hole maintain — OK** · `hdc-agents-a` · `cli`\n\ncompleted",
      );
    });

    it("resolveOpsNotifySystem prefers HDC_OPS_SYSTEM_ID over host override", () => {
      const prevSystem = process.env[OPS_SYSTEM_ID_ENV];
      const prevHost = process.env[OPS_DISCORD_HOST_ENV];
      process.env[OPS_SYSTEM_ID_ENV] = "hdc-agents-a";
      process.env[OPS_DISCORD_HOST_ENV] = "legacy-host";
      try {
        expect(resolveOpsNotifySystem()).toBe("hdc-agents-a");
        expect(resolveOpsDiscordHost()).toBe("hdc-agents-a");
      } finally {
        if (prevSystem === undefined) delete process.env[OPS_SYSTEM_ID_ENV];
        else process.env[OPS_SYSTEM_ID_ENV] = prevSystem;
        if (prevHost === undefined) delete process.env[OPS_DISCORD_HOST_ENV];
        else process.env[OPS_DISCORD_HOST_ENV] = prevHost;
      }
    });

    it("resolveOpsDiscordHost still honors HDC_OPS_DISCORD_HOST when system unset", () => {
      const prev = process.env[OPS_DISCORD_HOST_ENV];
      const prevSystem = process.env[OPS_SYSTEM_ID_ENV];
      delete process.env[OPS_SYSTEM_ID_ENV];
      process.env[OPS_DISCORD_HOST_ENV] = "custom-host";
      try {
        expect(resolveOpsDiscordHost()).toBe("custom-host");
      } finally {
        if (prev === undefined) delete process.env[OPS_DISCORD_HOST_ENV];
        else process.env[OPS_DISCORD_HOST_ENV] = prev;
        if (prevSystem === undefined) delete process.env[OPS_SYSTEM_ID_ENV];
        else process.env[OPS_SYSTEM_ID_ENV] = prevSystem;
      }
    });

    it("resolveOpsNotifyApp prefers explicit env then agent role then cli", () => {
      const prevApp = process.env[OPS_NOTIFY_APP_ENV];
      const prevRole = process.env.HDC_AGENT_ROLE;
      delete process.env[OPS_NOTIFY_APP_ENV];
      delete process.env.HDC_AGENT_ROLE;
      try {
        expect(resolveOpsNotifyApp()).toBe("cli");
        process.env.HDC_AGENT_ROLE = "hdc-scheduler";
        expect(resolveOpsNotifyApp()).toBe("hdc-scheduler");
        process.env[OPS_NOTIFY_APP_ENV] = "mcp";
        expect(resolveOpsNotifyApp()).toBe("mcp");
      } finally {
        if (prevApp === undefined) delete process.env[OPS_NOTIFY_APP_ENV];
        else process.env[OPS_NOTIFY_APP_ENV] = prevApp;
        if (prevRole === undefined) delete process.env.HDC_AGENT_ROLE;
        else process.env.HDC_AGENT_ROLE = prevRole;
      }
    });
  });

  describe("postDiscordWebhook", () => {
    it("sets SUPPRESS_NOTIFICATIONS flag when silent", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));
      vi.stubGlobal("fetch", fetchMock);
      try {
        await postDiscordWebhook("https://discord.example.invalid/webhook", "hello", {
          suppressNotifications: true,
        });
        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(body.flags).toBe(DISCORD_SUPPRESS_NOTIFICATIONS_FLAG);
        expect(body.content).toBe("hello");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("decision buttons", () => {
    it("buildDecisionMessageComponents uses approve/deny custom_ids", () => {
      const rows = buildDecisionMessageComponents("2026-07-14-sre-foo");
      const buttons = /** @type {{ custom_id: string; style: number }[]} */ (
        /** @type {any} */ (rows[0]).components
      );
      expect(buttons).toHaveLength(2);
      expect(buttons[0].custom_id).toBe("hdc:approve:2026-07-14-sre-foo");
      expect(buttons[0].style).toBe(DISCORD_BUTTON_STYLE_SUCCESS);
      expect(buttons[1].custom_id).toBe("hdc:deny:2026-07-14-sre-foo");
      expect(buttons[1].style).toBe(DISCORD_BUTTON_STYLE_DANGER);
    });

    it("resolveOpsDiscordInteractiveConfig requires all four fields", async () => {
      const env = {
        [OPS_DISCORD_APPLICATION_ID_ENV]: "app1",
        [OPS_DISCORD_PUBLIC_KEY_ENV]: "pk1",
        [OPS_DISCORD_BOT_TOKEN_ENV]: "token1",
        [OPS_DISCORD_CHANNEL_ID_ENV]: "chan1",
      };
      const full = await resolveOpsDiscordInteractiveConfig({ env });
      expect(full.enabled).toBe(true);
      expect(full.channelId).toBe("chan1");

      const partial = await resolveOpsDiscordInteractiveConfig({
        env: { ...env, [OPS_DISCORD_CHANNEL_ID_ENV]: "" },
      });
      expect(partial.enabled).toBe(false);
    });

    it("sendOpsDiscordMessage uses Bot API with components when interactive", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        text: async () => "",
        json: async () => ({ id: "m1" }),
      }));
      vi.stubGlobal("fetch", fetchMock);
      try {
        const result = await sendOpsDiscordMessage({
          content: "**HDC decision needed**\n\nTask x",
          decision: true,
          taskId: "task-a",
          env: {
            [OPS_DISCORD_APPLICATION_ID_ENV]: "app1",
            [OPS_DISCORD_PUBLIC_KEY_ENV]: "pk1",
            [OPS_DISCORD_BOT_TOKEN_ENV]: "token1",
            [OPS_DISCORD_CHANNEL_ID_ENV]: "chan1",
          },
        });
        expect(result.mode).toBe("bot");
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(String(url)).toContain("/channels/chan1/messages");
        expect(String(/** @type {any} */ (init).headers.Authorization)).toContain("Bot ");
        const body = JSON.parse(String(/** @type {any} */ (init).body));
        expect(body.components[0].components).toHaveLength(2);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("sendOpsDiscordMessage falls back to webhook without interactive config", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));
      vi.stubGlobal("fetch", fetchMock);
      try {
        const result = await sendOpsDiscordMessage({
          content: "plain",
          decision: true,
          taskId: "task-a",
          env: { HDC_OPS_DISCORD_WEBHOOK_URL: "https://discord.example.invalid/webhook" },
        });
        expect(result.mode).toBe("webhook");
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain("webhook");
        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(body.components).toBeUndefined();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("sendOpsDiscordMessage uses webhookVaultKey when set", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));
      vi.stubGlobal("fetch", fetchMock);
      try {
        await sendOpsDiscordMessage({
          content: "agents",
          env: {
            HDC_OPS_DISCORD_WEBHOOK_URL: "https://discord.example.invalid/ops",
            HDC_AGENTS_DISCORD_WEBHOOK_URL: "https://discord.example.invalid/agents",
          },
          webhookVaultKey: "HDC_AGENTS_DISCORD_WEBHOOK_URL",
        });
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://discord.example.invalid/agents");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("sendOpsDiscordMessage falls back when agents webhook missing", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }));
      vi.stubGlobal("fetch", fetchMock);
      try {
        await sendOpsDiscordMessage({
          content: "fallback",
          env: { HDC_OPS_DISCORD_WEBHOOK_URL: "https://discord.example.invalid/ops" },
          webhookVaultKey: "HDC_AGENTS_DISCORD_WEBHOOK_URL",
          fallbackWebhookVaultKey: "HDC_OPS_DISCORD_WEBHOOK_URL",
        });
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://discord.example.invalid/ops");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("redactIpsFromText", () => {
    it("removes IPv4 and CIDR while preserving hostnames", () => {
      const input = "pi-hole-a at 192.0.2.5 and hypervisor-a 192.0.2.120/24 ok";
      const out = redactIpsFromText(input);
      expect(out).not.toContain("192.0.2.5");
      expect(out).not.toContain("192.0.2.120");
      expect(out).toContain("pi-hole-a");
      expect(out).toContain("hypervisor-a");
    });

    it("redacts IPv6 literals", () => {
      const out = redactIpsFromText("reach 2001:db8::1 from vm-bind-a");
      expect(out).not.toContain("2001:db8::1");
      expect(out).toContain("vm-bind-a");
    });
  });

  describe("buildOperationReportDiscordSummary", () => {
    it("builds a one-line summary without IPs", () => {
      const { title, message } = buildOperationReportDiscordSummary({
        clumpId: "pi-hole",
        clumpTitle: "Pi-hole",
        verb: "maintain",
        collectedAt: "2026-01-01T00:00:00.000Z",
        dryRun: false,
        flags: {},
        steps: [
          { id: "a", title: "Allowlist sync", ran: true, ok: true, notes: [] },
          { id: "b", title: "Gravity update", ran: true, ok: true, notes: [] },
        ],
        warnings: [],
        ok: true,
        exitCode: 0,
        stdoutPayload: {
          instances: [
            { system_id: "pi-hole-a", ok: true, message: "synced at 192.0.2.2" },
            { system_id: "pi-hole-b", ok: true },
          ],
        },
        inventory: [],
        manifestNextSteps: [],
        reportPath: null,
        repoRoot: null,
        argvFlags: [],
      });
      expect(title).toBe("Pi-hole maintain — OK");
      expect(message).toContain("pi-hole-a");
      expect(message).toContain("pi-hole-b");
      expect(message).toContain("2/2 steps ok");
      expect(message).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    });
  });

  describe("buildProxmoxMaintainDiscordSummary", () => {
    it("includes step counts and down host names", () => {
      const { title, message } = buildProxmoxMaintainDiscordSummary({
        collectedAt: "2026-01-01T00:00:00.000Z",
        dryRun: true,
        flags: { dryRun: true },
        steps: [{ id: "ssh", title: "SSH keys", ran: true, ok: true, notes: [] }],
        warnings: [],
        capacity: null,
        templateChecks: [],
        downHosts: ["hypervisor-c"],
        exitCode: 0,
        reportPath: null,
      });
      expect(title).toContain("Proxmox maintain");
      expect(title).toContain("dry-run");
      expect(message).toContain("1/1 steps ok");
      expect(message).toContain("hypervisor-c");
    });
  });

  describe("maybeNotifyOpsDiscordFromOperationReport", () => {
    /** @type {string | undefined} */
    let prevNotifyEnv;

    beforeEach(() => {
      prevNotifyEnv = process.env[OPS_DISCORD_NOTIFY_ENV];
      process.env[OPS_DISCORD_NOTIFY_ENV] = "1";
    });

    afterEach(() => {
      if (prevNotifyEnv === undefined) delete process.env[OPS_DISCORD_NOTIFY_ENV];
      else process.env[OPS_DISCORD_NOTIFY_ENV] = prevNotifyEnv;
      vi.restoreAllMocks();
    });

    it("skips query and teardown", () => {
      const base = {
        clumpId: "bind",
        clumpTitle: "BIND",
        collectedAt: "",
        dryRun: false,
        flags: {},
        steps: [],
        warnings: [],
        ok: true,
        exitCode: 0,
        stdoutPayload: null,
        inventory: [],
        manifestNextSteps: [],
        reportPath: null,
        repoRoot: null,
        argvFlags: [],
      };
      expect(maybeNotifyOpsDiscordFromOperationReport({ ...base, verb: "query" }).skipped).toBe(true);
      expect(maybeNotifyOpsDiscordFromOperationReport({ ...base, verb: "teardown" }).skipped).toBe(true);
    });

    it("skips when --no-discord-notify is set", () => {
      const r = maybeNotifyOpsDiscordFromOperationReport({
        clumpId: "bind",
        clumpTitle: "BIND",
        verb: "maintain",
        collectedAt: "",
        dryRun: false,
        flags: { noDiscordNotify: true },
        steps: [],
        warnings: [],
        ok: true,
        exitCode: 0,
        stdoutPayload: null,
        inventory: [],
        manifestNextSteps: [],
        reportPath: null,
        repoRoot: null,
        argvFlags: ["--no-discord-notify"],
      });
      expect(r.skipped).toBe(true);
    });

    it("invokes notify script for deploy/maintain", () => {
      spawnSyncMock.mockClear();
      const r = maybeNotifyOpsDiscordFromOperationReport({
        clumpId: "pi-hole",
        clumpTitle: "Pi-hole",
        verb: "maintain",
        collectedAt: "",
        dryRun: false,
        flags: {},
        steps: [],
        warnings: [],
        ok: true,
        exitCode: 0,
        stdoutPayload: { system_id: "pi-hole-a", ok: true },
        inventory: [],
        manifestNextSteps: [],
        reportPath: null,
        repoRoot: null,
        argvFlags: [],
      });
      expect(r.ok).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalled();
      const args = spawnSyncMock.mock.calls[0]?.[1];
      expect(args).toContain("--title");
      expect(args).toContain("Pi-hole maintain — OK");
    });
  });

  describe("sendOpsDiscordNotifyBestEffort", () => {
    it("returns skipped for empty content", () => {
      expect(sendOpsDiscordNotifyBestEffort({ title: "", message: "" }).skipped).toBe(true);
    });

    it("forwards --silent to notify script", () => {
      spawnSyncMock.mockClear();
      sendOpsDiscordNotifyBestEffort({
        title: "Job OK",
        message: "done",
        silent: true,
      });
      const args = spawnSyncMock.mock.calls[0]?.[1];
      expect(args).toContain("--silent");
    });
  });

  describe("maybeNotifyOpsDiscordFromProxmoxMaintain", () => {
    it("skips when notify disabled via env", () => {
      const prev = process.env[OPS_DISCORD_NOTIFY_ENV];
      process.env[OPS_DISCORD_NOTIFY_ENV] = "0";
      try {
        const r = maybeNotifyOpsDiscordFromProxmoxMaintain({
          collectedAt: "",
          dryRun: false,
          flags: {},
          steps: [],
          warnings: [],
          capacity: null,
          templateChecks: [],
          downHosts: [],
          exitCode: 0,
          reportPath: null,
        });
        expect(r.skipped).toBe(true);
      } finally {
        if (prev === undefined) delete process.env[OPS_DISCORD_NOTIFY_ENV];
        else process.env[OPS_DISCORD_NOTIFY_ENV] = prev;
      }
    });
  });
});
