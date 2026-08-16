import type { NoticeDeliveryStatus } from "@/lib/recovery/notice-delivery";

export type AutopilotNoticePresentation =
  | { kind: "none" }
  | { kind: "queued" }
  | { kind: "accepted" }
  | { kind: "delayed" }
  | { kind: "veto-window"; deliveredAt: string; vetoDeadlineAt: string }
  | { kind: "bounced" }
  | { kind: "failed" }
  | { kind: "complained" }
  | { kind: "token-invalid" };

export function presentAutopilotNotice(input: {
  deliveryStatus: NoticeDeliveryStatus | null;
  noticeDeliveredAt: string | null;
  vetoDeadlineAt: string | null;
  tokenCoverageInvalid: boolean;
}): AutopilotNoticePresentation {
  if (input.tokenCoverageInvalid) return { kind: "token-invalid" };
  if (input.deliveryStatus === "DELIVERED" && input.noticeDeliveredAt && input.vetoDeadlineAt) {
    return {
      kind: "veto-window",
      deliveredAt: input.noticeDeliveredAt,
      vetoDeadlineAt: input.vetoDeadlineAt,
    };
  }
  if (input.deliveryStatus === "BOUNCED") return { kind: "bounced" };
  if (input.deliveryStatus === "FAILED") return { kind: "failed" };
  if (input.deliveryStatus === "COMPLAINED") return { kind: "complained" };
  if (input.deliveryStatus === "DELAYED") return { kind: "delayed" };
  if (input.deliveryStatus === "ACCEPTED") return { kind: "accepted" };
  if (input.deliveryStatus === "QUEUED") return { kind: "queued" };
  return { kind: "none" };
}

export function noticePresentationCopy(presentation: AutopilotNoticePresentation): string {
  switch (presentation.kind) {
    case "queued":
    case "accepted":
    case "delayed":
      return "Delivery is pending.";
    case "veto-window":
      return `48-hour veto window. Delivered ${presentation.deliveredAt}. Veto by ${presentation.vetoDeadlineAt}.`;
    case "bounced":
      return "Notice bounced. There is no active veto countdown.";
    case "failed":
      return "Notice failed. There is no active veto countdown.";
    case "complained":
      return "Notice was marked as spam. There is no active veto countdown.";
    case "token-invalid":
      return "Notice token coverage is invalid. There is no active veto countdown.";
    case "none":
      return "";
  }
}
