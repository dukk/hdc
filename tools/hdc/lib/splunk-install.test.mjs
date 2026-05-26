import { describe, expect, it } from "vitest";
import {
  splunkDebFilename,
  splunkDownloadUrl,
} from "../../../packages/services/splunk/lib/splunk-install.mjs";

describe("splunk-install", () => {
  it("builds deb filename and download URL", () => {
    expect(splunkDebFilename("9.4.1", "deadbeef")).toBe(
      "splunk-9.4.1-deadbeef-linux-2.6-amd64.deb",
    );
    expect(splunkDownloadUrl("9.4.1", "deadbeef")).toBe(
      "https://download.splunk.com/products/splunk/releases/9.4.1/linux/splunk-9.4.1-deadbeef-linux-2.6-amd64.deb",
    );
  });
});
