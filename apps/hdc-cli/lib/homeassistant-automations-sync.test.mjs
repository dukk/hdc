import { describe, expect, it, vi } from "vitest";

import {
  automationConfigBody,
  selectManagedAutomations,
  syncManagedAutomations,
} from "hdc/clump/services/homeassistant/lib/ha-automations-sync.mjs";

describe("selectManagedAutomations", () => {
  const entries = [
    { id: "a", managed: true, config: { alias: "A" } },
    { id: "b", managed: false, config: { alias: "B" } },
    { id: "c", config: { alias: "C" } },
    { id: "d", managed: true },
    { id: "", managed: true, config: {} },
    "skip-me",
  ];

  it("selects only managed entries with config", () => {
    expect(selectManagedAutomations(entries).map((e) => e.id)).toEqual(["a"]);
  });

  it("filters by automation id", () => {
    const multi = [
      { id: "a", managed: true, config: { alias: "A" } },
      { id: "z", managed: true, config: { alias: "Z" } },
    ];
    expect(selectManagedAutomations(multi, { automationId: "z" }).map((e) => e.id)).toEqual([
      "z",
    ]);
  });

  it("returns empty for non-arrays", () => {
    expect(selectManagedAutomations(null)).toEqual([]);
    expect(selectManagedAutomations(undefined)).toEqual([]);
  });
});

describe("automationConfigBody", () => {
  it("injects sidecar id into config body", () => {
    expect(
      automationConfigBody({
        id: "front_porch_light_sun",
        config: { alias: "Porch", id: "wrong" },
      }),
    ).toEqual({ alias: "Porch", id: "front_porch_light_sun" });
  });
});

describe("syncManagedAutomations", () => {
  it("dry-run skips POST", async () => {
    const post = vi.fn();
    const client = { post };
    const log = vi.fn();
    const result = await syncManagedAutomations({
      client,
      automations: [{ id: "a", managed: true, config: { alias: "A" } }],
      dryRun: true,
      log,
    });
    expect(post).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      results: [{ id: "a", action: "dry_run", ok: true }],
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("dry-run"));
  });

  it("POSTs each managed automation", async () => {
    const post = vi.fn().mockResolvedValue({});
    const client = { post };
    const result = await syncManagedAutomations({
      client,
      automations: [
        { id: "a", managed: true, config: { alias: "A" } },
        { id: "b", managed: true, config: { alias: "B" } },
        { id: "c", managed: false, config: { alias: "C" } },
      ],
    });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, "/api/config/automation/config/a", {
      alias: "A",
      id: "a",
    });
    expect(post).toHaveBeenNthCalledWith(2, "/api/config/automation/config/b", {
      alias: "B",
      id: "b",
    });
    expect(result.ok).toBe(true);
    expect(result.results).toEqual([
      { id: "a", action: "upsert", ok: true },
      { id: "b", action: "upsert", ok: true },
    ]);
  });

  it("records failure and continues", async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValueOnce({});
    const client = { post };
    const result = await syncManagedAutomations({
      client,
      automations: [
        { id: "a", managed: true, config: { alias: "A" } },
        { id: "b", managed: true, config: { alias: "B" } },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({
      id: "a",
      action: "upsert",
      ok: false,
      message: "HTTP 500",
    });
    expect(result.results[1]).toEqual({ id: "b", action: "upsert", ok: true });
  });

  it("filters with automationId", async () => {
    const post = vi.fn().mockResolvedValue({});
    const client = { post };
    await syncManagedAutomations({
      client,
      automations: [
        { id: "a", managed: true, config: { alias: "A" } },
        { id: "b", managed: true, config: { alias: "B" } },
      ],
      automationId: "b",
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/api/config/automation/config/b", {
      alias: "B",
      id: "b",
    });
  });
});
