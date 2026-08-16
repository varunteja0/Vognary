import assert from "node:assert/strict";
import test from "node:test";

import { noticePresentationCopy, presentAutopilotNotice } from "../src/lib/recovery/notice-presentation";
import {
  autopilotNoticeReadinessCopy,
  describeAutopilotNoticeReadiness,
} from "../src/lib/recovery/notice-readiness";

test("only a delivered notice with a persisted clock is an active veto window", () => {
  const deliveredAt = "2026-08-24T00:05:00.000Z";
  const vetoDeadlineAt = "2026-08-26T00:05:00.000Z";
  const window = presentAutopilotNotice({
    deliveryStatus: "DELIVERED",
    noticeDeliveredAt: deliveredAt,
    vetoDeadlineAt,
    tokenCoverageInvalid: false,
  });
  assert.deepEqual(window, { kind: "veto-window", deliveredAt, vetoDeadlineAt });
  const windowCopy = noticePresentationCopy(window);
  assert.match(windowCopy, /48-hour veto window/);
  assert.ok(windowCopy.includes(deliveredAt), "delivered timestamp must appear in the veto-window copy");
  assert.ok(windowCopy.includes(vetoDeadlineAt), "exact veto deadline must appear in the veto-window copy");

  assert.equal(presentAutopilotNotice({
    deliveryStatus: "DELIVERED",
    noticeDeliveredAt: null,
    vetoDeadlineAt: null,
    tokenCoverageInvalid: false,
  }).kind, "none");
  for (const status of ["QUEUED", "ACCEPTED", "DELAYED"] as const) {
    const pending = presentAutopilotNotice({
      deliveryStatus: status,
      noticeDeliveredAt: deliveredAt,
      vetoDeadlineAt,
      tokenCoverageInvalid: false,
    });
    assert.equal(["queued", "accepted", "delayed"].includes(pending.kind), true);
    assert.match(noticePresentationCopy(pending), /Delivery is pending/);
    assert.doesNotMatch(noticePresentationCopy(pending), /48-hour veto window/);
  }
  for (const status of ["BOUNCED", "FAILED", "COMPLAINED"] as const) {
    const terminal = presentAutopilotNotice({
      deliveryStatus: status,
      noticeDeliveredAt: deliveredAt,
      vetoDeadlineAt,
      tokenCoverageInvalid: false,
    });
    assert.doesNotMatch(noticePresentationCopy(terminal), /48-hour veto window/);
    assert.match(noticePresentationCopy(terminal), /no active veto countdown/);
  }
  const invalid = presentAutopilotNotice({
    deliveryStatus: "DELIVERED",
    noticeDeliveredAt: deliveredAt,
    vetoDeadlineAt,
    tokenCoverageInvalid: true,
  });
  assert.equal(invalid.kind, "token-invalid");
  assert.match(noticePresentationCopy(invalid), /no active veto countdown/);
});

test("notice readiness copy is not a single Enabled flag", () => {
  assert.equal(describeAutopilotNoticeReadiness({
    featureSwitch: false,
    channelReady: true,
    credentialsPresent: true,
    webhookReady: true,
    deliveryProven: true,
  }).state, "off");
  assert.equal(autopilotNoticeReadinessCopy("off"), "Off — veto notices are not sent");
  assert.equal(autopilotNoticeReadinessCopy("channel-not-ready"), "Channel is not ready — notices cannot be delivered");
  assert.equal(autopilotNoticeReadinessCopy("credentials-missing"), "Credentials or webhook are missing — notices cannot be delivered");
  assert.equal(autopilotNoticeReadinessCopy("configured-unproven"), "Configured, but live delivery is not proven");
  assert.equal(autopilotNoticeReadinessCopy("proven-ready"), "Live notice delivery is proven");
});
