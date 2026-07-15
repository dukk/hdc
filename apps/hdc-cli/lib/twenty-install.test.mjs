import { describe, expect, it } from "vitest";
import {
  buildMaintainScript,
  buildPostgresPasswordSyncLines,
  buildStagedComposeUpLines,
} from "hdc/clump/services/twenty/lib/twenty-install.mjs";
import {
  buildEncryptionKeyGuardLines,
  buildSigningKeyLogHealLines,
} from "hdc/clump/services/twenty/lib/twenty-signing-key-heal.mjs";

describe("twenty install scripts", () => {
  it("buildPostgresPasswordSyncLines guards fresh volume and verifies auth", () => {
    const lines = buildPostgresPasswordSyncLines().join("\n");
    expect(lines).toContain("/var/lib/postgresql/data/PG_VERSION");
    expect(lines).toContain("ALTER USER ${DB_USER} PASSWORD");
    expect(lines).toContain('PGPASSWORD="$PW"');
    expect(lines).toContain('psql -U "${DB_USER}" -h localhost -d postgres -c "SELECT 1"');
    expect(lines).not.toMatch(/ALTER USER.*\|\| true/);
  });

  it("buildStagedComposeUpLines uses staged startup without sourcing .env", () => {
    const script = buildStagedComposeUpLines("/opt/twenty").join("\n");
    expect(script).toContain("docker compose up -d db redis");
    expect(script).toContain("docker compose up -d --no-deps server");
    expect(script).toContain("docker compose up -d --no-deps worker");
    expect(script).toContain("/healthz");
    expect(script).toContain("ALTER USER ${DB_USER} PASSWORD");
    expect(script).not.toContain("source .env");
  });

  it("buildStagedComposeUpLines includes encryption key guard and JWT heal when id provided", () => {
    const script = buildStagedComposeUpLines("/opt/twenty", {
      encryptionKeyId: "70a204b5",
    }).join("\n");
    expect(script).toContain("encryption-key-id");
    expect(script).toContain('DELETE FROM core."signingKey"');
    expect(script).toContain("No active signing key available to sign asymmetric token");
  });

  it("buildEncryptionKeyGuardLines skips purge when FALLBACK_ENCRYPTION_KEY is set", () => {
    const lines = buildEncryptionKeyGuardLines("/opt/twenty", "abcd1234").join("\n");
    expect(lines).toContain("FALLBACK_ENCRYPTION_KEY");
    expect(lines).toContain('[ -z "$FALLBACK" ]');
  });

  it("buildSigningKeyLogHealLines restarts server on JWT signing errors", () => {
    const lines = buildSigningKeyLogHealLines().join("\n");
    expect(lines).toContain("docker compose restart server worker");
    expect(lines).toContain("No active signing key available to sign asymmetric token");
  });

  it("buildMaintainScript ends with final /healthz probe", () => {
    const script = buildMaintainScript("/opt/twenty", "services:\n  server:\n    image: x", "PG_DATABASE_PASSWORD=abc");
    expect(script).toContain('curl -sf --max-time 10 "http://127.0.0.1:${HOST_PORT}/healthz"');
    expect(script.trim().split("\n").at(-1)).toContain("/healthz");
  });
});
