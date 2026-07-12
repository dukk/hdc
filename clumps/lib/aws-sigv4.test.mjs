import { describe, expect, it } from "vitest";

import { awsUriEncode, signAwsRequest } from "./aws-sigv4.mjs";

describe("awsUriEncode", () => {
  it("encodes reserved characters", () => {
    expect(awsUriEncode("a/b+c")).toBe("a%2Fb%2Bc");
  });

  it("preserves slashes when encodeSlash is false", () => {
    expect(awsUriEncode("/path/to", false)).toBe("/path/to");
  });
});

describe("signAwsRequest", () => {
  it("produces stable authorization for fixed inputs", () => {
    const signed = signAwsRequest({
      method: "GET",
      url: "https://ec2.us-east-1.amazonaws.com/?Action=DescribeRegions&Version=2016-11-15",
      credentials: {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
      region: "us-east-1",
      service: "ec2",
      now: new Date("2020-08-30T12:36:00.000Z"),
    });
    expect(signed.authorization).toContain("AWS4-HMAC-SHA256");
    expect(signed.authorization).toContain("Credential=AKIAIOSFODNN7EXAMPLE/20200830/us-east-1/ec2/aws4_request");
    expect(signed.authorization).toContain("Signature=");
    expect(signed.headers.authorization).toBe(signed.authorization);
    expect(signed.headers["x-amz-date"]).toBe("20200830T123600Z");
  });

  it("includes session token when present", () => {
    const signed = signAwsRequest({
      method: "POST",
      url: "https://iam.amazonaws.com/",
      body: "Action=ListRoles&Version=2010-05-08",
      credentials: {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        sessionToken: "session-token",
      },
      region: "us-east-1",
      service: "iam",
      now: new Date("2020-08-30T12:36:00.000Z"),
    });
    expect(signed.headers["x-amz-security-token"]).toBe("session-token");
  });
});
