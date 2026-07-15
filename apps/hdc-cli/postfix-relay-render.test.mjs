import { describe, expect, it, afterEach } from "vitest";

import {
  renderRelayCfSnippet,
  renderSaslPasswd,
  renderSatelliteCfSnippet,
  SMTP2GO_RELAYHOST,
} from "hdc/clump/services/postfix-relay/lib/postfix-relay-render.mjs";
import {
  normalizeClientDefaults,
  resetMailRelayClientDefaultsCache,
  resolveSatelliteMyhostname,
} from "hdc/package/mail-relay-config.mjs";
import {
  mailRelaySkippedByFlags,
  shouldSkipMailRelayForDeployment,
} from "hdc/package/postfix-satellite-ensure.mjs";
import { mailEnabledFromConfig } from "hdc/package/mail-relay-settings.mjs";
import { configurePostfixSatellite } from "hdc/clump/services/postfix-relay/lib/postfix-satellite-configure.mjs";

describe("configurePostfixSatellite", () => {
  it("removes invalid main.cf include and sets relay via postconf", () => {
    /** @type {string[]} */
    const commands = [];
    const exec = {
      label: "test-ssh",
      run(cmd, _opts) {
        commands.push(cmd);
        if (cmd.includes("dpkg -s postfix")) return { status: 0, stdout: "", stderr: "" };
        if (cmd.includes("apt-get install")) return { status: 0, stdout: "", stderr: "" };
        if (cmd.startsWith("mkdir -p")) return { status: 0, stdout: "", stderr: "" };
        if (cmd.includes("base64 -d")) return { status: 0, stdout: "", stderr: "" };
        if (cmd.includes("sed -i")) return { status: 0, stdout: "", stderr: "" };
        if (cmd.includes("postconf -e")) return { status: 0, stdout: "", stderr: "" };
        if (cmd.includes("postfix check")) return { status: 0, stdout: "", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      },
    };
    const log = { info: () => {} };

    configurePostfixSatellite({
      exec,
      log,
      relayhost: "[192.0.2.60]",
      myhostname: "nginx-waf-a.home.example.invalid",
      myorigin: "hdc.example.invalid",
      inetInterfaces: "loopback-only",
    });

    const joined = commands.join("\n");
    expect(joined).toContain("sed -i '/^include \\/etc\\/postfix\\/main.cf.d/d'");
    expect(joined).not.toContain("echo 'include /etc/postfix/main.cf.d'");
    expect(joined).toContain("relayhost=[192.0.2.60]");
    expect(joined).toContain("local_transport=error:local delivery disabled on satellite");
  });
});

describe("postfix-relay-render (SMTP2GO)", () => {
  it("renderRelayCfSnippet matches SMTP2GO submission settings", () => {
    const s = renderRelayCfSnippet();
    expect(s).toContain(`relayhost = ${SMTP2GO_RELAYHOST}`);
    expect(s).toContain("smtp_sasl_auth_enable = yes");
    expect(s).toContain("smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd");
    expect(s).toContain("smtp_sasl_security_options = noanonymous");
    expect(s).toContain("smtp_sasl_tls_security_options = noanonymous");
    expect(s).toContain("smtp_use_tls = yes");
    expect(s).toContain("smtp_tls_security_level = encrypt");
    expect(s).toContain("smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt");
  });

  it("renderSaslPasswd is one relayhost line for postmap", () => {
    expect(renderSaslPasswd("[mail.smtp2go.com]:587", "myuser", "secret")).toBe(
      "[mail.smtp2go.com]:587\tmyuser:secret\n",
    );
  });

  it("renderSatelliteCfSnippet has relayhost without SASL", () => {
    const s = renderSatelliteCfSnippet({
      relayhost: "[192.0.2.60]",
      myhostname: "pi-hole-a.home.example.invalid",
      myorigin: "hdc.example.invalid",
      inetInterfaces: "loopback-only",
    });
    expect(s).toContain("relayhost = [192.0.2.60]");
    expect(s).toContain("inet_interfaces = loopback-only");
    expect(s).not.toContain("smtp_sasl");
  });
});

describe("mail-relay-config", () => {
  afterEach(() => {
    resetMailRelayClientDefaultsCache();
  });

  it("normalizeClientDefaults uses HDC_MAIL_RELAY_HOST env", () => {
    const d = normalizeClientDefaults({}, { HDC_MAIL_RELAY_HOST: "192.0.2.99" });
    expect(d.relayhost).toBe("[192.0.2.99]");
  });

  it("resolveSatelliteMyhostname appends myorigin to short hostname", () => {
    expect(resolveSatelliteMyhostname({ hostname: "n8n" }, "hdc.example.invalid")).toBe(
      "n8n.hdc.example.invalid",
    );
    expect(resolveSatelliteMyhostname({ system_id: "vm-bind-a" }, "hdc.example.invalid")).toBe(
      "vm-bind-a.hdc.example.invalid",
    );
  });
});

describe("postfix-satellite-ensure flags", () => {
  it("honours --skip-mail-relay", () => {
    expect(mailRelaySkippedByFlags({ "skip-mail-relay": "1" })).toBe(true);
    expect(mailRelaySkippedByFlags({ skip_mail_relay: "1" })).toBe(true);
  });

  it("skips relay host system id", () => {
    expect(
      shouldSkipMailRelayForDeployment({ system_id: "postfix-relay-a" }, "postfix-relay-a"),
    ).toBe(true);
    expect(shouldSkipMailRelayForDeployment({ system_id: "n8n-a" }, "postfix-relay-a")).toBe(
      false,
    );
  });
});

describe("mail-relay-settings", () => {
  it("mailEnabledFromConfig requires enabled true", () => {
    expect(mailEnabledFromConfig({ enabled: true })).toBe(true);
    expect(mailEnabledFromConfig({ enabled: false })).toBe(false);
    expect(mailEnabledFromConfig(null)).toBe(false);
  });
});
