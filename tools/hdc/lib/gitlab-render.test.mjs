import { describe, expect, it } from "vitest";
import {
  hostPort,
  normalizeExternalUrl,
  normalizeImageTag,
  renderComposeYaml,
  renderOmnibusConfig,
  resolveSshCloneHint,
  resolveUpstreamUrl,
  resolveWebUrl,
  sshHostPort,
} from "../../../packages/services/gitlab/lib/gitlab-render.mjs";

const baseGl = {
  external_url: "https://gitlab.example.invalid/",
  image_tag: "17.5.5-ce.0",
  host_port: 80,
  ssh_host_port: 2222,
  signups_enabled: false,
};

describe("gitlab render", () => {
  it("normalizeExternalUrl requires https and strips trailing slash", () => {
    expect(normalizeExternalUrl(baseGl)).toBe("https://gitlab.example.invalid");
    expect(() => normalizeExternalUrl({ external_url: "http://bad.example" })).toThrow(/https/);
    expect(() => normalizeExternalUrl({})).toThrow(/required/);
  });

  it("renderOmnibusConfig sets external_url and nginx behind reverse proxy", () => {
    const cfg = renderOmnibusConfig(baseGl);
    expect(cfg).toContain("external_url 'https://gitlab.example.invalid'");
    expect(cfg).toContain("nginx['listen_https'] = false");
    expect(cfg).toContain("letsencrypt['enable'] = false");
    expect(cfg).toContain("gitlab_rails['gitlab_shell_ssh_port'] = 2222");
    expect(cfg).toContain("gitlab_rails['gitlab_signup_enabled'] = false");
  });

  it("signups_enabled true when configured", () => {
    const cfg = renderOmnibusConfig({ ...baseGl, signups_enabled: true });
    expect(cfg).toContain("gitlab_rails['gitlab_signup_enabled'] = true");
  });

  it("renderComposeYaml includes image tag and ports", () => {
    const yaml = renderComposeYaml(baseGl);
    expect(yaml).toContain("image: gitlab/gitlab-ce:17.5.5-ce.0");
    expect(yaml).toContain("'80:80'");
    expect(yaml).toContain("'2222:22'");
    expect(yaml).toContain("gitlab-config:");
    expect(yaml).toContain("GITLAB_OMNIBUS_CONFIG:");
  });

  it("hostPort and sshHostPort defaults", () => {
    expect(hostPort({})).toBe(80);
    expect(hostPort({ host_port: 8080 })).toBe(8080);
    expect(sshHostPort({})).toBe(2222);
    expect(sshHostPort({ ssh_host_port: 8022 })).toBe(8022);
  });

  it("normalizeImageTag defaults to latest", () => {
    expect(normalizeImageTag({})).toBe("latest");
    expect(normalizeImageTag({ image_tag: "17.5.5-ce.0" })).toBe("17.5.5-ce.0");
  });

  it("resolveWebUrl upstream and ssh hints", () => {
    expect(resolveWebUrl(baseGl)).toBe("https://gitlab.example.invalid");
    expect(resolveUpstreamUrl("10.0.0.5", baseGl)).toBe("http://10.0.0.5:80");
    expect(resolveSshCloneHint("10.0.0.5", baseGl)).toContain("2222");
  });
});
