import { describe, expect, it } from "vitest";
import { resolveLxcRootPassword } from "../../../packages/services/ollama/lib/lxc-password.mjs";

describe("resolveLxcRootPassword", () => {
  it("uses config password when set", async () => {
    const pw = await resolveLxcRootPassword("ct-ollama-a", 470, { password: "from-config" }, {});
    expect(pw).toBe("from-config");
  });

  it("uses --password flag", async () => {
    const pw = await resolveLxcRootPassword("ct-ollama-a", 470, {}, { password: "from-flag" });
    expect(pw).toBe("from-flag");
  });

  it("uses cache without prompting", async () => {
    const pw = await resolveLxcRootPassword("ct-ollama-b", 471, {}, {}, { cached: "cached-pw" });
    expect(pw).toBe("cached-pw");
  });
});
