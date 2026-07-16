"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { encodeCsvCell } from "@/lib/csv";
import { connectors, type Connector, type ConnectorStatus } from "@/lib/connectors";
import {
  analyzeStatements,
  applyMergeDecisionsToAudit,
  findDuplicateCandidates,
  type AuditResult,
  type DuplicateCandidate,
  type Frequency,
  type ManualRecurringInput,
  type MergeDecision,
  type RecommendationType,
  type RecurringItem,
  type StatementSource,
} from "@/lib/recurring-audit";
import { receiptTextToManualInputs, type ReceiptCandidate } from "@/lib/receipt-parser";
import { buildRenewalTimeline, type RenewalTimeline } from "@/lib/renewal-timeline";
import { buildProofGraphSummary, type ProofGraphSummary } from "@/lib/proof-graph";
import { buildVerifiedSavings, type ActionMeta, type VerifiedSavingsSummary } from "@/lib/verified-savings";
import { buildReviewSnapshot, diffReviews, isReviewSnapshot, type ReviewDiff, type ReviewSnapshot } from "@/lib/review-diff";
import {
  attachIssuerSignature,
  sealAuditPack,
  type PackChainState,
  type PackIssuerSignature,
} from "@/lib/audit-pack";
import { redactText } from "@/lib/redaction";
import { getCommitmentPolicy, isCommitmentActionAllowed, type CommitmentAction } from "@/lib/commitment-policy";
import { resolveCommitmentDecisionIdentityKey } from "@/lib/commitment-decisions";
import { buildConnectorCoverageWindows, connectorEvidenceSourceName } from "@/lib/connector-source-identity";
import { guestAuditTransferKey, parseGuestAuditSnapshot, type GuestAuditSnapshot } from "@/lib/guest-audit-transfer";
import type { ProductEventMetricName, ProductEventName } from "@/lib/product-events";
import GuidedCapturePanel from "./guided-capture-panel";
import { VognaryMark } from "./brand";

const statusStyles: Record<RecommendationType, string> = {
  keep: "stamp stamp-keep",
  watch: "stamp stamp-watch",
  downgrade: "stamp stamp-downgrade",
  cancel: "stamp stamp-cancel",
  investigate: "stamp stamp-investigate",
};

type StatementFile = StatementSource & {
  id: string;
  rowCount: number;
  kind?: "csv" | "pdf" | "spreadsheet";
  warnings?: string[];
};

type TeamMember = {
  id: string;
  name: string;
  role: string;
};

type WorkspaceBackup = {
  version: 1;
  exportedAt: string;
  statementSources: StatementFile[];
  manualItems: ManualRecurringInput[];
  userActions: Record<string, RecommendationType>;
  itemOwners: Record<string, string>;
  reviewNotes: Record<string, string>;
  teamMembers: TeamMember[];
  receiptText?: string;
  actionsMeta?: Record<string, ActionMeta>;
  mergeDecisions?: Record<string, MergeDecision>;
  lastReview?: ReviewSnapshot | null;
  reviewCompletedAt?: string | null;
};

type ServerSessionPayload = {
  authenticated: boolean;
  configuration: { status: "not-configured" | "ready"; cookieName: string };
  session: null | {
    userId: string;
    email: string;
    workspaceId: string | null;
    expiresAt: string;
  };
};

type CoverageSignal = {
  label: string;
  done: boolean;
};

type ConnectorStartPayload = {
  status?: string;
  state?: string;
  error?: string;
  missingEnv?: string[];
  nextSteps?: string[];
  requiredEnv?: string[];
  message?: string;
  authUrl?: string;
  redirectUri?: string;
  initialSync?: {
    status?: string;
    evidenceWritten?: number;
    commitmentsTouched?: number;
    error?: string;
  };
};

type ServerConnectedAccount = {
  id: string;
  connectorId: string;
  providerAccountId: string | null;
  displayName: string;
  scopes: string[];
  status: string;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  coverageStartAt: string | null;
  coverageEndAt: string | null;
  coverageCompleteness: "partial" | "complete" | null;
  freshnessStatus: "unknown" | "fresh" | "stale" | "error" | null;
  latestRunStatus: string | null;
  latestRunAt: string | null;
  evidenceCount: number;
};

type ServerConnectorEvidence = {
  id: string;
  connectorId: string;
  connectedAccountId: string | null;
  provider: string;
  evidenceType: string;
  observedAt: string;
  merchantRaw: string | null;
  amount: number | null;
  currency: string | null;
  cadenceHint: string | null;
  nextDebitHint: string | null;
  confidenceScore: number;
};

type ServerRecurringItem = {
  id: string;
  merchant: string;
  normalizedMerchant: string;
  category: string;
  frequency: string;
  currency: string;
  amountMin: number;
  amountMax: number;
  averageAmount: number;
  monthlyCost: number;
  annualCost: number;
  lastChargeDate: string | null;
  nextExpectedDate: string | null;
  confidenceScore: number;
  status: string;
  recommendationReason: string | null;
  riskTags: string[];
  firstDetectedAt: string;
  updatedAt: string;
  connectorIds: string[];
  evidenceCount: number;
  lastObservedAt: string | null;
};

type ServerSourceHealth = {
  connectedAccountId: string;
  connectorId: string;
  status: string;
  freshnessStatus: "unknown" | "fresh" | "stale" | "error" | null;
  coverageStartAt: string | null;
  coverageEndAt: string | null;
  coverageCompleteness: "partial" | "complete" | null;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  latestRunStatus: string | null;
};

type WorkspaceConnectorStatusPayload = {
  status?: string;
  accounts?: ServerConnectedAccount[];
  sourceHealth?: ServerSourceHealth[];
  recurringItems?: ServerRecurringItem[];
  evidence?: ServerConnectorEvidence[];
  error?: string;
  message?: string;
};

type ServerCommitmentDecision = {
  id: string;
  recurringItemId: string;
  action: RecommendationType;
  decidedAt: string;
  updatedAt: string;
  merchant: string;
  normalizedMerchant: string;
  currency: string;
};

type WorkspaceDecisionsPayload = {
  status?: string;
  decisions?: ServerCommitmentDecision[];
  error?: string;
};

type ExperienceMode = "signed-in" | "guest" | "demo";

type IngestSourcePayload = {
  name: string;
  text: string;
  kind?: "csv" | "pdf" | "spreadsheet";
  rowCount?: number;
  warnings?: string[];
};

type IngestResponsePayload = {
  sources?: IngestSourcePayload[];
  error?: string;
  message?: string;
};

const workspaceStorageKey = "vognary.workspace.v1";
const gmailReceiptStorageKey = "vognary.gmail.receipts.v1";
const lastReviewStorageKey = "vognary.lastReview.v1";
const packChainStorageKey = "vognary.packChain.v1";

const demoReceiptText = [
  "OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly. Usage source not connected yet.",
  "GitHub Copilot Business invoice INR 1,520 paid on 2026-07-02. Review inactive seats before next billing cycle.",
  "Cloudflare domain renewal notice INR 1,200 annual renewal due 2026-09-10. Auto-renew enabled.",
].join("\n\n");

const demoStatementCsv = `Date,Description,Debit,Credit
2026-04-02,GITHUB COPILOT BUSINESS,1520,
2026-05-02,GITHUB COPILOT BUSINESS,1520,
2026-06-02,GITHUB COPILOT BUSINESS,1520,
2026-07-02,GITHUB COPILOT BUSINESS,1520,
2026-04-06,OPENAI CHATGPT PLUS,1999,
2026-05-06,OPENAI CHATGPT PLUS,1999,
2026-06-06,OPENAI CHATGPT PLUS,1999,
2026-07-06,OPENAI CHATGPT PLUS,1999,
2026-04-18,VERCEL PRO TEAM,1600,
2026-05-18,VERCEL PRO TEAM,1600,
2026-06-18,VERCEL PRO TEAM,1600,
2026-01-10,CLOUDFLARE DOMAIN RENEWAL,1200,
2026-04-10,INSURANCE POLICY PREMIUM,4200,
2026-05-15,SIP MUTUAL FUND AUTOPAY,5000,
2026-06-15,SIP MUTUAL FUND AUTOPAY,5000,`;

function buildDemoWorkspace(): WorkspaceBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    statementSources: [
      {
        id: "demo-founder-stack-statement",
        name: "demo-founder-stack.csv",
        text: demoStatementCsv,
        rowCount: 15,
        kind: "csv",
        warnings: [],
      },
    ],
    manualItems: [
      {
        id: "demo-upi-mandate",
        merchant: "UPI AutoPay mandate - AI video tool",
        amount: 999,
        frequency: "monthly",
        nextExpectedDate: "2026-08-03",
        category: "AI tools",
        sourceName: "User-confirmed UPI mandate screen",
      },
      {
        id: "demo-google-play",
        merchant: "Google Play subscription",
        amount: 299,
        frequency: "monthly",
        nextExpectedDate: "2026-08-12",
        category: "App store",
        sourceName: "Google Play subscription screen",
      },
    ],
    userActions: {},
    itemOwners: {},
    reviewNotes: {},
    teamMembers: [{ id: "founder", name: "Founder", role: "Owner" }],
    receiptText: demoReceiptText,
  };
}

function getInitialWorkspace(): WorkspaceBackup | null {
  if (typeof window === "undefined") return null;

  try {
    const saved = window.localStorage.getItem(workspaceStorageKey);
    if (!saved) return null;
    const backup = JSON.parse(saved) as Partial<WorkspaceBackup>;
    if (backup.version !== 1 || !Array.isArray(backup.statementSources) || !Array.isArray(backup.manualItems)) return null;
    return backup as WorkspaceBackup;
  } catch {
    window.localStorage.removeItem(workspaceStorageKey);
    return null;
  }
}

// Workspaces written before stable identity keys used item ids ending in the
// last charge date. Migrate those records before initializing React state so
// the first render is already internally consistent and no effect has to
// cascade through four state updates after paint.
function migrateLegacyWorkspaceKeys(workspace: WorkspaceBackup): WorkspaceBackup {
  const legacyPattern = /-\d{4}-\d{2}-\d{2}$/;
  const receiptItems = receiptTextToManualInputs(workspace.receiptText ?? "");
  const audit = analyzeStatements(
    workspace.statementSources.map(({ name, text }) => ({ name, text })),
    [...workspace.manualItems, ...receiptItems],
  );
  const mapKey = (key: string): string => {
    if (audit.recurringItems.some((item) => item.identityKey === key)) return key;
    if (legacyPattern.test(key)) {
      const merchantSlug = key.replace(legacyPattern, "");
      const match = audit.recurringItems.find((item) => slugifyKey(item.normalizedMerchant) === merchantSlug);
      return match?.identityKey ?? key;
    }

    const rankedKey = key.match(/^(.*::[A-Z]{3})(?:::(\d+))?$/);
    if (!rankedKey) return key;
    const candidates = audit.recurringItems
      .filter((item) => item.identityKey.startsWith(`${rankedKey[1]}::`))
      .sort((left, right) => right.monthlyCost - left.monthlyCost || left.identityKey.localeCompare(right.identityKey));
    const oldRank = Math.max(0, Number.parseInt(rankedKey[2] ?? "1", 10) - 1);
    return candidates[oldRank]?.identityKey ?? key;
  };
  const remap = <T,>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [mapKey(key), value]));
  const remapPairs = (record: Record<string, MergeDecision>): Record<string, MergeDecision> =>
    Object.fromEntries(Object.entries(record).map(([pairKey, value]) => {
      const [left, right] = pairKey.split("||");
      return [left && right ? [mapKey(left), mapKey(right)].sort().join("||") : pairKey, value];
    }));
  const remappedLastReview = workspace.lastReview ? {
    ...workspace.lastReview,
    items: workspace.lastReview.items.map((item) => ({ ...item, key: mapKey(item.key) })),
  } : null;

  return {
    ...workspace,
    userActions: remap(workspace.userActions),
    actionsMeta: remap(workspace.actionsMeta ?? {}),
    itemOwners: remap(workspace.itemOwners),
    reviewNotes: remap(workspace.reviewNotes),
    mergeDecisions: remapPairs(workspace.mergeDecisions ?? {}),
    lastReview: remappedLastReview,
  };
}

const integrationConnectorIds = [
  "gmail-readonly",
  "claude-subscription",
  "kling-subscription",
  "openai-costs",
  "vercel-platform",
  "render-platform",
  "x-premium-subscription",
  "github-billing",
  "github-copilot",
  "cloudflare-billing",
  "aws-cost-explorer",
  "paypal-automatic-payments",
  "apple-receipt-evidence",
  "google-play-receipt-evidence",
  "account-aggregator",
  "upi-autopay-mandates",
  "card-emandates",
];

const connectorLaunchTargets: Record<string, { label: string; url: string }> = {
  "gmail-readonly": { label: "Google OAuth", url: "https://console.cloud.google.com/apis/credentials" },
  "claude-subscription": { label: "Claude account", url: "https://claude.ai/settings/billing" },
  "kling-subscription": { label: "Kling account", url: "https://klingai.com/" },
  "openai-costs": { label: "OpenAI usage", url: "https://platform.openai.com/settings/organization/usage" },
  "chatgpt-subscription": { label: "ChatGPT billing guidance", url: "https://help.openai.com/en/articles/7232927-how-do-i-cancel-my-chatgpt-subscription" },
  "anthropic-usage": { label: "Anthropic console", url: "https://console.anthropic.com/settings/billing" },
  "vercel-platform": { label: "Vercel dashboard", url: "https://vercel.com/dashboard" },
  "render-platform": { label: "Render dashboard", url: "https://dashboard.render.com/" },
  "x-premium-subscription": { label: "X settings", url: "https://x.com/settings/subscription" },
  "github-billing": { label: "GitHub billing", url: "https://github.com/settings/billing" },
  "github-copilot": { label: "GitHub Copilot", url: "https://github.com/settings/copilot" },
  "cloudflare-billing": { label: "Cloudflare dashboard", url: "https://dash.cloudflare.com/" },
  "aws-cost-explorer": { label: "AWS Cost Explorer", url: "https://console.aws.amazon.com/costmanagement/home" },
  "paypal-automatic-payments": { label: "PayPal automatic payments", url: "https://www.paypal.com/myaccount/autopay/" },
  "apple-receipt-evidence": { label: "Apple subscriptions", url: "https://support.apple.com/en-in/118428" },
  "google-play-receipt-evidence": { label: "Google Play subscriptions", url: "https://play.google.com/store/account/subscriptions" },
  "account-aggregator": { label: "AA ecosystem", url: "https://sahamati.org.in/" },
  "upi-autopay-mandates": { label: "UPI AutoPay help", url: "https://support.google.com/pay/india/answer/10797278" },
  "card-emandates": { label: "RBI e-mandate overview", url: "https://www.rbi.org.in/" },
};

const connectorStatusLabels: Record<ConnectorStatus, string> = {
  live: "Implemented path",
  "ready-with-env": "Needs setup",
  "partner-required": "Needs partner",
  planned: "Planned",
};

const connectorStatusClass: Record<ConnectorStatus, string> = {
  live: "pill pill-ready",
  "ready-with-env": "pill pill-partial",
  "partner-required": "pill pill-blocked",
  planned: "pill pill-planned",
};

// Workspace information architecture — the ordered chapters of the review.
// Drives the sticky section index (table of contents) and the scroll-spy state.
const workspaceSections = [
  { id: "overview", folio: "00", label: "Overview", title: "Overview", note: "The five-second answer: burn, next renewal, one action." },
  { id: "connect", folio: "01", label: "Connect", title: "Connect evidence", note: "Bring receipts, statements, and provider sources into one workspace." },
  { id: "ledger", folio: "02", label: "Ledger", title: "Recurring ledger", note: "Every detected item with proof, cadence, and a decision." },
  { id: "review", folio: "03", label: "Review", title: "Monthly review", note: "Assign owners, capture notes, and close the review." },
  { id: "data", folio: "04", label: "Data", title: "Data & readiness", note: "Control where data lives and what is already live." },
] as const;

const workspaceSectionIds = workspaceSections.map((section) => section.id);
type WorkspaceSectionId = (typeof workspaceSections)[number]["id"];

