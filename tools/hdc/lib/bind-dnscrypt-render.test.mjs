import { describe, expect, it } from "vitest";
import {
  ODOH_STATIC_STAMPS,
  renderDnscryptProxyToml,
} from "../../../packages/services/bind/lib/bind-dnscrypt-render.mjs";

describe("bind-dnscrypt-render", () => {
  it("renders ODoH TOML with listen, server, relay, and static stamps", () => {
    const text = renderDnscryptProxyToml({
      listen: "127.0.0.1:5300",
      server: "odoh-cloudflare",
      relay: "odohrelay-crypto-sx",
    });
    expect(text).toContain("listen_addresses = ['127.0.0.1:5300']");
    expect(text).toContain("odoh_servers = true");
    expect(text).toContain("dnscrypt_servers = false");
    expect(text).toContain("server_names = ['odoh-cloudflare']");
    expect(text).toContain("server_name='odoh-cloudflare', via=['odohrelay-crypto-sx']");
    expect(text).toContain(ODOH_STATIC_STAMPS["odoh-cloudflare"]);
    expect(text).toContain(ODOH_STATIC_STAMPS["odohrelay-crypto-sx"]);
  });

  it("rejects unknown server or relay", () => {
    expect(() =>
      renderDnscryptProxyToml({
        listen: "127.0.0.1:5300",
        server: "unknown-server",
        relay: "odohrelay-crypto-sx",
      }),
    ).toThrow(/Unknown ODoH server/);
  });
});
