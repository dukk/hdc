import { describe, expect, it } from "vitest";
import {
  renderCertSyncScript,
  renderCloudflareRealIp,
  renderExploitPathMap,
  renderHdcNginxInclude,
  renderHdcNginxMaps,
  renderConnLimitZones,
  renderAuthBearerHashDirectives,
  renderRetryAfterMap,
  retryAfterMapForSite,
  siteUsesRequestLimits,
  normalizeLocationPath,
  normalizeRetryAfterPattern,
  escapeRegexMetaInLocationPath,
  escapeRegexDollars,
  renderModsecurityMainConf,
  renderProxyHeaders,
  renderDefaultCatchAllVhost,
  renderAcmeChallengeLocation,
  renderSiteUploadDirectives,
  renderSiteVhost,
  renderTrustedGeo,
  renderTrustedGeoForPolicy,
  renderWebsocketUpgradeMap,
  resolveTlsHttp2Enabled,
  siteHasWebsocketLocations,
  sitesNeedWebsocketMap,
  tlsDomainsFromSites,
  validateTrustedCidrs,
} from "hdc/clump/services/nginx-waf/lib/nginx-waf-render.mjs";
import { collectGroupPolicyPlan, resolveSitePolicyPlan } from "hdc/clump/services/nginx-waf/lib/nginx-waf-policies.mjs";
import { mergePolicyDefinitions } from "hdc/clump/services/nginx-waf/lib/nginx-waf-policies.mjs";

const testPolicyCatalog = mergePolicyDefinitions(
  {
    nginx_waf: {
      modsecurity: { enabled: true, rule_engine: "On" },
      trusted_cidrs: ["192.0.2.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"],
    },
  },
  null,
);

const sampleSite = {
  id: "example-app",
  host_names: ["app.hdc.example.invalid"],
  listen: [80, 443],
  upstream: "http://192.0.2.50:8080",
  tls: { enabled: true, cert_name: "app.hdc.example.invalid" },
  policies: ["modsecurity-default"],
  locations: [{ path: "/", proxy_headers: true }],
};

const restrictedSite = {
  ...sampleSite,
  locations: [
    {
      path: "/api/",
      proxy_headers: true,
      policies: [{ type: "trusted_cidrs", deny_status: 404, groups: [{ id: "default", cidrs: ["192.0.2.0/8"] }] }],
    },
    {
      path: "~ ^/admin",
      proxy_headers: true,
      policies: [
        { type: "trusted_cidrs", deny_status: 401, groups: [{ id: "default", cidrs: ["192.0.2.0/8"] }] },
        { type: "modsecurity", enabled: false },
      ],
    },
    { path: "/", proxy_headers: true },
  ],
};

function renderWithCatalog(site, extra = {}) {
  return renderSiteVhost({
    site,
    modsecurityEnabled: true,
    http01Acme: true,
    webroot: "/var/www/letsencrypt",
    policyCatalog: testPolicyCatalog,
    ...extra,
  });
}

