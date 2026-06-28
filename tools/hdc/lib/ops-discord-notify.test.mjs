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
  buildOperationReportDiscordSummary,
  buildProxmoxMaintainDiscordSummary,
  DISCORD_SUPPRESS_NOTIFICATIONS_FLAG,
  formatDiscordContent,
  maybeNotifyOpsDiscordFromOperationReport,
  maybeNotifyOpsDiscordFromProxmoxMaintain,
  OPS_DISCORD_HOST_ENV,
  OPS_DISCORD_NOTIFY_ENV,
  postDiscordWebhook,
  redactIpsFromText,
  resolveOpsDiscordHost,
  sendOpsDiscordNotifyBestEffort,
} from "./ops-discord-notify.mjs";

describe("ops-discord-notify", () => {
  describe("formatDiscordContent", () => {
    it("includes host in header when provided", () => {
      const content = formatDiscordContent("Pi-hole maintain — OK", "completed", {
        host: "hdc-runner-a",
      });
      expect(content).toBe("**Pi-hole maintain — OK** · `hdc-runner-a`\n\ncompleted");
    });

    it("resolveOpsDiscordHost prefers HDC_OPS_DISCORD_HOST", () => {
      const prev = process.env[OPS_DISCORD_HOST_ENV];
      process.env[OPS_DISCORD_HOST_ENV] = "custom-host";
      try {
        expect(resolveOpsDiscordHost()).toBe("custom-host");
      } finally {
        if (prev === undefined) delete process.env[OPS_DISCORD_HOST_ENV];
        else process.env[OPS_DISCORD_HOST_ENV] = prev;
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

  describe("redactIpsFromText", () => {
    it("removes IPv4 and CIDR while preserving hostnames", () => {
      const input = "pi-hole-a at 10.0.0.5 and hypervisor-a 192.0.2.120/24 ok";
      const out = redactIpsFromText(input);
      expect(out).not.toContain("10.0.0.5");
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
        packageId: "pi-hole",
        packageTitle: "Pi-hole",
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
            { system_id: "pi-hole-a", ok: true, message: "synced at 10.0.0.2" },
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
        packageId: "bind",
        packageTitle: "BIND",
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
        packageId: "bind",
        packageTitle: "BIND",
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
        packageId: "pi-hole",
        packageTitle: "Pi-hole",
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
