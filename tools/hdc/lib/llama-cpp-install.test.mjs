import { describe, expect, it } from "vitest";
import {
  buildLlamaServerArgv,
  formatSystemdExecStart,
  releaseDownloadUrl,
  resolveReleaseAsset,
  serverHasModel,
} from "../../../packages/services/llama-cpp/lib/llama-cpp-install.mjs";

describe("llama-cpp install", () => {
  it("resolveReleaseAsset maps backends", () => {
    expect(resolveReleaseAsset("cpu", "b100")).toBe("llama-b100-bin-ubuntu-x64.tar.gz");
    expect(resolveReleaseAsset("cuda", "b100", { cudaVersion: "12.4" })).toBe(
      "llama-b100-bin-ubuntu-cuda-12.4-x64.tar.gz",
    );
    expect(resolveReleaseAsset("vulkan", "b100")).toBe("llama-b100-bin-ubuntu-vulkan-x64.tar.gz");
    expect(resolveReleaseAsset("rocm", "b100", { rocmVersion: "7.2" })).toBe(
      "llama-b100-bin-ubuntu-rocm-7.2-x64.tar.gz",
    );
  });

  it("releaseDownloadUrl encodes tag and asset", () => {
    const url = releaseDownloadUrl("b8485", "llama-b8485-bin-ubuntu-x64.tar.gz");
    expect(url).toBe(
      "https://github.com/ggml-org/llama.cpp/releases/download/b8485/llama-b8485-bin-ubuntu-x64.tar.gz",
    );
  });

  it("buildLlamaServerArgv includes model or hf", () => {
    expect(buildLlamaServerArgv({ port: 9000, model: "/var/lib/llama-cpp/models/x.gguf" })).toEqual([
      "--host",
      "0.0.0.0",
      "--port",
      "9000",
      "-m",
      "/var/lib/llama-cpp/models/x.gguf",
    ]);
    expect(buildLlamaServerArgv({ hf_model: "ggml-org/gemma-3-1b-it-GGUF" })).toContain("-hf");
  });

  it("rejects model and hf_model together", () => {
    expect(() =>
      buildLlamaServerArgv({ model: "/a.gguf", hf_model: "org/repo" }),
    ).toThrow(/mutually exclusive/);
  });

  it("formatSystemdExecStart quotes paths with spaces", () => {
    const line = formatSystemdExecStart(["-m", "/var/lib/a b/model.gguf"]);
    expect(line).toContain('"/var/lib/a b/model.gguf"');
  });

  it("serverHasModel detects configured model", () => {
    expect(serverHasModel({})).toBe(false);
    expect(serverHasModel({ model: "  " })).toBe(false);
    expect(serverHasModel({ model: "/x.gguf" })).toBe(true);
    expect(serverHasModel({ hf_model: "org/repo" })).toBe(true);
  });
});
