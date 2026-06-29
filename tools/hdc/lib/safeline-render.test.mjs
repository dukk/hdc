import { describe, expect, it } from "vitest";

import {
  hdcManagedComment,
  parseHdcSiteIdFromComment,
  renderSafelineEnv,
  siteToApiPayload,
} from "../../../packages/services/safeline/lib/safeline-render.mjs";

describe("safeline-render", () => {
  it("renders .env with required keys", () => {
    const env = renderSafelineEnv(
      { image_tag: "9.3.4", mgt_port: 9443, subnet_prefix: "172.22.222" },
      "secret-pass",
      { compose_dir: "/opt/safeline" },
    );
    expect(env).toContain("SAFELINE_DIR=/opt/safeline");
    expect(env).toContain("IMAGE_TAG=9.3.4");
    expect(env).toContain("MGT_PORT=9443");
    expect(env).toContain("POSTGRES_PASSWORD=secret-pass");
    expect(env).toContain("SUBNET_PREFIX=172.22.222");
    expect(env).toContain("REGION=-g");
  });

  it("defaults REGION to -g when region omitted", () => {
    const env = renderSafelineEnv({}, "secret", { compose_dir: "/opt/safeline" });
    expect(env).toContain("REGION=-g");
  });

  it("maps site config to API payload with hdc comment marker", () => {
    const payload = siteToApiPayload({
      id: "immich",
      server_names: ["immich.example.invalid"],
      ports: ["443"],
      ssl: true,
      upstreams: ["http://192.0.2.9:2283"],
      comment: "Immich edge",
    });
    expect(payload.comment).toBe("hdc:site:immich Immich edge");
    expect(payload.server_names).toEqual(["immich.example.invalid"]);
    expect(payload.ssl).toBe(true);
  });

  it("parses hdc site id from comment", () => {
    expect(parseHdcSiteIdFromComment("hdc:site:immich Immich")).toBe("immich");
    expect(parseHdcSiteIdFromComment("manual site")).toBeNull();
  });

  it("builds managed comment without extra text", () => {
    expect(hdcManagedComment("demo")).toBe("hdc:site:demo");
  });
});
