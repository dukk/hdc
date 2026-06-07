import { describe, expect, it } from "vitest";
import { listenPort, interfaceAddress } from "../../../packages/services/wireguard/lib/wireguard-render.mjs";

describe("wireguard render", () => {
  it("listenPort defaults to 51820", () => {
    expect(listenPort({})).toBe(51820);
  });

  it("interfaceAddress defaults to hub /24", () => {
    expect(interfaceAddress({})).toBe("10.7.0.1/24");
  });
});
