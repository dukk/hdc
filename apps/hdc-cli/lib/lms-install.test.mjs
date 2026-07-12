import { describe, expect, it } from "vitest";
import {
  buildInstallShellScript,
  buildSystemdExecStartLine,
  resolveLinuxUser,
} from "../../../clumps/services/lms/lib/lms-install.mjs";

describe("lms install", () => {
  const install = { linux_user: "lms", gpu: false };
  const lms = {
    models: ["openai/gpt-oss-20b"],
    load_on_start: "openai/gpt-oss-20b",
    server: { host: "0.0.0.0", port: 1234 },
  };

  it("resolveLinuxUser defaults to lms", () => {
    expect(resolveLinuxUser({})).toBe("lms");
    expect(resolveLinuxUser({ linux_user: "lmstudio" })).toBe("lmstudio");
  });

  it("buildInstallShellScript includes install.sh and systemd", () => {
    const script = buildInstallShellScript(install, lms);
    expect(script).toContain("lmstudio.ai/install.sh");
    expect(script).toContain("libatomic1");
    expect(script).toContain("lmstudio.service");
    expect(script).toContain("lms daemon up");
    expect(script).toContain("lms load");
    expect(script).toContain("gpt-oss-20b");
  });

  it("buildSystemdExecStartLine binds when host is 0.0.0.0", () => {
    const line = buildSystemdExecStartLine(install, lms);
    expect(line).toContain("server start --bind 0.0.0.0 --port 1234");
  });

  it("buildSystemdExecStartLine omits bind for localhost", () => {
    const line = buildSystemdExecStartLine(install, {
      server: { host: "127.0.0.1", port: 1234 },
    });
    expect(line).toBe("/home/lms/.lmstudio/bin/lms server start");
    expect(line).not.toContain("--bind");
  });

  it("includes nvidia driver block when gpu enabled", () => {
    const script = buildInstallShellScript(
      { linux_user: "lms", gpu: true, gpu_backend: "nvidia" },
      { server: { host: "0.0.0.0", port: 1234 } },
    );
    expect(script).toContain("ubuntu-drivers");
  });
});
