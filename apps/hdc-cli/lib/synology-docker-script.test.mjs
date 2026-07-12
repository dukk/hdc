import { describe, expect, it } from "vitest";

import {
  assertSafeComposePath,
  buildComposeDownScript,
  buildComposeMaintainScript,
  buildComposeUpScript,
  composeDirFromStack,
} from "../../../clumps/infrastructure/synology-nas/lib/synology-docker-compose.mjs";

describe("assertSafeComposePath", () => {
  it("accepts valid absolute paths", () => {
    expect(() => assertSafeComposePath("/volume1/docker/myapp")).not.toThrow();
  });

  it("rejects parent traversal", () => {
    expect(() => assertSafeComposePath("/volume1/../etc")).toThrow(/unsafe/);
  });

  it("rejects empty path", () => {
    expect(() => assertSafeComposePath("")).toThrow(/unsafe/);
  });
});

describe("composeDirFromStack", () => {
  it("builds path under base dir", () => {
    expect(composeDirFromStack("my-app", "/volume1/docker")).toBe("/volume1/docker/my-app");
  });

  it("sanitizes stack id", () => {
    expect(composeDirFromStack("My App!", "/volume1/docker")).toBe("/volume1/docker/my-app-");
  });
});

describe("buildComposeUpScript", () => {
  it("writes compose file and runs docker compose", () => {
    const script = buildComposeUpScript({
      dir: "/volume1/docker/test",
      composeYaml: "services:\n  web:\n    image: nginx",
      envContent: "FOO=bar",
      pull: true,
    });
    expect(script).toContain("mkdir -p '/volume1/docker/test'");
    expect(script).toContain("HDCCOMPOSE");
    expect(script).toContain("HDCENV");
    expect(script).toContain("docker compose pull");
    expect(script).toContain("docker compose up -d");
  });

  it("escapes single quotes in paths", () => {
    const script = buildComposeUpScript({
      dir: "/volume1/docker/o'brien",
      composeYaml: "services: {}",
    });
    expect(script).toContain("o'\\''brien");
  });
});

describe("buildComposeMaintainScript", () => {
  it("requires docker-compose.yml", () => {
    const script = buildComposeMaintainScript({ dir: "/volume1/docker/x", pull: false });
    expect(script).toContain("test -f docker-compose.yml");
    expect(script).not.toContain("docker compose pull");
  });
});

describe("buildComposeDownScript", () => {
  it("adds -v when removeVolumes", () => {
    const script = buildComposeDownScript({ dir: "/volume1/docker/x", removeVolumes: true });
    expect(script).toContain("docker compose down -v");
  });
});
