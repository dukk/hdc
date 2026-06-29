import { describe, expect, it } from "vitest";
import {
  REQUIRED_PORTS,
  composeDir,
  dhcpHints,
  menuVersion,
  normalizeImage,
  normalizeImageTag,
  renderComposeYaml,
} from "../../../packages/services/netboot-xyz/lib/netboot-xyz-render.mjs";

const baseCfg = {
  image: "ghcr.io/netbootxyz/netbootxyz",
  image_tag: "latest",
  menu_version: "2.0.84",
  web_app_port: 3000,
  nginx_port: 80,
  nginx_host_port: 8080,
  tftp_host_port: 69,
  tftpd_opts: "--tftp-single-port",
  timezone: "America/New_York",
  puid: 1000,
  pgid: 1000,
};

const install = { compose_dir: "/opt/netboot-xyz" };

describe("netboot-xyz render", () => {
  it("REQUIRED_PORTS lists PXE service ports", () => {
    expect(REQUIRED_PORTS.tcp).toContain(3000);
    expect(REQUIRED_PORTS.tcp).toContain(8080);
    expect(REQUIRED_PORTS.udp).toContain(69);
  });

  it("normalizeImage defaults to ghcr.io/netbootxyz/netbootxyz", () => {
    expect(normalizeImage({})).toBe("ghcr.io/netbootxyz/netbootxyz");
    expect(normalizeImageTag({})).toBe("latest");
  });

  it("menuVersion returns null when unset", () => {
    expect(menuVersion({})).toBeNull();
    expect(menuVersion({ menu_version: "2.0.84" })).toBe("2.0.84");
  });

  it("composeDir defaults to /opt/netboot-xyz", () => {
    expect(composeDir({})).toBe("/opt/netboot-xyz");
    expect(composeDir({ compose_dir: "/custom" })).toBe("/custom");
  });

  it("renderComposeYaml includes ports, volumes, and env", () => {
    const yaml = renderComposeYaml(baseCfg, install);
    expect(yaml).toContain("ghcr.io/netbootxyz/netbootxyz:latest");
    expect(yaml).toContain("'3000:3000'");
    expect(yaml).toContain("'69:69/udp'");
    expect(yaml).toContain("'8080:80'");
    expect(yaml).toContain("/opt/netboot-xyz/config:/config");
    expect(yaml).toContain("/opt/netboot-xyz/assets:/assets");
    expect(yaml).toContain("MENU_VERSION=2.0.84");
    expect(yaml).toContain("TFTPD_OPTS=--tftp-single-port");
    expect(yaml).toContain("TZ=America/New_York");
  });

  it("renderComposeYaml omits MENU_VERSION when null", () => {
    const yaml = renderComposeYaml({ ...baseCfg, menu_version: null }, install);
    expect(yaml).not.toContain("MENU_VERSION");
  });

  it("dhcpHints returns boot filenames and next-server", () => {
    const hints = dhcpHints("192.0.2.50", baseCfg);
    expect(hints.next_server).toBe("192.0.2.50");
    expect(hints.bios_boot_file).toBe("netboot.xyz.kpxe");
    expect(hints.uefi_boot_file).toBe("netboot.xyz.efi");
    expect(hints.web_ui_url).toBe("http://192.0.2.50:3000");
    expect(hints.assets_url).toBe("http://192.0.2.50:8080/");
    expect(hints.examples.generic_dhcp).toEqual({
      "next-server": "192.0.2.50",
      filename_bios: "netboot.xyz.kpxe",
      filename_uefi: "netboot.xyz.efi",
    });
  });

  it("dhcpHints returns null URLs without CT IP", () => {
    const hints = dhcpHints(null, baseCfg);
    expect(hints.next_server).toBeNull();
    expect(hints.web_ui_url).toBeNull();
    expect(hints.examples.generic_dhcp).toBeNull();
  });
});
