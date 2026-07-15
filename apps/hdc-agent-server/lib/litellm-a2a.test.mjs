import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  filterAugmentors,
  isAugmentationEnabled,
  listA2aAgents,
  listAugmentorsForRole,
  loadA2aAgentsFromLitellmConfig,
  pickAugmentor,
  postA2aMessage,
} from "./litellm-a2a.mjs";

describe("litellm-a2a", () => {
  it("loads a2a_agents from hdc-private litellm config", () => {
    const dir = mkdtempSync(join(tmpdir(), "hdc-litellm-"));
    try {
      mkdirSync(join(dir, "clumps", "services", "litellm"), { recursive: true });
      writeFileSync(
        join(dir, "clumps", "services", "litellm", "config.json"),
        JSON.stringify({
          defaults: {
            litellm: {
              a2a_agents: [
                {
                  name: "cursor-cli-hdc",
                  url: "http://10.0.0.5:9211",
                  kind: "augmentor",
                  repos: ["hdc"],
                  delegatable_by: ["hdc-engineer"],
                },
              ],
            },
          },
        }),
        "utf8",
      );
      const agents = loadA2aAgentsFromLitellmConfig(dir);
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({ name: "cursor-cli-hdc" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("filters augmentors by role and repo", () => {
    const agents = [
      { name: "hdc-engineer", kind: "fleet", url: "http://x:9207" },
      {
        name: "cursor-cli-hdc",
        kind: "augmentor",
        runtime: "cursor-cli",
        repos: ["hdc"],
        delegatable_by: ["hdc-engineer"],
        url: "http://x:9211",
      },
      {
        name: "cursor-cli-clumps",
        kind: "augmentor",
        runtime: "cursor-cli",
        repos: ["hdc-clumps"],
        delegatable_by: ["hdc-sre-engineer"],
        url: "http://x:9212",
      },
    ];
    const hdc = filterAugmentors(agents, { delegatorRole: "hdc-engineer", repo: "hdc" });
    expect(hdc.map((a) => /** @type {Record<string, unknown>} */ (a).name)).toEqual(["cursor-cli-hdc"]);
    const picked = pickAugmentor(agents, {
      delegatorRole: "hdc-sre-engineer",
      repo: "hdc-clumps",
    });
    expect(picked).toMatchObject({ name: "cursor-cli-clumps" });
  });

  it("lists augmentors from config when API is unavailable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hdc-litellm-"));
    try {
      mkdirSync(join(dir, "clumps", "services", "litellm"), { recursive: true });
      writeFileSync(
        join(dir, "clumps", "services", "litellm", "config.json"),
        JSON.stringify({
          defaults: {
            litellm: {
              a2a_agents: [
                {
                  name: "cursor-cloud-hdc",
                  url: "http://192.0.2.117:9210",
                  kind: "augmentor",
                  runtime: "cursor-cloud",
                  repos: ["hdc"],
                  delegatable_by: ["hdc-engineer"],
                },
              ],
            },
          },
        }),
        "utf8",
      );
      const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
      const list = await listAugmentorsForRole({
        privateRoot: dir,
        delegatorRole: "hdc-engineer",
        repo: "hdc",
        fetchImpl,
      });
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("cursor-cloud-hdc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("posts A2A message through LiteLLM gateway", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: { taskId: "task-abc" },
        }),
    });
    const data = await postA2aMessage({
      gatewayUrl: "http://litellm:4000",
      agentName: "cursor-cli-hdc",
      apiKey: "sk-test",
      text: "fix docs lint",
      fetchImpl,
    });
    expect(data.result).toMatchObject({ taskId: "task-abc" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://litellm:4000/a2a/cursor-cli-hdc",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reads augmentation enabled from hdc-agents config", () => {
    const dir = mkdtempSync(join(tmpdir(), "hdc-agents-"));
    try {
      mkdirSync(join(dir, "clumps", "services", "hdc-agents"), { recursive: true });
      writeFileSync(
        join(dir, "clumps", "services", "hdc-agents", "config.json"),
        JSON.stringify({ defaults: { hdc_agents: { augmentation: { enabled: true } } } }),
        "utf8",
      );
      expect(isAugmentationEnabled(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
