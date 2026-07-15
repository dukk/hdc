import { describe, expect, it } from "vitest";

import {
  assertSafePublicHttpUrl,
  htmlToText,
  isBlockedHostname,
  isPrivateOrReservedIp,
  parseDuckDuckGoHtmlResults,
  webFetch,
  webSearch,
} from "./web-tools.mjs";

describe("web-tools SSRF guards", () => {
  it("blocks localhost and .local hostnames", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("foo.local")).toBe(true);
    expect(isBlockedHostname("example.com")).toBe(false);
  });

  it("blocks private and reserved IPs", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("10.1.2.3")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
  });

  it("rejects non-public URLs", () => {
    expect(() => assertSafePublicHttpUrl("file:///etc/passwd")).toThrow(/http/);
    expect(() => assertSafePublicHttpUrl("http://127.0.0.1/")).toThrow(/private/);
    expect(() => assertSafePublicHttpUrl("https://user:pass@example.com/")).toThrow(/credentials/);
    expect(assertSafePublicHttpUrl("https://example.com/path").hostname).toBe("example.com");
  });
});

describe("web-tools parsing", () => {
  it("strips HTML to text", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("parses DuckDuckGo HTML results", () => {
    const html = `
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=${encodeURIComponent("https://docs.example.com/foo")}">Foo Docs</a>
      <a class="result__snippet">About foo</a>
      <a class="result__a" href="https://bar.example.org/">Bar</a>
      <div class="result__snippet">Bar snippet</div>
    `;
    const results = parseDuckDuckGoHtmlResults(html, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].url).toMatch(/^https:\/\//);
    expect(results[0].title).toMatch(/Foo|Bar/);
  });
});

describe("webFetch / webSearch", () => {
  it("fetches via injected fetchImpl", async () => {
    const fetchImpl = async () =>
      new Response("<html><body><p>Hello agent</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
        url: "https://example.com/page",
      });
    // Response.url may be empty in some runtimes — patch via wrapper
    const wrapped = async (url, init) => {
      const res = await fetchImpl(url, init);
      Object.defineProperty(res, "url", { value: "https://example.com/page" });
      return res;
    };
    const r = await webFetch({ url: "https://example.com/page", fetchImpl: wrapped });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/Hello agent/);
  });

  it("searches via injected HTML fetch", async () => {
    const html = `
      <a class="result__a" href="https://example.com/a">Alpha</a>
      <a class="result__snippet">Alpha snip</a>
    `;
    const fetchImpl = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    const r = await webSearch({ query: "alpha", fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("duckduckgo-html");
    expect(r.results[0]?.url).toBe("https://example.com/a");
  });
});
