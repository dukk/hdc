import { describe, expect, it } from "vitest";

import { serviceUrlFromHostPort, serviceUrlFromPublicUrlOrHostPort, widgetBlockEnabled } from "../../../clumps/services/homepage/lib/homepage-widget-utils.mjs";
import { glancesWidgetEnabled } from "../../../clumps/services/homepage/lib/homepage-glances-widget.mjs";

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
    expect(serviceUrlFromPublicUrlOrHostPort("https://uptime-kuma.home.example.invalid", "192.0.2.105", 3001)).toBe(
      "https://uptime-kuma.home.example.invalid",
    );
    expect(serviceUrlFromPublicUrlOrHostPort("", "192.0.2.105", 3001)).toBe("http://192.0.2.105:3001");
    expect(serviceUrlFromHostPort("192.0.2.95", 61208)).toBe("http://192.0.2.95:61208");
  });
});
