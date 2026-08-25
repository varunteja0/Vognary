import { RecoveryServiceError } from "@/lib/server/recovery-api";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
  UnsupportedContentTypeError,
} from "@/lib/server/request-body";

export const commitmentControlMaxRequestBytes = 64 * 1024;

export async function readCommitmentControlRequest<T>(request: Request, normalize: (value: unknown) => T): Promise<T> {
  let value: unknown;
  try {
    value = await readLimitedJson<unknown>(request, commitmentControlMaxRequestBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw new RecoveryServiceError("REQUEST_TOO_LARGE");
    if (error instanceof UnsupportedContentTypeError) throw new RecoveryServiceError("UNSUPPORTED_MEDIA_TYPE");
    throw new RecoveryServiceError("INVALID_EVIDENCE", "Commitment Control request must be valid JSON.");
  }
  try {
    return normalize(value);
  } catch (error) {
    if (error instanceof RecoveryServiceError) throw error;
    throw new RecoveryServiceError("INVALID_EVIDENCE", error instanceof Error ? error.message : "Commitment Control request is invalid.");
  }
}