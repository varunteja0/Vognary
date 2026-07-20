import { getPartnerRailsStatus } from "@/lib/partner-rails";
import { checkBackupConfiguration } from "./backup-readiness";
import { checkGoogleAuthConfiguration } from "./google-auth";
import { checkMagicLinkConfiguration } from "./magic-link-auth";
import { checkSessionConfiguration } from "./session";
import { checkTokenVaultConfiguration } from "./token-vault";

export type TrustSignalState = "proven" | "configured" | "not-yet-proven";

export type TrustSignalId =
  | "session-signing"
  | "token-vault"
  | "backups"
  | "identity-provider"
  | "gmail-verification"
  | "bank-rails"
  | "sync-scheduler"
  | "retention-scheduler"
  | "renewal-alert-delivery";

export type PublicTrustSignal = {
  id: TrustSignalId;
  label: string;
  state: TrustSignalState;
  detail: string;
};

/**
 * Public-safe view of deployment readiness for the trust pages. Everything is
 * derived from configuration and operator attestations at request time; blank
 * environment always renders "not yet proven". Details must never name
 * environment variables or list missing secrets — that level of detail stays
 * behind the internal-secret readiness route.
 */
export function getPublicTrustSignals(): PublicTrustSignal[] {
  return [
    sessionSignal(),
    tokenVaultSignal(),
    backupSignal(),
    identitySignal(),
    gmailVerificationSignal(),
    bankRailSignal(),
    attestationSignal(
      "sync-scheduler",
      "Background sync schedule",
      process.env.SYNC_SCHEDULER_STATUS,
      "An operator recorded the production sync schedule after observing it run.",
      "No production sync schedule has been attested yet.",
    ),
    attestationSignal(
      "retention-scheduler",
      "Retention enforcement schedule",
      process.env.RETENTION_SCHEDULER_STATUS,
      "An operator recorded the production retention schedule after observing an enforced run.",
      "No production retention schedule has been attested yet.",
    ),
    attestationSignal(
      "renewal-alert-delivery",
      "Renewal alert delivery",
      process.env.RENEWAL_ALERT_DELIVERY_STATUS,
      "An operator recorded production renewal-alert delivery after observing a real send.",
      "Production renewal-alert delivery has not been attested yet.",
    ),
  ];
}

function sessionSignal(): PublicTrustSignal {
  const ready = checkSessionConfiguration().status === "ready";
  return {
    id: "session-signing",
    label: "Signed session cookies",
    state: ready ? "configured" : "not-yet-proven",
    detail: ready
      ? "Session cookies are signed and expire; unsigned or expired cookies are rejected."
      : "Session signing is not active in this deployment, so sign-in is unavailable.",
  };
}

function tokenVaultSignal(): PublicTrustSignal {
  const vault = checkTokenVaultConfiguration();
  if (vault.status === "ready") {
    return {
      id: "token-vault",
      label: "Encrypted token vault",
      state: "configured",
      detail: "The vault key passed an encrypt-decrypt round-trip; connector secrets and workspace snapshots are stored encrypted.",
    };
  }
  return {
    id: "token-vault",
    label: "Encrypted token vault",
    state: "not-yet-proven",
    detail: vault.status === "invalid"
      ? "An encryption key is present but failed validation, so encrypted storage stays closed."
      : "No vault key is active in this deployment, so encrypted storage is unavailable.",
  };
}

function backupSignal(): PublicTrustSignal {
  const backups = checkBackupConfiguration();
  if (backups.status === "configured") {
    const drillDate = parseAttestationDate(process.env.BACKUP_RESTORE_DRILL_AT);
    return {
      id: "backups",
      label: "Encrypted backups and restore drill",
      state: "proven",
      detail: drillDate
        ? `Backup storage, an encryption-key proof, and a successful restore drill (${drillDate}) are recorded for this deployment.`
        : "Backup storage, an encryption-key proof, and a successful restore drill are recorded for this deployment.",
    };
  }
  if (backups.storage === "configured") {
    return {
      id: "backups",
      label: "Encrypted backups and restore drill",
      state: "configured",
      detail: backups.restoreDrill === "passed"
        ? "Backup storage is configured and a restore drill is recorded; the encryption-key proof is incomplete."
        : "Backup storage is configured; a restore drill has not been recorded yet.",
    };
  }
  return {
    id: "backups",
    label: "Encrypted backups and restore drill",
    state: "not-yet-proven",
    detail: "No backup storage or restore drill is recorded for this deployment.",
  };
}

function identitySignal(): PublicTrustSignal {
  const google = checkGoogleAuthConfiguration().status === "ready";
  const magicLink = checkMagicLinkConfiguration().status === "ready";
  if (google || magicLink) {
    return {
      id: "identity-provider",
      label: "Identity provider",
      state: "configured",
      detail: google && magicLink
        ? "Google sign-in and email magic-link sign-in are both active."
        : google
          ? "Google sign-in is active; the provider's issuer and subject are verified on every callback."
          : "Email magic-link sign-in is active.",
    };
  }
  return {
    id: "identity-provider",
    label: "Identity provider",
    state: "not-yet-proven",
    detail: "No identity provider is active in this deployment, so sign-in is unavailable.",
  };
}

function gmailVerificationSignal(): PublicTrustSignal {
  const complete = process.env.GOOGLE_OAUTH_VERIFICATION_COMPLETE === "true";
  return {
    id: "gmail-verification",
    label: "Gmail read-only rail verification",
    state: complete ? "proven" : "not-yet-proven",
    detail: complete
      ? "Google's restricted-scope review of read-only Gmail receipt access is complete."
      : "Google's restricted-scope review is not complete, so the Gmail rail stays gated.",
  };
}

function bankRailSignal(): PublicTrustSignal {
  const status = getPartnerRailsStatus();
  if (status === "production-live") {
    return {
      id: "bank-rails",
      label: "Regulated bank rails",
      state: "proven",
      detail: "An approved regulated partner rail is live for consented bank data.",
    };
  }
  if (status === "sandbox-approved" || status === "in-progress" || status === "outreach-started") {
    return {
      id: "bank-rails",
      label: "Regulated bank rails",
      state: "configured",
      detail: "Partner onboarding is underway; no direct bank, UPI, or card-mandate access is offered in the meantime.",
    };
  }
  return {
    id: "bank-rails",
    label: "Regulated bank rails",
    state: "not-yet-proven",
    detail: "No regulated partner rail is engaged; Vognary offers no direct bank, UPI, or card-mandate access.",
  };
}

function parseAttestationDate(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return Number.isNaN(new Date(`${trimmed}T00:00:00Z`).getTime()) ? null : trimmed;
}

function attestationSignal(
  id: TrustSignalId,
  label: string,
  envValue: string | undefined,
  provenDetail: string,
  pendingDetail: string,
): PublicTrustSignal {
  const attested = envValue?.trim() === "production-live";
  return {
    id,
    label,
    state: attested ? "proven" : "not-yet-proven",
    detail: attested ? provenDetail : pendingDetail,
  };
}
