import { describe, expect, it } from "vitest";

import { renderSystemdUiUnit } from "./hdc-runner-configure-ui.mjs";
import { renderPaperclipBridgeSystemdUnit } from "./hdc-runner-configure-bridge.mjs";

const runner = {
  install_root: "/opt/hdc",
  meta_root: "/opt/hdc-runner",
  private_root: "/opt/hdc-private",
  web: { enabled: true, port: 9120 },
};

const bridge = {
  enabled: true,
  host: "0.0.0.0",
  port: 9121,
  hdc_runner_url: "http://127.0.0.1:9120",
};

describe("hdc-runner systemd units", () => {
  it("renderSystemdUiUnit uses forward slashes in ExecStart on all platforms", () => {
    const unit = renderSystemdUiUnit(runner);
    expect(unit).toContain(
      "ExecStart=/usr/bin/node /opt/hdc/clumps/services/hdc-runner/lib/hdc-runner-ui-server.mjs",
    );
    expect(unit).not.toMatch(/ExecStart=.*\\/);
  });

  it("renderPaperclipBridgeSystemdUnit uses forward slashes in ExecStart on all platforms", () => {
    const unit = renderPaperclipBridgeSystemdUnit(bridge, runner);
    expect(unit).toContain(
      "ExecStart=/usr/bin/node /opt/hdc/clumps/services/paperclip/lib/paperclip-agent-bridge.mjs",
    );
    expect(unit).not.toMatch(/ExecStart=.*\\/);
  });
});
