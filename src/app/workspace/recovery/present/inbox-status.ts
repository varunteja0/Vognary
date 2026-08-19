import type { ReceiptInboxStatusDto } from "@/lib/recovery/contracts";
import { customerPhrases } from "./customer-copy";

export type CustomerInboxStatus = "NOT_SET_UP" | "WAITING_CONFIRMATION" | "WAITING_MAIL" | "ON" | "NEEDS_HELP";

export function customerInboxStatus(inbox: ReceiptInboxStatusDto | null): CustomerInboxStatus {
  if (!inbox || inbox.state === "UNAVAILABLE" || inbox.state === "NOT_PROVISIONED" || inbox.state === "REVOKED") {
    return "NOT_SET_UP";
  }
  if (inbox.gmailVerification && !inbox.forwardingVerifiedAt) return "WAITING_CONFIRMATION";
  if (inbox.state === "FAILED" || inbox.state === "ROTATION_REQUIRED") return "NEEDS_HELP";
  if (inbox.forwardingVerifiedAt && inbox.setupCompletedAt && (inbox.state === "READY" || inbox.state === "RECEIVED" || inbox.state === "PROCESSING")) {
    return "ON";
  }
  if (inbox.alias) return "WAITING_MAIL";
  return "NOT_SET_UP";
}

export function customerInboxStatusLabel(status: CustomerInboxStatus): string {
  switch (status) {
    case "NOT_SET_UP":
      return customerPhrases.notSetUp;
    case "WAITING_CONFIRMATION":
      return customerPhrases.waitingConfirmation;
    case "WAITING_MAIL":
      return "Waiting for matching mail";
    case "ON":
      return customerPhrases.inboxOn;
    case "NEEDS_HELP":
      return "Needs a moment";
  }
}

export function gmailWizardStep(inbox: ReceiptInboxStatusDto | null): 1 | 2 | 3 | 4 {
  if (!inbox?.alias) return 1;
  if (!inbox.forwardingVerifiedAt && inbox.gmailVerification) return 2;
  if (!inbox.forwardingVerifiedAt) return 1;
  if (!inbox.setupCompletedAt) return 3;
  return 4;
}
