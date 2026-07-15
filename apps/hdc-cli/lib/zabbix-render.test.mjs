import { describe, expect, it } from "vitest";
import {
  buildEnvVarsWriteScript,
  buildOfficialStackInstallScript,
  renderZabbixRootEnv,
  resolveWebUrl,
  zabbixComposeFile,
  zabbixRelease,
} from "hdc/clump/services/zabbix/lib/zabbix-render.mjs";

describe("zabbix render", () => {
  const zabbixPgsql = { release: "7.0", database: "pgsql", web_http_port: 80 };
  const zabbixMysql = { release: "7.0", database: "mysql", web_http_port: 8080 };

  it("zabbixRelease strips v prefix", () => {
    expect(zabbixRelease({ release: "v7.0" })).toBe("7.0");
    expect(zabbixRelease({})).toBe("7.0");
  });

  it("zabbixComposeFile selects compose file by database", () => {
    expect(zabbixComposeFile(zabbixPgsql)).toBe("compose_pgsql.yaml");
    expect(zabbixComposeFile(zabbixMysql)).toBe("compose.yaml");
  });

  it("renderZabbixRootEnv includes version and ports", () => {
    const env = renderZabbixRootEnv(zabbixPgsql, "secret-db", "secret-root");
    expect(env).toContain("ZBX_VERSION=7.0");
    expect(env).toContain("ZABBIX_WEB_NGINX_HTTP_PORT=80");
    expect(env).toContain("ZABBIX_SERVER_PORT=10051");
  });

  it("buildEnvVarsWriteScript writes postgres env files", () => {
    const script = buildEnvVarsWriteScript(zabbixPgsql, '"/opt/zabbix/zabbix-docker"', "dbpass");
    expect(script).toContain(".POSTGRES_USER");
    expect(script).toContain(".POSTGRES_PASSWORD");
    expect(script).toContain("dbpass");
  });

  it("buildEnvVarsWriteScript writes mysql env files", () => {
    const script = buildEnvVarsWriteScript(zabbixMysql, '"/opt/zabbix/zabbix-docker"', "dbpass", "rootpass");
    expect(script).toContain(".MYSQL_USER");
    expect(script).toContain(".MYSQL_PASSWORD");
    expect(script).toContain(".MYSQL_ROOT_PASSWORD");
    expect(script).toContain("rootpass");
  });

  it("buildOfficialStackInstallScript clones zabbix-docker and runs compose", () => {
    const script = buildOfficialStackInstallScript("7.0", "compose_pgsql.yaml", zabbixPgsql, "dbpass", "dbpass");
    expect(script).toContain("zabbix-docker.git");
    expect(script).toContain("ZABBIX_BRANCH='7.0'");
    expect(script).toContain("compose_pgsql.yaml");
    expect(script).toContain("docker compose");
  });

  it("resolveWebUrl builds http URL from guest IP", () => {
    expect(resolveWebUrl(zabbixPgsql, "192.0.2.50")).toBe("http://192.0.2.50/");
    expect(resolveWebUrl(zabbixMysql, "192.0.2.50")).toBe("http://192.0.2.50:8080/");
    expect(resolveWebUrl({ public_url: "https://zabbix.example.com/" }, "192.0.2.50")).toBe(
      "https://zabbix.example.com/",
    );
  });
});
