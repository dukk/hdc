import { describe, expect, it } from "vitest";
import {
  splunkDebFilename,
  splunkDownloadUrl,
} from "hdc/clump/services/splunk/lib/splunk-install.mjs";

describe("splunk-install", () => {
  it("builds linux-amd64 deb filename and URL for 9.4+", () => {
    expect(splunkDebFilename("9.4.1", "e3bdab203ac8")).toBe(
      "splunk-9.4.1-e3bdab203ac8-linux-amd64.deb",
    );
    expect(splunkDownloadUrl("9.4.1", "e3bdab203ac8")).toBe(
      "https://download.splunk.com/products/splunk/releases/9.4.1/linux/splunk-9.4.1-e3bdab203ac8-linux-amd64.deb",
    );
  });

  it("builds linux-2.6-amd64 deb filename and URL for 9.3.x", () => {
    expect(splunkDebFilename("9.3.12", "c3c164f2e6c4")).toBe(
      "splunk-9.3.12-c3c164f2e6c4-linux-2.6-amd64.deb",
    );
    expect(splunkDownloadUrl("9.3.12", "c3c164f2e6c4")).toBe(
      "https://download.splunk.com/products/splunk/releases/9.3.12/linux/splunk-9.3.12-c3c164f2e6c4-linux-2.6-amd64.deb",
    );
  });
});