export default function VognaryMvpClient({ experienceMode = "signed-in" }: { experienceMode?: ExperienceMode }) {
  const [initialWorkspace] = useState<WorkspaceBackup | null>(() => {
    const workspace = experienceMode === "demo" ? buildDemoWorkspace() : null;
    return workspace ? migrateLegacyWorkspaceKeys(workspace) : null;
  });
  const [statementSources, setStatementSources] = useState<StatementFile[]>(initialWorkspace?.statementSources ?? []);
  const [manualItems, setManualItems] = useState<ManualRecurringInput[]>(initialWorkspace?.manualItems ?? []);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [userActions, setUserActions] = useState<Record<string, RecommendationType>>(initialWorkspace?.userActions ?? {});
  const [actionsMeta, setActionsMeta] = useState<Record<string, ActionMeta>>(initialWorkspace?.actionsMeta ?? {});
  const [mergeDecisions, setMergeDecisions] = useState<Record<string, MergeDecision>>(initialWorkspace?.mergeDecisions ?? {});
  const [lastReview, setLastReview] = useState<ReviewSnapshot | null>(() => initialWorkspace?.lastReview ?? null);
  const [confirmState, setConfirmState] = useState<ConfirmRequest | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const undoSnapshotRef = useRef<WorkspaceBackup | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const [itemOwners, setItemOwners] = useState<Record<string, string>>(initialWorkspace?.itemOwners ?? {});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>(initialWorkspace?.reviewNotes ?? {});
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(initialWorkspace?.teamMembers?.length ? initialWorkspace.teamMembers : [{ id: "founder", name: "Founder", role: "Owner" }]);
  const [memberDraft, setMemberDraft] = useState({ name: "", role: "Finance / Ops" });
  const [receiptText, setReceiptText] = useState(initialWorkspace?.receiptText ?? "");
  const [reviewCompletedAt, setReviewCompletedAt] = useState<string | null>(initialWorkspace?.reviewCompletedAt ?? null);
  const [localSaveEnabled, setLocalSaveEnabled] = useState(experienceMode !== "demo" && Boolean(initialWorkspace));
  const [notice, setNotice] = useState<string | null>(null);
  const [serverSession, setServerSession] = useState<ServerSessionPayload | null>(null);
  const [serverSaveStatus, setServerSaveStatus] = useState<string | null>(null);
  const [serverWorkspaceHydrated, setServerWorkspaceHydrated] = useState(false);
  const [serverSaveRetry, setServerSaveRetry] = useState(0);
  const [connectorStartResults, setConnectorStartResults] = useState<Record<string, ConnectorStartPayload>>({});
  const [connectingConnectorId, setConnectingConnectorId] = useState<string | null>(null);
  const [syncingConnectorId, setSyncingConnectorId] = useState<string | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState("gmail-readonly");
  const [connectorApiKeyDraft, setConnectorApiKeyDraft] = useState("");
  const [connectorAccountDraft, setConnectorAccountDraft] = useState("");
  const [serverConnectors, setServerConnectors] = useState<WorkspaceConnectorStatusPayload | null>(null);
  const [serverDecisions, setServerDecisions] = useState<ServerCommitmentDecision[]>([]);
  const [disconnectedConnectorIds, setDisconnectedConnectorIds] = useState<string[]>([]);
  const [mobileSection, setMobileSection] = useState<WorkspaceSectionId>("overview");
  const [mobileViewport, setMobileViewport] = useState(false);
  const activationEventSent = useRef(false);
  const ledgerViewEventSent = useRef(false);
  const serverRevisionRef = useRef<number | null>(null);
  const lastServerSnapshotRef = useRef<string | null>(null);
  const serverSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const serverSyncGenerationRef = useRef(0);
  const guestTransferImportedRef = useRef(false);
  const guestTransferPendingSyncRef = useRef(false);
  const guestTransferSnapshotRef = useRef<GuestAuditSnapshot | null>(null);
  const serverSaveRetryCountRef = useRef(0);
  const serverSaveRetryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (experienceMode !== "guest") return;
    const savedWorkspace = getInitialWorkspace();
    const savedReview = loadLastReviewSnapshot();
    queueMicrotask(() => {
      if (savedWorkspace) {
        const restored = migrateLegacyWorkspaceKeys(savedWorkspace);
        setStatementSources(restored.statementSources);
        setManualItems(restored.manualItems);
        setUserActions(restored.userActions ?? {});
        setActionsMeta(restored.actionsMeta ?? {});
        setMergeDecisions(restored.mergeDecisions ?? {});
        setItemOwners(restored.itemOwners ?? {});
        setReviewNotes(restored.reviewNotes ?? {});
        setTeamMembers(restored.teamMembers?.length ? restored.teamMembers : [{ id: "founder", name: "Founder", role: "Owner" }]);
        setReceiptText(restored.receiptText ?? "");
        setLastReview(restored.lastReview ?? savedReview);
        setReviewCompletedAt(restored.reviewCompletedAt ?? null);
        setLocalSaveEnabled(true);
      } else if (savedReview) {
        setLastReview(savedReview);
      }
    });
  }, [experienceMode]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const updateViewport = () => setMobileViewport(media.matches);
    const updateHash = () => {
      const section = window.location.hash.slice(1);
      if (workspaceSectionIds.includes(section as WorkspaceSectionId)) {
        setMobileSection(section as WorkspaceSectionId);
      }
    };
    updateViewport();
    updateHash();
    media.addEventListener("change", updateViewport);
    window.addEventListener("hashchange", updateHash);
    return () => {
      media.removeEventListener("change", updateViewport);
      window.removeEventListener("hashchange", updateHash);
    };
  }, []);

  // Deferred so fast typing in the receipt box never blocks the frame on a
  // full re-analysis; the ledger catches up when typing pauses.
  const deferredReceiptText = useDeferredValue(receiptText);
  const pastedReceiptItems = useMemo(() => receiptTextToManualInputs(deferredReceiptText), [deferredReceiptText]);
  const syncedStatementSources = useMemo(
    () => connectorEvidenceToStatementSources(serverConnectors?.evidence ?? []),
    [serverConnectors?.evidence],
  );
  const verifiedCoverageWindows = useMemo(
    () => buildConnectorCoverageWindows(serverConnectors?.sourceHealth ?? []),
    [serverConnectors?.sourceHealth],
  );
  const syncedRecurringItems = useMemo(
    () => (serverConnectors?.recurringItems ?? []).map(serverRecurringItemToManualInput),
    [serverConnectors?.recurringItems],
  );
  const allStatementSources = useMemo(
    () => [...statementSources, ...syncedStatementSources],
    [statementSources, syncedStatementSources],
  );
  const allManualItems = useMemo(
    () => [...manualItems, ...syncedRecurringItems],
    [manualItems, syncedRecurringItems],
  );
  const baseAudit = useMemo<AuditResult>(
    () => analyzeStatements(allStatementSources.map(({ name, text }) => ({ name, text })), [...allManualItems, ...pastedReceiptItems]),
    [allStatementSources, allManualItems, pastedReceiptItems],
  );
  const audit = useMemo<AuditResult>(
    () => applyMergeDecisionsToAudit(baseAudit, mergeDecisions),
    [baseAudit, mergeDecisions],
  );
  const renewalTimeline = useMemo(
    () => buildRenewalTimeline(audit.recurringItems, { horizonDays: 45, actions: userActions }),
    [audit.recurringItems, userActions],
  );
  const duplicateCandidates = useMemo(
    () => findDuplicateCandidates(audit.recurringItems, mergeDecisions),
    [audit.recurringItems, mergeDecisions],
  );
  const proofGraph = useMemo(() => buildProofGraphSummary(audit.recurringItems), [audit.recurringItems]);
  const verifiedSavings = useMemo(
    () => buildVerifiedSavings(audit.recurringItems, actionsMeta, { coverageWindows: verifiedCoverageWindows }),
    [actionsMeta, audit.recurringItems, verifiedCoverageWindows],
  );
  const selectedItem = audit.recurringItems.find((item) => item.identityKey === selectedItemId) ?? audit.recurringItems[0] ?? null;
  const hasRealData = allStatementSources.length > 0 || allManualItems.length > 0 || receiptText.trim().length > 0;
  const coverageSignals = useMemo(
    () => getCoverageSignals(allStatementSources, allManualItems, receiptText),
    [allStatementSources, allManualItems, receiptText],
  );
  const coverageScore = Math.round((coverageSignals.filter((signal) => signal.done).length / coverageSignals.length) * 100);
  const priorityItems = useMemo(() => getPriorityItems(audit.recurringItems, userActions), [audit.recurringItems, userActions]);
  const reviewDiff = useMemo<ReviewDiff | null>(() => {
    if (!lastReview) return null;
    return diffReviews(lastReview, buildReviewSnapshot(audit, userActions, coverageScore));
  }, [lastReview, audit, userActions, coverageScore]);
  const connectedConnectorIds = useMemo(() => {
    const connected = new Set<string>();
    for (const [id, result] of Object.entries(connectorStartResults)) {
      if (result.status?.startsWith("connected")) connected.add(id);
    }
    for (const account of serverConnectors?.accounts ?? []) {
      if (account.status === "active") connected.add(account.connectorId);
    }
    for (const id of disconnectedConnectorIds) connected.delete(id);
    return connected;
  }, [connectorStartResults, disconnectedConnectorIds, serverConnectors]);
  const persistFailureNotified = useRef(false);
  useEffect(() => {
    if (!localSaveEnabled || typeof window === "undefined") return;
    const backup = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText, actionsMeta, mergeDecisions, lastReview, reviewCompletedAt });
    const saved = safePersist(workspaceStorageKey, JSON.stringify(backup));
    if (!saved && !persistFailureNotified.current) {
      persistFailureNotified.current = true;
      setNotice("Browser storage is full — the on-device save is NOT updating. Export a sealed audit pack now, then remove an old statement source.");
    }
    if (saved) persistFailureNotified.current = false;
  }, [actionsMeta, itemOwners, lastReview, localSaveEnabled, manualItems, mergeDecisions, receiptText, reviewCompletedAt, reviewNotes, statementSources, teamMembers, userActions]);

  // Cross-tab safety: if another tab writes this workspace, warn before this
  // tab silently overwrites that work with an older in-memory copy.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === workspaceStorageKey && event.newValue && event.oldValue !== event.newValue) {
        setNotice("This workspace changed in another tab. Reload this tab before editing here, or the other tab's changes may be overwritten.");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const payload = await response.json() as ServerSessionPayload;
        if (!ignore) setServerSession(payload);
      } catch {
        if (!ignore) setServerSession(null);
      }
    }

    loadSession();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const workspaceId = serverSession?.session?.workspaceId;
    const generation = ++serverSyncGenerationRef.current;
    if (!serverSession?.authenticated || !workspaceId) {
      serverRevisionRef.current = null;
      lastServerSnapshotRef.current = null;
      queueMicrotask(() => {
        if (generation === serverSyncGenerationRef.current) setServerWorkspaceHydrated(false);
      });
      return;
    }

    let ignore = false;
    queueMicrotask(() => {
      if (!ignore && generation === serverSyncGenerationRef.current) {
        setServerWorkspaceHydrated(false);
        setServerSaveStatus("Loading encrypted workspace state...");
      }
    });

    async function hydrateServerWorkspace() {
      try {
        const response = await fetch("/api/workspaces/current/audit-snapshot", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (ignore || generation !== serverSyncGenerationRef.current) return;
        if (!response.ok) {
          setServerSaveStatus(payload.message ?? payload.error ?? "Automatic workspace sync is unavailable.");
          return;
        }
        if (payload.status === "empty" || !payload.snapshot?.snapshot) {
          serverRevisionRef.current = null;
          lastServerSnapshotRef.current = null;
          setServerWorkspaceHydrated(true);
          setServerSaveStatus("Automatic encrypted workspace sync is ready.");
          return;
        }

        const snapshot = payload.snapshot.snapshot as Partial<WorkspaceBackup>;
        if (snapshot.version !== 1 || !Array.isArray(snapshot.statementSources) || !Array.isArray(snapshot.manualItems)) {
          setServerSaveStatus("Saved workspace state is invalid; automatic sync is paused.");
          return;
        }
        const restored = migrateLegacyWorkspaceKeys(snapshot as WorkspaceBackup);
        setStatementSources(restored.statementSources);
        setManualItems(restored.manualItems);
        setUserActions(restored.userActions ?? {});
        setActionsMeta(restored.actionsMeta ?? {});
        setMergeDecisions(restored.mergeDecisions ?? {});
        setItemOwners(restored.itemOwners ?? {});
        setReviewNotes(restored.reviewNotes ?? {});
        setTeamMembers(restored.teamMembers?.length ? restored.teamMembers : [{ id: "founder", name: "Founder", role: "Owner" }]);
        setReceiptText(restored.receiptText ?? "");
        setLastReview(restored.lastReview ?? null);
        setReviewCompletedAt(restored.reviewCompletedAt ?? null);
        setSelectedItemId(null);
        serverRevisionRef.current = payload.snapshot.revision;
        lastServerSnapshotRef.current = serializeWorkspaceForSync(restored);
        setServerWorkspaceHydrated(true);
        setServerSaveStatus(`Encrypted workspace synchronized at revision ${payload.snapshot.revision}.`);
      } catch {
        if (!ignore && generation === serverSyncGenerationRef.current) {
          setServerSaveStatus("Automatic workspace sync could not reach the server; local edits are not being uploaded.");
        }
      }
    }

    void hydrateServerWorkspace();
    return () => {
      ignore = true;
    };
  }, [serverSession?.authenticated, serverSession?.session?.workspaceId]);

  useEffect(() => {
    if (!serverSession?.authenticated || !serverWorkspaceHydrated || guestTransferImportedRef.current) return;
    const rawGuest = window.sessionStorage.getItem(guestAuditTransferKey);
    const guest = parseGuestAuditSnapshot(rawGuest);
    guestTransferImportedRef.current = true;
    if (!guest) {
      if (rawGuest) window.sessionStorage.removeItem(guestAuditTransferKey);
      return;
    }

    guestTransferSnapshotRef.current = guest;
    guestTransferPendingSyncRef.current = true;
    queueMicrotask(() => {
      setStatementSources((current) => {
        const next = [...current];
        guest.statementSources.forEach((source) => {
          if (!next.some((candidate) => candidate.text === source.text)) next.push(source);
        });
        return next;
      });
      setManualItems((current) => {
        const next = [...current];
        guest.manualItems.forEach((item) => {
          if (!next.some((candidate) => candidate.id === item.id)) next.push(item);
        });
        return next;
      });
      setReceiptText((current) => mergeReceiptText(current, guest.receiptText));
      setNotice("Your guest audit is intact. Saving it to this encrypted workspace now…");
    });
  }, [serverSession?.authenticated, serverWorkspaceHydrated]);

  useEffect(() => {
    if (!serverSession?.authenticated || !serverWorkspaceHydrated) return;
    const snapshot = buildWorkspaceBackup({
      statementSources,
      manualItems,
      userActions,
      itemOwners,
      reviewNotes,
      teamMembers,
      receiptText,
      actionsMeta,
      mergeDecisions,
      lastReview,
      reviewCompletedAt,
    });
    const serialized = serializeWorkspaceForSync(snapshot);
    if (serialized === lastServerSnapshotRef.current) return;
    const generation = serverSyncGenerationRef.current;
    const timer = window.setTimeout(() => {
      serverSaveQueueRef.current = serverSaveQueueRef.current.catch(() => undefined).then(async () => {
        if (generation !== serverSyncGenerationRef.current || serialized === lastServerSnapshotRef.current) return;
        setServerSaveStatus("Synchronizing encrypted workspace state...");
        let response: Response;
        try {
          response = await fetch("/api/workspaces/current/audit-snapshot", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: "Vognary workspace state",
              expectedRevision: serverRevisionRef.current,
              snapshot,
              summary: {
                recurringCount: audit.summary.recurringCount,
                monthlyRecurringSpend: audit.summary.monthlyRecurringSpend,
                annualRecurringSpend: audit.summary.annualRecurringSpend,
                reviewableMonthlySpend: audit.summary.reviewableMonthlySpend,
                sourceCount: statementSources.length,
                manualCount: manualItems.length,
              },
            }),
          });
        } catch {
          setServerSaveStatus("Automatic workspace sync could not reach the server; this tab retains the current edits and will retry.");
          scheduleServerSaveRetry();
          return;
        }
        const payload = await response.json().catch(() => ({}));
        if (generation !== serverSyncGenerationRef.current) return;
        if (response.status === 409) {
          guestTransferImportedRef.current = false;
          guestTransferPendingSyncRef.current = false;
          setServerWorkspaceHydrated(false);
          setServerSaveStatus("Workspace changed on another device. Reloading and merging this tab's guest audit before retrying.");
          window.location.reload();
          return;
        }
        if (!response.ok) {
          setServerSaveStatus(payload.message ?? payload.error ?? "Automatic workspace sync failed; this tab retains the current edits.");
          if (response.status >= 500) scheduleServerSaveRetry();
          return;
        }
        finishSuccessfulServerSave(snapshot, serialized, payload);
      });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [
    actionsMeta,
    audit.summary.annualRecurringSpend,
    audit.summary.monthlyRecurringSpend,
    audit.summary.recurringCount,
    audit.summary.reviewableMonthlySpend,
    itemOwners,
    lastReview,
    manualItems,
    mergeDecisions,
    receiptText,
    reviewCompletedAt,
    reviewNotes,
    serverSession?.authenticated,
    serverSaveRetry,
    serverWorkspaceHydrated,
    statementSources,
    teamMembers,
    userActions,
  ]);

  useEffect(() => {
    let ignore = false;
    let intervalId: number | null = null;

    async function loadWorkspaceConnectors() {
      if (!serverSession?.authenticated) {
        setServerConnectors(null);
        setServerDecisions([]);
        return;
      }

      const [connectorPayload, decisionPayload] = await Promise.all([
        fetchWorkspaceConnectors(),
        fetchWorkspaceDecisions(),
      ]);
      if (!ignore) {
        setServerConnectors(connectorPayload);
        setServerDecisions(decisionPayload.decisions ?? []);
      }
    }

    loadWorkspaceConnectors();
    if (serverSession?.authenticated) {
      intervalId = window.setInterval(() => {
        if (document.visibilityState === "visible") void loadWorkspaceConnectors();
      }, 30_000);
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadWorkspaceConnectors();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      ignore = true;
      if (intervalId !== null) window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [serverSession?.authenticated, serverSession?.session?.workspaceId]);

  useEffect(() => {
    if (activationEventSent.current || !serverSession?.authenticated || !syncedRecurringItems.length) return;
    activationEventSent.current = true;
    void trackProductEvent("workspace.activated", {
      commitmentsTouched: syncedRecurringItems.length,
      evidenceWritten: serverConnectors?.evidence?.length ?? 0,
    });
  }, [serverConnectors?.evidence?.length, serverSession?.authenticated, syncedRecurringItems.length]);

  useEffect(() => {
    if (!serverDecisions.length) return;
    queueMicrotask(() => {
      setUserActions((current) => {
        const next = { ...current };
        for (const decision of serverDecisions) {
          const key = resolveCommitmentDecisionIdentityKey(audit.recurringItems, decision);
          if (key) next[key] = decision.action;
        }
        return next;
      });
      setActionsMeta((current) => {
        const next = { ...current };
        for (const decision of serverDecisions) {
          const key = resolveCommitmentDecisionIdentityKey(audit.recurringItems, decision);
          if (!key) continue;
          const local = next[key];
          if (!local || Date.parse(decision.decidedAt) >= Date.parse(local.decidedAt)) {
            next[key] = { action: decision.action, decidedAt: decision.decidedAt };
          }
        }
        return next;
      });
    });
  }, [audit.recurringItems, serverDecisions]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = window.localStorage.getItem(gmailReceiptStorageKey);
    if (!raw) {
      const url = new URL(window.location.href);
      const gmailOutcome = url.searchParams.get("gmail");
      if (!gmailOutcome) return;

      queueMicrotask(() => {
        setNotice(gmailOutcome === "connected"
          ? "Gmail connected and its first receipt-history sync completed. The ledger now refreshes automatically."
          : gmailOutcome === "sync-pending"
            ? "Gmail connected. Its first sync needs attention; the source-health view will show the retry state."
            : `Gmail authorization returned ${gmailOutcome.replaceAll("-", " ")}. Check the connection status before retrying.`);
      });
      url.searchParams.delete("gmail");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      return;
    }

    try {
      const payload = JSON.parse(raw) as { candidates?: ReceiptCandidate[]; messageCount?: number };
      const candidates = Array.isArray(payload.candidates) ? payload.candidates.filter(isReceiptCandidate) : [];

      if (!candidates.length) {
        queueMicrotask(() => {
          setConnectorStartResults((current) => ({ ...current, "gmail-readonly": { status: "connected-preview", message: "Gmail connected; no recurring candidates found yet." } }));
          setDisconnectedConnectorIds((current) => current.filter((id) => id !== "gmail-readonly"));
          setNotice(`Gmail connected. Scanned ${payload.messageCount ?? 0} receipt-like message(s), but no recurring candidates were found yet.`);
        });
        return;
      }

      const importedAt = Date.now();
      queueMicrotask(() => {
        setManualItems((current) => {
          const existing = new Set(current.map((item) => recurringIdentity(item)));
          const nextItems = candidates
            .filter((candidate) => !existing.has(recurringIdentity(candidate)))
            .map((candidate, index) => ({
              id: `gmail-${importedAt}-${index}-${candidate.id}`,
              merchant: candidate.merchant,
              amount: candidate.amount,
              currency: candidate.currency,
              frequency: candidate.frequency,
              nextExpectedDate: candidate.nextExpectedDate,
              category: candidate.category,
              sourceName: "Gmail receipt sync",
            }));
          return [...current, ...nextItems];
        });
        setReceiptText((current) => current || candidates.map((candidate) => candidate.evidenceText).join("\n\n"));
        setConnectorStartResults((current) => ({ ...current, "gmail-readonly": { status: "connected-preview", message: `Imported ${candidates.length} recurring candidate(s) from Gmail.` } }));
        setDisconnectedConnectorIds((current) => current.filter((id) => id !== "gmail-readonly"));
        setNotice(`Gmail connected. Imported ${candidates.length} recurring candidate(s) from receipt history.`);
      });
    } catch {
      queueMicrotask(() => {
        setNotice("Gmail returned receipt data, but Vognary could not import it into this browser.");
      });
    } finally {
      window.localStorage.removeItem(gmailReceiptStorageKey);
      if (window.location.search.includes("gmail=")) window.history.replaceState(null, "", "/app");
    }
  }, []);

  const activeSection = useActiveSection(workspaceSectionIds);
  const workspaceNavSection = mobileViewport ? mobileSection : activeSection;
  const sampleDataPresent = statementSources.some((source) => source.id.startsWith("demo-"))
    || manualItems.some((item) => item.id.startsWith("demo-"));

  function selectAndReviewItem(itemId?: string) {
    if (itemId) setSelectedItemId(itemId);
    setMobileSection("ledger");
    if (serverSession?.authenticated && !ledgerViewEventSent.current && audit.recurringItems.length) {
      ledgerViewEventSent.current = true;
      void trackProductEvent("ledger.viewed", { commitmentsTouched: audit.recurringItems.length });
    }
    window.setTimeout(() => document.getElementById("recurring-ledger")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  // Record the action AND when it was decided — the Verified Savings engine
  // proves outcomes against this timestamp.
  function recordAction(itemId: string, action: RecommendationType) {
    const item = audit.recurringItems.find((candidate) => candidate.identityKey === itemId);
    if (item && !isReviewActionAllowed(item.category, action)) {
      const policy = getCommitmentPolicy(item.category);
      setNotice(`${policy.label}: ${policy.consequenceWarning}`);
      return;
    }
    setUserActions((current) => ({ ...current, [itemId]: action }));
    setActionsMeta((current) => ({ ...current, [itemId]: { action, decidedAt: new Date().toISOString() } }));
    if (item?.canonicalRecurringItemId && serverSession?.authenticated) {
      void saveServerCommitmentDecision(item.canonicalRecurringItemId, action);
    }
    if (serverSession?.authenticated) void trackProductEvent("review.action_recorded", { commitmentsTouched: 1 });
  }

  function decideDuplicate(pairKey: string, decision: MergeDecision) {
    setMergeDecisions((current) => ({ ...current, [pairKey]: decision }));
    setNotice(decision === "merge"
      ? "Merged into one commitment. Evidence rows were combined and totals updated."
      : "Kept as separate commitments. Vognary will not ask about this pair again.");
  }

  function undoDuplicateDecision(pairKey: string) {
    setMergeDecisions((current) => {
      const next = { ...current };
      delete next[pairKey];
      return next;
    });
    setNotice("Duplicate resolution removed. The pair is available for review again.");
  }

  function restoreWorkspaceBackup(backup: WorkspaceBackup) {
    setStatementSources(backup.statementSources);
    setManualItems(backup.manualItems);
    setUserActions(backup.userActions ?? {});
    setActionsMeta(backup.actionsMeta ?? {});
    setMergeDecisions(backup.mergeDecisions ?? {});
    setItemOwners(backup.itemOwners ?? {});
    setReviewNotes(backup.reviewNotes ?? {});
    setTeamMembers(backup.teamMembers?.length ? backup.teamMembers : [{ id: "founder", name: "Founder", role: "Owner" }]);
    setReceiptText(backup.receiptText ?? "");
    setLastReview(backup.lastReview ?? null);
    setReviewCompletedAt(backup.reviewCompletedAt ?? null);
  }

  // Destructive actions are confirmed first and undoable for 30 seconds after.
  function offerUndo() {
    undoSnapshotRef.current = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText, actionsMeta, mergeDecisions, lastReview, reviewCompletedAt });
    setUndoAvailable(true);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setUndoAvailable(false), 30_000);
  }

  function undoLastDestructiveAction() {
    if (!undoSnapshotRef.current) return;
    restoreWorkspaceBackup(undoSnapshotRef.current);
    undoSnapshotRef.current = null;
    setUndoAvailable(false);
    setNotice("Workspace restored. Nothing was lost.");
  }

  function requestClearWorkspace() {
    setConfirmState({
      title: "Clear this workspace?",
      body: "Every source, manual item, note, owner, and decision in this browser will be removed. You can undo for 30 seconds afterwards — or export a sealed pack first.",
      confirmLabel: "Clear workspace",
      onConfirm: () => {
        offerUndo();
        setStatementSources([]);
        setManualItems([]);
        setUserActions({});
        setActionsMeta({});
        setMergeDecisions({});
        setItemOwners({});
        setReviewNotes({});
        setSelectedItemId(null);
        setReceiptText("");
        setNotice("Workspace cleared. This browser has no audit data now.");
      },
    });
  }

  function loadDemoWorkspace() {
    const demo = buildDemoWorkspace();
    setStatementSources(demo.statementSources);
    setManualItems(demo.manualItems);
    setUserActions({});
    setActionsMeta({});
    setMergeDecisions({});
    setItemOwners({});
    setReviewNotes({});
    setTeamMembers(demo.teamMembers);
    setReceiptText(demo.receiptText ?? "");
    setSelectedItemId(null);
    setDisconnectedConnectorIds([]);
    setNotice("Sample workspace loaded. You can review the ledger, change actions, export it, or replace it with your own evidence.");
    window.setTimeout(() => selectAndReviewItem(), 80);
  }

  async function importStatementFiles(files: File[]) {
    if (!files.length) return;
    setNotice(`Importing ${files.length} source file(s)...`);

    try {
      const formData = new FormData();
      for (const file of files) formData.append("files", file);
      const response = await fetch("/api/ingest", { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({})) as IngestResponsePayload;

      if (!response.ok || !payload.sources?.length) {
        setNotice(payload.message ?? payload.error ?? "Could not import those files. Use CSV/TXT/XLS/XLSX or readable PDF statement exports under 8 MB.");
        return;
      }

      const importedAt = Date.now();
      const importedSources: StatementFile[] = payload.sources.map((source, index) => ({
        id: `source-${importedAt}-${index}`,
        name: source.name,
        text: source.text,
        rowCount: source.rowCount ?? Math.max(0, source.text.split(/\r?\n/).filter((row) => row.trim()).length - 1),
        kind: source.kind ?? "csv",
        warnings: source.warnings ?? [],
      }));
      setStatementSources((current) => [...current, ...importedSources]);
      setNotice(`Imported ${importedSources.length} source file(s). Vognary updated the ledger and source checklist.`);
      window.setTimeout(() => selectAndReviewItem(), 80);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not import those files.");
    }
  }

  async function exportReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      product: "Vognary Recurring Audit",
      mode: "self-serve-stateless-audit",
      readiness: getReadinessItems(),
      sourceCoverage: getCoverageItems(),
      proofGraph,
      verifiedSavings,
      summary: audit.summary,
      renewalTimeline,
      sources: statementSources.map(({ name, rowCount }) => ({ name, rowCount })),
      manualItems,
      teamMembers,
      itemOwners,
      reviewNotes,
      recurringItems: audit.recurringItems.map((item) => ({
        ...item,
        evidence: item.evidence.map((link) => ({ ...link, description: redactText(link.description).text })),
        userAction: userActions[item.identityKey] ?? item.recommendationType,
        owner: getOwnerName(itemOwners[item.identityKey], teamMembers),
        reviewNote: reviewNotes[item.identityKey] ?? "",
      })),
      warnings: audit.warnings,
    };

    try {
      const { sealed, chain } = await sealAuditPack(report, loadPackChain());
      let downloadablePack = sealed;
      let issuerSigned = false;
      if (serverSession?.authenticated && serverSession.session?.workspaceId) {
        try {
          const response = await fetch("/api/audit-packs/sign", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ integrity: sealed.integrity }),
          });
          const payload = await response.json().catch(() => ({})) as { issuerSignature?: unknown };
          if (response.ok && isPackIssuerSignature(payload.issuerSignature)) {
            downloadablePack = attachIssuerSignature(sealed, payload.issuerSignature);
            issuerSigned = true;
          }
        } catch {
          // The offline checksum export remains useful when signing is absent
          // or temporarily unreachable; the notice below states that level.
        }
      }
      savePackChain(chain);
      const blob = new Blob([JSON.stringify(downloadablePack, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `vognary-audit-pack-${chain.chainIndex}.json`;
      link.click();
      URL.revokeObjectURL(url);
      if (serverSession?.authenticated) void trackProductEvent("export.created", { commitmentsTouched: audit.recurringItems.length });
      setNotice(issuerSigned
        ? `Audit pack #${chain.chainIndex} downloaded with an offline SHA-256 checksum and a Vognary Ed25519 issuer signature. Verify both at /verify.`
        : `Audit pack #${chain.chainIndex} downloaded with an offline SHA-256 self-checksum. It detects edits but does not prove Vognary issued the pack; /verify will show that distinction.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not seal the audit pack in this browser.");
    }
  }

  function exportCsv() {
    const header = ["Merchant", "Category", "Currency", "Frequency", "Monthly cost", "Average amount", "Next expected", "Confidence", "Action", "Owner", "Note", "Sources"];
    const rows = audit.recurringItems.map((item) => [
      item.merchant,
      item.category,
      item.currency,
      item.frequency,
      Math.round(item.monthlyCost),
      Math.round(item.averageAmount),
      item.nextExpectedDate,
      item.confidenceScore,
      userActions[item.identityKey] ?? item.recommendationType,
      getOwnerName(itemOwners[item.identityKey], teamMembers),
      reviewNotes[item.identityKey] ?? "",
      item.sourceNames.join("; "),
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    downloadBlob(csv, "text/csv;charset=utf-8", "vognary-recurring-ledger.csv");
    if (serverSession?.authenticated) void trackProductEvent("export.created", { commitmentsTouched: audit.recurringItems.length });
    setNotice("Ledger CSV downloaded. It carries actions, owners, and notes for spreadsheet review.");
  }

  // PDF is rendered on demand; jspdf never loads unless the user asks for it.
  async function exportPdf() {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageHeight = doc.internal.pageSize.getHeight();
      const left = 48;
      let y = 56;

      const line = (text: string, size = 10, gap = 16) => {
        if (y > pageHeight - 60) {
          doc.addPage();
          y = 56;
        }
        doc.setFontSize(size);
        doc.text(text, left, y, { maxWidth: 500 });
        y += gap;
      };

      line("Vognary — Recurring Money Audit", 18, 26);
      line(`Generated ${new Date().toISOString().slice(0, 10)} · ${audit.summary.recurringCount} recurring items`, 10, 20);
      line(`Monthly recurring (${audit.summary.primaryCurrency}): ${Math.round(audit.summary.monthlyRecurringSpend)}   Yearly: ${Math.round(audit.summary.annualRecurringSpend)}   Needs review: ${Math.round(audit.summary.reviewableMonthlySpend)}`, 10, 16);
      const foreignEntries = Object.entries(audit.summary.foreignMonthlyTotals);
      if (foreignEntries.length) {
        line(`Foreign-currency monthly (reported separately): ${foreignEntries.map(([code, total]) => `${code} ${Math.round(total)}`).join(" · ")}`, 10, 16);
      }
      if (verifiedSavings.verifiedAnnual > 0) {
        line(`Verified savings: ${Math.round(verifiedSavings.verifiedAnnual)}/yr proven by evidence of absence`, 10, 16);
      }
      y += 8;
      line("Ledger (merchant · monthly · next debit · action)", 12, 20);
      for (const item of audit.recurringItems) {
        const action = userActions[item.identityKey] ?? item.recommendationType;
        line(`${item.merchant} — ${item.currency} ${Math.round(item.monthlyCost)}/mo — next ${item.nextExpectedDate} — ${action} (${item.confidenceScore}% confidence)`, 10, 14);
      }
      y += 10;
      const chain = loadPackChain();
      line(chain
        ? `Data integrity: latest pack #${chain.chainIndex}, SHA-256 ${chain.lastHash.slice(0, 16)}… — the JSON verifier distinguishes its checksum from any Vognary issuer signature.`
        : "Data integrity: export the JSON pack for an offline tamper checksum; authenticated packs are issuer-signed only when signing is configured.", 9, 14);

      doc.save("vognary-audit-report.pdf");
      if (serverSession?.authenticated) void trackProductEvent("export.created", { commitmentsTouched: audit.recurringItems.length });
      setNotice("PDF report downloaded. Use the JSON pack to check its offline checksum and, when present, its separate Vognary issuer signature.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not render the PDF in this browser.");
    }
  }

  async function saveServerWorkspace() {
    if (!serverSession?.authenticated) {
      setNotice("Sign in before saving an encrypted server snapshot.");
      return;
    }

    const generation = serverSyncGenerationRef.current;
    setServerSaveStatus("Synchronizing encrypted workspace state...");
    const snapshot = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText, actionsMeta, mergeDecisions, lastReview, reviewCompletedAt });
    let response: Response;
    try {
      response = await fetch("/api/workspaces/current/audit-snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Vognary workspace snapshot",
          expectedRevision: serverRevisionRef.current,
          snapshot,
          summary: {
            recurringCount: audit.summary.recurringCount,
            monthlyRecurringSpend: audit.summary.monthlyRecurringSpend,
            annualRecurringSpend: audit.summary.annualRecurringSpend,
            reviewableMonthlySpend: audit.summary.reviewableMonthlySpend,
            sourceCount: statementSources.length,
            manualCount: manualItems.length,
          },
        }),
      });
    } catch {
      const message = "Could not reach encrypted workspace sync. This tab and the same-tab transfer still retain your audit.";
      setServerSaveStatus(message);
      setNotice(message);
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (generation !== serverSyncGenerationRef.current) return;
    if (response.status === 409) {
      guestTransferImportedRef.current = false;
      guestTransferPendingSyncRef.current = false;
      setServerWorkspaceHydrated(false);
      const message = "Workspace changed on another device. Reloading and merging this tab's guest audit before retrying.";
      setServerSaveStatus(message);
      setNotice(message);
      window.location.reload();
      return;
    }
    if (response.ok) {
      finishSuccessfulServerSave(snapshot, serializeWorkspaceForSync(snapshot), payload);
      setServerWorkspaceHydrated(true);
    }
    const message = response.ok
      ? `Encrypted workspace synchronized at revision ${serverRevisionRef.current}.`
      : payload.message ?? payload.error ?? "Could not save server snapshot.";
    setServerSaveStatus(message);
    setNotice(message);
  }

  function scheduleServerSaveRetry() {
    if (serverSaveRetryTimerRef.current !== null) return;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(serverSaveRetryCountRef.current, 5));
    serverSaveRetryCountRef.current += 1;
    serverSaveRetryTimerRef.current = window.setTimeout(() => {
      serverSaveRetryTimerRef.current = null;
      setServerSaveRetry((value) => value + 1);
    }, delayMs);
  }

  function finishSuccessfulServerSave(snapshot: WorkspaceBackup, serialized: string, payload: { snapshot?: { revision?: number } }) {
    serverRevisionRef.current = payload.snapshot?.revision ?? serverRevisionRef.current;
    lastServerSnapshotRef.current = serialized;
    serverSaveRetryCountRef.current = 0;
    if (serverSaveRetryTimerRef.current !== null) {
      window.clearTimeout(serverSaveRetryTimerRef.current);
      serverSaveRetryTimerRef.current = null;
    }
    setServerSaveStatus(`Encrypted workspace synchronized at revision ${serverRevisionRef.current}.`);
    const guest = guestTransferSnapshotRef.current;
    if (guestTransferPendingSyncRef.current && guest && workspaceContainsGuestTransfer(snapshot, guest)) {
      window.sessionStorage.removeItem(guestAuditTransferKey);
      guestTransferPendingSyncRef.current = false;
      guestTransferSnapshotRef.current = null;
      setNotice("Guest audit saved to this encrypted workspace. The same-tab transfer copy has been cleared.");
    }
  }

  async function loadServerWorkspace() {
    if (!serverSession?.authenticated) {
      setNotice("Sign in before loading an encrypted server snapshot.");
      return;
    }

    const generation = ++serverSyncGenerationRef.current;
    setServerWorkspaceHydrated(false);
    setServerSaveStatus("Loading encrypted workspace state...");
    let response: Response;
    try {
      response = await fetch("/api/workspaces/current/audit-snapshot", { cache: "no-store" });
    } catch {
      const message = "Could not reach encrypted workspace sync. This tab and the same-tab transfer still retain your audit.";
      setServerSaveStatus(message);
      setNotice(message);
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.message ?? payload.error ?? "Could not load server snapshot.";
      setServerSaveStatus(message);
      setNotice(message);
      return;
    }
    if (payload.status === "empty" || !payload.snapshot?.snapshot) {
      serverRevisionRef.current = null;
      lastServerSnapshotRef.current = null;
      setServerWorkspaceHydrated(true);
      setServerSaveStatus("No saved server state yet; automatic sync is ready for this workspace.");
      setNotice("No saved server state yet; automatic sync is ready for this workspace.");
      return;
    }

    const snapshot = payload.snapshot.snapshot as Partial<WorkspaceBackup>;
    if (snapshot.version !== 1 || !Array.isArray(snapshot.statementSources) || !Array.isArray(snapshot.manualItems)) {
      setServerSaveStatus("Saved snapshot is not a valid Vognary workspace backup.");
      return;
    }

    const restored = migrateLegacyWorkspaceKeys(snapshot as WorkspaceBackup);
    restoreWorkspaceBackup(restored);
    setSelectedItemId(null);
    serverRevisionRef.current = payload.snapshot.revision;
    lastServerSnapshotRef.current = serializeWorkspaceForSync(restored);
    setServerWorkspaceHydrated(true);
    if (generation !== serverSyncGenerationRef.current) return;
    setServerSaveStatus(`Encrypted workspace synchronized at revision ${payload.snapshot.revision}.`);
    setNotice("Latest encrypted workspace state loaded into this browser.");
  }

  function requestDeleteServerWorkspace() {
    if (!serverSession?.authenticated) {
      setNotice("Sign in before deleting synchronized server state.");
      return;
    }
    setConfirmState({
      title: "Pause sync and delete server state?",
      body: "The encrypted synchronized workspace state and its normalized upload/manual ledger rows will be permanently deleted. Local data on this device is not affected.",
      confirmLabel: "Delete server copies",
      onConfirm: () => { void deleteServerWorkspace(); },
    });
  }

  async function deleteServerWorkspace() {
    if (!serverSession?.authenticated) {
      setNotice("Sign in before deleting synchronized server state.");
      return;
    }

    ++serverSyncGenerationRef.current;
    setServerWorkspaceHydrated(false);
    setServerSaveStatus("Deleting synchronized workspace state...");
    const response = await fetch("/api/workspaces/current/audit-snapshot", { method: "DELETE" });
    const payload = await response.json();
    const message = response.ok
      ? `Deleted ${payload.deletedCount ?? 0} synchronized workspace state record(s). Automatic server sync is paused in this tab.`
      : payload.message ?? payload.error ?? "Could not delete synchronized server state.";
    if (response.ok) {
      serverRevisionRef.current = null;
      lastServerSnapshotRef.current = null;
    }
    setServerSaveStatus(message);
    setNotice(message);
  }

  function addTeamMember() {
    if (!memberDraft.name.trim()) {
      setNotice("Add a team member name before adding them to the review workflow.");
      return;
    }
    setTeamMembers((current) => [...current, { id: `member-${Date.now()}`, name: memberDraft.name.trim(), role: memberDraft.role.trim() || "Member" }]);
    setMemberDraft({ name: "", role: "Finance / Ops" });
  }

  function removeTeamMember(id: string) {
    if (id === "founder") return;
    setTeamMembers((current) => current.filter((member) => member.id !== id));
    setItemOwners((current) => Object.fromEntries(Object.entries(current).filter(([, ownerId]) => ownerId !== id)));
  }

  function markMonthlyReviewComplete() {
    setReviewCompletedAt(new Date().toISOString());
    const snapshot = buildReviewSnapshot(audit, userActions, coverageScore);
    safePersist(lastReviewStorageKey, JSON.stringify(snapshot));
    setLastReview(snapshot);
    if (serverSession?.authenticated) void trackProductEvent("review.completed", { commitmentsTouched: audit.recurringItems.length });
    setNotice("Monthly review completed. The next review will open with what changed since today. Export the sealed audit pack for evidence.");
  }

  function enableLocalSave() {
    setLocalSaveEnabled(true);
    const backup = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText, actionsMeta, mergeDecisions, lastReview, reviewCompletedAt });
    const saved = safePersist(workspaceStorageKey, JSON.stringify(backup));
    setNotice(saved
      ? "Local save enabled on this device. Do not use it on shared computers."
      : "Browser storage is full — the workspace could not be saved. Export a sealed audit pack, then remove an old statement source and try again.");
  }

  function requestDisableLocalSave() {
    setConfirmState({
      title: "Delete the browser save?",
      body: "The saved copy on this device will be removed. The workspace currently on screen stays until you close the tab.",
      confirmLabel: "Delete browser save",
      onConfirm: () => {
        setLocalSaveEnabled(false);
        window.localStorage.removeItem(workspaceStorageKey);
        setNotice("Saved browser workspace deleted from this device.");
      },
    });
  }

  async function startConnector(connector: Connector) {
    setConnectingConnectorId(connector.id);
    setDisconnectedConnectorIds((current) => current.filter((id) => id !== connector.id));

    try {
      if (connector.authType === "api-key" && connectorApiKeyDraft.trim()) {
        const workspaceId = serverSession?.session?.workspaceId;
        if (!serverSession?.authenticated || !workspaceId) {
          setNotice("Sign in before storing an encrypted provider API key.");
          return;
        }

        if (connector.id === "github-copilot" && !connectorAccountDraft.trim()) {
          setNotice("Add the GitHub organization slug before storing a Copilot metrics token.");
          return;
        }

        const response = await fetch(`/api/connectors/${connector.id}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            apiKey: connectorApiKeyDraft.trim(),
            providerAccountId: connectorAccountDraft.trim() || undefined,
            displayName: `${connector.name} sync`,
          }),
        });
        const payload = await response.json().catch(() => ({})) as ConnectorStartPayload;
        setConnectorStartResults((current) => ({ ...current, [connector.id]: payload }));

        if (!response.ok) {
          setNotice(payload.message ?? payload.error ?? `Could not connect ${connector.name}.`);
          return;
        }

        setConnectorApiKeyDraft("");
        setConnectorAccountDraft("");
        await refreshWorkspaceConnectors();
        setNotice(payload.initialSync?.status === "succeeded"
          ? `${connector.name} connected. Its first sync populated ${payload.initialSync.evidenceWritten ?? 0} evidence record(s) and will refresh automatically.`
          : `${connector.name} connected, but its first sync needs attention: ${payload.initialSync?.error ?? "the source did not complete"}. Vognary will retain the failure state for retry.`);
        return;
      }

      if (connector.id === "gmail-readonly") {
        if (!serverSession?.authenticated) {
          setNotice("Sign in before connecting Gmail so the OAuth consent and encrypted refresh token belong to your workspace.");
          return;
        }
        const response = await fetch("/api/integrations/gmail/start?mode=json", { cache: "no-store" });
        const payload = await response.json().catch(() => ({})) as ConnectorStartPayload;
        setConnectorStartResults((current) => ({ ...current, [connector.id]: payload }));

        if (response.ok && payload.authUrl) {
          window.location.href = payload.authUrl;
          return;
        }

        openOfficialConnectorTarget(connector.id);
        setNotice(payload.requiredEnv?.length
          ? `Gmail needs production OAuth setup first: ${payload.requiredEnv.join(", ")}. Required redirect URI: ${payload.redirectUri ?? "not available"}.`
          : "Opening the official Gmail setup path.");
        return;
      }

      const response = await fetch(`/api/connectors/${connector.id}/start`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as ConnectorStartPayload;
      setConnectorStartResults((current) => ({ ...current, [connector.id]: payload }));

      openOfficialConnectorTarget(connector.id);
      const missing = payload.missingEnv?.length ? ` Missing setup: ${payload.missingEnv.join(", ")}.` : "";
      const state = payload.state ? ` State: ${payload.state}.` : "";
      setNotice(`${connector.name} integration started through the official provider path.${state}${missing}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not start this integration.");
    } finally {
      setConnectingConnectorId(null);
    }
  }

  async function disconnectConnector(connector: Connector) {
    const account = getServerAccount(serverConnectors, connector.id);
    if (account) {
      setConnectingConnectorId(connector.id);
      try {
        const response = await fetch(`/api/workspaces/current/connectors/${account.id}`, { method: "DELETE" });
        const payload = await response.json().catch(() => ({})) as { status?: string; error?: string; message?: string };
        if (!response.ok) {
          setNotice(payload.message ?? payload.error ?? `Could not disconnect ${connector.name}.`);
          return;
        }
        await refreshWorkspaceConnectors();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : `Could not disconnect ${connector.name}.`);
        return;
      } finally {
        setConnectingConnectorId(null);
      }
    }

    setConnectorStartResults((current) => {
      const next = { ...current };
      delete next[connector.id];
      return next;
    });
    setDisconnectedConnectorIds((current) => current.includes(connector.id) ? current : [...current, connector.id]);

    if (connector.id === "gmail-readonly") {
      window.localStorage.removeItem(gmailReceiptStorageKey);
      setReceiptText("");
      setManualItems((current) => current.filter((item) => item.sourceName !== "Gmail receipt sync"));
    }

    setNotice(`${connector.name} disconnected in this workspace.`);
  }

  async function refreshWorkspaceConnectors() {
    if (!serverSession?.authenticated) return;
    setServerConnectors(await fetchWorkspaceConnectors());
  }

  async function saveServerCommitmentDecision(recurringItemId: string, action: RecommendationType) {
    try {
      const response = await fetch("/api/workspaces/current/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recurringItemId, action }),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        decision?: ServerCommitmentDecision;
      };
      if (!response.ok) {
        setNotice(`${payload.error ?? "The decision could not be synced."} It remains in this browser until you retry.`);
        return;
      }
      if (payload.decision) {
        setServerDecisions((current) => [
          payload.decision as ServerCommitmentDecision,
          ...current.filter((decision) => decision.recurringItemId !== recurringItemId),
        ]);
      }
    } catch {
      setNotice("The decision is saved in this browser, but the server copy could not be updated yet.");
    }
  }

  async function runConnectorSyncNow(connector: Connector) {
    const account = getActiveServerAccount(serverConnectors, connector.id);
    if (!account) {
      setNotice(`Connect ${connector.name} before running sync.`);
      return;
    }

    setSyncingConnectorId(connector.id);
    try {
      const response = await fetch(`/api/workspaces/current/connectors/${account.id}/sync`, { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { status?: string; error?: string; message?: string; result?: { status?: string; evidenceWritten?: number; error?: string } };
      await refreshWorkspaceConnectors();
      if (!response.ok || payload.status !== "synced" || payload.result?.status === "skipped") {
        setNotice(payload.result?.error ?? payload.message ?? payload.error ?? `${connector.name} sync failed.`);
        return;
      }
      setNotice(`${connector.name} sync finished. Evidence written: ${payload.result?.evidenceWritten ?? 0}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${connector.name} sync failed.`);
    } finally {
      setSyncingConnectorId(null);
    }
  }

  return (
    <main id="ledger-main" className="relative px-4 pb-24 pt-3 text-foreground sm:px-6 sm:pb-12 sm:pt-4 lg:px-8">
      <h1 className="sr-only">Vognary recurring money workspace</h1>
      <GlobalNotice
        notice={notice}
        onDismiss={() => setNotice(null)}
        action={undoAvailable ? { label: "Undo", onClick: undoLastDestructiveAction } : undefined}
      />
      {confirmState ? (
        <ConfirmDialog
          request={confirmState}
          onCancel={() => setConfirmState(null)}
          onConfirm={() => {
            confirmState.onConfirm();
            setConfirmState(null);
          }}
        />
      ) : null}
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        {/* Command header — live money tape + sticky section index */}
        <div className="sticky top-3 z-30 flex flex-col gap-2">
          <div className="dossier glass tape flex items-center gap-x-3 px-3 py-2.5 sm:gap-x-5 sm:px-5 sm:py-3">
            <a href="#ledger-main" className="flex items-center gap-2.5 rounded-lg transition hover:opacity-90" aria-label="Vognary — back to top">
              <VognaryMark size={32} className="text-(--dossier-ink)" animated />
              <div className="leading-tight">
                <p className="font-display text-lg font-semibold tracking-[-0.02em] text-(--dossier-ink)">Vognary</p>
                <p className="hidden eyebrow muted-on-dark sm:block" style={{ fontSize: "0.58rem" }}>Recurring payments, reviewed</p>
              </div>
            </a>
            <div className="hidden h-8 w-px bg-(--dossier-line) lg:block" />
            <div className="hidden flex-1 flex-wrap items-center gap-x-6 gap-y-2 lg:flex">
              <TickerStat label={`Monthly · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.monthlyRecurringSpend, audit.summary.primaryCurrency)} tone="ember" />
              <TickerStat label={`Yearly · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.annualRecurringSpend, audit.summary.primaryCurrency)} tone="paper" />
              <TickerStat label={`Review · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.reviewableMonthlySpend, audit.summary.primaryCurrency)} tone="ochre" />
              <TickerStat label="Renewals in 10d" value={`${audit.summary.renewalsNextTenDays}`} tone="paper" />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {sampleDataPresent ? <span className="pill pill-partial whitespace-nowrap">Sample data</span> : null}
              <span className="live-dot" aria-hidden />
              <span className="hidden eyebrow muted-on-dark sm:inline" style={{ fontSize: "0.58rem" }}>{serverSession?.authenticated ? "Synced workspace" : "On this device"}</span>
              <a href="/profile" className="btn btn-ondark h-9 px-3 text-xs">Profile</a>
            </div>
          </div>
          <WorkspaceNav activeId={workspaceNavSection} onSelect={setMobileSection} />
        </div>

        {/* 00 · Overview — the five-second answer */}
        <section id="overview" aria-labelledby="overview-heading" className={`${mobileSection === "overview" ? "flex" : "hidden sm:flex"} scroll-mt-36 flex-col gap-5`}>
          <StageHeader id="overview-heading" folio="00" title="Overview" note="Monthly burn, what renews next, and the one action to take first." />
          <OverviewPanel
            audit={audit}
            timeline={renewalTimeline}
            savings={verifiedSavings}
            proofGraph={proofGraph}
            priorityItems={priorityItems}
            userActions={userActions}
            hasRealData={hasRealData}
            onSelect={(key) => selectAndReviewItem(key)}
            onLoadDemo={loadDemoWorkspace}
            onExportPack={exportReport}
            onExportCsv={exportCsv}
            onExportPdf={exportPdf}
          />
        </section>

        {/* 01 · Connect evidence */}
        <section id="connect" aria-labelledby="connect-heading" className={`${mobileSection === "connect" ? "flex" : "hidden sm:flex"} scroll-mt-36 flex-col gap-5`}>
          <StageHeader id="connect-heading" folio="01" title="Connect evidence" note="Bring receipts, statements, and provider sources into one workspace." />
          <IntegrationCommandCenter
            audit={audit}
            connectorStartResults={connectorStartResults}
            connectingConnectorId={connectingConnectorId}
            syncingConnectorId={syncingConnectorId}
            connectedConnectorIds={connectedConnectorIds}
            selectedConnectorId={selectedConnectorId}
            serverSession={serverSession}
            serverConnectors={serverConnectors}
            apiKeyDraft={connectorApiKeyDraft}
            accountDraft={connectorAccountDraft}
            onSelectedConnector={setSelectedConnectorId}
            onApiKeyDraftChange={setConnectorApiKeyDraft}
            onAccountDraftChange={setConnectorAccountDraft}
            onStartConnector={startConnector}
            onDisconnectConnector={disconnectConnector}
            onRunConnectorSync={runConnectorSyncNow}
            onJumpToLedger={() => selectAndReviewItem()}
            onExportReport={exportReport}
            onClearWorkspace={requestClearWorkspace}
          />
          <FirstSuccessPanel
            audit={audit}
            coverageScore={coverageScore}
            experienceMode={experienceMode}
            hasRealData={hasRealData}
            localSaveEnabled={localSaveEnabled}
            receiptText={receiptText}
            signedIn={Boolean(serverSession?.authenticated)}
            onExportReport={exportReport}
            onImportFiles={importStatementFiles}
            onJumpToLedger={() => selectAndReviewItem()}
            onLoadDemoWorkspace={loadDemoWorkspace}
            onReceiptTextChange={setReceiptText}
            onSaveLocal={enableLocalSave}
          />
          <GuidedCapturePanel
            onAdd={(items) => {
              setManualItems((current) => [...current, ...items]);
              setNotice(`Added ${items.length} user-confirmed item(s) from the guided capture. They now appear in the ledger and renewal calendar.`);
            }}
          />
        </section>

        {/* 02 · Recurring ledger */}
        <section id="ledger" aria-labelledby="ledger-heading" className={`${mobileSection === "ledger" ? "flex" : "hidden sm:flex"} scroll-mt-36 flex-col gap-5`}>
          <StageHeader id="ledger-heading" folio="02" title="Recurring ledger" note="Every detected item with proof, cadence, and a decision." />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-reveal>
            <Metric label={`Monthly recurring · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.monthlyRecurringSpend, audit.summary.primaryCurrency)} tone="ink" />
            <Metric label={`Yearly total · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.annualRecurringSpend, audit.summary.primaryCurrency)} tone="blue" />
            <Metric label={`Needs review · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.reviewableMonthlySpend, audit.summary.primaryCurrency)} tone="caution" />
            <Metric label="Renewing in 10 days" value={`${audit.summary.renewalsNextTenDays}`} tone="accent" />
          </div>
          <RenewalTimelinePanel timeline={renewalTimeline} onSelect={setSelectedItemId} />
          <div className="grid gap-5 xl:grid-cols-[1.12fr_0.88fr]" data-reveal>
            <RecurringGraph
              audit={audit}
              hasRealData={hasRealData}
              selectedItem={selectedItem}
              userActions={userActions}
              onSelect={setSelectedItemId}
            />
            <div className="flex flex-col gap-5">
              <SpendSpectrum audit={audit} userActions={userActions} onSelect={setSelectedItemId} />
              <PriorityActionPanel priorityItems={priorityItems} userActions={userActions} onSelect={setSelectedItemId} />
            </div>
          </div>
          {duplicateCandidates.length ? (
            <DuplicateCandidatesPanel candidates={duplicateCandidates} onDecide={decideDuplicate} />
          ) : null}
          {Object.keys(mergeDecisions).length ? (
            <ResolvedDuplicateDecisionsPanel
              decisions={mergeDecisions}
              items={baseAudit.recurringItems}
              onUndo={undoDuplicateDecision}
            />
          ) : null}
          {selectedItem ? (
            <SelectedItemPanel
              item={selectedItem}
              action={userActions[selectedItem.identityKey] ?? selectedItem.recommendationType}
              onAction={(action) => recordAction(selectedItem.identityKey, action)}
            />
          ) : null}
        </section>

        {/* 03 · Monthly review */}
        <section id="review" aria-labelledby="review-heading" className={`${mobileSection === "review" ? "flex" : "hidden sm:flex"} scroll-mt-36 flex-col gap-5`}>
          <StageHeader id="review-heading" folio="03" title="Monthly review" note="Assign owners, capture notes, and close the review." />
          {reviewDiff ? <SinceLastReviewPanel diff={reviewDiff} onSelectMerchant={() => selectAndReviewItem()} /> : null}
          <VerifiedSavingsPanel savings={verifiedSavings} onSelect={setSelectedItemId} />
          <TeamReviewPanel
            audit={audit}
            teamMembers={teamMembers}
            memberDraft={memberDraft}
            itemOwners={itemOwners}
            reviewNotes={reviewNotes}
            reviewCompletedAt={reviewCompletedAt}
            onMemberDraft={setMemberDraft}
            onAddTeamMember={addTeamMember}
            onRemoveTeamMember={removeTeamMember}
            onItemOwner={(itemId, ownerId) => setItemOwners((current) => ({ ...current, [itemId]: ownerId }))}
            onReviewNote={(itemId, note) => setReviewNotes((current) => ({ ...current, [itemId]: note }))}
            onCompleteReview={markMonthlyReviewComplete}
          />
        </section>

        {/* 04 · Data & readiness */}
        <section id="data" aria-labelledby="data-heading" className={`${mobileSection === "data" ? "flex" : "hidden sm:flex"} scroll-mt-36 flex-col gap-5`}>
          <StageHeader id="data-heading" folio="04" title="Data & readiness" note="Control where data lives and what is already live." />
          <ProofGraphPanel graph={proofGraph} />
          <ReadinessPanel />
          <UserControlPanel
            coverageScore={coverageScore}
            coverageSignals={coverageSignals}
            localSaveEnabled={localSaveEnabled}
            serverSession={serverSession}
            serverSaveStatus={serverSaveStatus}
            onEnableLocalSave={enableLocalSave}
            onDisableLocalSave={requestDisableLocalSave}
            onSaveServerWorkspace={saveServerWorkspace}
            onLoadServerWorkspace={loadServerWorkspace}
            onDeleteServerWorkspace={requestDeleteServerWorkspace}
          />
        </section>
        <footer className="panel flex flex-col items-center gap-3 px-5 py-5 text-center" data-reveal>
          <div className="flex items-center gap-2.5">
            <VognaryMark size={22} className="text-(--ink)" />
            <span className="font-display text-base font-semibold text-(--ink)">Vognary <span className="font-normal text-(--muted)">· Recurring payments, reviewed</span></span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-data text-[0.66rem] uppercase tracking-[0.16em] text-(--muted)">
            <a className="transition hover:text-(--ink)" href="/privacy">Privacy</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/security">Security</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/sources">Sources</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/partners">Partners</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/terms">Terms</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/beta-readiness">Capability status</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/profile">Profile</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/login">Sign in</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/private-audit">Assisted audit</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/brand">Brand</a>
          </div>
        </footer>
      </div>
    </main>
  );
}

