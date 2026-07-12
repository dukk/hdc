import { describe, expect, it } from "vitest";
import {
  hdcMetadataPath,
  twentyEncryptionKeyId,
} from "../../../clumps/services/twenty/lib/encryption-key-id.mjs";

describe("twenty encryption key id", () => {
  it("twentyEncryptionKeyId returns first 8 hex chars of sha256", () => {
    const key = Buffer.from("test-encryption-key").toString("base64");
    const id = twentyEncryptionKeyId(key);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(id).toBe(twentyEncryptionKeyId(key));
  });

  it("twentyEncryptionKeyId rejects empty key", () => {
    expect(() => twentyEncryptionKeyId("")).toThrow(/invalid ENCRYPTION_KEY/);
  });

  it("hdcMetadataPath resolves compose dir", () => {
    expect(hdcMetadataPath({ compose_dir: "/opt/twenty" })).toBe(
      "/opt/twenty/.hdc/encryption-key-id",
    );
    expect(hdcMetadataPath("/opt/custom")).toBe("/opt/custom/.hdc/encryption-key-id");
  });
});
