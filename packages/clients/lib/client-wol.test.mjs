import { describe, expect, it } from "vitest";
import { buildMagicPacket } from "./client-wol.mjs";

describe("client-wol", () => {
  it("buildMagicPacket is 102 bytes", () => {
    const pkt = buildMagicPacket("aa:bb:cc:dd:ee:ff");
    expect(pkt.length).toBe(102);
    expect(pkt.subarray(0, 6).every((b) => b === 0xff)).toBe(true);
  });

  it("rejects invalid MAC", () => {
    expect(() => buildMagicPacket("bad")).toThrow(/invalid MAC/i);
  });
});
