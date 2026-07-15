import { describe, expect, it } from "vitest";
import { buildInstallScript } from "hdc/clump/services/postiz/lib/postiz-install.mjs";

describe("postiz install script", () => {
  it("expands PNPM_BIN in systemd ExecStart (not literal ${PNPM_BIN})", () => {
    const script = buildInstallScript(
      "/opt/postiz",
      "DATABASE_URL=x\n",
      "v1.0.0",
      "https://github.com/gitroomhq/postiz-app/archive/refs/tags/v1.0.0.tar.gz",
    );
    expect(script).toContain("PNPM_BIN=$(command -v pnpm)");
    expect(script).toContain('test -n "$PNPM_BIN" && test -x "$PNPM_BIN"');
    expect(script).toContain("ExecStart=$PNPM_BIN run start:prod:backend");
    expect(script).toContain("ExecStart=$PNPM_BIN run start:prod:frontend");
    expect(script).toContain("ExecStart=$PNPM_BIN run start:prod:orchestrator");
    expect(script).not.toContain("ExecStart=${PNPM_BIN}");
  });

  it("finds postiz source dir with grouped find predicates", () => {
    const script = buildInstallScript("/opt/postiz", "X=1\n", "v1.0.0", "https://example.invalid/t.tar.gz");
    expect(script).toContain(
      "find /tmp -maxdepth 1 -type d \\( -name 'postiz-app-*' -o -name 'postiz-*' \\)",
    );
  });

  it("resolves temporal binary after tarball extract", () => {
    const script = buildInstallScript("/opt/postiz", "X=1\n", "v1.0.0", "https://example.invalid/t.tar.gz");
    expect(script).toContain('find /opt/temporal -maxdepth 3 -type f -name temporal');
    expect(script).toContain('if [ "$TEMPORAL_BIN" != /opt/temporal/temporal ]; then ln -sf');
  });
});
