import { describe, expect, it } from "vitest";
import { configureNginxWafSites } from "hdc/clump/services/nginx-waf/lib/nginx-waf-configure.mjs";
import { configureNginxSites } from "hdc/clump/services/nginx/lib/nginx-configure.mjs";

const wafSampleSite = {
  id: "vaultwarden",
  host_names: ["vault.example.test"],
  listen: [80],
  upstream: "http://192.0.2.123:80",
  tls: { enabled: false },
};

const nginxSampleSite = {
  id: "vaultwarden",
  server_names: ["vault.example.test"],
  listen: [80],
  upstream: "http://192.0.2.123:80",
  tls: { enabled: false },
};

/** @param {string[]} [existingSiteIds] */
function createMockExec(existingSiteIds = ["bookshelf"]) {
  /** @type {string[]} */
  const commands = [];
  return {
    label: "mock",
    commands,
    /** @param {string} cmd */
    run(cmd) {
      commands.push(cmd);
      if (cmd.includes("test -f /etc/letsencrypt/live/")) {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (cmd.includes("ls -1 /etc/nginx/sites-enabled/hdc-")) {
        const stdout = existingSiteIds.map((id) => `hdc-${id}.conf`).join("\n");
        return { status: 0, stdout, stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  };
}

const wafGlobal = {
  challenge: "http-01",
  modsecurityEnabled: false,
  defaultSiteEnabled: true,
  webroot: "/var/www/letsencrypt",
};

const nginxGlobal = {
  challenge: "http-01",
  webroot: "/var/www/letsencrypt",
};

const log = { info: () => {} };

function rmSiteCommands(commands) {
  return commands.filter(
    (c) =>
      c.includes("rm -f") &&
      c.includes("/etc/nginx/sites-enabled/hdc-") &&
      !c.includes("hdc-acme-bootstrap"),
  );
}

describe("configureNginxWafSites pruneStaleSites", () => {
  it("does not remove other vhosts when pruneStaleSites is false", () => {
    const exec = createMockExec(["bookshelf"]);
    const result = configureNginxWafSites({
      exec,
      log,
      global: wafGlobal,
      sites: [wafSampleSite],
      pruneStaleSites: false,
    });
    expect(rmSiteCommands(exec.commands)).toHaveLength(0);
    expect(result).toEqual({ enabled_site_ids: ["vaultwarden"], prune_stale_sites: false });
  });

  it("removes vhosts not in sites[] when pruneStaleSites is true", () => {
    const exec = createMockExec(["bookshelf"]);
    const result = configureNginxWafSites({
      exec,
      log,
      global: wafGlobal,
      sites: [wafSampleSite],
      pruneStaleSites: true,
    });
    expect(rmSiteCommands(exec.commands)).toHaveLength(1);
    expect(rmSiteCommands(exec.commands)[0]).toContain("hdc-bookshelf");
    expect(result).toEqual({ enabled_site_ids: ["vaultwarden"], prune_stale_sites: true });
  });
});

describe("configureNginxSites pruneStaleSites", () => {
  it("does not remove other vhosts when pruneStaleSites is false", () => {
    const exec = createMockExec(["bookshelf"]);
    const result = configureNginxSites({
      exec,
      log,
      global: nginxGlobal,
      sites: [nginxSampleSite],
      pruneStaleSites: false,
    });
    expect(rmSiteCommands(exec.commands)).toHaveLength(0);
    expect(result).toEqual({ enabled_site_ids: ["vaultwarden"], prune_stale_sites: false });
  });

  it("removes vhosts not in sites[] when pruneStaleSites is true", () => {
    const exec = createMockExec(["bookshelf"]);
    const result = configureNginxSites({
      exec,
      log,
      global: nginxGlobal,
      sites: [nginxSampleSite],
      pruneStaleSites: true,
    });
    expect(rmSiteCommands(exec.commands)).toHaveLength(1);
    expect(rmSiteCommands(exec.commands)[0]).toContain("hdc-bookshelf");
    expect(result).toEqual({ enabled_site_ids: ["vaultwarden"], prune_stale_sites: true });
  });
});
