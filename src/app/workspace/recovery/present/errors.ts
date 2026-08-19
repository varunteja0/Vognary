import { recoveryErrorCodes, type RecoveryErrorCode } from "@/lib/recovery/contracts";
import { errorCopy } from "../labels";

export function customerErrorCopy(code: RecoveryErrorCode): { title: string; detail: string } {
  return errorCopy[code];
}

export function inboxFailureCopy(lastFailureCode: string | null): { title: string; detail: string } {
  if (lastFailureCode && isRecoveryErrorCode(lastFailureCode)) {
    return errorCopy[lastFailureCode];
  }
  return errorCopy.PARSE_FAILED;
}

export function rejectedSubmissionCopy(code: "INVALID_EVIDENCE" | "PARSE_FAILED" | "DUPLICATE_EVIDENCE"): { title: string; detail: string } {
  return errorCopy[code];
}

function isRecoveryErrorCode(value: string): value is RecoveryErrorCode {
  return (recoveryErrorCodes as readonly string[]).includes(value);
}
