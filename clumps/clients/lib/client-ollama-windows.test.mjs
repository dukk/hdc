import { describe, expect, it } from "vitest";
import {
  buildRemoteOllamaScript,
  hostOllamaEnabled,
  loadInstallOllamaServiceScript,
  resolveHostOllamaOpts,
} from "./client-ollama-windows.mjs";

describe("client-ollama-windows", () => {
  it("hostOllamaEnabled requires explicit true", () => {
    expect(hostOllamaEnabled({})).toBe(false);
    expect(hostOllamaEnabled({ ollama: { enabled: false } })).toBe(false);
    expect(hostOllamaEnabled({ ollama: { enabled: true } })).toBe(true);
  });

  it("resolveHostOllamaOpts applies defaults and normalizes models", () => {
    const opts = resolveHostOllamaOpts({
      ollama: {
        enabled: true,
        models: ["llama3.2:latest", { name: "nomic-embed-text" }, ""],
        listen: "127.0.0.1",
      },
    });
    expect(opts.enabled).toBe(true);
    expect(opts.listen).toBe("127.0.0.1");
    expect(opts.installDir).toBe("C:\\Program Files\\Ollama");
    expect(opts.modelsDir).toBe("C:\\ProgramData\\Ollama\\models");
    expect(opts.serviceName).toBe("Ollama");
    expect(opts.models).toEqual(["llama3.2:latest", "nomic-embed-text"]);
    expect(opts.scheduleEnabled).toBe(false);
    expect(opts.scheduleStart).toBe("23:00");
    expect(opts.scheduleStop).toBe("08:00");
  });

  it("resolveHostOllamaOpts reads night schedule", () => {
    const opts = resolveHostOllamaOpts({
      ollama: {
        enabled: true,
        schedule: { enabled: true, start_local: "23:00", stop_local: "08:00" },
      },
    });
    expect(opts.scheduleEnabled).toBe(true);
    expect(opts.scheduleStart).toBe("23:00");
    expect(opts.scheduleStop).toBe("08:00");
  });

  it("loadInstallOllamaServiceScript reads the ps1", () => {
    const body = loadInstallOllamaServiceScript();
    expect(body).toContain("Install-OllamaService");
    expect(body).toContain("nssm");
    expect(body).toContain("ollama-windows-amd64.zip");
    expect(body).toContain("HDC-Ollama-Start");
    expect(body).toContain("ScheduleEnabled");
  });

  it("buildRemoteOllamaScript embeds script and parameters", () => {
    const remote = buildRemoteOllamaScript({
      ollama: resolveHostOllamaOpts({
        ollama: {
          enabled: true,
          models: ["llama3.2:latest"],
          version: "v0.32.0",
          include_rocm: true,
          schedule: { enabled: true, start_local: "23:00", stop_local: "08:00" },
        },
      }),
      dryRun: true,
      skipModels: true,
    });
    expect(remote).toContain("FromBase64String");
    expect(remote).toContain("-DryRun");
    expect(remote).toContain("-SkipModels");
    expect(remote).toContain("-IncludeRocm");
    expect(remote).toContain("-Version 'v0.32.0'");
    expect(remote).toContain("llama3.2:latest");
    expect(remote).toContain("-ScheduleEnabled");
    expect(remote).toContain("-ScheduleStart '23:00'");
    expect(remote).toContain("-ScheduleStop '08:00'");
  });
});
