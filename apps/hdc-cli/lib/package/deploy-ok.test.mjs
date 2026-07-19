import { describe, expect, it } from "vitest";

import { deployOk } from "./deploy-ok.mjs";

describe("deployOk", () => {
  it("returns true when all parts are ok or absent", () => {
    expect(deployOk()).toBe(true);
    expect(deployOk(null, undefined)).toBe(true);
    expect(deployOk({ ok: true }, { ok: true })).toBe(true);
    expect(deployOk({ ok: true }, null, { message: "no ok field" })).toBe(true);
  });

  it("returns false when any part has ok:false", () => {
    expect(deployOk({ ok: false })).toBe(false);
    expect(deployOk({ ok: true }, { ok: false })).toBe(false);
    expect(deployOk(null, { ok: false }, { ok: true })).toBe(false);
  });
});
