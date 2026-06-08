import { describe, expect, it } from "vitest";
import {
  backupFailureMatcherMatches,
  matcherMatchesVzdumpInfo,
  notificationsMaintainEnabledFromConfig,
  notificationsSpecFromConfig,
  sendmailTargetMatches,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-notifications-maintain.mjs";

const cfg = {
  provision: {
    notifications: {
      enabled: true,
      mailto: "dukk@dukk.org",
      sendmail_target: "hdc-mail",
      backup_failure_matcher: "hdc-backup-failures",
      disable_matchers: ["default"],
    },
  },
};

describe("proxmox notifications maintain", () => {
  it("notificationsMaintainEnabledFromConfig requires mailto", () => {
    expect(notificationsMaintainEnabledFromConfig(cfg)).toBe(true);
    expect(notificationsMaintainEnabledFromConfig({ provision: { notifications: { enabled: true } } })).toBe(false);
    expect(notificationsMaintainEnabledFromConfig({ provision: { notifications: { enabled: false, mailto: "a@b.c" } } })).toBe(
      false,
    );
  });

  it("notificationsSpecFromConfig reads overrides", () => {
    const spec = notificationsSpecFromConfig(cfg);
    expect(spec.mailto).toBe("dukk@dukk.org");
    expect(spec.sendmailTarget).toBe("hdc-mail");
    expect(spec.backupFailureMatcher).toBe("hdc-backup-failures");
    expect(spec.disableMatchers).toEqual(["default"]);
    expect(spec.disableLegacyBackupSuccessMatchers).toBe(true);
  });

  it("matcherMatchesVzdumpInfo detects catch-all and vzdump matchers", () => {
    expect(matcherMatchesVzdumpInfo({})).toBe(true);
    expect(matcherMatchesVzdumpInfo({ "match-severity": ["error"] })).toBe(false);
    expect(matcherMatchesVzdumpInfo({ "match-field": ["exact:type=vzdump"], "match-severity": ["info", "error"] })).toBe(
      true,
    );
    expect(
      matcherMatchesVzdumpInfo({
        "match-field": ["exact:type=vzdump"],
        "match-severity": ["error"],
      }),
    ).toBe(false);
    expect(matcherMatchesVzdumpInfo({ disable: 1 })).toBe(false);
  });

  it("sendmailTargetMatches compares mailto and comment", () => {
    const spec = notificationsSpecFromConfig(cfg);
    expect(
      sendmailTargetMatches(
        { mailto: "dukk@dukk.org", comment: "hdc-managed proxmox notifications" },
        spec,
      ),
    ).toBe(true);
    expect(sendmailTargetMatches({ mailto: "other@dukk.org" }, spec)).toBe(false);
  });

  it("backupFailureMatcherMatches requires vzdump error target", () => {
    const spec = notificationsSpecFromConfig(cfg);
    expect(
      backupFailureMatcherMatches(
        {
          "match-field": ["exact:type=vzdump"],
          "match-severity": ["error"],
          target: ["hdc-mail"],
        },
        spec,
      ),
    ).toBe(true);
    expect(
      backupFailureMatcherMatches(
        {
          "match-field": ["exact:type=vzdump"],
          "match-severity": ["info", "error"],
          target: ["hdc-mail"],
        },
        spec,
      ),
    ).toBe(false);
  });
});
