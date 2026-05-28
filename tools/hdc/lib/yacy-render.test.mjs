import { describe, expect, it } from "vitest";
import {
  composeDir,
  normalizeImageTag,
  peerName,
  renderComposeYaml,
  renderYacyEnv,
  resolvePublicUrl,
} from "../../../packages/services/yacy/lib/yacy-render.mjs";

describe("yacy render", () => {
  it("renderComposeYaml includes image and ports", () => {
    const yaml = renderComposeYaml();
    expect(yaml).toContain("yacy/yacy_search_server");
    expect(yaml).toContain("${YACY_HTTP_PORT}:8090");
    expect(yaml).toContain("YACY_NETWORK_UNIT_AGENT");
    expect(yaml).toContain("yacy-data");
  });

  it("renderYacyEnv sets tag ports and peer without secrets", () => {
    const env = renderYacyEnv({
      image_tag: "latest",
      http_port: 8090,
      https_port: 8443,
      peer_name: "my-peer",
    });
    expect(env).toContain("YACY_IMAGE_TAG=latest");
    expect(env).toContain("YACY_HTTP_PORT=8090");
    expect(env).toContain("YACY_HTTPS_PORT=8443");
    expect(env).toContain("YACY_PEER_NAME=my-peer");
    expect(env).not.toContain("PASSWORD");
  });

  it("normalizeImageTag and peerName defaults", () => {
    expect(normalizeImageTag({})).toBe("latest");
    expect(normalizeImageTag({ image_tag: "1.2.3" })).toBe("1.2.3");
    expect(peerName({})).toBe("yacy-peer");
    expect(peerName({ peer_name: "hdc" })).toBe("hdc");
  });

  it("composeDir default", () => {
    expect(composeDir({})).toBe("/opt/yacy");
    expect(composeDir({ compose_dir: "/srv/yacy" })).toBe("/srv/yacy");
  });

  it("resolvePublicUrl prefers configured url", () => {
    expect(resolvePublicUrl({ public_url: "http://search.example" }, null)).toBe("http://search.example");
    expect(resolvePublicUrl({ http_port: 8090 }, "192.0.2.50")).toBe("http://192.0.2.50:8090");
  });
});
