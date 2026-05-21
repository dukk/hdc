import { describe, expect, it } from "vitest";

import {
  renderRelayCfSnippet,
  renderSaslPasswd,
  SMTP2GO_RELAYHOST,
} from "../../packages/services/postfix-relay/lib/postfix-relay-render.mjs";

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
});
