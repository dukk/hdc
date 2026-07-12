import { describe, expect, it } from "vitest";

import {
  buildTimezoneConfScript,
  normalizeAliasList,
  normalizeMailboxList,
} from "../../../clumps/services/mailcow/lib/mailcow-render.mjs";

describe("mailcow-render mailbox/alias normalize", () => {
  const mailcow = {
    domains: [
      {
        name: "example.invalid",
        mailboxes: [
          {
            local_part: "dukk",
            name: "Dukk Cloud",
            quota_mb: 4096,
            password_vault_key: "HDC_MAILCOW_MAILBOX_DUKK_DUKK_CLOUD_PASSWORD",
          },
        ],
        aliases: [
          {
            address: "info@example.invalid",
            goto: ["ops@example.invalid"],
          },
        ],
      },
    ],
  };

  it("normalizes mailbox list from domains", () => {
    const mailboxes = normalizeMailboxList(mailcow);
    expect(mailboxes).toHaveLength(1);
    expect(mailboxes[0].address).toBe("dukk@example.invalid");
    expect(mailboxes[0].quota_mb).toBe(4096);
    expect(mailboxes[0].password_vault_key).toBe(
      "HDC_MAILCOW_MAILBOX_DUKK_DUKK_CLOUD_PASSWORD",
    );
  });

  it("normalizes alias list from domains", () => {
    const aliases = normalizeAliasList(mailcow);
    expect(aliases).toHaveLength(1);
    expect(aliases[0].address).toBe("info@example.invalid");
    expect(aliases[0].goto).toEqual(["ops@example.invalid"]);
  });

  it("builds timezone script for mailcow.conf and timedatectl", () => {
    const script = buildTimezoneConfScript("/opt/mailcow", {
      timezone: "America/New_York",
    });
    expect(script).toContain("set_kv TZ 'America/New_York'");
    expect(script).toContain("timedatectl set-timezone 'America/New_York'");
  });
});
