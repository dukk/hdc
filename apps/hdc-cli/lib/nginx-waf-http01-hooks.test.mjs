import { describe, expect, it } from "vitest";

import {
  assertSafePeerHosts,
  renderAcmeHttp01AuthHook,
  renderAcmeHttp01CleanupHook,
  ACME_HTTP01_WEBROOT,
  ACME_HTTP01_AUTH_HOOK_PATH,
  ACME_HTTP01_CLEANUP_HOOK_PATH,
} from "hdc/clump/services/nginx-waf/lib/cert-ha.mjs";

describe("HTTP-01 peer hooks", () => {
  it("writes the challenge locally and copies it to every other WAF", () => {
    const sh = renderAcmeHttp01AuthHook(["10.0.0.40", "10.0.0.41"]);
    expect(sh).toContain("#!/bin/bash");
    expect(sh).toContain(ACME_HTTP01_WEBROOT);
    expect(sh).toContain('echo -n "$CERTBOT_VALIDATION" > "$WEBROOT/$CERTBOT_TOKEN"');
    expect(sh).toContain("'10.0.0.40'");
    expect(sh).toContain("'10.0.0.41'");
    expect(sh).toContain("acme-http01-put");
    expect(sh).toContain("/etc/hdc/nginx-waf-certs/id_ed25519");
    expect(sh).toContain("UserKnownHostsFile=");
    expect(sh).toContain("for peer in");
    expect(ACME_HTTP01_AUTH_HOOK_PATH).toBe("/etc/letsencrypt/hdc-acme-auth-hook.sh");
  });

  it("cleans the token on this node and every peer", () => {
    const sh = renderAcmeHttp01CleanupHook(["10.0.0.40"]);
    expect(sh).toContain(ACME_HTTP01_WEBROOT);
    expect(sh).toContain('rm -f "$WEBROOT/$CERTBOT_TOKEN"');
    expect(sh).toContain("'10.0.0.40'");
    expect(sh).toContain("acme-http01-clear");
    expect(ACME_HTTP01_CLEANUP_HOOK_PATH).toBe("/etc/letsencrypt/hdc-acme-cleanup-hook.sh");
  });

  it("works for a single-node fleet with no peers", () => {
    const sh = renderAcmeHttp01AuthHook([]);
    expect(sh).toContain("no peer WAFs");
    expect(sh).not.toContain("for peer in");
  });

  it("rejects unsafe peer host tokens", () => {
    expect(() => assertSafePeerHosts(["10.0.0.40; rm -rf /"])).toThrow(/bad peer host/);
    expect(() => renderAcmeHttp01AuthHook(["10.0.0.40 && true"])).toThrow(/bad peer host/);
  });
});
