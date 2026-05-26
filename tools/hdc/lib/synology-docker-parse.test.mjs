import { describe, expect, it } from "vitest";

import {
  parseDockerSectionOutput,
} from "../../../packages/infrastructure/synology-nas/lib/synology-docker-ensure.mjs";
import { parseHealthCollectOutput } from "../../../packages/infrastructure/synology-nas/lib/synology-query-remote.mjs";

describe("parseDockerSectionOutput", () => {
  it("parses running Container Manager", () => {
    const raw = `===DOCKER_PKG===
ContainerManager
===DOCKER_STATUS===
0
===DOCKER_CLI===
/usr/local/bin/docker
===DOCKER_VERSION===
24.0.2
===COMPOSE_VERSION===
2.29.1
===RESULT===
ok`;
    const r = parseDockerSectionOutput(raw);
    expect(r.package).toBe("ContainerManager");
    expect(r.status).toBe("0");
    expect(r.running).toBe(true);
    expect(r.dockerVersion).toBe("24.0.2");
    expect(r.composeAvailable).toBe(true);
  });

  it("parses not installed state", () => {
    const raw = `===DOCKER_PKG===

===DOCKER_STATUS===

===DOCKER_CLI===

===DOCKER_VERSION===

===COMPOSE_VERSION===
`;
    const r = parseDockerSectionOutput(raw);
    expect(r.package).toBeNull();
    expect(r.running).toBe(false);
    expect(r.composeAvailable).toBe(false);
  });

  it("parses ensure action installed", () => {
    const raw = `===ACTION===
install
===DOCKER_PKG===
ContainerManager
===DOCKER_STATUS===
0
===ACTION===
installed
===RESULT===
ok`;
    const r = parseDockerSectionOutput(raw);
    expect(r.package).toBe("ContainerManager");
    expect(r.action).toContain("installed");
  });
});

describe("parseHealthCollectOutput docker", () => {
  it("includes docker section from combined health output", () => {
    const raw = `===DSM_VERSION===
productversion="7.2"
===UPTIME===
up 1 day
===DF===
===MDSTAT===
===DISKS===
===DOCKER_PKG===
Docker
===DOCKER_STATUS===
0
===DOCKER_CLI===
/usr/local/bin/docker
===DOCKER_VERSION===
20.10.3
===COMPOSE_VERSION===
`;
    const h = parseHealthCollectOutput(raw);
    expect(h.dsmVersion).toBe("7.2");
    expect(h.docker?.package).toBe("Docker");
    expect(h.docker?.version).toBe("20.10.3");
    expect(h.docker?.compose).toBe(false);
  });
});
