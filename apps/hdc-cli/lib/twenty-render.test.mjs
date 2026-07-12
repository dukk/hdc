import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  generateTwentyDbPassword,
  hostPort,
  renderComposeYaml,
  renderTwentyEnv,
  resolveServerUrl,
  resolveWebUrl,
} from "../../../clumps/services/twenty/lib/twenty-render.mjs";
import {
  installMailRelayExampleMock,
  restoreMailRelayExampleMock,
} from "../test/mock-mail-relay-example.mjs";

const baseCfg = {
  image_tag: "v2.11.0",
  postgres_image_tag: "16",
  redis_image_tag: "7-alpine",
  host_port: 3000,
  storage_type: "local",
  multi_workspace_enabled: false,
};

const secrets = {
  encryptionKey: "dGVzdC1lbmNyeXB0aW9uLWtleS1iYXNlNjQ=",
  dbPassword: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
};

describe("twenty render", () => {
  beforeEach(() => {
    installMailRelayExampleMock();
  });

  afterEach(() => {
    restoreMailRelayExampleMock();
  });

  it("hostPort defaults to 3000", () => {
    expect(hostPort({})).toBe(3000);
    expect(hostPort({ host_port: 8080 })).toBe(8080);
  });

  it("renderComposeYaml includes all four services", () => {
    const yaml = renderComposeYaml();
    expect(yaml).toContain("server:");
    expect(yaml).toContain("worker:");
    expect(yaml).toContain("db:");
    expect(yaml).toContain("redis:");
    expect(yaml).toContain('DISABLE_DB_MIGRATIONS: "true"');
    expect(yaml).toContain("server-local-data:");
    expect(yaml).toContain("start_period: 120s");
    expect(yaml).toContain("retries: 40");
  });

  it("renderComposeYaml worker depends on server with service_started", () => {
    const yaml = renderComposeYaml();
    const workerBlock = yaml.slice(yaml.indexOf("worker:"));
    expect(workerBlock).toContain("server:");
    expect(workerBlock).toContain("condition: service_started");
    expect(workerBlock).not.toMatch(/server:\s*\n\s*condition: service_healthy/);
  });

  it("renderComposeYaml wires env_file on server and worker", () => {
    const yaml = renderComposeYaml();
    expect(yaml.match(/env_file:/g)?.length).toBe(2);
    expect(yaml).toContain("- .env");
  });

  it("renderTwentyEnv emits SMTP relay vars when mail.enabled", () => {
    const env = renderTwentyEnv(
      {
        ...baseCfg,
        public_url: "https://twenty.home.example.invalid",
        mail: {
          enabled: true,
          to: "ops@hdc.example.invalid",
          from: "noreply@hdc.example.invalid",
        },
      },
      secrets,
      "192.0.2.162",
    );
    expect(env).toContain("EMAIL_DRIVER=smtp");
    expect(env).toContain("EMAIL_SMTP_HOST=postfix-relay.home.example.invalid");
    expect(env).toContain("EMAIL_SMTP_PORT=25");
    expect(env).toContain("EMAIL_FROM_ADDRESS=noreply@hdc.example.invalid");
    expect(env).toContain('EMAIL_FROM_NAME="Twenty CRM"');
  });

  it("generateTwentyDbPassword is hex-only", () => {
    const pw = generateTwentyDbPassword();
    expect(pw).toMatch(/^[0-9a-f]+$/);
    expect(pw.length).toBe(64);
  });

  it("renderTwentyEnv uses public_url for SERVER_URL", () => {
    const env = renderTwentyEnv(
      { ...baseCfg, public_url: "https://crm.example.invalid" },
      secrets,
      "192.0.2.50",
    );
    expect(env).toContain("SERVER_URL=https://crm.example.invalid");
    expect(env).toContain("ENCRYPTION_KEY=");
    expect(env).toContain(`PG_DATABASE_PASSWORD=${secrets.dbPassword}`);
    expect(env).toContain("IS_MULTIWORKSPACE_ENABLED=false");
  });

  it("renderTwentyEnv emits FALLBACK_ENCRYPTION_KEY when provided", () => {
    const env = renderTwentyEnv(
      baseCfg,
      { ...secrets, fallbackEncryptionKey: "b2xkLWZhbGxiYWNrLWtleQ==" },
      "192.0.2.50",
    );
    expect(env).toContain("FALLBACK_ENCRYPTION_KEY=b2xkLWZhbGxiYWNrLWtleQ==");
  });

  it("renderTwentyEnv falls back to CT IP when public_url omitted", () => {
    const env = renderTwentyEnv({ ...baseCfg, public_url: "" }, secrets, "192.0.2.50");
    expect(env).toContain("SERVER_URL=http://192.0.2.50:3000");
  });

  it("resolveServerUrl and resolveWebUrl prefer public_url", () => {
    expect(resolveServerUrl({ public_url: "https://crm.example.invalid" }, "192.0.2.1")).toBe(
      "https://crm.example.invalid",
    );
    expect(resolveWebUrl({}, "192.0.2.50")).toBe("http://192.0.2.50:3000");
  });

  it("renderTwentyEnv requires secrets", () => {
    expect(() => renderTwentyEnv(baseCfg, { encryptionKey: "", dbPassword: "x" }, null)).toThrow(
      /ENCRYPTION_KEY/,
    );
    expect(() => renderTwentyEnv(baseCfg, { encryptionKey: "x", dbPassword: "" }, null)).toThrow(
      /PG_DATABASE_PASSWORD/,
    );
  });
});
