import { describe, expect, it, vi } from "vitest";

import { buildAugmentAgentCard, augmentBridgeConfigFromEnv } from "./agent-card.mjs";
import { runCursorCloudAugment } from "./adapters.mjs";

describe("hdc-augment-bridge", () => {
  it("builds augmentor agent card with hdc-a2a tags", () => {
    const card = buildAugmentAgentCard({
      name: "cursor-cloud-hdc",
      hostHeader: "127.0.0.1:9210",
      runtime: "cursor-cloud",
      repos: ["hdc"],
      delegatableBy: ["hdc-engineer"],
    });
    expect(card.name).toBe("cursor-cloud-hdc");
    expect(card.description).toContain("kind=augmentor");
    expect(card.description).toContain("runtime=cursor-cloud");
  });

  it("parses bridge config from env", () => {
    const cfg = augmentBridgeConfigFromEnv({
      HDC_AUGMENT_BRIDGE_NAME: "cursor-cli-hdc",
      HDC_AUGMENT_RUNTIME: "cursor-cli",
      HDC_AUGMENT_REPOS: "hdc",
      HDC_AUGMENT_DELEGATABLE_BY: "hdc-engineer",
      HDC_AUGMENT_BRIDGE_PORT: "9211",
    });
    expect(cfg.name).toBe("cursor-cli-hdc");
    expect(cfg.repos).toEqual(["hdc"]);
    expect(cfg.port).toBe(9211);
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
