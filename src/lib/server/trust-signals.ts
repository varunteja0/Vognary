import { isRecordedDurableBackupRestore, recordedBackupDrillEvidence } from "./backup-drill-evidence";
import { checkBackupConfiguration } from "./backup-readiness";
import { checkGoogleAuthConfiguration } from "./google-auth";
import { checkSessionConfiguration } from "./session";
import { checkTokenVaultConfiguration } from "./token-vault";
import { getReceiptInboxLaunchReadiness } from "./recovery-inbound-store";
import { getPilotPaymentLink } from "../pilot-payment-link";
import {
  independentSecurityAssessmentEvidenceFromEnvironment,
  isIndependentSecurityAssessmentCleared,
} from "../commitment-control/security-assessment";

export type TrustSignalState = "proven" | "configured" | "not-yet-proven";

export type TrustSignalId =
  | "session-signing"
  | "token-vault"
  | "backups"
  | "identity-provider"
  | "receipt-inbox"
  | "retention-scheduler"
  | "renewal-alert-delivery"
  | "independent-security-assessment"
  | "pilot-payment-collection";

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
    receiptInboxSignal(),
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
    independentSecurityAssessmentSignal(),
    pilotPaymentSignal(),
  ];
}

function independentSecurityAssessmentSignal(): PublicTrustSignal {
  const evidence = independentSecurityAssessmentEvidenceFromEnvironment();
  const cleared = isIndependentSecurityAssessmentCleared(evidence);
  const publicDisclosureApproved = evidence.publicDisclosureStatus?.trim() === "approved";
  if (cleared && publicDisclosureApproved) {
    return {
      id: "independent-security-assessment",
      label: "Independent security assessment",
      state: "proven",
      detail: `An independent assessment (${evidence.assessedAt}) and remediation retest (${evidence.retestedAt}) are recorded for this exact release. No unresolved Critical, High, or data-impacting Medium finding remains.`,
    };
  }
  return {
    id: "independent-security-assessment",
    label: "Independent security assessment",
    state: "not-yet-proven",
    detail: cleared
      ? "Release-bound independent assessment and retest evidence is recorded, but a public scope statement is not approved."
      : "No dated independent assessment and remediation retest is recorded for this release. Real customer financial data remains blocked until that evidence exists.",
  };
}

function receiptInboxSignal(): PublicTrustSignal {
  const readiness = getReceiptInboxLaunchReadiness();
  return {
    id: "receipt-inbox",
    label: "Receipt forwarding configuration",
    state: readiness.status === "ready" ? "configured" : "not-yet-proven",
    detail: readiness.status === "ready"
      ? "Receiving configuration and operator evidence are present. The public entry still verifies required database migrations before offering forwarding."
      : "Receipt forwarding is not offered until receiving, webhook, replay, retention, encryption, and database requirements are complete.",
  };
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
  const objectRestoreProven = backups.status === "configured"
    && isRecordedDurableBackupRestore(recordedBackupDrillEvidence, backups.keyFingerprint);
  if (objectRestoreProven) {
    const drillDate = parseAttestationDate(recordedBackupDrillEvidence.restoredAt.slice(0, 10))
      ?? parseAttestationDate(process.env.BACKUP_RESTORE_DRILL_AT);
    return {
      id: "backups",
      label: "Encrypted backups and restore drill",
      state: "proven",
      detail: drillDate
        ? `An encrypted dump in private backup storage was downloaded and restored into an isolated database (${drillDate}).`
        : "An encrypted dump in private backup storage was downloaded and restored into an isolated database.",
    };
  }
  if (backups.status === "configured") {
    return {
      id: "backups",
      label: "Encrypted backups and restore drill",
      state: "configured",
      detail: "Backup storage and a restore-drill attestation are present. Public proof waits for a recorded restore of the stored object.",
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
  if (google) {
    return {
      id: "identity-provider",
      label: "Identity provider",
      state: "configured",
      detail: "Google sign-in is active; the provider's issuer and subject are verified on every callback.",
    };
  }
  return {
    id: "identity-provider",
    label: "Identity provider",
    state: "not-yet-proven",
    detail: "No identity provider is active in this deployment, so sign-in is unavailable.",
  };
}

function pilotPaymentSignal(): PublicTrustSignal {
  const ready = getPilotPaymentLink().status === "ready";
  return {
    id: "pilot-payment-collection",
    label: "Private-pilot collection",
    state: ready ? "configured" : "not-yet-proven",
    detail: ready
      ? "A one-time hosted payment page is configured for the ₹14,999 Commitment Control private pilot. Card and UPI details stay with the payment provider. A configured link is not a paid customer."
      : "Online collection for the private pilot is not configured on this deployment.",
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
