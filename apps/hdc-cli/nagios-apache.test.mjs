import { describe, it, expect } from "vitest";

import {
  buildNagiosApacheEnableScript,
  buildNagiosInstallScript,
} from "../../clumps/services/nagios/lib/nagios-install.mjs";

describe("nagios apache cgi", () => {
  it("enables mod_cgi and nagios4 apache confs", () => {
    const script = buildNagiosApacheEnableScript();
    expect(script).toContain("a2enmod cgi");
    expect(script).toContain("a2enconf nagios4-cgi");
    expect(script).toContain("apache2ctl -M");
    expect(script).toContain("cgi_module");
    expect(script).toContain("systemctl restart apache2");
  });

  it("install script includes apache enable after nagios4 packages", () => {
    const script = buildNagiosInstallScript();
    expect(script).toContain("apt-get install -y -qq nagios4");
    expect(script.indexOf("nagios4")).toBeLessThan(script.indexOf("a2enmod cgi"));
  });
});
