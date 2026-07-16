import { describe, expect, it, vi } from "vitest";

import { buildAugmentAgentCard, augmentBridgeConfigFromEnv } from "./agent-card.mjs";
import { runCursorCloudAugment } from "./adapters.mjs";

describe("hdc-augment-bridge", () => {
  it("builds augmentor agent card with hdc-a2a tags", () => {
    const card = buildAugmentAgentCard({
      name: "cursor-cloud-clumps",
      hostHeader: "127.0.0.1:9210",
      runtime: "cursor-cloud",
      repos: ["hdc-clumps"],
      delegatableBy: ["hdc-sre-engineer"],
    });
    expect(card.name).toBe("cursor-cloud-clumps");
    expect(card.description).toContain("kind=augmentor");
    expect(card.description).toContain("runtime=cursor-cloud");
  });

  it("parses bridge config from env", () => {
    const cfg = augmentBridgeConfigFromEnv({
      HDC_AUGMENT_BRIDGE_NAME: "cursor-cli-clumps",
      HDC_AUGMENT_RUNTIME: "cursor-cli",
      HDC_AUGMENT_REPOS: "hdc-clumps",
      HDC_AUGMENT_DELEGATABLE_BY: "hdc-sre-engineer",
      HDC_AUGMENT_BRIDGE_PORT: "9211",
    });
    expect(cfg.name).toBe("cursor-cli-clumps");
    expect(cfg.repos).toEqual(["hdc-clumps"]);
    expect(cfg.port).toBe(9211);
  });

  it("defaults repos to hdc-clumps without hdc-engineer", () => {
    const cfg = augmentBridgeConfigFromEnv({});
    expect(cfg.repos).toEqual(["hdc-clumps"]);
    expect(cfg.delegatableBy).not.toContain("hdc-engineer");
    expect(cfg.delegatableBy).toContain("hdc-sre-engineer");
  });

  it("calls Cursor Cloud API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          agent: { id: "ag_1" },
          run: { id: "run_1" },
        }),
    });
    const result = await runCursorCloudAugment({
      apiKey: "key",
      prompt: "fix lint",
      repositoryUrl: "https://github.com/example/hdc",
      fetchImpl,
    });
    expect(result.task_id).toBe("run_1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.cursor.com/v1/agents",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
