import type { GmailForwardingVerificationDto } from "@/lib/recovery/contracts";

export function GmailForwardingConfirmation({ verification }: { verification: GmailForwardingVerificationDto }) {
  if (!verification.code && !verification.verificationUrl) return null;
  return (
    <div className="grid gap-3">
      {verification.code ? (
        <p className="text-sm leading-6 text-(--ink)">
          Confirmation code: <span className="font-mono font-semibold">{verification.code}</span>
          {" "}— paste this into Gmail&apos;s Forwarding settings.
        </p>
      ) : null}
      {verification.verificationUrl ? (
        <a
          href={verification.verificationUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn btn-sm btn-primary justify-self-start"
        >
          Confirm forwarding with Google
        </a>
      ) : null}
    </div>
  );
}
