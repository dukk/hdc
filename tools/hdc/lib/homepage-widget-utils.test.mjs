import { describe, expect, it } from "vitest";

import { serviceUrlFromHostPort, serviceUrlFromPublicUrlOrHostPort, widgetBlockEnabled } from "../../../packages/services/homepage/lib/homepage-widget-utils.mjs";
import { glancesWidgetEnabled } from "../../../packages/services/homepage/lib/homepage-glances-widget.mjs";

describe("homepage widget utils", () => {
  it("widgetBlockEnabled defaults true when enabled not false", () => {
    expect(widgetBlockEnabled({ immich_widget: { enabled: true } }, "immich_widget")).toBe(true);
    expect(widgetBlockEnabled({ immich_widget: { enabled: false } }, "immich_widget")).toBe(false);
    expect(widgetBlockEnabled({}, "immich_widget")).toBe(false);
  });

  it("glancesWidgetEnabled reads glances_widget block", () => {
    expect(glancesWidgetEnabled({ glances_widget: { enabled: true } })).toBe(true);
    expect(glancesWidgetEnabled({ glances_widget: { enabled: 0 } })).toBe(false);
  });

  it("serviceUrlFromPublicUrlOrHostPort prefers public_url", () => {
    expect(serviceUrlFromPublicUrlOrHostPort("https://uptime-kuma.hdc.dukk.org", "10.0.0.105", 3001)).toBe(
      "https://uptime-kuma.hdc.dukk.org",
    );
    expect(serviceUrlFromPublicUrlOrHostPort("", "10.0.0.105", 3001)).toBe("http://10.0.0.105:3001");
    expect(serviceUrlFromHostPort("10.0.0.95", 61208)).toBe("http://10.0.0.95:61208");
  });
});