// Scroll-spy: reports which workspace chapter is currently in the reading band.
function useActiveSection(ids: readonly string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

// Sticky section index — the workspace table of contents with active-chapter state.
function WorkspaceNav({ activeId, onSelect }: { activeId: string; onSelect: (id: WorkspaceSectionId) => void }) {
  return (
    <nav aria-label="Workspace sections" className="glass fixed bottom-2 left-4 right-4 z-40 grid grid-cols-5 items-center gap-1 rounded-2xl border border-line px-1.5 py-1.5 sm:static sm:flex sm:overflow-x-auto">
      {workspaceSections.map((section) => {
        const active = activeId === section.id;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={(event) => {
              event.preventDefault();
              onSelect(section.id);
              const url = new URL(window.location.href);
              url.hash = section.id;
              window.history.replaceState(null, "", url);
              window.setTimeout(() => document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
            }}
            aria-current={active ? "true" : undefined}
            className={`flex min-w-0 shrink-0 items-center justify-center gap-2 rounded-xl px-1 py-2 text-[0.68rem] font-medium transition sm:justify-start sm:px-3 sm:py-1.5 sm:text-sm ${active ? "bg-(--gold) text-[#17130a]" : "text-(--ink-soft) hover:bg-white/5 hover:text-(--ink)"}`}
          >
            <span className={`hidden font-data text-[0.6rem] tnum sm:inline ${active ? "opacity-70" : "text-(--muted)"}`}>{section.folio}</span>
            <span className="truncate">{section.label}</span>
          </a>
        );
      })}
      <a href="#ledger-main" className="ml-auto hidden shrink-0 items-center rounded-xl px-3 py-1.5 font-data text-[0.6rem] uppercase tracking-[0.14em] text-(--muted) transition hover:text-(--ink) sm:inline-flex" aria-label="Back to top of workspace">Top</a>
    </nav>
  );
}

// Chapter divider — the folio marker + intent that opens each workspace section.
function StageHeader({ id, folio, title, note }: { id: string; folio: string; title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4" data-reveal>
      <h2 id={id} className="folio shrink-0" data-folio={folio}>{title}</h2>
      <span className="hidden h-px flex-1 bg-line sm:block" aria-hidden />
      {note ? <p className="text-xs leading-5 text-(--muted) sm:max-w-sm sm:text-right">{note}</p> : null}
    </div>
  );
}

function IntegrationCommandCenter({
  audit,
  connectorStartResults,
  connectingConnectorId,
  syncingConnectorId,
  connectedConnectorIds,
  selectedConnectorId,
  serverSession,
  serverConnectors,
  apiKeyDraft,
  accountDraft,
  onSelectedConnector,
  onApiKeyDraftChange,
  onAccountDraftChange,
  onStartConnector,
  onDisconnectConnector,
  onRunConnectorSync,
  onJumpToLedger,
  onExportReport,
  onClearWorkspace,
}: {
  audit: AuditResult;
  connectorStartResults: Record<string, ConnectorStartPayload>;
  connectingConnectorId: string | null;
  syncingConnectorId: string | null;
  connectedConnectorIds: Set<string>;
  selectedConnectorId: string;
  serverSession: ServerSessionPayload | null;
  serverConnectors: WorkspaceConnectorStatusPayload | null;
  apiKeyDraft: string;
  accountDraft: string;
  onSelectedConnector: (connectorId: string) => void;
  onApiKeyDraftChange: (value: string) => void;
  onAccountDraftChange: (value: string) => void;
  onStartConnector: (connector: Connector) => void;
  onDisconnectConnector: (connector: Connector) => void;
  onRunConnectorSync: (connector: Connector) => void;
  onJumpToLedger: () => void;
  onExportReport: () => void;
  onClearWorkspace: () => void;
}) {
  const integrationConnectors = getIntegrationConnectors();
  const selectedConnector = integrationConnectors.find((connector) => connector.id === selectedConnectorId) ?? integrationConnectors[0];
  const result = connectorStartResults[selectedConnector.id];
  const connected = connectedConnectorIds.has(selectedConnector.id);
  const busy = connectingConnectorId === selectedConnector.id;
  const missing = result?.missingEnv ?? result?.requiredEnv ?? [];
  const serverAccount = getServerAccount(serverConnectors, selectedConnector.id);
  const needsReauth = serverAccount?.status === "needs_reauth";
  const statusLabel = connected ? "Connected" : needsReauth ? "Reconnect required" : connectorStatusLabels[selectedConnector.status];
  const statusClass = connected ? "pill pill-ready" : needsReauth ? "pill pill-blocked" : connectorStatusClass[selectedConnector.status];
  const signedIn = Boolean(serverSession?.authenticated && serverSession.session?.workspaceId);
  const hasApiKeyDraft = Boolean(apiKeyDraft.trim());
  const showApiKeyControl = selectedConnector.authType === "api-key";
  const syncing = syncingConnectorId === selectedConnector.id;
  const syncNeedsAttention = !needsReauth && (
    serverAccount?.freshnessStatus === "stale"
    || serverAccount?.freshnessStatus === "error"
    || serverAccount?.latestRunStatus === "failed"
    || serverAccount?.latestRunStatus === "blocked"
  );

  return (
    <section className="dossier spotlight scan p-5 sm:p-6" data-reveal onMouseMove={trackSpotlightPointer}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="folio" data-folio="1.1" style={{ color: "var(--dossier-muted)" }}>Connections</span>
          <h3 className="mt-3 font-display text-3xl font-semibold leading-tight text-(--dossier-ink) sm:text-4xl">Connect proof. Reveal renewals.</h3>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DossierStat label="Items" value={`${audit.summary.recurringCount}`} />
          <DossierStat label={`Monthly · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.monthlyRecurringSpend, audit.summary.primaryCurrency)} />
          <DossierStat label={`Yearly · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.annualRecurringSpend, audit.summary.primaryCurrency)} />
          <DossierStat label={`Review · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.reviewableMonthlySpend, audit.summary.primaryCurrency)} />
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <label className="block">
          <span className="eyebrow muted-on-dark" style={{ fontSize: "0.62rem" }}>Platform</span>
          <select value={selectedConnector.id} onChange={(event) => { onSelectedConnector(event.target.value); onApiKeyDraftChange(""); onAccountDraftChange(""); }} className="mt-2 h-13 w-full rounded-[10px] border px-4 text-base font-semibold outline-none" style={{ background: "rgba(243,234,214,0.06)", borderColor: "var(--dossier-line)", color: "var(--dossier-ink)" }}>
            {integrationConnectors.map((connector) => <option key={connector.id} value={connector.id}>{connector.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => connected ? onDisconnectConnector(selectedConnector) : onStartConnector(selectedConnector)} className={`${connected ? "btn btn-ondark" : "btn btn-primary"} h-13 self-end px-6 disabled:cursor-not-allowed disabled:opacity-60`}>
          {busy ? "Connecting..." : connected ? "Disconnect" : needsReauth ? "Reconnect" : showApiKeyControl && hasApiKeyDraft ? "Store & sync" : "Connect"}
        </button>
      </div>

      {showApiKeyControl ? (
        <div className="mt-3 rounded-[11px] border p-3" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
          <label className="block">
            <span className="eyebrow muted-on-dark" style={{ fontSize: "0.62rem" }}>{getConnectorAccountLabel(selectedConnector.id)}</span>
            <input
              value={accountDraft}
              onChange={(event) => onAccountDraftChange(event.target.value)}
              type="text"
              disabled={!signedIn || busy}
              placeholder={getConnectorAccountPlaceholder(selectedConnector.id)}
              className="mt-2 h-11 w-full rounded-[10px] border px-3 font-data text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "rgba(10,12,16,0.28)", borderColor: "var(--dossier-line)", color: "var(--dossier-ink)" }}
            />
          </label>
          <label className="block">
            <span className="eyebrow muted-on-dark" style={{ fontSize: "0.62rem" }}>Encrypted API key</span>
            <input
              value={apiKeyDraft}
              onChange={(event) => onApiKeyDraftChange(event.target.value)}
              type="password"
              disabled={!signedIn || busy}
              placeholder={signedIn ? "Paste read/admin key" : "Sign in to store a key"}
              className="mt-2 h-11 w-full rounded-[10px] border px-3 font-data text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "rgba(10,12,16,0.28)", borderColor: "var(--dossier-line)", color: "var(--dossier-ink)" }}
            />
          </label>
          <p className="mt-2 text-xs leading-5 muted-on-dark">
            {signedIn ? "Stored through the token vault, then queued for scheduled sync." : "API-key connectors require a signed-in configured workspace."}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 rounded-[11px] border p-3 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={statusClass}>{statusLabel}</span>
            <span className="font-data text-xs muted-on-dark">{selectedConnector.category} · {selectedConnector.authType}</span>
          </div>
          {missing.length ? <p className="mt-2 text-xs leading-5 text-ochre">Needs setup: {missing.join(", ")}</p> : null}
          {result?.redirectUri ? <p className="mt-2 break-all font-data text-[0.68rem] muted-on-dark">Redirect URI: {result.redirectUri}</p> : null}
          {serverAccount ? (
            <div className="mt-2 grid gap-1 font-data text-[0.68rem] leading-5 muted-on-dark sm:grid-cols-2">
              <p>Source: <span className="text-(--dossier-ink)">{serverAccount.displayName}</span> · {serverAccount.evidenceCount} evidence record(s)</p>
              <p>Freshness: <span className="text-(--dossier-ink)">{serverAccount.freshnessStatus ?? "unknown"}</span> · Coverage {serverAccount.coverageCompleteness ?? "unknown"}</p>
              <p>Last synced: <span className="text-(--dossier-ink)">{formatSyncTime(serverAccount.lastSyncedAt)}</span></p>
              <p>Next automatic sync: <span className="text-(--dossier-ink)">{formatSyncTime(serverAccount.nextSyncAt)}</span></p>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {serverAccount && !connected ? <button type="button" disabled={busy} onClick={() => onDisconnectConnector(selectedConnector)} className="btn btn-ondark h-9 px-3 text-xs disabled:opacity-60">Disconnect source</button> : null}
          {syncNeedsAttention ? <button type="button" disabled={syncing} onClick={() => onRunConnectorSync(selectedConnector)} className="btn btn-ondark h-9 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60">{syncing ? "Retrying" : "Retry sync"}</button> : null}
          <button type="button" onClick={onJumpToLedger} className="btn btn-ondark h-9 px-3 text-xs">Open ledger</button>
          <button type="button" onClick={onExportReport} className="btn btn-ondark h-9 px-3 text-xs">Download report</button>
          <button type="button" onClick={onClearWorkspace} className="btn btn-ondark h-9 px-3 text-xs">Clear</button>
        </div>
      </div>
    </section>
  );
}

function FirstSuccessPanel({
  audit,
  coverageScore,
  experienceMode,
  hasRealData,
  localSaveEnabled,
  receiptText,
  signedIn,
  onExportReport,
  onImportFiles,
  onJumpToLedger,
  onLoadDemoWorkspace,
  onReceiptTextChange,
  onSaveLocal,
}: {
  audit: AuditResult;
  coverageScore: number;
  experienceMode: ExperienceMode;
  hasRealData: boolean;
  localSaveEnabled: boolean;
  receiptText: string;
  signedIn: boolean;
  onExportReport: () => void;
  onImportFiles: (files: File[]) => void;
  onJumpToLedger: () => void;
  onLoadDemoWorkspace: () => void;
  onReceiptTextChange: (value: string) => void;
  onSaveLocal: () => void;
}) {
  const hasLedger = audit.summary.recurringCount > 0;
  const saved = localSaveEnabled || signedIn;
  const steps = [
    { label: "Add evidence", done: hasRealData, detail: "Sample, receipt snippets, CSV/PDF statement, or manual source." },
    { label: "Review ledger", done: hasLedger, detail: "Check amount, cadence, next debit, confidence, and proof." },
    { label: "Fill gaps", done: coverageScore >= 70, detail: "Add missing Gmail, UPI, card, app-store, SaaS, cloud, EMI, SIP, insurance, or utility sources." },
    { label: "Keep control", done: saved, detail: "Export, browser-save, or sign in for automatic encrypted workspace sync." },
  ];
  const modeCopy = experienceMode === "demo"
    ? "You are viewing a complete sample workspace. Replace it with your own evidence whenever ready."
    : experienceMode === "guest"
      ? "Browser-only mode is active. Nothing is stored on the server unless you sign in; signed-in workspaces synchronize encrypted state automatically."
      : "Signed-in workspace. Use this guide to complete the first review and improve coverage.";

  return (
    <section id="first-success" className="panel p-5 sm:p-6" data-reveal>
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div>
          <span className="folio" data-folio="1.2">First successful audit</span>
          <h3 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Reach the useful ledger before login friction.</h3>
          <p className="mt-2 text-sm leading-6 text-(--muted)">{modeCopy}</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-4">
            {steps.map((step, index) => (
              <div key={step.label} className="inset p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-xl font-semibold text-ember">{index + 1}</span>
                  <span className={step.done ? "pill pill-ready" : "pill pill-planned"}>{step.done ? "Done" : "Next"}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-(--ink)">{step.label}</p>
                <p className="mt-1 text-xs leading-5 text-(--muted)">{step.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-(--card-2) p-4">
          <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-verdict">Start in one click</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={onLoadDemoWorkspace} className="btn btn-primary">Load sample workspace</button>
            <label className="btn btn-ghost cursor-pointer text-center">
              Import statement
              <input
                type="file"
                accept=".csv,.txt,.xls,.xlsx,.pdf,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
                multiple
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  onImportFiles(files);
                }}
              />
            </label>
            <button type="button" onClick={onJumpToLedger} className="btn btn-ghost" disabled={!hasLedger}>Open ledger</button>
            <button type="button" onClick={onExportReport} className="btn btn-ghost" disabled={!hasRealData}>Download report</button>
            <button type="button" onClick={onSaveLocal} className="btn btn-ghost" disabled={!hasRealData || localSaveEnabled}>{localSaveEnabled ? "Saved on device" : "Save on this device"}</button>
            <a href="/login" className="btn btn-ghost">Sign in to sync</a>
          </div>
          <details className="mt-4 rounded-[11px] border border-line bg-card p-3" open={!hasRealData}>
            <summary className="cursor-pointer select-none font-display text-sm font-semibold text-(--ink)">Paste receipt snippets</summary>
            <label className="mt-3 block">
              <span className="field-label">Receipt, invoice, renewal, or payment-success text</span>
              <textarea
                value={receiptText}
                onChange={(event) => onReceiptTextChange(event.target.value)}
                className="field min-h-28"
                placeholder="Paste one or more receipt snippets. Keep merchant, amount, date, and renewal text visible; remove account numbers and private identifiers."
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-(--muted)">Pasted receipts become ledger candidates immediately and merge with matching statement evidence. For Google-approved users, configured Gmail OAuth backfills and refreshes receipt evidence on its declared schedule.</p>
          </details>
        </div>
      </div>
    </section>
  );
}

function getIntegrationConnectors() {
  const selected = new Set(integrationConnectorIds);
  return connectors.filter((connector) => selected.has(connector.id));
}

function openOfficialConnectorTarget(connectorId: string) {
  const target = connectorLaunchTargets[connectorId];
  if (!target) return;
  window.open(target.url, "_blank", "noopener,noreferrer");
}

async function fetchWorkspaceConnectors(): Promise<WorkspaceConnectorStatusPayload> {
  try {
    const response = await fetch("/api/workspaces/current/connectors", { cache: "no-store" });
    return await response.json() as WorkspaceConnectorStatusPayload;
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Could not load workspace connectors." };
  }
}

async function fetchWorkspaceDecisions(): Promise<WorkspaceDecisionsPayload> {
  try {
    const response = await fetch("/api/workspaces/current/decisions", { cache: "no-store" });
    return await response.json() as WorkspaceDecisionsPayload;
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : "Could not load workspace decisions." };
  }
}

async function trackProductEvent(
  eventName: ProductEventName,
  metrics: Partial<Record<ProductEventMetricName, number>> = {},
) {
  try {
    await fetch("/api/product-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventName, metrics }),
      keepalive: true,
    });
  } catch {
    // Consent-gated product telemetry is deliberately non-blocking.
  }
}

function getActiveServerAccount(payload: WorkspaceConnectorStatusPayload | null, connectorId: string) {
  return payload?.accounts?.find((account) => account.connectorId === connectorId && account.status === "active") ?? null;
}

function getServerAccount(payload: WorkspaceConnectorStatusPayload | null, connectorId: string) {
  return payload?.accounts?.find((account) => account.connectorId === connectorId && account.status !== "revoked") ?? null;
}

function getConnectorAccountLabel(connectorId: string) {
  if (connectorId === "github-copilot") return "GitHub organization slug";
  if (connectorId === "vercel-platform") return "Vercel team slug";
  if (connectorId === "render-platform") return "Render owner ID";
  return "Account identifier";
}

function getConnectorAccountPlaceholder(connectorId: string) {
  if (connectorId === "github-copilot") return "Required, for example your-org";
  if (connectorId === "vercel-platform") return "Optional team slug";
  if (connectorId === "render-platform") return "Optional owner/workspace ID";
  if (connectorId === "cloudflare-billing") return "Optional label";
  return "Optional account id";
}

function serverRecurringItemToManualInput(item: ServerRecurringItem): ManualRecurringInput {
  return {
    id: `synced-${item.id}`,
    canonicalRecurringItemId: item.id,
    merchant: item.merchant,
    amount: item.averageAmount,
    currency: item.currency,
    frequency: normalizeEvidenceFrequency(item.frequency),
    nextExpectedDate: item.nextExpectedDate ?? item.lastChargeDate ?? item.updatedAt.slice(0, 10),
    category: item.category,
    sourceName: item.connectorIds.length
      ? `Automatically synced: ${item.connectorIds.join(", ")}`
      : "Automatically synced source",
  };
}

function connectorEvidenceToStatementSources(evidence: ServerConnectorEvidence[]): StatementFile[] {
  const grouped = new Map<string, ServerConnectorEvidence[]>();

  for (const item of evidence) {
    if (!item.merchantRaw || typeof item.amount !== "number" || !Number.isFinite(item.amount) || item.amount <= 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(item.observedAt)) continue;
    const sourceName = connectorEvidenceSourceName(item.connectorId, item.connectedAccountId);
    const current = grouped.get(sourceName) ?? [];
    current.push(item);
    grouped.set(sourceName, current);
  }

  return [...grouped.entries()].map(([sourceName, items]) => {
    const rows = items.map((item) => [
      item.observedAt.slice(0, 10),
      `${item.merchantRaw} ${(item.currency ?? "INR").toUpperCase()}`,
      String(item.amount),
      "",
    ].map(encodeCsvCell).join(","));

    return {
      id: `synced-source-${sourceName}`,
      name: sourceName,
      text: ["Date,Description,Debit,Credit", ...rows].join("\n"),
      rowCount: rows.length,
      kind: "csv" as const,
    };
  });
}

function normalizeEvidenceFrequency(value: string | null): Frequency {
  if (value === "weekly" || value === "biweekly" || value === "semimonthly" || value === "monthly" || value === "bimonthly" || value === "quarterly" || value === "yearly" || value === "irregular") return value;
  if (value === "usage-window") return "monthly";
  return "monthly";
}

function formatSyncTime(value: string | null) {
  if (!value) return "not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
};

function GlobalNotice({ notice, onDismiss, action }: { notice: string | null; onDismiss: () => void; action?: { label: string; onClick: () => void } }) {
  if (!notice) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 rounded-xl border border-line-strong bg-[#14161b]/95 p-3 shadow-2xl backdrop-blur sm:bottom-4 sm:left-auto sm:w-[min(30rem,calc(100vw-2rem))]" role="status" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow" style={{ fontSize: "0.56rem" }}>Action result</p>
          <p className="mt-1 text-sm leading-6 text-(--ink)">{notice}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {action ? (
            <button type="button" onClick={action.onClick} className="rounded-md border border-verdict px-2 py-1 text-xs font-semibold text-verdict transition hover:bg-(--verdict-tint)">
              {action.label}
            </button>
          ) : null}
          <button type="button" onClick={onDismiss} className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-(--muted) transition hover:border-ember hover:text-ember">
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// Destructive actions state their consequence and wait for an explicit choice.
function ConfirmDialog({ request, onCancel, onConfirm }: { request: ConfirmRequest; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="panel w-full max-w-md p-5">
        <h2 id="confirm-title" className="font-display text-xl font-semibold text-(--ink)">{request.title}</h2>
        <p className="mt-2 text-sm leading-6 text-(--muted)">{request.body}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus onClick={onCancel} className="btn btn-ghost">Cancel</button>
          <button type="button" onClick={onConfirm} className="btn btn-primary" style={{ background: "var(--ember)", borderColor: "var(--ember)" }}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Overview — the five-second answer. Every tile deep-links into its chapter.
function OverviewPanel({
  audit,
  timeline,
  savings,
  proofGraph,
  priorityItems,
  userActions,
  hasRealData,
  onSelect,
  onLoadDemo,
  onExportPack,
  onExportCsv,
  onExportPdf,
}: {
  audit: AuditResult;
  timeline: RenewalTimeline;
  savings: VerifiedSavingsSummary;
  proofGraph: ProofGraphSummary;
  priorityItems: RecurringItem[];
  userActions: Record<string, RecommendationType>;
  hasRealData: boolean;
  onSelect: (identityKey: string) => void;
  onLoadDemo: () => void;
  onExportPack: () => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
}) {
  const nextEvent = timeline.events[0] ?? null;
  const topAction = priorityItems[0] ?? null;
  const proofStrength = proofGraph.totalMonthly > 0 ? Math.round((1 - proofGraph.singleSourceShare) * 100) : 0;
  const foreignEntries = Object.entries(audit.summary.foreignMonthlyTotals);

  if (!audit.summary.recurringCount) {
    return (
      <section className="panel p-6 text-center sm:p-8" data-reveal>
        <p className="font-data text-xs text-(--muted)">{hasRealData ? "No recurring pattern proven yet" : "Nothing connected yet"}</p>
        <h3 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Your recurring money, answered in five seconds.</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-(--muted)">
          Load the sample to see a full working review, or connect your first evidence below — a statement export, pasted receipts, or the guided mandate capture.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onLoadDemo} className="btn btn-primary">Load sample workspace</button>
          <a href="#connect" className="btn btn-ghost">Connect evidence</a>
        </div>
      </section>
    );
  }

  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="inset p-4">
          <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Monthly burn</p>
          <p className="font-data mt-2 text-2xl font-semibold tnum text-(--ink)">{formatCurrency(audit.summary.monthlyRecurringSpend, audit.summary.primaryCurrency)}</p>
          <p className="mt-1 font-data text-[0.66rem] text-(--muted)">
            {formatCurrency(audit.summary.annualRecurringSpend, audit.summary.primaryCurrency)}/yr · {audit.summary.recurringCount} commitments
            {foreignEntries.map(([code, total]) => (
              <span key={code} className="ml-2 text-ochre">+ {formatCurrency(total, code)}/mo</span>
            ))}
          </p>
        </div>
        {nextEvent ? (
          <button type="button" onClick={() => onSelect(nextEvent.itemId)} className="inset p-4 text-left transition hover:border-ember">
            <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Renews next</p>
            <p className="mt-2 truncate font-display text-lg font-semibold text-(--ink)">{nextEvent.merchant}</p>
            <p className="mt-1 font-data text-[0.66rem] text-(--muted)">
              {formatCurrency(nextEvent.amount, nextEvent.currency)} · {nextEvent.daysAway === 0 ? "today" : `in ${nextEvent.daysAway}d`} ({nextEvent.date})
            </p>
          </button>
        ) : (
          <div className="inset p-4">
            <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Renews next</p>
            <p className="mt-2 text-sm leading-6 text-(--muted)">No projected renewal inside {timeline.horizonDays} days.</p>
          </div>
        )}
        <div className="inset p-4">
          <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Due in 30 days</p>
          <p className="font-data mt-2 text-2xl font-semibold tnum text-ochre">{formatCurrency(timeline.dueNext30Days)}</p>
          <p className="mt-1 font-data text-[0.66rem] text-(--muted)">Needs review ({audit.summary.primaryCurrency}): {formatCurrency(audit.summary.reviewableMonthlySpend, audit.summary.primaryCurrency)}/mo</p>
        </div>
        <div className="inset p-4">
          <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Verified savings</p>
          <p className={`font-data mt-2 text-2xl font-semibold tnum ${savings.verifiedAnnual > 0 ? "text-verdict" : "text-(--muted)"}`}>
            {formatCurrency(savings.verifiedAnnual)}/yr
          </p>
          <p className="mt-1 font-data text-[0.66rem] text-(--muted)">{savings.entries.length ? `${savings.entries.length} decision(s) tracked` : "Mark a cancel to start proving savings"}</p>
        </div>
        <div className="inset p-4">
          <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Proof strength</p>
          <p className="font-data mt-2 text-2xl font-semibold tnum text-(--ink)">{proofStrength}%</p>
          <p className="mt-1 font-data text-[0.66rem] text-(--muted)">of monthly spend is multi-source verified</p>
        </div>
        {topAction ? (
          <button type="button" onClick={() => onSelect(topAction.identityKey)} className="inset p-4 text-left transition hover:border-ember">
            <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Do this first</p>
            <p className="mt-2 truncate font-display text-lg font-semibold text-(--ink)">{topAction.merchant}</p>
            <p className="mt-1 flex items-center gap-2 font-data text-[0.66rem] text-(--muted)">
              <span className={statusStyles[userActions[topAction.identityKey] ?? topAction.recommendationType]}>{userActions[topAction.identityKey] ?? topAction.recommendationType}</span>
              {formatCurrency(topAction.monthlyCost, topAction.currency)}/mo
            </p>
          </button>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onExportPack} className="btn btn-ghost h-9 px-3 text-xs">Sealed pack (JSON)</button>
        <button type="button" onClick={onExportCsv} className="btn btn-ghost h-9 px-3 text-xs">Export CSV</button>
        <button type="button" onClick={() => { void onExportPdf(); }} className="btn btn-ghost h-9 px-3 text-xs">Export PDF</button>
        <a href="/private-audit" className="btn btn-primary h-9 px-3 text-xs">Request assisted audit</a>
        <p className="font-data text-[0.64rem] text-(--muted)">Every JSON export has an offline tamper checksum; /verify separately reports whether a trusted Vognary issuer signature is present.</p>
      </div>
    </section>
  );
}

function trackSpotlightPointer(event: React.MouseEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
  event.currentTarget.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
}

function UserControlPanel({
  coverageScore,
  coverageSignals,
  localSaveEnabled,
  serverSession,
  serverSaveStatus,
  onEnableLocalSave,
  onDisableLocalSave,
  onSaveServerWorkspace,
  onLoadServerWorkspace,
  onDeleteServerWorkspace,
}: {
  coverageScore: number;
  coverageSignals: CoverageSignal[];
  localSaveEnabled: boolean;
  serverSession: ServerSessionPayload | null;
  serverSaveStatus: string | null;
  onEnableLocalSave: () => void;
  onDisableLocalSave: () => void;
  onSaveServerWorkspace: () => void;
  onLoadServerWorkspace: () => void;
  onDeleteServerWorkspace: () => void;
}) {
  const signedInEmail = serverSession?.authenticated ? serverSession.session?.email : null;
  const missingSignals = coverageSignals.filter((signal) => !signal.done).slice(0, 4);

  return (
    <section className="grid gap-4 lg:grid-cols-[0.78fr_1.22fr]" data-reveal>
      <div className="panel p-5 sm:p-6">
        <p className="eyebrow">Source check</p>
        <div className="mt-3 flex items-end gap-3">
          <p className="font-display text-6xl font-semibold leading-none text-ember">{coverageScore}<span className="text-3xl">%</span></p>
          <p className="pb-2 text-sm text-(--muted)">evidence source types represented</p>
        </div>
        <p className="mt-2 text-xs leading-5 text-(--muted)">This is a source-presence heuristic, not a claim that all recurring payments have been found.</p>
        <div className="mt-4 grid gap-2">
          {coverageSignals.map((signal) => (
            <div key={signal.label} className="inset flex items-center justify-between px-3 py-2 text-sm">
              <span className="font-semibold text-(--ink)">{signal.label}</span>
              <span className={signal.done ? "pill pill-ready" : "pill pill-planned"}>{signal.done ? "Added" : "Check"}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-[11px] border border-line bg-(--card-2) p-3">
          <p className="font-data text-[0.68rem] text-(--muted)">Next best sources</p>
          {missingSignals.length ? (
            <ul className="mt-2 grid gap-2 text-xs leading-5 text-(--muted)">
              {missingSignals.map((signal) => <li key={signal.label}>- {getCoverageAction(signal.label)}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-xs leading-5 text-verdict">Core evidence rails are represented. Use direct connectors next to refresh this automatically.</p>
          )}
        </div>
      </div>

      <div className="panel p-5 sm:p-6">
        <SectionHead folio="4.2" kicker="Your data" title="Control where your data is saved" desc="Signed-in workspaces synchronize encrypted review state automatically with revision checks. Browser save remains an optional device-local fallback." />
        <div className="mt-4 flex flex-wrap gap-2">
          {localSaveEnabled ? (
            <button type="button" onClick={onDisableLocalSave} className="btn btn-ghost" style={{ borderColor: "var(--ember)", color: "var(--ember)" }}>
              Delete browser save
            </button>
          ) : (
            <button type="button" onClick={onEnableLocalSave} className="btn btn-primary">
              Save on this device
            </button>
          )}
          <a href="/sources" className="btn btn-ghost">Manage sources</a>
        </div>
        <div className="mt-4 rounded-[11px] border border-line bg-(--card-2) p-3">
          <p className="font-data text-[0.68rem] text-(--muted)">Configured account</p>
          <p className="mt-2 text-sm leading-6 text-(--muted)">
            {signedInEmail ? <>Signed in as <strong className="text-(--ink)">{signedInEmail}</strong>. Changes synchronize after a short pause.</> : <>Not signed in. Use login to synchronize encrypted workspace state across devices.</>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {signedInEmail ? (
              <>
                <button type="button" onClick={onSaveServerWorkspace} className="btn btn-primary">Sync now</button>
                <button type="button" onClick={onLoadServerWorkspace} className="btn btn-ghost">Reload server state</button>
                <button type="button" onClick={onDeleteServerWorkspace} className="btn btn-ghost" style={{ borderColor: "var(--ember)", color: "var(--ember)" }}>Pause &amp; delete server state</button>
              </>
            ) : (
              <a href="/login" className="btn btn-primary">Sign in</a>
            )}
          </div>
          {serverSaveStatus ? <p className="mt-3 text-xs leading-5 text-(--muted)">{serverSaveStatus}</p> : null}
        </div>
        <p className="mt-3 text-xs leading-5 text-(--muted)">Do not enable browser save on shared machines. Local backups contain source text. Automatic server sync requires configured login, database, and TOKEN_ENCRYPTION_KEY; revision conflicts pause uploads instead of overwriting another device.</p>
      </div>
    </section>
  );
}

function RecurringGraph({
  audit,
  hasRealData,
  selectedItem,
  userActions,
  onSelect,
}: {
  audit: AuditResult;
  hasRealData: boolean;
  selectedItem: RecurringItem | null;
  userActions: Record<string, RecommendationType>;
  onSelect: (id: string) => void;
}) {
  return (
    <section id="recurring-ledger" className="panel scroll-mt-36 overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-line px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="folio" data-folio="2.1">Results</span>
          <h3 className="mt-2 font-display text-xl font-semibold text-(--ink)">Recurring payments found</h3>
          <p className="mt-1 text-sm text-(--muted)">{audit.summary.recurringCount} recurring items from {audit.summary.transactionCount} debit transactions.</p>
        </div>
        <p className="font-data text-xs text-(--muted)">Avg confidence {Math.round(audit.summary.averageConfidence)}%</p>
      </div>

      {audit.recurringItems.length ? (
        <div className="overflow-x-auto" tabIndex={0} aria-label="Recurring payment ledger table">
          <table className="w-full min-w-184 border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr>
                <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Merchant</th>
                <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.68rem] font-semibold text-(--muted)">How often</th>
                <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Monthly</th>
                <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Next debit</th>
                <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.68rem] font-semibold text-(--muted)">Suggested action</th>
              </tr>
            </thead>
            <tbody>
              {audit.recurringItems.map((item) => {
                const action = userActions[item.identityKey] ?? item.recommendationType;
                return (
                  <tr key={item.identityKey} onClick={() => onSelect(item.identityKey)} data-active={selectedItem?.identityKey === item.identityKey} className="ledger-row cursor-pointer">
                    <td className="border-b border-line px-5 py-3.5">
                      <p className="font-semibold text-(--ink)">{item.merchant}</p>
                      <p className="mt-0.5 font-data text-[11px] text-(--muted)">{item.category} · {item.confidenceScore}% confidence</p>
                    </td>
                    <td className="border-b border-line px-5 py-3.5 capitalize text-(--ink-soft)">{item.frequency}</td>
                    <td className="border-b border-line px-5 py-3.5 font-data font-semibold tnum text-(--ink)">{formatCurrency(item.monthlyCost, item.currency)}</td>
                    <td className="border-b border-line px-5 py-3.5 font-data text-xs text-(--muted)">{item.nextExpectedDate}</td>
                    <td className="border-b border-line px-5 py-3.5"><span className={statusStyles[action]}>{action}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 py-14 text-center">
          <p className="font-data text-xs text-(--muted)">{hasRealData ? "No pattern yet" : "No proof connected yet"}</p>
          <h3 className="mt-3 font-display text-2xl font-semibold text-(--ink)">{hasRealData ? "No repeated payments found yet" : "Connect a source to reveal renewals"}</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-(--muted)">
            {hasRealData ? "Connect more official sources or wait for provider/partner access to deepen coverage." : "Start with Gmail receipts. If UPI, card, app-store, bank, SaaS, or cloud evidence is missing, Vognary keeps that gap visible instead of guessing."}
          </p>
        </div>
      )}
    </section>
  );
}

// Renewal calendar — projects every proven cadence into the next debits, so the
// workspace answers "what renews next and what will it cost" before anything else.
function RenewalTimelinePanel({ timeline, onSelect }: { timeline: RenewalTimeline; onSelect: (id: string) => void }) {
  const visibleEvents = 12;

  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <SectionHead
        folio="2.2"
        kicker="Calendar"
        title="What renews next"
        desc={`Projected debits over the next ${timeline.horizonDays} days, from proven cadence and next-debit predictions.`}
        right={timeline.events.length ? <span className="font-data text-xs tnum text-(--muted)">{timeline.events.length} debits · {formatCurrency(timeline.totalDue)}</span> : null}
      />

      {timeline.events.length ? (
        <>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
            <MiniStat label="Due in 7 days" value={formatCurrency(timeline.dueNext7Days)} />
            <MiniStat label="Due in 30 days" value={formatCurrency(timeline.dueNext30Days)} />
            <MiniStat label={`Total in ${timeline.horizonDays} days`} value={formatCurrency(timeline.totalDue)} />
          </div>
          {Object.keys(timeline.foreignTotals).length ? (
            <p className="mt-2 font-data text-[0.66rem] text-(--muted)">
              Foreign renewals, kept separate: {Object.entries(timeline.foreignTotals).map(([currency, total]) => `${formatCurrency(total, currency)}`).join(" · ")}
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
            {timeline.buckets.map((bucket) => (
              <div key={bucket.label} className="inset min-w-0 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="eyebrow" style={{ fontSize: "0.6rem" }}>{bucket.label}</p>
                  <span className="font-data text-xs font-semibold tnum text-(--ink)">{formatCurrency(bucket.total)}</span>
                </div>
                <div className="mt-2 grid gap-1.5">
                  {bucket.events.slice(0, visibleEvents).map((event) => (
                    <button
                      key={`${event.itemId}-${event.date}`}
                      type="button"
                      onClick={() => onSelect(event.itemId)}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-line bg-card px-2.5 py-2 text-left transition hover:border-ember"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="inline-flex shrink-0 flex-col items-center rounded-md border border-line bg-(--card-2) px-2 py-1">
                          <span className="font-data text-[0.66rem] font-semibold text-(--ink)">{formatRenewalDay(event.date)}</span>
                          <span className="font-data text-[0.54rem] uppercase tracking-[0.08em] text-(--muted)">{event.daysAway === 0 ? "today" : `in ${event.daysAway}d`}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-(--ink)">{event.merchant}</span>
                          <span className="block font-data text-[0.64rem] text-(--muted)">{event.category} · {event.frequency}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-data text-sm font-semibold tnum text-(--ink)">{formatCurrency(event.amount, event.currency)}</span>
                        <span className={statusStyles[event.action]}>{event.action}</span>
                      </span>
                    </button>
                  ))}
                  {bucket.events.length > visibleEvents ? (
                    <p className="px-1 pt-1 font-data text-[0.64rem] text-(--muted)">+{bucket.events.length - visibleEvents} more in this window</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="inset mt-4 px-3 py-6 text-center text-sm text-(--muted)">
          No projected renewals yet. Connect a source or add evidence, and the calendar fills in as soon as one recurring item is proven.
        </p>
      )}
    </section>
  );
}

function formatRenewalDay(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function PriorityActionPanel({
  priorityItems,
  userActions,
  onSelect,
}: {
  priorityItems: RecurringItem[];
  userActions: Record<string, RecommendationType>;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="panel p-5 sm:p-6">
      <SectionHead folio="2.4" kicker="Priority" title="What to review first" desc="Start with these before the next billing cycle." />
      <div className="mt-4 grid gap-2">
        {priorityItems.length ? priorityItems.map((item) => {
          const action = userActions[item.identityKey] ?? item.recommendationType;
          return (
            <button key={item.identityKey} type="button" onClick={() => onSelect(item.identityKey)} className="inset w-full p-3 text-left transition hover:border-ember">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-(--ink)">{item.merchant}</p>
                  <p className="mt-0.5 font-data text-xs leading-5 text-(--muted)">{formatCurrency(item.monthlyCost, item.currency)}/mo · renews {item.nextExpectedDate} · {item.confidenceScore}%</p>
                </div>
                <span className={statusStyles[action]}>{action}</span>
              </div>
            </button>
          );
        }) : <p className="inset px-3 py-3 text-sm text-(--muted)">Connect a proof source to generate an action plan.</p>}
      </div>
    </section>
  );
}

function SelectedItemPanel({ item, action, onAction }: { item: RecurringItem; action: RecommendationType; onAction: (action: RecommendationType) => void }) {
  const confidence = getConfidenceStory(item);
  const policy = getCommitmentPolicy(item.category);
  const allowedReviewActions = recommendationActions.filter((candidate) => isReviewActionAllowed(item.category, candidate.value));
  const displayedAction = allowedReviewActions.some((candidate) => candidate.value === action) ? action : "investigate";
  const managementTarget = getCommitmentManagementTarget(item);

  return (
    <section className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr]" data-reveal>
      <div className="dossier p-6">
        <span className="folio" data-folio="2.5" style={{ color: "var(--dossier-muted)" }}>Selected item</span>
        <h3 className="mt-4 font-display text-2xl font-semibold text-(--dossier-ink)">{item.merchant}</h3>
        <p className="mt-2 text-sm leading-6 muted-on-dark">{item.recommendationReason}</p>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <DossierStat label="Average debit" value={formatCurrency(item.averageAmount, item.currency)} />
          <DossierStat label="Annual cost" value={formatCurrency(item.annualCost, item.currency)} />
          <DossierStat label="Amount range" value={`${formatCurrency(item.amountMin, item.currency)} – ${formatCurrency(item.amountMax, item.currency)}`} />
          <DossierStat label="Proof rows" value={`${item.evidence.length}`} />
          {item.priceChange ? (
            <DossierStat
              label={item.priceChange.direction === "increase" ? `Price up ${item.priceChange.changePercent}%` : `Price down ${item.priceChange.changePercent}%`}
              value={`${formatCurrency(item.priceChange.previousAmount, item.currency)} → ${formatCurrency(item.priceChange.latestAmount, item.currency)}`}
            />
          ) : null}
          {item.missedCycles >= 2 ? (
            <DossierStat label="Evidence gap" value={`${item.missedCycles} cycles unproven`} />
          ) : null}
        </div>
        <div className="mt-5">
          <label className="font-data text-[0.68rem]" style={{ color: "var(--dossier-muted)" }} htmlFor="action-select">Choose action</label>
          <select id="action-select" value={displayedAction} onChange={(event) => onAction(event.target.value as RecommendationType)} className="mt-2 h-11 w-full rounded-[9px] border px-3 text-sm outline-none" style={{ background: "rgba(243,234,214,0.06)", borderColor: "var(--dossier-line)", color: "var(--dossier-ink)" }}>
            {allowedReviewActions.map((candidate) => <option key={candidate.value} value={candidate.value}>{candidate.label}</option>)}
          </select>
        </div>
        <div className="mt-4 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-base font-semibold text-(--dossier-ink)">{policy.label}</p>
            <span className="pill pill-partial">Class-safe actions</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-ochre">{policy.consequenceWarning}</p>
          <p className="mt-2 text-xs leading-5 muted-on-dark">Safe next steps: {policy.safeActions.map(formatPolicyAction).join(" · ")}</p>
        </div>
        {managementTarget ? (
          <div className="mt-4 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
            <p className="font-display text-base font-semibold text-(--dossier-ink)">Continue at the official account</p>
            <p className="mt-2 text-xs leading-5 muted-on-dark">Vognary takes you directly to the provider&apos;s own management surface. You keep control of the final confirmation; if the source remains connected, later evidence can verify the financial outcome.</p>
            <a href={managementTarget.url} target="_blank" rel="noreferrer" className="btn btn-ondark mt-3 h-9 px-3 text-xs">Open {managementTarget.label}</a>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {item.riskTags.length ? item.riskTags.map((tag) => <span key={tag} className="rounded-full border px-3 py-1 font-data text-[0.6rem] uppercase tracking-[0.12em]" style={{ borderColor: "var(--dossier-line)", color: "var(--dossier-muted)" }}>{tag}</span>) : <span className="text-sm muted-on-dark">No risk tags yet.</span>}
        </div>
        <div className="mt-5 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-base font-semibold text-(--dossier-ink)">{confidence.label}</p>
            <span className="pill pill-partial">{item.confidenceScore}%</span>
          </div>
          <p className="mt-2 text-sm leading-6 muted-on-dark">{confidence.detail}</p>
          <p className="mt-2 text-xs leading-5 muted-on-dark">{confidence.nextStep}</p>
        </div>
      </div>

      <div className="panel p-5 sm:p-6">
        <SectionHead folio="2.5" kicker="Proof" title="Where this came from" desc="Each suggestion links back to transaction or receipt text." right={<span className="pill pill-partial">{item.sourceNames.join(", ")}</span>} />
        <div className="mt-4 overflow-hidden rounded-[11px] border border-line">
          <table className="w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr>
                <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Date</th>
                <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Amount</th>
                <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Statement text</th>
              </tr>
            </thead>
            <tbody>
              {item.evidence.map((evidence) => (
                <tr key={`${evidence.source}-${evidence.rowNumber}-${evidence.date}`}>
                  <td className="border-t border-line px-4 py-3 font-data text-xs text-(--muted)">{evidence.date}</td>
                  <td className="border-t border-line px-4 py-3 font-data font-semibold tnum text-(--ink)">{formatCurrency(evidence.amount, item.currency)}</td>
                  <td className="border-t border-line px-4 py-3 text-(--ink-soft)">{evidence.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const recommendationActions: Array<{ value: RecommendationType; label: string }> = [
  { value: "keep", label: "Keep / continue" },
  { value: "watch", label: "Monitor" },
  { value: "downgrade", label: "Downgrade" },
  { value: "cancel", label: "Cancel" },
  { value: "investigate", label: "Review details" },
];

function isReviewActionAllowed(category: string, action: RecommendationType) {
  const policyAction: Record<RecommendationType, CommitmentAction> = {
    keep: "keep",
    watch: "monitor",
    downgrade: "downgrade",
    cancel: "cancel",
    investigate: "investigate",
  };
  return isCommitmentActionAllowed(category, policyAction[action]);
}

function formatPolicyAction(action: CommitmentAction) {
  return action.replace(/-/g, " ");
}

function getCommitmentManagementTarget(item: RecurringItem) {
  const value = `${item.merchant} ${item.normalizedMerchant} ${item.category} ${item.sourceNames.join(" ")}`.toLowerCase();
  const connectorId = value.includes("chatgpt")
    ? "chatgpt-subscription"
    : value.includes("openai")
      ? item.category.toLowerCase().includes("cloud") || item.category.toLowerCase().includes("usage") ? "openai-costs" : "chatgpt-subscription"
      : value.includes("github copilot")
        ? "github-copilot"
        : value.includes("github")
          ? "github-billing"
          : value.includes("vercel")
            ? "vercel-platform"
            : value.includes("cloudflare")
              ? "cloudflare-billing"
              : value.includes("google play")
                ? "google-play-receipt-evidence"
                : value.includes("apple") || value.includes("icloud")
                  ? "apple-receipt-evidence"
                  : value.includes("paypal")
                    ? "paypal-automatic-payments"
                    : value.includes("claude") || value.includes("anthropic")
                      ? "claude-subscription"
                      : value.includes("render")
                        ? "render-platform"
                        : value.includes("aws") || value.includes("amazon web services")
                          ? "aws-cost-explorer"
                          : null;
  return connectorId ? connectorLaunchTargets[connectorId] ?? null : null;
}

function DossierStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[9px] border px-3 py-2.5" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
      <p className="font-data text-[0.54rem] uppercase tracking-[0.18em]" style={{ color: "var(--dossier-muted)" }}>{label}</p>
      <p className="font-data mt-1.5 text-sm font-semibold tnum text-(--dossier-ink)">{value}</p>
    </div>
  );
}

function TeamReviewPanel({
  audit,
  teamMembers,
  memberDraft,
  itemOwners,
  reviewNotes,
  reviewCompletedAt,
  onMemberDraft,
  onAddTeamMember,
  onRemoveTeamMember,
  onItemOwner,
  onReviewNote,
  onCompleteReview,
}: {
  audit: AuditResult;
  teamMembers: TeamMember[];
  memberDraft: { name: string; role: string };
  itemOwners: Record<string, string>;
  reviewNotes: Record<string, string>;
  reviewCompletedAt: string | null;
  onMemberDraft: (draft: { name: string; role: string }) => void;
  onAddTeamMember: () => void;
  onRemoveTeamMember: (id: string) => void;
  onItemOwner: (itemId: string, ownerId: string) => void;
  onReviewNote: (itemId: string, note: string) => void;
  onCompleteReview: () => void;
}) {
  const assignedCount = audit.recurringItems.filter((item) => itemOwners[item.identityKey]).length;
  const actionedCount = audit.recurringItems.filter((item) => ["cancel", "downgrade", "investigate", "watch"].includes(item.recommendationType)).length;

  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <SectionHead
        folio="3.3"
        kicker="Review"
        title="Monthly review"
        desc="Assign payments to owners, record notes, and close the monthly review."
        right={<button type="button" onClick={onCompleteReview} className="btn btn-primary">Mark review complete</button>}
      />
      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        <MiniStat label="Team members" value={`${teamMembers.length}`} />
        <MiniStat label="Assigned items" value={`${assignedCount}/${audit.recurringItems.length}`} />
        <MiniStat label="Needs review" value={`${actionedCount}`} />
      </div>
      {reviewCompletedAt ? <p className="mt-3 rounded-md border border-verdict bg-(--verdict-tint) px-3 py-2 text-sm text-verdict">Review completed at {new Date(reviewCompletedAt).toLocaleString("en-IN")}.</p> : null}

      <div className="mt-4 inset p-4">
        <p className="eyebrow">People reviewing</p>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input value={memberDraft.name} onChange={(event) => onMemberDraft({ ...memberDraft, name: event.target.value })} className="field" placeholder="Name" aria-label="Reviewer name" />
          <input value={memberDraft.role} onChange={(event) => onMemberDraft({ ...memberDraft, role: event.target.value })} className="field" placeholder="Role" aria-label="Reviewer role" />
          <button type="button" onClick={onAddTeamMember} className="btn btn-primary">Add</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {teamMembers.map((member) => (
            <span key={member.id} className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold text-(--muted)">
              {member.name} · {member.role}
              {member.id !== "founder" ? <button type="button" onClick={() => onRemoveTeamMember(member.id)} className="text-ember">Remove</button> : null}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-[11px] border border-line">
        <table className="w-full min-w-184 border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Merchant</th>
              <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Monthly</th>
              <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Signal</th>
              <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Owner</th>
              <th className="border-b border-line bg-(--card-2) px-4 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Review note</th>
            </tr>
          </thead>
          <tbody>
            {audit.recurringItems.map((item) => (
              <tr key={item.identityKey}>
                <td className="border-t border-line px-4 py-3 font-semibold text-(--ink)">{item.merchant}</td>
                <td className="border-t border-line px-4 py-3 font-data tnum text-(--ink-soft)">{formatCurrency(item.monthlyCost, item.currency)}</td>
                <td className="border-t border-line px-4 py-3"><span className={statusStyles[item.recommendationType]}>{item.recommendationType}</span></td>
                <td className="border-t border-line px-4 py-3">
                  <select value={itemOwners[item.identityKey] ?? ""} onChange={(event) => onItemOwner(item.identityKey, event.target.value)} className="field" style={{ height: "2.3rem", fontSize: "0.78rem" }} aria-label={`Owner for ${item.merchant}`}>
                    <option value="">Unassigned</option>
                    {teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </td>
                <td className="border-t border-line px-4 py-3">
                  <input value={reviewNotes[item.identityKey] ?? ""} onChange={(event) => onReviewNote(item.identityKey, event.target.value)} className="field" style={{ height: "2.3rem", fontSize: "0.78rem" }} placeholder="Usage, cancel path, decision" aria-label={`Review note for ${item.merchant}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Entity resolution v2 — near-miss pairs the automatic gates refused to merge.
// Ambiguity becomes a user question, never a silent guess.
function DuplicateCandidatesPanel({ candidates, onDecide }: { candidates: DuplicateCandidate[]; onDecide: (pairKey: string, decision: MergeDecision) => void }) {
  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <SectionHead
        folio="2.6"
        kicker="Resolve"
        title="Possible duplicates"
        desc="These pairs look related but were kept separate on purpose. Confirm what they are and the totals update everywhere."
        right={<span className="pill pill-partial">{candidates.length} to review</span>}
      />
      <div className="mt-4 grid gap-2">
        {candidates.map((candidate) => (
          <div key={candidate.pairKey} className="inset flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-(--ink)">{candidate.leftMerchant} <span className="font-normal text-(--muted)">vs</span> {candidate.rightMerchant}</p>
              <p className="mt-1 text-xs leading-5 text-(--muted)">{candidate.reason}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" onClick={() => onDecide(candidate.pairKey, "merge")} className="btn btn-primary h-9 px-3 text-xs">Same commitment</button>
              <button type="button" onClick={() => onDecide(candidate.pairKey, "separate")} className="btn btn-ghost h-9 px-3 text-xs">Keep separate</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResolvedDuplicateDecisionsPanel({
  decisions,
  items,
  onUndo,
}: {
  decisions: Record<string, MergeDecision>;
  items: RecurringItem[];
  onUndo: (pairKey: string) => void;
}) {
  const itemByKey = new Map(items.map((item) => [item.identityKey, item]));
  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <SectionHead
        folio="2.7"
        kicker="Resolved"
        title="Duplicate decisions"
        desc="Merge and keep-separate decisions remain reversible. Undoing a decision restores the original evidence pair for review."
      />
      <div className="mt-4 grid gap-2">
        {Object.entries(decisions).map(([pairKey, decision]) => {
          const [leftKey, rightKey] = pairKey.split("||");
          const left = itemByKey.get(leftKey);
          const right = itemByKey.get(rightKey);
          return (
            <div key={pairKey} className="inset flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-(--ink)">{left?.merchant ?? "Previous item"} + {right?.merchant ?? "previous item"}</p>
                <p className="mt-1 text-xs text-(--muted)">{decision === "merge" ? "Treated as one commitment" : "Kept as separate commitments"}</p>
              </div>
              <button type="button" onClick={() => onUndo(pairKey)} className="btn btn-ghost h-9 px-3 text-xs">Undo resolution</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const savingStatusPill: Record<string, string> = {
  verified: "pill pill-ready",
  verifying: "pill pill-partial",
  watching: "pill pill-planned",
  "not-eliminated": "pill pill-blocked",
};

// Verified Savings — Vognary does not claim savings, it proves them by
// watching the item's own predicted debits stop appearing in covered evidence.
function VerifiedSavingsPanel({ savings, onSelect }: { savings: VerifiedSavingsSummary; onSelect: (id: string) => void }) {
  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <SectionHead
        folio="3.2"
        kicker="Outcomes"
        title="Verified savings"
        desc="Mark an item cancel or downgrade, then let newer evidence prove the charge stopped. Silence only counts once evidence covers the expected debit."
        right={savings.entries.length ? <span className="font-data text-xs tnum text-verdict">{formatCurrency(savings.verifiedAnnual)}/yr verified</span> : null}
      />
      {savings.entries.length ? (
        <>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
            <MiniStat label="Verified savings" value={`${formatCurrency(savings.verifiedMonthly)}/mo`} />
            <MiniStat label="Verified annual" value={formatCurrency(savings.verifiedAnnual)} />
            <MiniStat label="Pending proof" value={`${formatCurrency(savings.pendingMonthly)}/mo`} />
          </div>
          <div className="mt-4 grid gap-2">
            {savings.entries.map((entry) => (
              <button key={entry.itemId} type="button" onClick={() => onSelect(entry.itemId)} className="inset w-full p-3 text-left transition hover:border-ember">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-(--ink)">{entry.merchant} <span className="font-normal text-(--muted)">· {entry.action}</span></p>
                    <p className="mt-1 text-xs leading-5 text-(--muted)">{entry.detail}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {entry.status === "verified" ? <span className="font-data text-sm font-semibold tnum text-verdict">{formatCurrency(entry.annualSaving, entry.currency)}/yr</span> : null}
                    <span className={savingStatusPill[entry.status]}>{entry.status}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="inset mt-4 px-3 py-5 text-center text-sm text-(--muted)">
          No cancel or downgrade decisions recorded yet. Choose an action on any ledger item; when newer evidence shows the charge stopped, the saving is minted here — proven, not promised.
        </p>
      )}
    </section>
  );
}

// Month-over-month diff — the review opens with what changed, not a cold table.
function SinceLastReviewPanel({ diff, onSelectMerchant }: { diff: ReviewDiff; onSelectMerchant: () => void }) {
  const deltaTone = diff.monthlyDelta > 0 ? "text-ember" : diff.monthlyDelta < 0 ? "text-verdict" : "text-(--muted)";

  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <SectionHead
        folio="3.1"
        kicker="Since last review"
        title={`What changed in ${diff.daysSincePrevious} day(s)`}
        desc={`Compared against the review completed on ${diff.previousTakenAt.slice(0, 10)}.`}
        right={<span className={`font-data text-xs tnum ${deltaTone}`}>{diff.monthlyDelta >= 0 ? "+" : ""}{formatCurrency(diff.monthlyDelta)}/mo</span>}
      />
      {diff.hasChanges ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="inset p-3">
            <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Price changes</p>
            {diff.priceChanges.length ? diff.priceChanges.slice(0, 4).map((change) => (
              <p key={`${change.merchant}-${change.toAmount}`} className="mt-2 text-sm leading-6 text-(--ink-soft)">
                <span className="font-semibold text-(--ink)">{change.merchant}</span>{" "}
                <span className={change.direction === "increase" ? "text-ember" : "text-verdict"}>
                  {formatCurrency(change.fromAmount, change.currency)} → {formatCurrency(change.toAmount, change.currency)} ({change.direction === "increase" ? "+" : "−"}{change.changePercent}%)
                </span>
              </p>
            )) : <p className="mt-2 text-sm text-(--muted)">No price movements detected.</p>}
          </div>
          <div className="inset p-3">
            <p className="eyebrow" style={{ fontSize: "0.6rem" }}>New commitments</p>
            {diff.added.length ? diff.added.slice(0, 4).map((item) => (
              <button key={item.key} type="button" onClick={onSelectMerchant} className="mt-2 block text-left text-sm leading-6 text-(--ink-soft) transition hover:text-(--ink)">
                <span className="font-semibold text-(--ink)">{item.merchant}</span> · {formatCurrency(item.monthlyCost, item.currency)}/mo
              </button>
            )) : <p className="mt-2 text-sm text-(--muted)">Nothing new appeared.</p>}
          </div>
          <div className="inset p-3">
            <p className="eyebrow" style={{ fontSize: "0.6rem" }}>No longer detected</p>
            {diff.removed.length ? diff.removed.slice(0, 4).map((item) => (
              <p key={item.key} className="mt-2 text-sm leading-6 text-(--ink-soft)">
                <span className="font-semibold text-(--ink)">{item.merchant}</span> · was {formatCurrency(item.monthlyCost, item.currency)}/mo
              </p>
            )) : <p className="mt-2 text-sm text-(--muted)">Nothing dropped out.</p>}
          </div>
        </div>
      ) : (
        <p className="inset mt-4 px-3 py-4 text-center text-sm text-(--muted)">No changes since the last completed review. Coverage {diff.coverageDelta >= 0 ? "held or improved" : "declined"} ({diff.coverageDelta >= 0 ? "+" : ""}{diff.coverageDelta} pts).</p>
      )}
    </section>
  );
}

// Proof Graph — which rupees rest on one source, which have gone stale, and
// which single connection would strengthen the most spend.
function ProofGraphPanel({ graph }: { graph: ProofGraphSummary }) {
  const singleShare = Math.round(graph.singleSourceShare * 100);

  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <SectionHead
        folio="4.0"
        kicker="Proof graph"
        title="How strong is the evidence behind the money?"
        desc="Every rupee in the ledger is either multi-source, single-source, or going stale. The strongest next connection is computed from what is actually at stake."
        right={graph.itemCount ? <span className="font-data text-xs tnum text-(--muted)">{graph.itemCount} items · {graph.sources.length} sources</span> : null}
      />
      {graph.itemCount ? (
        <>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-4">
            <MiniStat label="Single-source spend" value={`${formatCurrency(graph.singleSourceMonthly)}/mo (${singleShare}%)`} />
            <MiniStat label="Multi-source spend" value={`${formatCurrency(graph.multiSourceMonthly)}/mo`} />
            <MiniStat label="Stale evidence" value={`${formatCurrency(graph.staleMonthly)}/mo`} />
            <MiniStat label="Avg proof rows" value={graph.averageProofRows.toFixed(1)} />
          </div>
          {graph.nextBestSources.length ? (
            <div className="mt-4 grid gap-2 lg:grid-cols-3">
              {graph.nextBestSources.map((suggestion) => (
                <div key={suggestion.suggestion} className="inset p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-(--ink)">{suggestion.suggestion}</p>
                    <span className="font-data text-xs font-semibold tnum text-ember">{formatCurrency(suggestion.monthlyAtStake)}/mo</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-(--muted)">{suggestion.reason}</p>
                  {suggestion.merchants.length ? (
                    <p className="mt-1.5 font-data text-[0.66rem] text-(--muted)">Biggest: {suggestion.merchants.join(", ")}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-md border border-verdict bg-(--verdict-tint) px-3 py-2 text-sm text-verdict">Every commitment is corroborated by more than one source. This is the strongest proof state the ledger can reach.</p>
          )}
        </>
      ) : (
        <p className="inset mt-4 px-3 py-5 text-center text-sm text-(--muted)">Add evidence to see the proof structure behind your recurring money.</p>
      )}
    </section>
  );
}

function ReadinessPanel() {
  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <SectionHead
        folio="4.1"
        kicker="Readiness"
        title="What works now"
        desc="What works today and which connected features still need setup or partners."
        right={<span className="pill pill-ready">Ready to use</span>}
      />
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {getReadinessItems().map((item) => <StatusRow key={item.label} {...item} />)}
      </div>
    </section>
  );
}

function verdictColor(action: RecommendationType): string {
  return {
    keep: "var(--verdict)",
    watch: "var(--ochre)",
    downgrade: "var(--indigo)",
    cancel: "var(--ember)",
    investigate: "var(--ink-soft)",
  }[action];
}

function SpendSpectrum({ audit, userActions, onSelect }: { audit: AuditResult; userActions: Record<string, RecommendationType>; onSelect: (id: string) => void }) {
  const items = audit.recurringItems
    .filter((item) => item.currency === audit.summary.primaryCurrency)
    .sort((left, right) => right.monthlyCost - left.monthlyCost);
  const total = items.reduce((sum, item) => sum + item.monthlyCost, 0);
  const hasForeignItems = audit.recurringItems.some((item) => item.currency !== audit.summary.primaryCurrency);

  return (
    <section className="panel p-5 sm:p-6">
      <SectionHead
        folio="2.3"
        kicker="Spend"
        title="Spend by merchant"
        desc={`Shows which ${audit.summary.primaryCurrency} recurring payments cost the most each month; other currencies stay separate.`}
        right={<span className="font-data text-xs text-(--muted)">{formatCurrency(audit.summary.monthlyRecurringSpend, audit.summary.primaryCurrency)}/mo</span>}
      />
      {items.length ? (
        <>
          <div className="spectrum-track mt-5" role="group" aria-label="Recurring spend by merchant">
            {items.map((item) => {
              const action = userActions[item.identityKey] ?? item.recommendationType;
              const pct = total > 0 ? (item.monthlyCost / total) * 100 : 0;
              return (
                <button
                  key={item.identityKey}
                  type="button"
                  onClick={() => onSelect(item.identityKey)}
                  className={`spectrum-seg seg-${action}`}
                  style={{ flexGrow: Math.max(item.monthlyCost, 1), flexBasis: 0 }}
                  title={`${item.merchant} · ${formatCurrency(item.monthlyCost, item.currency)}/mo · ${Math.round(pct)}%`}
                  aria-label={`${item.merchant}, ${formatCurrency(item.monthlyCost, item.currency)} per month`}
                />
              );
            })}
          </div>
          <div className="mt-4 grid gap-1 sm:grid-cols-2">
            {items.slice(0, 6).map((item) => {
              const action = userActions[item.identityKey] ?? item.recommendationType;
              const pct = total > 0 ? (item.monthlyCost / total) * 100 : 0;
              const color = verdictColor(action);
              return (
                <button key={item.identityKey} type="button" onClick={() => onSelect(item.identityKey)} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-white/4">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px 0 ${color}` }} />
                    <span className="truncate text-sm text-(--ink)">{item.merchant}</span>
                  </span>
                  <span className="font-data shrink-0 text-xs tnum text-(--muted)">{formatCurrency(item.monthlyCost, item.currency)} · {Math.round(pct)}%</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <p className="inset mt-5 px-3 py-6 text-center text-sm text-(--muted)">{hasForeignItems ? `No ${audit.summary.primaryCurrency} commitments yet; foreign commitments remain visible in the ledger.` : "Add sources to see spend by merchant."}</p>
      )}
    </section>
  );
}

function TickerStat({ label, value, tone }: { label: string; value: string; tone: "ember" | "ochre" | "paper" }) {
  const color = tone === "ember" ? "var(--ember)" : tone === "ochre" ? "var(--ochre)" : "var(--dossier-ink)";
  return (
    <div className="flex items-baseline gap-2">
      <span className="eyebrow muted-on-dark" style={{ fontSize: "0.58rem" }}>{label}</span>
      <span className="font-data text-sm font-medium tnum" style={{ color }}>{value}</span>
    </div>
  );
}

function SectionHead({ folio, kicker, title, desc, right }: { folio: string; kicker: string; title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <span className="folio" data-folio={folio}>{kicker}</span>
        <h3 className="mt-2 font-display text-[1.22rem] font-semibold text-(--ink)">{title}</h3>
        {desc ? <p className="mt-1 max-w-xl text-sm leading-6 text-(--muted)">{desc}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "ink" | "blue" | "caution" | "accent" }) {
  const color = {
    ink: "var(--glow)",
    blue: "var(--indigo)",
    caution: "var(--ochre)",
    accent: "var(--verdict)",
  }[tone];

  return (
    <div className="panel-flat lift relative overflow-hidden px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow" style={{ fontSize: "0.62rem" }}>{label}</p>
        <span className="size-1.5 rounded-full" style={{ background: color }} />
      </div>
      <p className="font-data mt-3 text-[1.7rem] font-medium leading-none tnum" style={{ color }}>{value}</p>
      <span className="mt-3 block h-px w-full" style={{ background: `color-mix(in srgb, ${color} 40%, var(--line))` }} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inset px-3 py-2.5">
      <p className="eyebrow" style={{ fontSize: "0.62rem" }}>{label}</p>
      <p className="font-data mt-1.5 text-sm font-semibold tnum text-(--ink)">{value}</p>
    </div>
  );
}

function StatusRow({ label, value, state }: { label: string; value: string; state: "ready" | "partial" | "blocked" | "planned" }) {
  const pillClass = {
    ready: "pill pill-ready",
    partial: "pill pill-partial",
    blocked: "pill pill-blocked",
    planned: "pill pill-planned",
  }[state];

  return (
    <div className="inset flex items-center justify-between gap-3 px-3 py-2.5">
      <div>
        <p className="text-sm font-semibold text-(--ink)">{label}</p>
        <p className="text-xs leading-5 text-(--muted)">{value}</p>
      </div>
      <span className={`${pillClass} shrink-0`}>{state}</span>
    </div>
  );
}

function getCoverageItems() {
  return [
    { label: "Google identity", value: "OAuth route exists; workspace sessions require configured Google auth, database, and session secret", state: "partial" as const },
    { label: "Gmail receipts", value: "OAuth path exists; production Gmail receipt sync needs Google app verification", state: "partial" as const },
    { label: "Cloud and AI tools", value: "OpenAI adapter exists; Claude, Kling, Vercel, Render, GitHub, and X are connector targets", state: "partial" as const },
    { label: "App-store subscriptions", value: "Apple and Google Play need official source access or provider-supported evidence", state: "planned" as const },
    { label: "Bank/card data", value: "Needs Account Aggregator, issuer, network, or payment partner access", state: "blocked" as const },
    { label: "UPI/card mandates", value: "Needs PSP, issuer, bank, network, or regulated partner API access", state: "blocked" as const },
  ];
}

function getReadinessItems() {
  return [
    { label: "Integration launchpad", value: "Users start from one platform selector and one connect/disconnect action", state: "ready" as const },
    { label: "Recurring ledger", value: "Connected evidence lands in one review table with next debit and action labels", state: "ready" as const },
    { label: "Data handling", value: "Signed-in workspaces automatically synchronize encrypted state and normalized upload/manual ledger rows; browser mode remains a local fallback", state: "ready" as const },
    { label: "Exports", value: "JSON audit pack export remains available from the review workspace", state: "ready" as const },
    { label: "Provider APIs", value: "Each real auto-sync needs OAuth, API keys, or provider partnership per source", state: "partial" as const },
    { label: "Regulated rails", value: "Bank, UPI, and card mandate discovery cannot be universal without approved partners", state: "blocked" as const },
  ];
}

function getCoverageSignals(statementSources: StatementFile[], manualItems: ManualRecurringInput[], receiptText: string): CoverageSignal[] {
  const sourceNames = statementSources.map((source) => `${source.name} ${source.kind ?? "structured"}`.toLowerCase()).join(" ");
  const manualText = manualItems.map((item) => `${item.category} ${item.sourceName} ${item.merchant}`.toLowerCase()).join(" ");

  return [
    { label: "Bank/card statements", done: statementSources.length > 0 },
    { label: "Statement source coverage", done: statementSources.some((source) => source.kind === "pdf") || statementSources.some((source) => source.kind === "csv" || source.name.endsWith(".csv")) },
    { label: "UPI/card mandates", done: /upi|mandate|card/.test(manualText) },
    { label: "Apple/Google app stores", done: /apple|google play|app store/.test(manualText + sourceNames) },
    { label: "Email receipts", done: receiptText.trim().length > 0 || /gmail|email receipt/.test(manualText + sourceNames) },
    { label: "Cloud/SaaS tools", done: /openai|anthropic|claude|cursor|github|vercel|render|aws|cloud|domain/.test(manualText + sourceNames) },
    { label: "EMI/SIP/insurance/utilities", done: /emi|sip|insurance|utility|utilities|telecom|debt|investment/.test(manualText + sourceNames) },
  ];
}

function getCoverageAction(label: string) {
  const actions: Record<string, string> = {
    "Bank/card statements": "Add one redacted bank or card CSV so Vognary can detect repeated debits.",
    "Statement source coverage": "Prefer CSV over PDF for the next statement because it gives cleaner transaction rows.",
    "UPI/card mandates": "Open your UPI or card app, list active mandates, and add them manually until partner APIs are live.",
    "Apple/Google app stores": "Check Apple ID and Google Play subscriptions, then paste receipts or add each active plan manually.",
    "Email receipts": "Paste Gmail or Outlook receipt snippets, or connect Gmail when OAuth is configured.",
    "Cloud/SaaS tools": "Add invoices or usage exports for OpenAI, GitHub, Vercel, Render, AWS, Cloudflare, and domains.",
    "EMI/SIP/insurance/utilities": "Add policy, EMI, SIP, broadband, telecom, and utility renewals so annual commitments are visible.",
  };

  return actions[label] ?? `Add evidence for ${label.toLowerCase()}.`;
}

function getConfidenceStory(item: RecurringItem) {
  const sourceCount = new Set(item.sourceNames).size;
  const evidenceCount = item.evidence.length;
  const amountStable = Math.abs(item.amountMax - item.amountMin) <= Math.max(25, item.averageAmount * 0.05);
  const label = item.confidenceScore >= 85 ? "Strong evidence" : item.confidenceScore >= 70 ? "Useful evidence" : "Needs confirmation";
  const stability = amountStable ? "amount is stable" : "amount changes across evidence rows";

  return {
    label,
    detail: `Seen in ${evidenceCount} proof row(s) across ${sourceCount} source(s); ${stability}; cadence is ${item.frequency}.`,
    nextStep: item.confidenceScore >= 85
      ? "Use this to decide ownership and action before the next debit."
      : "Add one more source, receipt, or dashboard check before treating this as final.",
  };
}

function getPriorityItems(items: RecurringItem[], userActions: Record<string, RecommendationType>): RecurringItem[] {
  const actionWeight: Record<RecommendationType, number> = {
    cancel: 5,
    downgrade: 4,
    investigate: 3,
    watch: 2,
    keep: 0,
  };

  return [...items]
    .sort((left, right) => {
      const leftAction = userActions[left.identityKey] ?? left.recommendationType;
      const rightAction = userActions[right.identityKey] ?? right.recommendationType;
      return (actionWeight[rightAction] - actionWeight[leftAction]) || (right.monthlyCost - left.monthlyCost);
    })
    .slice(0, 5);
}

function isReceiptCandidate(value: unknown): value is ReceiptCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReceiptCandidate>;
  return typeof candidate.id === "string"
    && typeof candidate.merchant === "string"
    && typeof candidate.amount === "number"
    && Number.isFinite(candidate.amount)
    && typeof candidate.frequency === "string"
    && typeof candidate.nextExpectedDate === "string"
    && typeof candidate.category === "string"
    && typeof candidate.evidenceText === "string";
}

function isPackIssuerSignature(value: unknown): value is PackIssuerSignature {
  if (!value || typeof value !== "object") return false;
  const signature = value as Partial<PackIssuerSignature>;
  return signature.version === 1
    && signature.issuer === "Vognary"
    && signature.algorithm === "Ed25519"
    && typeof signature.keyId === "string"
    && typeof signature.publicKeyFingerprint === "string"
    && typeof signature.issuedAt === "string"
    && typeof signature.workspaceRef === "string"
    && typeof signature.signature === "string";
}

function recurringIdentity(item: Pick<ManualRecurringInput, "merchant" | "amount" | "frequency">) {
  return `${item.merchant.trim().toLowerCase()}::${Math.round(item.amount * 100)}::${item.frequency}`;
}

function buildWorkspaceBackup({
  statementSources,
  manualItems,
  userActions,
  itemOwners,
  reviewNotes,
  teamMembers,
  receiptText,
  actionsMeta,
  mergeDecisions,
  lastReview,
  reviewCompletedAt,
}: {
  statementSources: StatementFile[];
  manualItems: ManualRecurringInput[];
  userActions: Record<string, RecommendationType>;
  itemOwners: Record<string, string>;
  reviewNotes: Record<string, string>;
  teamMembers: TeamMember[];
  receiptText: string;
  actionsMeta?: Record<string, ActionMeta>;
  mergeDecisions?: Record<string, MergeDecision>;
  lastReview?: ReviewSnapshot | null;
  reviewCompletedAt?: string | null;
}): WorkspaceBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    statementSources,
    manualItems,
    userActions,
    itemOwners,
    reviewNotes,
    teamMembers,
    receiptText,
    actionsMeta: actionsMeta ?? {},
    mergeDecisions: mergeDecisions ?? {},
    lastReview: lastReview ?? null,
    reviewCompletedAt: reviewCompletedAt ?? null,
  };
}

function serializeWorkspaceForSync(workspace: WorkspaceBackup) {
  return JSON.stringify({ ...workspace, exportedAt: null });
}

function mergeReceiptText(current: string, incoming: string) {
  const snippets = [current, incoming]
    .flatMap((value) => value.split(/\n\s*\n/))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(snippets)].join("\n\n");
}

function workspaceContainsGuestTransfer(workspace: WorkspaceBackup, guest: GuestAuditSnapshot) {
  const hasStatements = guest.statementSources.every((source) => workspace.statementSources.some((candidate) => candidate.text === source.text));
  const hasManualItems = guest.manualItems.every((item) => workspace.manualItems.some((candidate) => JSON.stringify(candidate) === JSON.stringify(item)));
  const workspaceSnippets = new Set((workspace.receiptText ?? "").split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean));
  const hasReceipts = guest.receiptText
    .split(/\n\s*\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .every((snippet) => workspaceSnippets.has(snippet));
  return hasStatements && hasManualItems && hasReceipts;
}

function safePersist(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function slugifyKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function loadLastReviewSnapshot(): ReviewSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(lastReviewStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isReviewSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadPackChain(): PackChainState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(packChainStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PackChainState>;
    if (typeof parsed.lastHash !== "string" || typeof parsed.chainIndex !== "number") return null;
    return { lastHash: parsed.lastHash, chainIndex: parsed.chainIndex };
  } catch {
    return null;
  }
}

function savePackChain(chain: PackChainState) {
  safePersist(packChainStorageKey, JSON.stringify(chain));
}

function getOwnerName(ownerId: string | undefined, teamMembers: TeamMember[]): string {
  if (!ownerId) return "Unassigned";
  return teamMembers.find((member) => member.id === ownerId)?.name ?? "Unassigned";
}

function formatCurrency(value: number, currency = "INR"): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function csvCell(value: unknown): string {
  return encodeCsvCell(value);
}

function downloadBlob(content: string | Blob, mimeType: string, filename: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