describe("nginx-waf render", () => {
  it("renders proxy_pass and ModSecurity for HTTPS", () => {
    const vhost = renderWithCatalog(sampleSite);
    expect(vhost).toContain("proxy_pass http://192.0.2.50:8080");
    expect(vhost).toContain("ssl_certificate /etc/letsencrypt/live/app.hdc.example.invalid/fullchain.pem");
    // ACME on :80 (CF/LE) and :443 (Cloudflare Full SSL origin fetch)
    expect(vhost.match(/\/\.well-known\/acme-challenge\//g)?.length).toBeGreaterThanOrEqual(2);
    expect(vhost).toContain("return 301 https://");
    expect(vhost).toContain("modsecurity_rules_file /etc/modsecurity/hdc-waf-modsecurity-default.conf");
    expect(vhost).not.toContain("geo $remote_addr $hdc_trusted_internal");
  });

  it("renders modsecurity off when site omits modsecurity-default", () => {
    const vhost = renderWithCatalog({
      ...sampleSite,
      policies: ["hide-version", "block-exploits"],
    });
    expect(vhost).toContain("modsecurity off;");
    expect(vhost).not.toContain("modsecurity_rules_file");
  });

  it("renders geo and deny_status for trusted_cidrs policies", () => {
    const vhost = renderWithCatalog(restrictedSite);
    expect(vhost).toContain("geo $remote_addr $hdc_trusted_example_app {");
    expect(vhost).toContain("192.0.2.0/8 1;");
    expect(vhost).toContain("location /api/ {");
    expect(vhost).toContain("if ($hdc_trusted_example_app = 0) { return 404; }");
    expect(vhost).toContain("location ~ ^/admin {");
    expect(vhost).toContain("modsecurity off;");
    expect(vhost).toContain("if ($hdc_trusted_example_app = 0) { return 401; }");
    expect(vhost).toContain("location / {\n        proxy_pass");
    expect(vhost).not.toContain("location / {\n        if ($hdc_trusted_example_app = 0)");
    const apiBlock = vhost.match(/location \/api\/ \{[\s\S]*?\n    \}/)?.[0] ?? "";
    expect(apiBlock).not.toContain("modsecurity off;");
    const adminBlock = vhost.match(/location ~ \^\/admin \{[\s\S]*?\n    \}/)?.[0] ?? "";
    expect(adminBlock).toContain("modsecurity off;");
  });

  it("does not emit site modsecurity_rules_file when site modsecurity disabled", () => {
    const vhost = renderWithCatalog({
      ...restrictedSite,
      policies: [{ type: "modsecurity", enabled: false }],
    });
    expect(vhost).toContain("modsecurity off;");
    expect(vhost).not.toContain("modsecurity_rules_file");
  });

  it("renders Cloudflare real_ip and geo on realip_remote_addr", () => {
    const vhost = renderWithCatalog(
      {
        ...restrictedSite,
        client_ip: "cloudflare",
      },
      { clientIp: "cloudflare", cloudflareIpv4: true },
    );
    expect(vhost).toContain("geo $realip_remote_addr $hdc_trusted_example_app {");
    expect(vhost).toContain("real_ip_header CF-Connecting-IP;");
    expect(vhost).toContain("set_real_ip_from 173.245.48.0/20;");
    const realIpBlocks = vhost.match(/real_ip_header CF-Connecting-IP;/g);
    expect(realIpBlocks?.length).toBe(2);
    expect(vhost).toMatch(/listen 80;[\s\S]*real_ip_header CF-Connecting-IP;/);
    expect(vhost).toMatch(/listen 443 ssl[\s\S]*real_ip_header CF-Connecting-IP;/);
  });

  it("skips cloudflare-only on port 80 when http01Acme for LE validation", () => {
    const catalog = mergePolicyDefinitions(
      {
        nginx_waf: {
          modsecurity: { enabled: true, rule_engine: "On" },
          trusted_cidrs: ["192.0.2.0/8"],
          policy_definitions: {
            "cloudflare-only": {
              type: "cloudflare_origin",
              require_headers: true,
              deny_status: 403,
            },
          },
        },
      },
      null,
    );
    const site = {
      ...sampleSite,
      policies: ["modsecurity-default", "cloudflare-only"],
      client_ip: "cloudflare",
    };
    const vhost = renderSiteVhost({
      site,
      modsecurityEnabled: true,
      http01Acme: true,
      webroot: "/var/www/letsencrypt",
      clientIp: "cloudflare",
      cloudflareIpv4: true,
      policyCatalog: catalog,
    });
    expect(vhost).toContain("/.well-known/acme-challenge/");
    const port80Block = vhost.match(/server \{\s*listen 80;[\s\S]*?\n\}/)?.[0] ?? "";
    expect(port80Block).not.toContain("$http_cf_connecting_ip");
    const port443Block = vhost.match(/server \{\s*listen 443 ssl[\s\S]*?\n\}/)?.[0] ?? "";
    expect(port443Block).toContain("$http_cf_connecting_ip");
  });

  it("renders X-HDC-Nginx-Waf-Node when wafNodeId is set", () => {
    const vhost = renderWithCatalog(sampleSite, { wafNodeId: "vm-nginx-waf-a" });
    expect(vhost).toContain("proxy_set_header X-HDC-Nginx-Waf-Node vm-nginx-waf-a;");
  });

  it("renderProxyHeaders omits node header without wafNodeId", () => {
    const headers = renderProxyHeaders({});
    expect(headers).toContain("proxy_set_header X-Real-IP $remote_addr;");
    expect(headers).not.toContain("X-HDC-Nginx-Waf-Node");
  });

  it("renderTrustedGeo uses remote_addr by default", () => {
    const geo = renderTrustedGeo({
      cidrs: ["192.168.0.0/16"],
      clientIp: "remote_addr",
    });
    expect(geo).toContain("geo $remote_addr $hdc_trusted_internal {");
    expect(geo).toContain("192.168.0.0/16 1;");
  });

  it("renderCloudflareRealIp includes CF ranges", () => {
    const snippet = renderCloudflareRealIp(true);
    expect(snippet).toContain("set_real_ip_from 104.16.0.0/13;");
    expect(snippet).toContain("real_ip_recursive on;");
  });

  it("validateTrustedCidrs rejects invalid CIDR", () => {
    expect(() => validateTrustedCidrs(["not-a-cidr"], "test")).toThrow(/invalid trusted CIDR/);
  });

  it("extracts TLS domains from sites", () => {
    expect(tlsDomainsFromSites([sampleSite])).toEqual(["app.hdc.example.invalid"]);
  });

  it("renders ModSecurity main conf with OWASP CRS includes", () => {
    const conf = renderModsecurityMainConf({
      ruleEngine: "On",
      crsSetup: "/etc/modsecurity/crs/crs-setup.conf",
      crsRulesGlob: "/usr/share/modsecurity-crs/rules/*.conf",
      unicodeMap: "/usr/share/modsecurity-crs/unicode.mapping",
      auditLog: "/var/log/nginx/modsec_audit.log",
    });
    expect(conf).toContain("SecRuleEngine On");
    expect(conf).toContain("Include /etc/modsecurity/crs/crs-setup.conf");
    expect(conf).toContain("Include /usr/share/modsecurity-crs/rules/*.conf");
    expect(conf).toContain("SecUnicodeMapFile /usr/share/modsecurity-crs/unicode.mapping");
  });

  it("renders SecAuditLogFormat JSON when audit_log_format is json", () => {
    const conf = renderModsecurityMainConf({
      ruleEngine: "On",
      crsSetup: "/etc/modsecurity/crs/crs-setup.conf",
      crsRulesGlob: "/usr/share/modsecurity-crs/rules/*.conf",
      unicodeMap: "",
      auditLog: "/var/log/nginx/modsec_audit.log",
      auditLogFormat: "json",
    });
    expect(conf).toContain("SecAuditLogFormat JSON");
  });

  it("renders cert sync script with peer target", () => {
    const script = renderCertSyncScript({ peerUser: "root", peerHost: "192.0.2.21" });
    expect(script).toContain("root@192.0.2.21");
    expect(script).toContain("rsync");
    expect(script).toContain("nginx -s reload");
  });

  it("sitesNeedWebsocketMap detects websocket locations", () => {
    expect(sitesNeedWebsocketMap([sampleSite])).toBe(false);
    expect(
      sitesNeedWebsocketMap([
        {
          ...sampleSite,
          locations: [{ path: "/", proxy_headers: true, websocket: true }],
        },
      ]),
    ).toBe(true);
  });

  it("renderWebsocketUpgradeMap emits connection_upgrade map", () => {
    const map = renderWebsocketUpgradeMap();
    expect(map).toContain("map $http_upgrade $connection_upgrade");
    expect(map).toContain("default upgrade;");
  });

  it("renderHdcNginxMaps adds websocket map when enabled", () => {
    const withMap = renderHdcNginxMaps({
      websocketMapEnabled: true,
      blockCommonExploits: true,
      rateLimitZones: [],
    });
    expect(withMap).toContain("map $http_upgrade $connection_upgrade");
    expect(withMap).toContain("hdc_blocked_exploit_path");
    const include = renderHdcNginxInclude({ modsecurityEnabled: true });
    expect(include).toContain("include /etc/nginx/hdc/waf-maps.conf");
    expect(include).toContain("modsecurity on;");
  });

  it("deferTlsUntilCertExists serves HTTP proxy without HTTPS block", () => {
    const vhost = renderWithCatalog(sampleSite, {
      deferTlsUntilCertExists: true,
    });
    expect(vhost).toContain("listen 80;");
    expect(vhost).toContain("proxy_pass http://192.0.2.50:8080");
    expect(vhost).not.toContain("listen 443 ssl");
    expect(vhost).not.toContain("return 301 https://");
    expect(vhost).toContain("/.well-known/acme-challenge/");
  });

  it("renderSiteVhost websocket location has Upgrade headers but no map block", () => {
    const vhost = renderWithCatalog({
      ...sampleSite,
      locations: [{ path: "/", proxy_headers: true, websocket: true }],
    });
    expect(vhost).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(vhost).toContain("proxy_set_header Connection $connection_upgrade;");
    expect(vhost).toContain("proxy_cache_bypass $http_upgrade;");
    expect(vhost).not.toContain("map $http_upgrade $connection_upgrade");
    expect(vhost).toContain("listen 443 ssl;");
    expect(vhost).not.toContain("listen 443 ssl http2;");
  });

  it("resolveTlsHttp2Enabled disables HTTP/2 for websocket and ModSecurity sites by default", () => {
    const sitePlan = resolveSitePolicyPlan(sampleSite, testPolicyCatalog, "example-app");
    expect(siteHasWebsocketLocations({ locations: [{ websocket: true }] })).toBe(true);
    expect(resolveTlsHttp2Enabled({}, { locations: [{ websocket: true }] }, sitePlan, true)).toBe(
      false,
    );
    expect(resolveTlsHttp2Enabled({}, sampleSite, sitePlan, true)).toBe(false);
    expect(resolveTlsHttp2Enabled({ http2: true }, sampleSite, sitePlan, true)).toBe(true);
    expect(resolveTlsHttp2Enabled({}, sampleSite, { modsecurity: { enabled: false } }, true)).toBe(
      true,
    );
  });

  it("renders upstream pool with least_conn and proxy_ssl for https backends", () => {
    const vhost = renderWithCatalog({
      id: "pve",
      host_names: ["pve.hdc.example.invalid"],
      policies: ["modsecurity-default"],
      upstream: {
        method: "least_conn",
        servers: [
          { url: "https://192.0.2.1:8006", weight: 2 },
          { url: "https://192.0.2.2:8006", backup: true },
        ],
      },
      tls: { enabled: true, cert_name: "pve.hdc.example.invalid" },
      locations: [{ path: "/", proxy_headers: true }],
    });
    expect(vhost).toContain("upstream hdc_pve {");
    expect(vhost).toContain("least_conn;");
    expect(vhost).toContain("server 192.0.2.1:8006 weight=2;");
    expect(vhost).toContain("server 192.0.2.2:8006 backup;");
    expect(vhost).toContain("proxy_pass https://hdc_pve;");
    expect(vhost).toContain("proxy_ssl on;");
  });

  it("tls.http_redirect false serves HTTP proxy without redirect", () => {
    const vhost = renderWithCatalog({
      ...sampleSite,
      tls: { enabled: true, http_redirect: false, cert_name: "app.hdc.example.invalid" },
    });
    expect(vhost).toContain("listen 80;");
    expect(vhost).toContain("proxy_pass http://192.0.2.50:8080");
    expect(vhost).not.toContain("return 301 https://");
    expect(vhost).toContain("listen 443 ssl");
  });

  it("peer proxies :80 ACME challenges to the cert-primary with the original Host", () => {
    const vhost = renderWithCatalog(sampleSite, { acmeChallengeProxy: "http://10.0.0.40" });
    const http80 = vhost.slice(vhost.indexOf("listen 80;"), vhost.indexOf("listen 443"));
    expect(http80).toContain("location ^~ /.well-known/acme-challenge/ {\n        proxy_pass http://10.0.0.40;");
    expect(http80).toContain("proxy_set_header Host $host;");
    expect(http80).not.toContain("root /var/www/letsencrypt;");
  });

  it("cert-primary keeps serving the ACME webroot on :80", () => {
    const vhost = renderWithCatalog(sampleSite);
    const http80 = vhost.slice(vhost.indexOf("listen 80;"), vhost.indexOf("listen 443"));
    expect(http80).toContain("root /var/www/letsencrypt;");
    expect(http80).not.toContain("proxy_pass http://10.0.0.40");
  });

  it("default catch-all: peer proxies ACME, primary serves webroot, none by default", () => {
    const peer = renderDefaultCatchAllVhost({ acmeChallengeProxy: "http://10.0.0.40" });
    const http80 = peer.slice(0, peer.indexOf("listen 443"));
    expect(http80).toContain("proxy_pass http://10.0.0.40;");
    expect(http80).toContain("proxy_set_header Host $host;");
    const primary = renderDefaultCatchAllVhost({ acmeWebroot: "/var/www/letsencrypt" });
    expect(primary.slice(0, primary.indexOf("listen 443"))).toContain("root /var/www/letsencrypt;");
    expect(renderDefaultCatchAllVhost()).not.toContain("acme-challenge");
  });

  it("renderAcmeChallengeLocation rejects non-http proxy targets", () => {
    expect(() => renderAcmeChallengeLocation({ acmeChallengeProxy: "https://10.0.0.40/x;" })).toThrow();
    expect(renderAcmeChallengeLocation({})).toBe("");
  });

  it("renderDefaultCatchAllVhost uses default_server and static root", () => {
    const vhost = renderDefaultCatchAllVhost();
    expect(vhost).toContain("listen 80 default_server;");
    expect(vhost).toContain("listen 443 ssl http2 default_server;");
    expect(vhost).toContain("server_name _;");
    expect(vhost).toContain("modsecurity off;");
    expect(vhost).toContain("try_files /index.html =404;");
  });

  it("renderSiteUploadDirectives emits per-site body size and proxy timeouts", () => {
    const directives = renderSiteUploadDirectives({
      client_max_body_size: "3g",
      proxy_read_timeout: "1800s",
      proxy_connect_timeout: "60s",
    });
    expect(directives).toContain("client_max_body_size 3g;");
    expect(directives).toContain("proxy_read_timeout 1800s;");
    expect(directives).toContain("proxy_connect_timeout 60s;");
    expect(renderSiteUploadDirectives({})).toBe("");
  });

  it("renderSiteVhost includes upload directives on HTTPS when set on site", () => {
    const vhost = renderWithCatalog({
      ...sampleSite,
      client_max_body_size: "3g",
      proxy_read_timeout: "1800s",
    });
    expect(vhost).toContain("client_max_body_size 3g;");
    expect(vhost).toContain("proxy_read_timeout 1800s;");
    const httpsIdx = vhost.indexOf("listen 443 ssl");
    const bodySizeIdx = vhost.indexOf("client_max_body_size 3g;");
    expect(bodySizeIdx).toBeGreaterThan(httpsIdx);
  });

  it("renderSiteVhost omits upload directives when not set on site", () => {
    const vhost = renderWithCatalog(sampleSite);
    expect(vhost).not.toContain("client_max_body_size");
    expect(vhost).not.toMatch(/proxy_read_timeout \d/);
  });
  it("renders multiple limit_req zones, limit_conn, 429 Retry-After, and return locations", () => {
    const site = {
      id: "okf-mcp",
      host_names: ["okf.lab.jdlxp.com"],
      listen: [80, 443],
      upstream: "http://10.0.0.26:8080",
      client_ip: "cloudflare",
      tls: { enabled: true, http_redirect: true, cert_name: "okf.lab.jdlxp.com" },
      policies: [
        "modsecurity-default",
        { type: "cloudflare_origin", require_headers: true, deny_status: 403 },
        { type: "server_tokens", enabled: false },
        { type: "conn_limit", zone_name: "jdlxp_okf_conn", key: "$binary_remote_addr", limit: 20 },
      ],
      rate_limit_status: 429,
      conn_limit_status: 429,
      rate_limit_log_level: "warn",
      conn_limit_log_level: "warn",
      retry_after: {
        default: 2,
        paths: [{ pattern: "~*^/(auth|signin|sign-in|login|oauth|invite)", seconds: 60 }],
      },
      locations: [
        {
          path: "/mcp",
          policies: [
            { type: "rate_limit", zone_name: "jdlxp_okf_mcp_ip", rate: "30r/s", burst: 60, nodelay: true },
            {
              type: "rate_limit",
              zone_name: "jdlxp_okf_mcp_auth",
              key_source: "auth_bearer_hash",
              rate: "20r/s",
              burst: 40,
              nodelay: true,
            },
          ],
        },
        {
          path: "/login",
          return: 404,
          policies: [
            { type: "rate_limit", zone_name: "jdlxp_okf_auth_ip", rate: "10r/m", burst: 5, nodelay: true },
          ],
        },
        {
          path: "/auth",
          return: 404,
          policies: [
            { type: "rate_limit", zone_name: "jdlxp_okf_auth_ip", rate: "10r/m", burst: 5, nodelay: true },
          ],
        },
        {
          path: "/signin",
          return: 404,
          policies: [
            { type: "rate_limit", zone_name: "jdlxp_okf_auth_ip", rate: "10r/m", burst: 5, nodelay: true },
          ],
        },
        {
          path: "/sign-in",
          return: 404,
          policies: [
            { type: "rate_limit", zone_name: "jdlxp_okf_auth_ip", rate: "10r/m", burst: 5, nodelay: true },
          ],
        },
        {
          path: "/oauth",
          return: 404,
          policies: [
            { type: "rate_limit", zone_name: "jdlxp_okf_auth_ip", rate: "10r/m", burst: 5, nodelay: true },
          ],
        },
        {
          path: "/invite",
          return: 404,
          policies: [
            { type: "rate_limit", zone_name: "jdlxp_okf_auth_ip", rate: "10r/m", burst: 5, nodelay: true },
          ],
        },
        { path: "/", return: 404 },
      ],
    };

    expect(siteUsesRequestLimits(site, testPolicyCatalog)).toBe(true);

    const vhost = renderWithCatalog(site);
    expect(vhost).toContain("limit_req zone=jdlxp_okf_mcp_ip burst=60 nodelay;");
    expect(vhost).toContain("limit_req zone=jdlxp_okf_mcp_auth burst=40 nodelay;");
    expect(vhost).toContain("limit_req zone=jdlxp_okf_auth_ip burst=5 nodelay;");
    expect(vhost).toContain("limit_conn jdlxp_okf_conn 20;");
    expect(vhost).toContain("error_log /var/log/nginx/error.log warn;");
    expect(vhost).toContain("limit_req_status 429;");
    expect(vhost).toContain("limit_conn_status 429;");
    expect(vhost).toContain("limit_req_log_level warn;");
    expect(vhost).toContain("limit_conn_log_level warn;");
    expect(vhost).toContain("error_page 429 = @hdc_429_okf_mcp;");
    expect(vhost).toContain("location @hdc_429_okf_mcp");
    expect(vhost).toContain("add_header Retry-After $hdc_retry_after_okf_mcp always;");
    expect(vhost).toContain('return 429');
    expect(vhost).toContain("location /login");
    expect(vhost).toContain("location /oauth");
    expect(vhost).toContain("location /invite");
    expect(vhost).toContain("try_files /__hdc_waf_absent__ =404;");
    expect(vhost).toContain("location /mcp");
    expect(vhost).toContain("proxy_pass http://10.0.0.26:8080");
    expect(vhost).toContain('if ($http_cf_connecting_ip = "") { return 403; }');
    expect(vhost).toContain("real_ip_header CF-Connecting-IP;");
    expect(vhost).not.toMatch(/Authorization/);

    const plan = collectGroupPolicyPlan([site], testPolicyCatalog);
    expect(plan.authBearerHash).toBe(true);
    expect(plan.connLimitZones).toEqual(
      expect.arrayContaining([expect.objectContaining({ zoneName: "jdlxp_okf_conn", limit: 20 })]),
    );
    const maps = renderHdcNginxMaps({
      websocketMapEnabled: false,
      blockCommonExploits: false,
      rateLimitZones: plan.rateLimitZones,
      connLimitZones: plan.connLimitZones,
      authBearerHash: plan.authBearerHash,
      retryAfterMaps: [retryAfterMapForSite(site)],
    });
    expect(maps).toContain("limit_req_zone $binary_remote_addr zone=jdlxp_okf_mcp_ip:10m rate=30r/s;");
    expect(maps).toContain("limit_req_zone $hdc_auth_bearer_hash zone=jdlxp_okf_mcp_auth:10m rate=20r/s;");
    expect(maps).toContain("limit_req_zone $binary_remote_addr zone=jdlxp_okf_auth_ip:10m rate=10r/m;");
    expect(maps).toContain("limit_conn_zone $binary_remote_addr zone=jdlxp_okf_conn:10m;");
    expect(maps).toContain("perl_require /etc/nginx/hdc/auth_bearer_hash.pl;");
    expect(maps).toContain("perl_set $hdc_auth_bearer_hash");
    expect(maps).toContain("map $uri $hdc_retry_after_okf_mcp");
    expect(maps).toContain("default 2;");
    expect(maps).toContain("~*^/(auth|signin|sign-in|login|oauth|invite) 60;");
    expect(maps).not.toMatch(/Authorization/);
  });

  it("normalizeLocationPath inserts a space after regex modifiers", () => {
    expect(normalizeLocationPath("~*^/(auth|login)(/|$)")).toBe("~* ^/(auth|login)(/|$)");
    expect(normalizeLocationPath("~* ^/login")).toBe("~* ^/login");
    expect(normalizeLocationPath("^~/mcp")).toBe("^~ /mcp");
    expect(normalizeLocationPath("=/exact")).toBe("= /exact");
    expect(normalizeLocationPath("/mcp")).toBe("/mcp");
    expect(normalizeRetryAfterPattern("~* ^/(auth|login)(/|$)")).toBe("~*^/(auth|login)(/|$)");
    expect(normalizeRetryAfterPattern("~*^/(auth|login)(/|$)")).toBe("~*^/(auth|login)(/|$)");
    expect(escapeRegexMetaInLocationPath("~* ^/(auth|login)(/|$)")).toBe("~* ^/(auth|login)(/|\\$)");
    expect(escapeRegexDollars("~*^/(auth|login)(/|$)")).toBe("~*^/(auth|login)(/|\\$)");
    expect(escapeRegexMetaInLocationPath("/mcp")).toBe("/mcp");
  });

  it("renderConnLimitZones and auth hash helpers emit expected directives", () => {
    expect(renderConnLimitZones([{ zoneName: "jdlxp_okf_conn", key: "$binary_remote_addr" }])).toContain(
      "limit_conn_zone $binary_remote_addr zone=jdlxp_okf_conn:10m;",
    );
    expect(renderAuthBearerHashDirectives()).toContain("perl_set $hdc_auth_bearer_hash");
    expect(renderRetryAfterMap({ variable: "$hdc_retry_after_okf_mcp", defaultSeconds: 2, rules: [] })).toContain(
      "default 2;",
    );
  });

});
