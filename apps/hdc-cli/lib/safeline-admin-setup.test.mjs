import { describe, expect, it } from "vitest";

import { parseResetAdminOutput, stripAnsi } from "hdc/clump/services/safeline/lib/safeline-admin-setup.mjs";

describe("safeline-admin-setup", () => {
  it("stripAnsi removes color codes", () => {
    expect(stripAnsi("\u001b[92m[INFO] Done\u001b[0m")).toBe("[INFO] Done");
  });

  it("parseResetAdminOutput extracts username and password from deploy sample", () => {
    const sample =
      "\u001b[92m[INFO] Initial username：admin\u001b[0m\n" +
      "\u001b[92m[INFO] Initial password：ecDSpeUH\u001b[0m\n" +
      "\u001b[92m[INFO] Done\u001b[0m\n" +
      "Warning: Permanently added '192.0.2.12' (ED25519) to the list of known hosts.";
    expect(parseResetAdminOutput(sample)).toEqual({
      username: "admin",
      password: "ecDSpeUH",
    });
  });

  it("parseResetAdminOutput accepts ASCII colon", () => {
    const sample = "[INFO] Initial username: admin\n[INFO] Initial password: xY9zAb";
    expect(parseResetAdminOutput(sample)).toEqual({
      username: "admin",
      password: "xY9zAb",
    });
  });

  it("parseResetAdminOutput returns null when password missing", () => {
    expect(parseResetAdminOutput("[INFO] Initial username：admin\n[INFO] Done")).toBeNull();
  });
});
