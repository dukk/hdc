import { describe, expect, it, vi } from "vitest";
import {
  diffOllamaModels,
  listOllamaModels,
  normalizeModelNames,
  parseOllamaListOutput,
  parseOllamaTagsJson,
  parseOllamaTagsResponse,
  syncOllamaModels,
} from "../../../clumps/services/ollama/lib/ollama-models.mjs";

describe("ollama models", () => {
  it("normalizeModelNames accepts strings and objects", () => {
    expect(
      normalizeModelNames({
        models: ["llama3.2:latest", { name: "nomic-embed-text" }, "llama3.2:latest", "", { name: "  " }],
      }),
    ).toEqual(["llama3.2:latest", "nomic-embed-text"]);
  });

  it("normalizeModelNames returns empty for missing block", () => {
    expect(normalizeModelNames(null)).toEqual([]);
    expect(normalizeModelNames({})).toEqual([]);
  });

  it("diffOllamaModels computes pull and remove sets", () => {
    const { pull, remove } = diffOllamaModels(
      ["a:latest", "b:latest"],
      ["a:latest", "c:latest"],
    );
    expect(pull).toEqual(["b:latest"]);
    expect(remove).toEqual(["c:latest"]);
  });

  it("parseOllamaListOutput skips header and reads NAME column", () => {
    const out = `NAME              ID              SIZE      MODIFIED
llama3.2:latest   abc123          2.0 GB    2 days ago
nomic-embed-text  def456          274 MB    1 week ago`;
    expect(parseOllamaListOutput(out)).toEqual(["llama3.2:latest", "nomic-embed-text"]);
  });

  it("parseOllamaTagsJson reads models[].name", () => {
    const json = JSON.stringify({
      models: [{ name: "llama3.2:latest" }, { name: "qwen2.5:7b" }],
    });
    expect(parseOllamaTagsJson(json)).toEqual(["llama3.2:latest", "qwen2.5:7b"]);
  });

  it("parseOllamaTagsResponse accepts empty models array", () => {
    expect(parseOllamaTagsResponse('{"models":[]}')).toEqual({ models: [] });
    expect(parseOllamaTagsResponse("not json")).toBeNull();
  });

  it("listOllamaModels treats empty API tags as success", async () => {
    const exec = {
      label: "test",
      run: vi.fn((cmd) => {
        if (String(cmd).includes("ollama list")) {
          return { status: 1, stdout: "", stderr: "" };
        }
        return {
          status: 0,
          stdout: JSON.stringify({ models: [] }),
          stderr: "",
        };
      }),
    };
    const listed = await listOllamaModels(exec);
    expect(listed).toEqual({ ok: true, models: [] });
  });

  it("syncOllamaModels pulls when live inventory is empty", async () => {
    const pulled = [];
    const exec = {
      label: "test",
      run: vi.fn((cmd) => {
        const c = String(cmd);
        if (c.includes("ollama list")) {
          return { status: 0, stdout: "NAME\n", stderr: "" };
        }
        if (c.includes("api/tags")) {
          return { status: 0, stdout: JSON.stringify({ models: [] }), stderr: "" };
        }
        if (c.includes("ollama pull")) {
          pulled.push(c);
          return { status: 0, stdout: "", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      }),
    };
    const sync = await syncOllamaModels(exec, ["llama3.2:3b"], {}, {});
    expect(sync.ok).toBe(true);
    expect(sync.pulled).toEqual(["llama3.2:3b"]);
    expect(pulled.length).toBe(1);
  });
});
