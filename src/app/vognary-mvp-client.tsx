"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import OfflineBanner from "./offline-banner";
import { scrollIntoViewWithMotion } from "@/lib/client-motion";
import { encodeCsvCell } from "@/lib/csv";
import { connectors, type Connector, type ConnectorStatus } from "@/lib/connectors";
import {
  describeTileCoverage,
  matchTileItems,
  merchantTiles,
  resolveConnectedConnectorIds,
  type ConnectTile,
} from "@/lib/connect-rails";
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
import { findActionableCancelAction, findCancelAction, manageUrlHostname } from "@/lib/cancel-actions";
import { receiptTextToManualInputs, type ReceiptCandidate } from "@/lib/receipt-parser";
import { isSampleReceiptText, sampleReceiptText } from "@/lib/sample-audit";
import { buildRenewalTimeline, type RenewalTimeline } from "@/lib/renewal-timeline";
import { buildProofGraphSummary, type ProofGraphSummary } from "@/lib/proof-graph";
import type { CitedProofAnswer } from "@/lib/proof-questions";
import { buildVerifiedSavings, type ActionMeta, type VerifiedSavingsSummary } from "@/lib/verified-savings";
import { buildReviewSnapshot, diffReviews, type ReviewDiff, type ReviewSnapshot } from "@/lib/review-diff";
import {
  attachIssuerSignature,
  sealAuditPack,
  type PackChainState,
  type PackIssuerSignature,
} from "@/lib/audit-pack";
import { redactText } from "@/lib/redaction";
import { buildSavingsCardSvg } from "@/lib/savings-card";
import { buildSavingsReceipt, buildSavingsShareText } from "@/lib/savings-receipt";
import { rankSuggestedCuts } from "@/lib/suggested-cuts";
import { nakulMomentSeenPrefix, nakulMomentSessionKey, selectNakulMoment, type NakulMoment, type NakulMomentId } from "@/lib/nakul-moments";
import { sourceDisplayName, sourceHealthPresentation, sourceNeedsAttention } from "@/lib/source-health-presentation";
import { getCommitmentPolicy, isCommitmentActionAllowed, type CommitmentAction } from "@/lib/commitment-policy";
import { resolveCommitmentDecisionIdentityKey } from "@/lib/commitment-decisions";
import { buildConnectorCoverageWindows, connectorEvidenceSourceName } from "@/lib/connector-source-identity";
import { guestAuditTransferKey, parseGuestAuditSnapshot, type GuestAuditSnapshot } from "@/lib/guest-audit-transfer";
import type { ProductEventMetricName, ProductEventName } from "@/lib/product-events";
import { applyHydrationArrayDelta, applyHydrationRecordDelta, applyHydrationTextDelta } from "@/lib/workspace-hydration";
import GuidedCapturePanel from "./guided-capture-panel";
import { VognaryMark } from "./brand";
import { Nakul } from "./character";
import { CommandPalette, type PaletteItem } from "./command-palette";
import { RunwayStrip } from "./runway-strip";
import { NextDebitTicker, WorkspaceSidebar } from "./workspace-shell";

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
  merchantLinks?: string[];
  monthlyBudget?: number | null;
  categoryBudgets?: Record<string, number>;
};

type HydrationWorkspaceState = Pick<WorkspaceBackup,
  | "statementSources"
  | "manualItems"
  | "userActions"
  | "itemOwners"
  | "reviewNotes"
  | "teamMembers"
  | "receiptText"
  | "actionsMeta"
  | "mergeDecisions"
  | "lastReview"
  | "reviewCompletedAt"
  | "monthlyBudget"
  | "categoryBudgets"
> & {
  merchantLinks: string[];
  selectedItemId: string | null;
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

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type SyncCelebration = {
  rail: string;
  count: number;
  monthlyTotals: Array<[string, number]>;
  merchants: string[];
};

type ConnectorStartPayload = {
  status?: string;
  state?: string;
  availability?: "available" | "company-activation-pending";
  error?: string;
  missingEnv?: string[];
  nextSteps?: string[];
  requiredEnv?: string[];
  message?: string;
  authUrl?: string;
  approvalUrl?: string | null;
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
  displayName?: string | null;
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

type WorkspaceType = "personal" | "family" | "founder" | "team";

type WorkspaceProfilePayload = {
  status?: string;
  workspace?: {
    workspaceId: string;
    workspaceName: string;
    role: "owner" | "admin" | "member" | "viewer";
    plan: string;
    workspaceType: WorkspaceType;
  };
};

type ServerActionCase = {
  id: string;
  recurringItemId: string;
  action: "cancel" | "downgrade" | "renegotiate";
  status: string;
  merchant: string;
  currency: string;
  baselineAnnualAmount: number;
  maximumSuccessFeeMinor: number;
  authorization: { id: string; termsVersion: string; authorizedAt: string | null } | null;
  receipt: { id: string; verifiedAnnualSaving: number } | null;
  invoice: { id: string; status: string; amountMinor: number } | null;
  updatedAt: string;
  authorizationPreview?: AuthorizationPreview | null;
};

type AuthorizationPreview = {
  scope: "one-action-one-commitment";
  termsVersion: string;
  authorizationVersion: number;
  successFeeBasisPoints: number;
  maximumSuccessFeeMinor: number;
  text: string;
};

type WorkspaceActionsPayload = {
  status?: string;
  concierge?: { available: boolean };
  actionCases?: ServerActionCase[];
  authorizationPreview?: AuthorizationPreview;
  actionCase?: ServerActionCase;
  error?: string;
  message?: string;
};

type WorkspaceCommitmentsPayload = {
  status?: string;
  commitments?: ServerRecurringItem[];
};

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

function mergeWorkspaceHydration(
  server: WorkspaceBackup,
  baseline: HydrationWorkspaceState,
  current: HydrationWorkspaceState,
): WorkspaceBackup {
  return {
    ...server,
    statementSources: applyHydrationArrayDelta(server.statementSources, baseline.statementSources, current.statementSources, (source) => source.id),
    manualItems: applyHydrationArrayDelta(server.manualItems, baseline.manualItems, current.manualItems, (item) => item.id),
    userActions: applyHydrationRecordDelta(server.userActions ?? {}, baseline.userActions, current.userActions),
    actionsMeta: applyHydrationRecordDelta(server.actionsMeta ?? {}, baseline.actionsMeta ?? {}, current.actionsMeta ?? {}),
    mergeDecisions: applyHydrationRecordDelta(server.mergeDecisions ?? {}, baseline.mergeDecisions ?? {}, current.mergeDecisions ?? {}),
    itemOwners: applyHydrationRecordDelta(server.itemOwners ?? {}, baseline.itemOwners, current.itemOwners),
    reviewNotes: applyHydrationRecordDelta(server.reviewNotes ?? {}, baseline.reviewNotes, current.reviewNotes),
    teamMembers: applyHydrationArrayDelta(server.teamMembers ?? [], baseline.teamMembers, current.teamMembers, (member) => member.id),
    receiptText: applyHydrationTextDelta(server.receiptText ?? "", baseline.receiptText ?? "", current.receiptText ?? ""),
    lastReview: current.lastReview === baseline.lastReview ? server.lastReview ?? null : current.lastReview,
    reviewCompletedAt: current.reviewCompletedAt === baseline.reviewCompletedAt
      ? server.reviewCompletedAt ?? null
      : current.reviewCompletedAt,
    merchantLinks: applyHydrationArrayDelta(
      sanitizeMerchantLinks(server.merchantLinks),
      baseline.merchantLinks,
      current.merchantLinks,
      (id) => id,
    ),
    monthlyBudget: current.monthlyBudget === baseline.monthlyBudget ? server.monthlyBudget ?? null : current.monthlyBudget,
    categoryBudgets: applyHydrationRecordDelta(server.categoryBudgets ?? {}, baseline.categoryBudgets ?? {}, current.categoryBudgets ?? {}),
  };
}

const connectorLaunchTargets: Record<string, { label: string; url: string }> = {
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

// Workspace information architecture — the ordered chapters of the review.
// Drives the sticky section index (table of contents) and the scroll-spy state.
const workspaceSections = [
  { id: "overview", folio: "01", label: "Home", title: "Home", note: "Burn, next renewal, and one action." },
  { id: "ledger", folio: "02", label: "Subscriptions", title: "Subscriptions", note: "Every recurring payment and its proof." },
  { id: "connect", folio: "03", label: "Connect", title: "Connect", note: "Add fresh evidence with revocable access." },
  { id: "review", folio: "04", label: "Review", title: "Review", note: "Decisions, notes, and verified outcomes." },
  { id: "data", folio: "05", label: "Data", title: "Data", note: "Storage, exports, and readiness." },
] as const;

const workspaceSectionIds = workspaceSections.map((section) => section.id);
const primaryWorkspaceSections = workspaceSections.slice(0, 3);
const secondaryWorkspaceSections = workspaceSections.slice(3);
type WorkspaceSectionId = (typeof workspaceSections)[number]["id"];

export default function VognaryMvpClient() {
  const [statementSources, setStatementSources] = useState<StatementFile[]>([]);
  const [manualItems, setManualItems] = useState<ManualRecurringInput[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [userActions, setUserActions] = useState<Record<string, RecommendationType>>({});
  const [actionsMeta, setActionsMeta] = useState<Record<string, ActionMeta>>({});
  const [mergeDecisions, setMergeDecisions] = useState<Record<string, MergeDecision>>({});
  const [lastReview, setLastReview] = useState<ReviewSnapshot | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmRequest | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const undoSnapshotRef = useRef<WorkspaceBackup | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const [itemOwners, setItemOwners] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([{ id: "founder", name: "You", role: "Owner" }]);
  const [memberDraft, setMemberDraft] = useState({ name: "", role: "Finance / Ops" });
  const [receiptText, setReceiptText] = useState("");
  const [reviewCompletedAt, setReviewCompletedAt] = useState<string | null>(null);
  const [localSaveEnabled, setLocalSaveEnabled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverSession, setServerSession] = useState<ServerSessionPayload | null>(null);
  const [serverSaveStatus, setServerSaveStatus] = useState<string | null>(null);
  const [serverWorkspaceHydrated, setServerWorkspaceHydrated] = useState(false);
  const [serverSaveRetry, setServerSaveRetry] = useState(0);
  const [connectorStartResults, setConnectorStartResults] = useState<Record<string, ConnectorStartPayload>>({});
  const [merchantLinks, setMerchantLinks] = useState<string[]>([]);
  const [monthlyBudget, setMonthlyBudget] = useState<number | null>(null);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const [aaVuaDraft, setAaVuaDraft] = useState("");
  const [connectingConnectorId, setConnectingConnectorId] = useState<string | null>(null);
  const [syncingConnectorId, setSyncingConnectorId] = useState<string | null>(null);
  const [serverConnectors, setServerConnectors] = useState<WorkspaceConnectorStatusPayload | null>(null);
  const [serverDecisions, setServerDecisions] = useState<ServerCommitmentDecision[]>([]);
  const [serverCommitments, setServerCommitments] = useState<ServerRecurringItem[]>([]);
  const [serverActionCases, setServerActionCases] = useState<ServerActionCase[]>([]);
  const [conciergeAvailable, setConciergeAvailable] = useState(false);
  const [conciergeBusy, setConciergeBusy] = useState(false);
  const [authorizationRequest, setAuthorizationRequest] = useState<{ actionCase: ServerActionCase; preview: AuthorizationPreview } | null>(null);
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType>("personal");
  const [workspaceTypeSaving, setWorkspaceTypeSaving] = useState(false);
  const [proofQuestion, setProofQuestion] = useState("What is my total recurring spend?");
  const [proofAnswer, setProofAnswer] = useState<CitedProofAnswer | null>(null);
  const [proofQuestionBusy, setProofQuestionBusy] = useState(false);
  const [disconnectedConnectorIds, setDisconnectedConnectorIds] = useState<string[]>([]);
  const [mobileSection, setMobileSection] = useState<WorkspaceSectionId>("overview");
  const [emptyOnboardingChoice, setEmptyOnboardingChoice] = useState<"connect" | "paste" | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [installPromptAvailable, setInstallPromptAvailable] = useState(false);
  const [connectorReturn, setConnectorReturn] = useState<{ label: string; connectorId: string } | null>(null);
  const [syncCelebration, setSyncCelebration] = useState<SyncCelebration | null>(null);
  const [nakulMoment, setNakulMoment] = useState<NakulMoment | null>(null);
  const activationEventSent = useRef(false);
  const ledgerViewEventSent = useRef(false);
  const serverRevisionRef = useRef<number | null>(null);
  const lastServerSnapshotRef = useRef<string | null>(null);
  const serverSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const serverSyncGenerationRef = useRef(0);
  const guestTransferImportedRef = useRef(false);
  const guestTransferPendingSyncRef = useRef(false);
  const guestTransferSnapshotRef = useRef<GuestAuditSnapshot | null>(null);
  const emptyOnboardingRoutedRef = useRef(false);
  const serverSaveRetryCountRef = useRef(0);
  const serverSaveRetryTimerRef = useRef<number | null>(null);
  const latestWorkspaceStateRef = useRef<HydrationWorkspaceState | null>(null);
  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  latestWorkspaceStateRef.current = {
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
    merchantLinks,
    selectedItemId,
    monthlyBudget,
    categoryBudgets,
  };

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      installPromptRef.current = event as BeforeInstallPromptEvent;
      setInstallPromptAvailable(window.sessionStorage.getItem("vognary.install-prompt-dismissed") !== "1");
    };
    const installed = () => {
      installPromptRef.current = null;
      setInstallPromptAvailable(false);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("aa") !== "returned") return;
    let cancelled = false;
    let timer: number | null = null;
    let attempts = 0;
    url.searchParams.delete("aa");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    queueMicrotask(() => {
      if (cancelled) return;
      setConnectorReturn({ label: "Bank connection", connectorId: "account-aggregator" });
      setNotice("Bank approval returned. Confirming consent and waiting for the first evidence sync…");
    });
    const poll = async () => {
      const payload = await fetchWorkspaceConnectors();
      if (cancelled) return;
      setServerConnectors(payload);
      const account = getServerAccount(payload, "account-aggregator");
      if (account?.status === "active" && payload.recurringItems?.length) return;
      if (account?.status === "active" && ["completed", "succeeded", "success"].includes(account.latestRunStatus ?? "")) {
        setConnectorReturn(null);
        setNotice("Bank connection is active. The first sync completed without enough evidence to prove a recurring payment yet.");
        return;
      }
      attempts += 1;
      if (attempts >= 10) {
        setConnectorReturn(null);
        setNotice("Bank approval returned and is still being confirmed. Connect shows the live pending state and will refresh automatically.");
        return;
      }
      timer = window.setTimeout(() => void poll(), 2_000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!connectorReturn || !serverConnectors?.recurringItems?.length) return;
    const returnedItems = serverConnectors.recurringItems.filter((item) => item.connectorIds.includes(connectorReturn.connectorId));
    if (!returnedItems.length) return;
    const monthlyTotals = returnedItems.reduce<Record<string, number>>((totals, item) => {
      totals[item.currency] = (totals[item.currency] ?? 0) + item.monthlyCost;
      return totals;
    }, {});
    queueMicrotask(() => {
      setSyncCelebration({
        rail: connectorReturn.label,
        count: returnedItems.length,
        monthlyTotals: Object.entries(monthlyTotals).sort(([left], [right]) => left.localeCompare(right)),
        merchants: returnedItems.slice().sort((left, right) => right.monthlyCost - left.monthlyCost).slice(0, 4).map((item) => item.merchant),
      });
      setConnectorReturn(null);
      setMobileSection("overview");
      const url = new URL(window.location.href);
      url.hash = "overview";
      window.history.replaceState(null, "", url);
    });
  }, [connectorReturn, serverConnectors?.recurringItems]);

  useEffect(() => {
    const updateHash = () => {
      const section = window.location.hash.slice(1);
      if (workspaceSectionIds.includes(section as WorkspaceSectionId)) {
        setMobileSection(section as WorkspaceSectionId);
      }
    };
    updateHash();
    window.addEventListener("hashchange", updateHash);
    return () => {
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
  const savingsReceipt = useMemo(() => buildSavingsReceipt(verifiedSavings), [verifiedSavings]);
  const selectedItem = audit.recurringItems.find((item) => item.identityKey === selectedItemId) ?? audit.recurringItems[0] ?? null;
  const detailItem = detailItemId ? audit.recurringItems.find((item) => item.identityKey === detailItemId) ?? null : null;
  const selectedServerRecurringItemId = selectedItem ? resolveServerCommitmentId(selectedItem, serverCommitments) : null;
  const selectedActionCase = selectedServerRecurringItemId
    ? serverActionCases.find((entry) => entry.recurringItemId === selectedServerRecurringItemId && !["withdrawn", "failed"].includes(entry.status)) ?? null
    : null;
  const hasRealData = allStatementSources.length > 0 || allManualItems.length > 0 || receiptText.trim().length > 0;
  useEffect(() => {
    if (!serverSession?.authenticated || !serverWorkspaceHydrated || hasRealData || emptyOnboardingRoutedRef.current) return;
    emptyOnboardingRoutedRef.current = true;
    if (window.location.hash) return;
    const url = new URL(window.location.href);
    url.hash = "connect";
    window.history.replaceState(null, "", url);
    queueMicrotask(() => setMobileSection("connect"));
  }, [hasRealData, serverSession?.authenticated, serverWorkspaceHydrated]);
  // WP-2.2 — a sample workspace is one whose only evidence is the shared demo
  // text (no real statements or manual items). Content-derived, so the banner
  // survives reload without a persisted flag.
  const sampleWorkspace = allStatementSources.length === 0 && allManualItems.length === 0 && isSampleReceiptText(receiptText);
  const seedSampleWorkspace = () => {
    setReceiptText(sampleReceiptText);
    setNotice("Sample audit loaded — eight example subscriptions. This is demo data, not yours; clear it anytime.");
  };
  const clearSampleWorkspace = () => {
    setReceiptText("");
    setEmptyOnboardingChoice(null);
    setNotice("Sample audit cleared. Add your own evidence to build a real ledger.");
  };
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
  useEffect(() => {
    if (typeof window === "undefined" || window.sessionStorage.getItem(nakulMomentSessionKey)) return;
    if (serverSession?.authenticated && !serverConnectors) return;
    const ids: NakulMomentId[] = ["first-sync", "savings-minted", "budget-breach", "first-evidence"];
    const seen = new Set(ids.filter((id) => window.localStorage.getItem(`${nakulMomentSeenPrefix}${id}`) === "1"));
    const moment = selectNakulMoment({
      firstSync: Boolean(syncCelebration || (connectorReturn && syncedRecurringItems.length)),
      savingsMinted: verifiedSavings.verifiedAnnual > 0,
      budgetBreach: monthlyBudget !== null && audit.summary.monthlyRecurringSpend > monthlyBudget,
      firstEvidence: audit.summary.recurringCount > 0,
    }, seen);
    if (!moment) return;
    window.sessionStorage.setItem(nakulMomentSessionKey, moment.id);
    window.localStorage.setItem(`${nakulMomentSeenPrefix}${moment.id}`, "1");
    if (moment.id !== "first-sync") queueMicrotask(() => setNakulMoment(moment));
  }, [audit.summary.monthlyRecurringSpend, audit.summary.recurringCount, connectorReturn, monthlyBudget, serverConnectors, serverSession?.authenticated, syncCelebration, syncedRecurringItems.length, verifiedSavings.verifiedAnnual]);
  const connectedConnectorIds = useMemo(() => {
    return resolveConnectedConnectorIds(
      connectorStartResults,
      serverConnectors?.accounts ?? [],
      disconnectedConnectorIds,
    );
  }, [connectorStartResults, disconnectedConnectorIds, serverConnectors]);
  const persistFailureNotified = useRef(false);
  useEffect(() => {
    if (!localSaveEnabled || typeof window === "undefined") return;
    const backup = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText, actionsMeta, mergeDecisions, lastReview, reviewCompletedAt, merchantLinks, monthlyBudget, categoryBudgets });
    const saved = safePersist(workspaceStorageKey, JSON.stringify(backup));
    if (!saved && !persistFailureNotified.current) {
      persistFailureNotified.current = true;
      setNotice("Browser storage is full — the on-device save is NOT updating. Export a sealed audit pack now, then remove an old statement source.");
    }
    if (saved) persistFailureNotified.current = false;
  }, [actionsMeta, categoryBudgets, itemOwners, lastReview, localSaveEnabled, manualItems, merchantLinks, mergeDecisions, monthlyBudget, receiptText, reviewCompletedAt, reviewNotes, statementSources, teamMembers, userActions]);

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
    const hydrationBaseline = latestWorkspaceStateRef.current;
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
        const current = latestWorkspaceStateRef.current;
        const merged = hydrationBaseline && current
          ? mergeWorkspaceHydration(restored, hydrationBaseline, current)
          : restored;
        setStatementSources(merged.statementSources);
        setManualItems(merged.manualItems);
        setUserActions(merged.userActions ?? {});
        setActionsMeta(merged.actionsMeta ?? {});
        setMergeDecisions(merged.mergeDecisions ?? {});
        setItemOwners(merged.itemOwners ?? {});
        setReviewNotes(merged.reviewNotes ?? {});
        setTeamMembers(merged.teamMembers?.length ? merged.teamMembers : [{ id: "founder", name: "Founder", role: "Owner" }]);
        setReceiptText(merged.receiptText ?? "");
        setLastReview(merged.lastReview ?? null);
        setReviewCompletedAt(merged.reviewCompletedAt ?? null);
        setMerchantLinks(sanitizeMerchantLinks(merged.merchantLinks));
        setMonthlyBudget(sanitizeBudget(merged.monthlyBudget));
        setCategoryBudgets(sanitizeCategoryBudgets(merged.categoryBudgets));
        setSelectedItemId(current?.selectedItemId === hydrationBaseline?.selectedItemId ? null : current?.selectedItemId ?? null);
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
    const currentWorkspace = latestWorkspaceStateRef.current;
    if (currentWorkspace) {
      const currentSnapshot = buildWorkspaceBackup({
        ...currentWorkspace,
        receiptText: currentWorkspace.receiptText ?? "",
        monthlyBudget: currentWorkspace.monthlyBudget,
        categoryBudgets: currentWorkspace.categoryBudgets,
      });
      if (workspaceContainsGuestTransfer(currentSnapshot, guest)) {
        window.sessionStorage.removeItem(guestAuditTransferKey);
        guestTransferSnapshotRef.current = null;
        setNotice(buildGuestTransferNotice(guest));
        return;
      }
    }
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
      merchantLinks,
      monthlyBudget,
      categoryBudgets,
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
    categoryBudgets,
    itemOwners,
    lastReview,
    manualItems,
    merchantLinks,
    mergeDecisions,
    monthlyBudget,
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
        setServerCommitments([]);
        setServerActionCases([]);
        setConciergeAvailable(false);
        setWorkspaceType("personal");
        setProofAnswer(null);
        return;
      }

      const [connectorPayload, decisionPayload, workspacePayload, commitmentPayload, actionPayload] = await Promise.all([
        fetchWorkspaceConnectors(),
        fetchWorkspaceDecisions(),
        fetchCurrentWorkspace(),
        fetchWorkspaceCommitments(),
        fetchWorkspaceActions(),
      ]);
      if (!ignore) {
        setServerConnectors(connectorPayload);
        setServerDecisions(decisionPayload.decisions ?? []);
        setServerCommitments(commitmentPayload.commitments ?? []);
        setServerActionCases(actionPayload.actionCases ?? []);
        setConciergeAvailable(Boolean(actionPayload.concierge?.available));
        setWorkspaceType(workspacePayload.workspace?.workspaceType ?? "personal");
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
        if (gmailOutcome === "connected" || gmailOutcome === "sync-pending") setConnectorReturn({ label: "Gmail connection", connectorId: "gmail-readonly" });
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

  const workspaceNavSection = mobileSection;

  function navigateToSection(id: WorkspaceSectionId) {
    setMobileSection(id);
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, "", url);
    window.setTimeout(() => scrollIntoViewWithMotion(document.getElementById(id), { block: "start" }), 0);
  }

  async function requestPwaInstall() {
    const prompt = installPromptRef.current;
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    installPromptRef.current = null;
    setInstallPromptAvailable(false);
    setNotice(choice.outcome === "accepted" ? "Vognary was added to this device." : "Install dismissed. You can still use the full workspace in this browser.");
  }

  function dismissPwaInstall() {
    window.sessionStorage.setItem("vognary.install-prompt-dismissed", "1");
    setInstallPromptAvailable(false);
  }

  // Universal search — every section, ledger item, action, source, and page
  // reachable from one field.
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = workspaceSections.map((section) => ({
      id: `section-${section.id}`,
      group: "Go to",
      label: section.title,
      hint: section.folio,
      keywords: `${section.label} ${section.note}`,
      run: () => navigateToSection(section.id),
    }));
    for (const item of audit.recurringItems) {
      items.push({
        id: `ledger-${item.identityKey}`,
        group: "Ledger",
        label: item.merchant,
        hint: formatCurrency(item.averageAmount, item.currency),
        keywords: `${item.category} ${item.normalizedMerchant} ${item.frequency}`,
        run: () => selectAndReviewItem(item.identityKey),
      });
    }
    items.push(
      { id: "action-export-pack", group: "Actions", label: "Export audit pack (JSON)", keywords: "download proof report", run: () => void exportReport() },
      { id: "action-export-csv", group: "Actions", label: "Export ledger CSV", keywords: "download spreadsheet", run: () => exportCsv() },
      { id: "action-export-pdf", group: "Actions", label: "Export PDF report", keywords: "download print", run: () => void exportPdf() },
      { id: "action-mint-receipt", group: "Actions", label: "Mint savings receipt", keywords: "verified savings proof share seal", run: () => void mintSavingsReceipt() },
      { id: "action-share-card", group: "Actions", label: "Download savings share card", keywords: "png image social post verified", run: () => void downloadSavingsCard() },
      { id: "action-clear", group: "Actions", label: "Clear this workspace", keywords: "delete reset remove", run: () => requestClearWorkspace() },
    );
    for (const connector of connectors) {
      items.push({
        id: `source-${connector.id}`,
        group: "Sources",
        label: connector.name,
        hint: connectorStatusLabels[connector.status],
        keywords: `${connector.category} connect link integration`,
        run: () => {
          navigateToSection("connect");
        },
      });
    }
    items.push(
      { id: "page-guide", group: "Pages", label: "How Vognary works — guide", keywords: "help onboarding manual how to start", run: () => { window.location.href = "/guide"; } },
      { id: "page-sources", group: "Pages", label: "Source health", keywords: "connections freshness", run: () => { window.location.href = "/sources"; } },
      { id: "page-profile", group: "Pages", label: "Profile & data controls", keywords: "account privacy delete export", run: () => { window.location.href = "/profile"; } },
      { id: "page-verify", group: "Pages", label: "Verify an audit pack", keywords: "checksum signature proof", run: () => { window.location.href = "/verify"; } },
      { id: "page-security", group: "Pages", label: "Security & trust", keywords: "encryption privacy readiness", run: () => { window.location.href = "/security"; } },
    );
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit.recurringItems]);

  function selectAndReviewItem(itemId?: string) {
    if (itemId) setSelectedItemId(itemId);
    setMobileSection("ledger");
    if (serverSession?.authenticated && !ledgerViewEventSent.current && audit.recurringItems.length) {
      ledgerViewEventSent.current = true;
      void trackProductEvent("ledger.viewed", { commitmentsTouched: audit.recurringItems.length });
    }
    window.setTimeout(() => scrollIntoViewWithMotion(document.getElementById("recurring-ledger"), { block: "start" }), 0);
  }

  // Tapping any subscription/renewal/priority card opens the detail sheet in
  // place (proof + history + Keep/Watch/Cancel) without leaving the current
  // screen. selectedItemId stays in sync so the inline deep-dive and the
  // assisted-cancel flow reference the same item when the sheet is dismissed.
  function openDetail(itemId: string) {
    setSelectedItemId(itemId);
    setDetailItemId(itemId);
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
    setTeamMembers(backup.teamMembers?.length ? backup.teamMembers : [{ id: "founder", name: "You", role: "Owner" }]);
    setReceiptText(backup.receiptText ?? "");
    setLastReview(backup.lastReview ?? null);
    setReviewCompletedAt(backup.reviewCompletedAt ?? null);
    setMerchantLinks(sanitizeMerchantLinks(backup.merchantLinks));
    setMonthlyBudget(sanitizeBudget(backup.monthlyBudget));
    setCategoryBudgets(sanitizeCategoryBudgets(backup.categoryBudgets));
  }

  // Destructive actions are confirmed first and undoable for 30 seconds after.
  function offerUndo() {
    undoSnapshotRef.current = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText, actionsMeta, mergeDecisions, lastReview, reviewCompletedAt, merchantLinks, monthlyBudget, categoryBudgets });
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
        setMerchantLinks([]);
        setMonthlyBudget(null);
        setCategoryBudgets({});
        setNotice("Workspace cleared. This browser has no audit data now.");
      },
    });
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
      recurringItems: audit.recurringItems.map((item) => {
        const effectiveAction = userActions[item.identityKey] ?? item.recommendationType;
        return {
          ...item,
          evidence: item.evidence.map((link) => ({ ...link, description: redactText(link.description).text })),
          userAction: effectiveAction,
          owner: getOwnerName(itemOwners[item.identityKey], teamMembers),
          reviewNote: reviewNotes[item.identityKey] ?? "",
          cancelPath: findActionableCancelAction(item.merchant, item.category, effectiveAction),
        };
      }),
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
    const header = ["Merchant", "Category", "Currency", "Frequency", "Monthly cost", "Average amount", "Next expected", "Confidence", "Action", "Cancel path", "Owner", "Note", "Sources"];
    const rows = audit.recurringItems.map((item) => {
      const action = userActions[item.identityKey] ?? item.recommendationType;
      const cancelPath = findActionableCancelAction(item.merchant, item.category, action);
      return [
        item.merchant,
        item.category,
        item.currency,
        item.frequency,
        Math.round(item.monthlyCost),
        Math.round(item.averageAmount),
        item.nextExpectedDate,
        item.confidenceScore,
        action,
        cancelPath ? cancelPath.manageUrl ?? cancelPath.steps[0] : "",
        getOwnerName(itemOwners[item.identityKey], teamMembers),
        reviewNotes[item.identityKey] ?? "",
        item.sourceNames.join("; "),
      ];
    });
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
        const cancelPath = findActionableCancelAction(item.merchant, item.category, action);
        if (cancelPath) {
          const target = cancelPath.manageUrl ? `${manageUrlHostname(cancelPath)} — ` : "";
          line(`   Action path: ${target}${cancelPath.steps[0]}`, 9, 13);
        }
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

  // Verified Savings receipts — the shareable, checkable proof artifact.
  async function mintSavingsReceipt() {
    const receipt = savingsReceipt;
    if (!receipt) {
      setNotice("No verified savings to mint yet. Mark a cancel or downgrade, then let the next expected debits pass clean inside covered evidence.");
      return;
    }
    try {
      const { downloadable, chain, issuerSigned } = await prepareSealedSavingsReceipt(receipt);
      savePackChain(chain);
      triggerBlobDownload(
        new Blob([JSON.stringify(downloadable, null, 2)], { type: "application/json" }),
        `vognary-savings-receipt-${chain.chainIndex}.json`,
      );
      if (serverSession?.authenticated) void trackProductEvent("export.created", { commitmentsTouched: receipt.verifiedCount });
      setNotice(issuerSigned
        ? `Savings receipt #${chain.chainIndex} minted with an offline checksum and a Vognary issuer signature — anyone can check it at /verify.`
        : `Savings receipt #${chain.chainIndex} minted with an offline self-checksum; /verify explains what that level proves.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not mint the savings receipt in this browser.");
    }
  }

  async function downloadSavingsCard() {
    const receipt = savingsReceipt;
    if (!receipt) {
      setNotice("The share card unlocks with your first verified saving — a cancel proven clean across its expected debits.");
      return;
    }
    try {
      const card = await renderSavingsCard(receipt);
      triggerBlobDownload(card.blob, card.fileName);
      setNotice(`Share card downloaded as ${card.fileName.endsWith(".png") ? "PNG" : "SVG"}. The number on it comes from the verified receipt.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not render the savings share card.");
    }
  }

  async function copySavingsShareText() {
    const receipt = savingsReceipt;
    if (!receipt) {
      setNotice("Share text unlocks with your first verified saving.");
      return;
    }
    const text = buildSavingsShareText(receipt);
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Share text copied. Post it with the card; the receipt backs the number.");
    } catch {
      setNotice(text);
    }
  }

  async function shareSavingsProof() {
    const receipt = savingsReceipt;
    if (!receipt) {
      setNotice("Sharing unlocks with your first verified saving.");
      return;
    }

    try {
      const [{ downloadable, chain, issuerSigned }, card] = await Promise.all([
        prepareSealedSavingsReceipt(receipt),
        renderSavingsCard(receipt),
      ]);
      const receiptFile = new File(
        [JSON.stringify(downloadable, null, 2)],
        `vognary-savings-receipt-${chain.chainIndex}.json`,
        { type: "application/json" },
      );
      const cardFile = new File([card.blob], card.fileName, { type: card.blob.type });
      const text = buildSavingsShareText(receipt);
      const files = [cardFile, receiptFile];
      const canShareFiles = typeof navigator.share === "function"
        && (typeof navigator.canShare !== "function" || navigator.canShare({ files }));

      if (canShareFiles) {
        try {
          await navigator.share({ title: "Vognary verified savings", text, files });
          savePackChain(chain);
          if (serverSession?.authenticated) void trackProductEvent("export.created", { commitmentsTouched: receipt.verifiedCount });
          setNotice(`Savings proof shared with the card and ${issuerSigned ? "issuer-signed" : "self-checksummed"} receipt.`);
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            setNotice("Sharing cancelled. Your verified savings remain ready.");
            return;
          }
        }
      }

      savePackChain(chain);
      triggerBlobDownload(card.blob, card.fileName);
      triggerBlobDownload(receiptFile, receiptFile.name);
      try {
        await navigator.clipboard.writeText(text);
        setNotice("This browser cannot share files directly, so the card and receipt were downloaded and the verified share text was copied.");
      } catch {
        setNotice("This browser cannot share files directly, so the card and receipt were downloaded. Use the receipt to back the number on the card.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not prepare the savings proof for sharing.");
    }
  }

  async function prepareSealedSavingsReceipt(receipt: NonNullable<typeof savingsReceipt>) {
    const { sealed, chain } = await sealAuditPack(receipt as unknown as Record<string, unknown>, loadPackChain());
    let downloadable = sealed;
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
          downloadable = attachIssuerSignature(sealed, payload.issuerSignature);
          issuerSigned = true;
        }
      } catch {
        // Offline checksum receipts remain useful without the issuer signature.
      }
    }
    return { downloadable, chain, issuerSigned };
  }

  async function renderSavingsCard(receipt: NonNullable<typeof savingsReceipt>) {
    const svgBlob = new Blob([buildSavingsCardSvg(receipt)], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("SVG rasterization failed"));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 2400;
      canvas.height = 1260;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!pngBlob) throw new Error("PNG encoding failed");
      return { blob: pngBlob, fileName: "vognary-savings-card.png" };
    } catch {
      return { blob: svgBlob, fileName: "vognary-savings-card.svg" };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function saveServerWorkspace() {
    if (!serverSession?.authenticated) {
      setNotice("Sign in before saving an encrypted server snapshot.");
      return;
    }

    const generation = serverSyncGenerationRef.current;
    setServerSaveStatus("Synchronizing encrypted workspace state...");
    const snapshot = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText, actionsMeta, mergeDecisions, lastReview, reviewCompletedAt, merchantLinks, monthlyBudget, categoryBudgets });
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
      setNotice(buildGuestTransferNotice(guest));
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
    const backup = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText, actionsMeta, mergeDecisions, lastReview, reviewCompletedAt, merchantLinks, monthlyBudget, categoryBudgets });
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

        setNotice(payload.availability === "company-activation-pending" || payload.requiredEnv?.length
          ? "Email connection is not available yet. Vognary is completing the provider approval and company setup; no technical setup is required from you."
          : payload.message ?? payload.error ?? "Email connection could not be started.");
        return;
      }

      const response = await fetch(`/api/connectors/${connector.id}/start`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as ConnectorStartPayload;
      setConnectorStartResults((current) => ({ ...current, [connector.id]: payload }));

      openOfficialConnectorTarget(connector.id);
      setNotice(payload.availability === "company-activation-pending" || payload.missingEnv?.length
        ? `${connector.name} is not available yet. Vognary is completing the company-side provider setup.`
        : `${connector.name} connection started through the official provider path.`);
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

  function linkMerchantTile(tile: ConnectTile) {
    setMerchantLinks((current) => current.includes(tile.id) ? current : [...current, tile.id]);
    const matches = matchTileItems(tile, audit.recurringItems);
    const railsLive = connectedConnectorIds.has("gmail-readonly") || connectedConnectorIds.has("account-aggregator");
    setNotice(matches.length
      ? `${tile.name} watch added. ${matches.length} matching commitment(s) are already in your ledger.`
      : railsLive
        ? `${tile.name} watch added. Matching evidence can appear as your connected rails sync.`
        : `${tile.name} watch added. Connect the email or bank rail so matching evidence can arrive.`);
  }

  function unlinkMerchantTile(tile: ConnectTile) {
    setMerchantLinks((current) => current.filter((id) => id !== tile.id));
    setNotice(`${tile.name} watch removed. Evidence already in the ledger stays until you clear it.`);
  }

  async function startBankRail() {
    setConnectingConnectorId("account-aggregator");
    try {
      if (!serverSession?.authenticated) {
        setNotice("Sign in before linking bank data so the consent belongs to your workspace.");
        return;
      }
      const vua = aaVuaDraft.trim();
      if (!vua) {
        setNotice("Add your Account Aggregator handle first (for example 9999999999@onemoney). It identifies your account — it is not a password.");
        return;
      }
      const response = await fetch("/api/integrations/aa/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vua }),
      });
      const payload = await response.json().catch(() => ({})) as ConnectorStartPayload & { approvalUrl?: string | null };
      setConnectorStartResults((current) => ({ ...current, "account-aggregator": payload }));

      if (!response.ok) {
        setNotice(payload.availability === "company-activation-pending" || payload.requiredEnv?.length
          ? "Bank connection is not available yet. Vognary is completing the regulated provider agreement and company setup; no technical setup is required from you."
          : payload.message ?? payload.error ?? "The bank consent could not be started.");
        return;
      }

      setAaVuaDraft("");
      await refreshWorkspaceConnectors();
      if (payload.approvalUrl) window.location.assign(payload.approvalUrl);
      setNotice(payload.message ?? "Review and approve the request in the Account Aggregator flow. The source stays pending until approval is confirmed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The bank consent could not be started.");
    } finally {
      setConnectingConnectorId(null);
    }
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

  async function changeWorkspaceType(nextType: WorkspaceType) {
    if (!serverSession?.authenticated || workspaceTypeSaving || nextType === workspaceType) return;
    setWorkspaceTypeSaving(true);
    try {
      const response = await fetch("/api/workspaces/current", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `workspace-type:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ workspaceType: nextType }),
      });
      const payload = await response.json().catch(() => ({})) as WorkspaceProfilePayload & { error?: string };
      if (!response.ok || !payload.workspace) {
        setNotice(payload.error ?? "Workspace mode could not be updated.");
        return;
      }
      setWorkspaceType(payload.workspace.workspaceType);
      setNotice(`Workspace adapted for ${workspaceTypeLabel(payload.workspace.workspaceType).toLowerCase()} reviews.`);
    } catch {
      setNotice("Workspace mode could not be updated. Your current layout is unchanged.");
    } finally {
      setWorkspaceTypeSaving(false);
    }
  }

  async function startConciergeAction(item: RecurringItem, action: "cancel" | "downgrade") {
    if (!serverSession?.authenticated || !serverSession.session?.workspaceId) {
      setNotice("Sign in before asking Vognary to execute an action so authorization and proof stay bound to your workspace.");
      return;
    }
    setConciergeBusy(true);
    try {
      let commitments = serverCommitments;
      let recurringItemId = resolveServerCommitmentId(item, commitments);
      if (!recurringItemId) {
        await saveServerWorkspace();
        const refreshed = await fetchWorkspaceCommitments();
        commitments = refreshed.commitments ?? [];
        setServerCommitments(commitments);
        recurringItemId = resolveServerCommitmentId(item, commitments);
      }
      if (!recurringItemId) {
        setNotice("Vognary could not bind this item to a durable proof node yet. Add fresh evidence or sync the workspace, then retry.");
        return;
      }
      const response = await fetch("/api/workspaces/current/actions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `action-case:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ recurringItemId, action }),
      });
      const payload = await response.json().catch(() => ({})) as WorkspaceActionsPayload;
      if (!response.ok || !payload.actionCase || !payload.authorizationPreview) {
        if (response.status === 501) setConciergeAvailable(false);
        setNotice(payload.message ?? payload.error ?? "The action case could not be opened.");
        return;
      }
      setServerActionCases((current) => [payload.actionCase as ServerActionCase, ...current.filter((entry) => entry.id !== payload.actionCase?.id)]);
      setAuthorizationRequest({ actionCase: payload.actionCase, preview: payload.authorizationPreview });
      setNotice("Action case created. Review the exact one-commitment authorization before Vognary can begin.");
    } catch {
      setNotice("The action case could not reach the server. Nothing was authorized or executed.");
    } finally {
      setConciergeBusy(false);
    }
  }

  async function authorizeConciergeAction() {
    if (!authorizationRequest || conciergeBusy) return;
    setConciergeBusy(true);
    try {
      const response = await fetch(`/api/workspaces/current/actions/${authorizationRequest.actionCase.id}/authorize`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `action-authorization:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ accepted: true, termsVersion: authorizationRequest.preview.termsVersion }),
      });
      const payload = await response.json().catch(() => ({})) as WorkspaceActionsPayload;
      if (!response.ok || !payload.actionCase) {
        setNotice(payload.error ?? "Authorization could not be recorded. No action has started.");
        return;
      }
      setServerActionCases((current) => [payload.actionCase as ServerActionCase, ...current.filter((entry) => entry.id !== payload.actionCase?.id)]);
      setAuthorizationRequest(null);
      setNotice("Authorization recorded. Vognary can now accept this one action; every transition will remain visible here.");
    } catch {
      setNotice("Authorization could not reach the server. No action has started.");
    } finally {
      setConciergeBusy(false);
    }
  }

  async function customerTransitionActionCase(actionCaseId: string, status: "withdrawn" | "disputed") {
    if (conciergeBusy) return;
    setConciergeBusy(true);
    try {
      const response = await fetch(`/api/workspaces/current/actions/${actionCaseId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `action-${status}:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({})) as WorkspaceActionsPayload;
      if (!response.ok || !payload.actionCase) {
        setNotice(payload.error ?? `The action case could not be ${status}.`);
        return;
      }
      setServerActionCases((current) => [payload.actionCase as ServerActionCase, ...current.filter((entry) => entry.id !== payload.actionCase?.id)]);
      setNotice(status === "withdrawn" ? "Action authorization withdrawn." : "Receipt and fee marked disputed for review.");
    } catch {
      setNotice("The action-case update could not reach the server.");
    } finally {
      setConciergeBusy(false);
    }
  }

  async function askProofGraph(question = proofQuestion) {
    const normalized = question.trim();
    if (!serverSession?.authenticated) {
      setNotice("Sign in to ask the protected Proof Graph. Guest evidence stays in this browser and is never sent implicitly.");
      return;
    }
    if (proofQuestionBusy || normalized.length < 3) return;
    setProofQuestion(normalized);
    setProofQuestionBusy(true);
    try {
      const response = await fetch("/api/workspaces/current/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: normalized }),
      });
      const payload = await response.json().catch(() => ({})) as { answer?: CitedProofAnswer; error?: string };
      if (!response.ok || !payload.answer) {
        setNotice(payload.error ?? "The Proof Graph could not answer that question.");
        return;
      }
      setProofAnswer(payload.answer);
    } catch {
      setNotice("The Proof Graph could not be reached. No answer was generated.");
    } finally {
      setProofQuestionBusy(false);
    }
  }

  function openProofCitation(entityId: string | null) {
    if (!entityId) return;
    const item = audit.recurringItems.find((candidate) => candidate.canonicalRecurringItemId === entityId);
    if (!item) {
      setNotice("That proof entity is in the server ledger but is not materialized in this browser yet. Refresh the workspace to open it.");
      return;
    }
    selectAndReviewItem(item.identityKey);
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
    <main id="ledger-main" className="relative px-4 pb-24 pt-3 text-foreground sm:px-6 sm:pb-12 sm:pt-4 lg:pl-[264px] lg:pr-8">
      <h1 className="sr-only">Vognary recurring money workspace</h1>
      <WorkspaceSidebar
        sections={primaryWorkspaceSections}
        moreSections={hasRealData ? secondaryWorkspaceSections : []}
        activeId={workspaceNavSection}
        counts={{
          connect: connectedConnectorIds.size,
          ledger: audit.recurringItems.length,
          review: audit.recurringItems.filter((item) => !userActions[item.identityKey]).length,
        }}
        watching={audit.recurringItems.length}
        signedIn={Boolean(serverSession?.authenticated)}
        onNavigate={(id) => navigateToSection(id as WorkspaceSectionId)}
        onOpenSearch={() => setPaletteOpen(true)}
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={paletteItems} />
      <GlobalNotice
        notice={notice}
        onDismiss={() => setNotice(null)}
        action={undoAvailable ? { label: "Undo", onClick: undoLastDestructiveAction } : undefined}
      />
      <OfflineBanner />
      {syncCelebration ? (
        <div className="fixed inset-0 z-70 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="sync-celebration-heading">
          <section className="panel w-full max-w-xl overflow-hidden">
            <div className="dossier flex items-center gap-4 p-5 sm:p-6">
              <Nakul pose="found" size={72} className="shrink-0 text-(--dossier-ink)" title="Nakul found recurring payments" />
              <div>
                <p className="eyebrow muted-on-dark">First sync complete</p>
                <h2 id="sync-celebration-heading" className="mt-2 font-display text-2xl font-semibold text-(--dossier-ink)">
                  Found {syncCelebration.count} recurring payment{syncCelebration.count === 1 ? "" : "s"}
                </h2>
                <p className="mt-1 text-sm muted-on-dark">{syncCelebration.rail} supplied the evidence. Every result opens back to its proof.</p>
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <div className="grid gap-2 sm:grid-cols-2">
                {syncCelebration.monthlyTotals.map(([currency, total]) => (
                  <div key={currency} className="inset p-3">
                    <p className="eyebrow">Monthly burn · {currency}</p>
                    <p className="font-data mt-2 text-2xl font-semibold tnum text-(--ink)">{formatCurrency(total, currency)}/mo</p>
                  </div>
                ))}
                <div className="inset p-3">
                  <p className="eyebrow">Largest finds</p>
                  <p className="mt-2 text-sm leading-6 text-(--ink)">{syncCelebration.merchants.join(" · ")}</p>
                </div>
              </div>
              <button type="button" autoFocus onClick={() => setSyncCelebration(null)} className="btn btn-primary mt-5 w-full">Continue to Home</button>
            </div>
          </section>
        </div>
      ) : null}
      {detailItem ? (
        <SubscriptionDetailSheet
          item={detailItem}
          action={userActions[detailItem.identityKey] ?? detailItem.recommendationType}
          onAction={(action) => recordAction(detailItem.identityKey, action)}
          onOpenFullReview={() => {
            const target = detailItem.identityKey;
            setDetailItemId(null);
            selectAndReviewItem(target);
          }}
          onClose={() => setDetailItemId(null)}
        />
      ) : null}
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
              <TickerStat label={`Monthly · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.monthlyRecurringSpend, audit.summary.primaryCurrency)} tone="ember" onClick={() => navigateToSection("ledger")} />
              <TickerStat label={`Yearly · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.annualRecurringSpend, audit.summary.primaryCurrency)} tone="paper" onClick={() => navigateToSection("ledger")} />
              <TickerStat label={`Review · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.reviewableMonthlySpend, audit.summary.primaryCurrency)} tone="ochre" onClick={() => navigateToSection("ledger")} />
              <TickerStat label="Renewals in 10d" value={`${audit.summary.renewalsNextTenDays}`} tone="paper" onClick={() => navigateToSection("ledger")} />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {serverSession?.authenticated ? (
                <label className="hidden items-center gap-2 xl:flex">
                  <span className="sr-only">Workspace mode</span>
                  <select
                    value={workspaceType}
                    disabled={workspaceTypeSaving}
                    onChange={(event) => void changeWorkspaceType(event.target.value as WorkspaceType)}
                    className="h-9 rounded-lg border border-white/15 bg-white/6 px-2 font-data text-[0.64rem] uppercase tracking-[0.1em] text-(--dossier-ink) outline-none disabled:opacity-60"
                    aria-label="Workspace mode"
                  >
                    <option value="personal">Personal</option>
                    <option value="family">Family</option>
                    <option value="founder">Founder</option>
                    <option value="team">Team</option>
                  </select>
                </label>
              ) : null}
              <span className="live-dot" aria-hidden />
              <span className="hidden eyebrow muted-on-dark sm:inline" style={{ fontSize: "0.58rem" }}>{serverSession?.authenticated ? "Synced workspace" : "On this device"}</span>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="btn btn-ondark h-9 px-3 text-xs"
                aria-label="Open universal search"
              >
                Search <kbd className="ml-1 hidden rounded border border-white/15 px-1 font-data text-[0.58rem] sm:inline">⌘K</kbd>
              </button>
              <a href="/profile" className="btn btn-ondark h-9 px-3 text-xs">Profile</a>
            </div>
          </div>
          {audit.recurringItems.length ? (
            <div className="dossier glass hidden items-center px-5 py-2 lg:flex">
              <NextDebitTicker timeline={renewalTimeline} />
            </div>
          ) : null}
          <div className="lg:hidden">
            <WorkspaceNav activeId={workspaceNavSection} onSelect={navigateToSection} showMore={hasRealData} />
          </div>
        </div>
        {nakulMoment ? <NakulMomentPanel moment={nakulMoment} onDismiss={() => setNakulMoment(null)} /> : null}
        {sampleWorkspace ? (
          <div role="status" className="flex flex-col gap-2 rounded-xl border border-(--gold-line) bg-(--gold-tint) p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-(--ink)"><span className="font-semibold">Sample data.</span> These eight subscriptions are a demo, not your evidence — explore freely, then clear anytime.</p>
            <button type="button" onClick={clearSampleWorkspace} className="btn btn-ghost h-9 shrink-0 px-3 text-xs">Clear sample</button>
          </div>
        ) : null}

        {/* 00 · Overview — the five-second answer */}
        <section id="overview" aria-labelledby="overview-heading" className={`${mobileSection === "overview" ? "flex" : "hidden"} scroll-mt-36 flex-col gap-5`}>
          <StageHeader id="overview-heading" folio="01" title="Home" note="Monthly burn, next renewal, one action." />
          {audit.recurringItems.length ? <RenewalRadar timeline={renewalTimeline} onSelect={openDetail} onOpenSubscriptions={() => selectAndReviewItem()} /> : null}
          <OverviewPanel
            audit={audit}
            timeline={renewalTimeline}
            savings={verifiedSavings}
            proofGraph={proofGraph}
            priorityItems={priorityItems}
            userActions={userActions}
            hasRealData={hasRealData}
            reviewDiff={reviewDiff}
            monthlyBudget={monthlyBudget}
            categoryBudgets={categoryBudgets}
            sourceHealth={serverConnectors?.sourceHealth ?? []}
            onSelect={openDetail}
            onOpenSubscriptions={() => selectAndReviewItem()}
            onOpenConnect={() => navigateToSection("connect")}
            onMonthlyBudgetChange={setMonthlyBudget}
            onCategoryBudgetChange={(category, value) => {
              setCategoryBudgets((current) => {
                const next = { ...current };
                if (value === null) delete next[category];
                else next[category] = value;
                return next;
              });
            }}
            onExportPack={exportReport}
            onExportCsv={exportCsv}
            onExportPdf={exportPdf}
          />
          {hasRealData && installPromptAvailable ? (
            <section className="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Install Vognary">
              <div className="flex items-center gap-3">
                <Nakul pose="found" size={48} className="shrink-0 text-(--ink)" title="Nakul found your recurring ledger" />
                <div>
                  <p className="text-sm font-semibold text-(--ink)">Keep renewals one tap away</p>
                  <p className="mt-1 text-xs leading-5 text-(--muted)">Install Vognary after your first proven ledger; financial pages remain network-only.</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={dismissPwaInstall} className="btn btn-ghost h-9 px-3 text-xs">Not now</button>
                <button type="button" onClick={() => void requestPwaInstall()} className="btn btn-primary h-9 px-3 text-xs">Install Vognary</button>
              </div>
            </section>
          ) : null}
          {hasRealData ? <AskProofPanel
            signedIn={Boolean(serverSession?.authenticated)}
            question={proofQuestion}
            answer={proofAnswer}
            busy={proofQuestionBusy}
            onQuestion={setProofQuestion}
            onAsk={(question) => void askProofGraph(question)}
            onOpenCitation={openProofCitation}
          /> : null}
        </section>

        {/* 01 · Connect evidence */}
        <section id="connect" aria-labelledby="connect-heading" className={`${mobileSection === "connect" ? "flex" : "hidden"} scroll-mt-36 flex-col gap-5`}>
          <StageHeader id="connect-heading" folio="03" title="Connect" note="Add fresh evidence with revocable access." />
          {!hasRealData && emptyOnboardingChoice === null ? (
            <EmptyWorkspaceOnboarding
              onConnectGmail={() => {
                setEmptyOnboardingChoice("connect");
                const gmail = connectors.find((connector) => connector.id === "gmail-readonly");
                if (gmail) void startConnector(gmail);
              }}
              onPasteReceipts={() => setEmptyOnboardingChoice("paste")}
              onSeedSample={seedSampleWorkspace}
            />
          ) : null}
          {hasRealData || emptyOnboardingChoice === "connect" ? <IntegrationCommandCenter
            audit={audit}
            connectorStartResults={connectorStartResults}
            connectingConnectorId={connectingConnectorId}
            syncingConnectorId={syncingConnectorId}
            connectedConnectorIds={connectedConnectorIds}
            serverSession={serverSession}
            serverConnectors={serverConnectors}
            merchantLinks={merchantLinks}
            aaVuaDraft={aaVuaDraft}
            onAaVuaDraftChange={setAaVuaDraft}
            onStartConnector={startConnector}
            onDisconnectConnector={disconnectConnector}
            onRunConnectorSync={runConnectorSyncNow}
            onStartBankRail={() => void startBankRail()}
            onLinkMerchant={linkMerchantTile}
            onUnlinkMerchant={unlinkMerchantTile}
            onJumpToLedger={() => selectAndReviewItem()}
            onExportReport={exportReport}
            onClearWorkspace={requestClearWorkspace}
          /> : null}
          {hasRealData || emptyOnboardingChoice === "paste" ? <ReceiptPastePanel
            receiptText={receiptText}
            onReceiptTextChange={setReceiptText}
            autoFocus={!hasRealData && emptyOnboardingChoice === "paste"}
            onBack={!hasRealData ? () => setEmptyOnboardingChoice(null) : undefined}
          /> : null}
          {hasRealData || emptyOnboardingChoice === "paste" ? <GuidedCapturePanel
            onAdd={(items) => {
              setManualItems((current) => [...current, ...items]);
              setNotice(`Added ${items.length} user-confirmed item(s) from the guided capture. They now appear in the ledger and renewal calendar.`);
            }}
          /> : null}
        </section>

        {/* 02 · Recurring ledger */}
        <section id="ledger" aria-labelledby="ledger-heading" className={`${mobileSection === "ledger" ? "flex" : "hidden"} scroll-mt-36 flex-col gap-5`}>
          <StageHeader id="ledger-heading" folio="02" title="Subscriptions" note="Every recurring payment and its proof." />
          {!audit.recurringItems.length ? (
            <section className="panel p-7 text-center sm:p-9" aria-label="No subscriptions yet">
              <p className="text-sm text-(--muted)">No subscriptions are proven yet; connect one evidence source to build this list.</p>
              <button type="button" onClick={() => navigateToSection("connect")} className="btn btn-primary mt-5">Connect evidence</button>
            </section>
          ) : <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label={`Monthly recurring · ${audit.summary.primaryCurrency}`}
              value={formatCurrency(audit.summary.monthlyRecurringSpend, audit.summary.primaryCurrency)}
              tone="ink"
              proofEntries={audit.recurringItems.filter((item) => item.currency === audit.summary.primaryCurrency).map((item) => ({ key: item.identityKey, label: item.merchant, detail: `${formatCurrency(item.monthlyCost, item.currency)}/mo` }))}
              proofEmptyText="No primary-currency commitments compose this total."
            />
            <Metric
              label={`Yearly total · ${audit.summary.primaryCurrency}`}
              value={formatCurrency(audit.summary.annualRecurringSpend, audit.summary.primaryCurrency)}
              tone="blue"
              proofEntries={audit.recurringItems.filter((item) => item.currency === audit.summary.primaryCurrency).map((item) => ({ key: item.identityKey, label: item.merchant, detail: `${formatCurrency(item.annualCost, item.currency)}/yr` }))}
              proofEmptyText="No primary-currency commitments compose this total."
            />
            <Metric
              label={`Needs review · ${audit.summary.primaryCurrency}`}
              value={formatCurrency(audit.summary.reviewableMonthlySpend, audit.summary.primaryCurrency)}
              tone="caution"
              proofEntries={audit.recurringItems.filter((item) => item.currency === audit.summary.primaryCurrency && ["cancel", "downgrade", "investigate", "watch"].includes(item.recommendationType)).map((item) => ({ key: item.identityKey, label: item.merchant, detail: `${formatCurrency(item.monthlyCost, item.currency)}/mo · ${item.recommendationType}` }))}
              proofEmptyText="No commitments currently need review."
            />
            <Metric
              label="Renewing in 10 days"
              value={`${audit.summary.renewalsNextTenDays}`}
              tone="accent"
              proofEntries={renewalTimeline.events.filter((event) => event.daysAway <= 10).map((event) => ({ key: `${event.itemId}-${event.date}`, label: event.merchant, detail: `${formatRenewalDay(event.date)} · ${formatCurrency(event.amount, event.currency)}` }))}
              proofEmptyText="No proven renewal is due in the next 10 days."
            />
          </div>
          <RenewalTimelinePanel timeline={renewalTimeline} onSelect={openDetail} onConnect={() => navigateToSection("connect")} />
          <div className="grid gap-5 xl:grid-cols-[1.12fr_0.88fr]">
            <RecurringGraph
              audit={audit}
              selectedItem={selectedItem}
              userActions={userActions}
              categoryBudgets={categoryBudgets}
              onSelect={openDetail}
            />
            <div className="flex flex-col gap-5">
              <SpendSpectrum audit={audit} userActions={userActions} onSelect={openDetail} onConnect={() => navigateToSection("connect")} />
              {priorityItems.length ? <PriorityActionPanel priorityItems={priorityItems} userActions={userActions} onSelect={openDetail} /> : null}
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
            <>
              <SelectedItemPanel
                item={selectedItem}
                action={userActions[selectedItem.identityKey] ?? selectedItem.recommendationType}
                onAction={(action) => recordAction(selectedItem.identityKey, action)}
              />
              <ConciergeOutcomePanel
                item={selectedItem}
                selectedAction={userActions[selectedItem.identityKey] ?? selectedItem.recommendationType}
                actionCase={selectedActionCase}
                authorizationRequest={authorizationRequest?.actionCase.id === selectedActionCase?.id || (!selectedActionCase && authorizationRequest?.actionCase.recurringItemId === selectedServerRecurringItemId) ? authorizationRequest : null}
                available={conciergeAvailable}
                signedIn={Boolean(serverSession?.authenticated)}
                busy={conciergeBusy}
                onStart={(action) => void startConciergeAction(selectedItem, action)}
                onAuthorize={() => void authorizeConciergeAction()}
                onWithdraw={(id) => void customerTransitionActionCase(id, "withdrawn")}
                onDispute={(id) => void customerTransitionActionCase(id, "disputed")}
              />
            </>
          ) : null}
          </>}
        </section>

        {/* 03 · Monthly review */}
        <section id="review" aria-labelledby="review-heading" className={`${mobileSection === "review" ? "flex" : "hidden"} scroll-mt-36 flex-col gap-5`}>
          <StageHeader id="review-heading" folio="04" title="Review" note="Decisions, notes, and verified outcomes." />
          {reviewDiff ? <SinceLastReviewPanel diff={reviewDiff} onSelectMerchant={() => selectAndReviewItem()} /> : null}
          <VerifiedSavingsPanel
            savings={verifiedSavings}
            onSelect={openDetail}
            onOpenSubscriptions={() => selectAndReviewItem()}
            onShareProof={() => void shareSavingsProof()}
            onMintReceipt={() => void mintSavingsReceipt()}
            onDownloadCard={() => void downloadSavingsCard()}
            onCopyShareText={() => void copySavingsShareText()}
          />
          <TeamReviewPanel
            audit={audit}
            collaborative={workspaceType !== "personal"}
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
            onOpenSubscriptions={() => selectAndReviewItem()}
            onSelect={openDetail}
          />
        </section>

        {/* 04 · Data & readiness */}
        <section id="data" aria-labelledby="data-heading" className={`${mobileSection === "data" ? "flex" : "hidden"} scroll-mt-36 flex-col gap-5`}>
          <StageHeader id="data-heading" folio="05" title="Data" note="Storage, exports, and readiness." />
          <AdvancedImportPanel onImportFiles={importStatementFiles} />
          <ProofGraphPanel graph={proofGraph} audit={audit} onConnect={() => navigateToSection("connect")} />
          <ReadinessPanel />
          <UserControlPanel
            coverageScore={coverageScore}
            coverageSignals={coverageSignals}
            localSaveEnabled={localSaveEnabled}
            serverSession={serverSession}
            serverSaveStatus={serverSaveStatus}
            workspaceType={workspaceType}
            workspaceTypeSaving={workspaceTypeSaving}
            onWorkspaceType={(value) => void changeWorkspaceType(value)}
            onEnableLocalSave={enableLocalSave}
            onDisableLocalSave={requestDisableLocalSave}
            onSaveServerWorkspace={saveServerWorkspace}
            onLoadServerWorkspace={loadServerWorkspace}
            onDeleteServerWorkspace={requestDeleteServerWorkspace}
          />
        </section>
        <footer className="panel flex flex-col items-center gap-3 px-5 py-5 text-center">
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

// Three primary destinations stay visible; review and data appear after the
// first evidence lands, under one compact More disclosure.
function WorkspaceNav({ activeId, onSelect, showMore }: { activeId: string; onSelect: (id: WorkspaceSectionId) => void; showMore: boolean }) {
  return (
    <nav aria-label="Workspace sections" className={`glass fixed bottom-2 left-4 right-4 z-40 grid ${showMore ? "grid-cols-4" : "grid-cols-3"} items-center gap-1 rounded-2xl border border-line px-1.5 py-1.5 sm:static sm:flex sm:overflow-visible`}>
      {primaryWorkspaceSections.map((section) => {
        const active = activeId === section.id;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={(event) => {
              event.preventDefault();
              onSelect(section.id);
            }}
            aria-current={active ? "true" : undefined}
            className={`flex min-h-11 min-w-0 shrink-0 items-center justify-center gap-2 rounded-xl px-1 py-2 text-[0.68rem] font-medium transition sm:justify-start sm:px-3 sm:py-1.5 sm:text-sm ${active ? "bg-(--gold) text-[#17130a]" : "text-(--ink) hover:bg-white/5"}`}
          >
            <span className={`hidden font-data text-[0.6rem] tnum sm:inline ${active ? "opacity-70" : "text-(--muted)"}`}>{section.folio}</span>
            <span className="truncate">{section.label}</span>
          </a>
        );
      })}
      {showMore ? (
        <details className="group relative min-w-0 sm:ml-auto">
          <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-center rounded-xl px-2 text-[0.68rem] font-medium transition sm:px-3 sm:text-sm ${secondaryWorkspaceSections.some((section) => section.id === activeId) ? "bg-(--gold) text-[#17130a]" : "text-(--ink) hover:bg-white/5"}`}>More</summary>
          <div className="absolute bottom-full right-0 mb-2 grid min-w-40 gap-1 rounded-xl border border-line bg-(--paper-2) p-1.5 shadow-2xl sm:bottom-auto sm:top-full sm:mt-2">
            {secondaryWorkspaceSections.map((section) => (
              <button key={section.id} type="button" onClick={() => onSelect(section.id)} className="min-h-11 rounded-lg px-3 text-left text-sm text-(--ink-soft) transition hover:bg-white/5 hover:text-(--ink)">
                {section.label}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </nav>
  );
}

// Chapter divider — the folio marker + intent that opens each workspace section.
function StageHeader({ id, folio, title, note }: { id: string; folio: string; title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <h2 id={id} className="folio shrink-0" data-folio={folio}>{title}</h2>
      <span className="hidden h-px flex-1 bg-line sm:block" aria-hidden />
      {note ? <p className="text-xs leading-5 text-(--muted) sm:max-w-sm sm:text-right">{note}</p> : null}
    </div>
  );
}

function NakulMomentPanel({ moment, onDismiss }: { moment: NakulMoment; onDismiss: () => void }) {
  return (
    <section className="panel flex flex-col gap-4 border-(--gold-line) p-4 sm:flex-row sm:items-center" role="status" aria-label="Nakul moment">
      <Nakul pose={moment.pose} size={64} className="shrink-0 text-(--ink)" title={`Nakul: ${moment.title}`} />
      <div className="min-w-0 flex-1">
        <p className="eyebrow" style={{ fontSize: "0.6rem" }}>{moment.kicker}</p>
        <h3 className="mt-1 font-display text-lg font-semibold text-(--ink)">{moment.title}</h3>
        <p className="mt-1 text-sm leading-6 text-(--muted)">{moment.detail}</p>
      </div>
      <button type="button" onClick={onDismiss} className="btn btn-ghost h-9 shrink-0 px-3 text-xs">Dismiss</button>
    </section>
  );
}

function IntegrationCommandCenter({
  audit,
  connectorStartResults,
  connectingConnectorId,
  syncingConnectorId,
  connectedConnectorIds,
  serverSession,
  serverConnectors,
  merchantLinks,
  aaVuaDraft,
  onAaVuaDraftChange,
  onStartConnector,
  onDisconnectConnector,
  onRunConnectorSync,
  onStartBankRail,
  onLinkMerchant,
  onUnlinkMerchant,
  onJumpToLedger,
  onExportReport,
  onClearWorkspace,
}: {
  audit: AuditResult;
  connectorStartResults: Record<string, ConnectorStartPayload>;
  connectingConnectorId: string | null;
  syncingConnectorId: string | null;
  connectedConnectorIds: Set<string>;
  serverSession: ServerSessionPayload | null;
  serverConnectors: WorkspaceConnectorStatusPayload | null;
  merchantLinks: string[];
  aaVuaDraft: string;
  onAaVuaDraftChange: (value: string) => void;
  onStartConnector: (connector: Connector) => void;
  onDisconnectConnector: (connector: Connector) => void;
  onRunConnectorSync: (connector: Connector) => void;
  onStartBankRail: () => void;
  onLinkMerchant: (tile: ConnectTile) => void;
  onUnlinkMerchant: (tile: ConnectTile) => void;
  onJumpToLedger: () => void;
  onExportReport: () => void;
  onClearWorkspace: () => void;
}) {
  const signedIn = Boolean(serverSession?.authenticated && serverSession.session?.workspaceId);
  const rails = {
    gmailConnected: connectedConnectorIds.has("gmail-readonly"),
    bankConnected: connectedConnectorIds.has("account-aggregator"),
  };
  const linked = new Set(merchantLinks);

  return (
    <section className="dossier spotlight scan p-5 sm:p-6" onMouseMove={trackSpotlightPointer}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="folio" data-folio="1.1" style={{ color: "var(--dossier-muted)" }}>Connections</span>
          <h3 className="mt-3 font-display text-3xl font-semibold leading-tight text-(--dossier-ink) sm:text-4xl">Connect evidence. Choose what to watch.</h3>
          <p className="mt-2 max-w-xl text-sm leading-6 muted-on-dark">Approve read-only email or bank evidence; merchant watches never connect merchant accounts.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DossierStat label="Items" value={`${audit.summary.recurringCount}`} onClick={onJumpToLedger} />
          <DossierStat label={`Monthly · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.monthlyRecurringSpend, audit.summary.primaryCurrency)} onClick={onJumpToLedger} />
          <DossierStat label={`Yearly · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.annualRecurringSpend, audit.summary.primaryCurrency)} onClick={onJumpToLedger} />
          <DossierStat label={`Review · ${audit.summary.primaryCurrency}`} value={formatCurrency(audit.summary.reviewableMonthlySpend, audit.summary.primaryCurrency)} onClick={onJumpToLedger} />
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <RailCard
          title="Bank transactions"
          eyebrow="Rail 01 · Primary automatic account feed"
          connectorId="account-aggregator"
          description="Approve a scoped, revocable bank-data request with the regulated provider."
          connectorStartResults={connectorStartResults}
          connectingConnectorId={connectingConnectorId}
          syncingConnectorId={syncingConnectorId}
          connected={rails.bankConnected}
          serverConnectors={serverConnectors}
          onStartConnector={onStartConnector}
          onDisconnectConnector={onDisconnectConnector}
          onRunConnectorSync={onRunConnectorSync}
          bankRail={{ signedIn, vuaDraft: aaVuaDraft, onVuaDraftChange: onAaVuaDraftChange, onStart: onStartBankRail }}
        />
        <RailCard
          title="Email receipts"
          eyebrow="Rail 02 · Optional coverage"
          connectorId="gmail-readonly"
          description="Approve read-only Gmail access for receipts a bank feed cannot identify."
          connectorStartResults={connectorStartResults}
          connectingConnectorId={connectingConnectorId}
          syncingConnectorId={syncingConnectorId}
          connected={rails.gmailConnected}
          serverConnectors={serverConnectors}
          onStartConnector={onStartConnector}
          onDisconnectConnector={onDisconnectConnector}
          onRunConnectorSync={onRunConnectorSync}
        />
      </div>

      <div className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="eyebrow muted-on-dark" style={{ fontSize: "0.62rem" }}>Merchant watches · local workspace preferences</span>
          <span className="font-data text-[0.66rem] muted-on-dark">{merchantLinks.length ? `${merchantLinks.length} watched` : "Watch the merchants you pay"}</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {merchantTiles.map((tile) => {
            const isLinked = linked.has(tile.id);
            const matches = matchTileItems(tile, audit.recurringItems);
            const coverage = describeTileCoverage(tile, rails);
            const matchCurrency = matches[0]?.currency ?? audit.summary.primaryCurrency;
            const matchedMonthly = matches
              .filter((item) => item.currency === matchCurrency)
              .reduce((sum, item) => sum + item.monthlyCost, 0);
            return (
              <div key={tile.id} className="flex flex-col justify-between rounded-[11px] border p-3" style={{ borderColor: "var(--dossier-line)", background: isLinked ? "rgba(243,234,214,0.07)" : "rgba(243,234,214,0.03)" }}>
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-display text-base font-semibold text-(--dossier-ink)">{tile.name}</p>
                      <p className="font-data text-[0.62rem] uppercase tracking-[0.14em] muted-on-dark">{tile.category}</p>
                    </div>
                    <span className={isLinked ? (matches.length || coverage.state === "fed" ? "pill pill-ready" : "pill pill-partial") : "pill pill-planned"}>
                      {isLinked ? (matches.length ? "In ledger" : coverage.state === "waiting-for-rail" ? "Needs rail" : "Watching") : "Not watched"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 muted-on-dark">
                    {isLinked
                      ? matches.length
                        ? `${matches.length} matching commitment(s) · ${formatCurrency(matchedMonthly, matchCurrency)}/mo already detected.`
                        : coverage.message
                      : tile.tagline}
                  </p>
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => (isLinked ? onUnlinkMerchant(tile) : onLinkMerchant(tile))}
                    className={`${isLinked ? "btn btn-ondark" : "btn btn-primary"} h-9 w-full text-xs`}
                  >
                    {isLinked ? "Stop watching" : "Watch"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-[11px] border p-3 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
        <p className="text-xs leading-5 muted-on-dark">
          Access is revocable; merchant watches are workspace preferences, not merchant-account connections.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={onJumpToLedger} className="btn btn-ondark h-9 px-3 text-xs">Open ledger</button>
          <button type="button" onClick={onExportReport} className="btn btn-ondark h-9 px-3 text-xs">Download report</button>
          <button type="button" onClick={onClearWorkspace} className="btn btn-ondark h-9 px-3 text-xs">Clear</button>
        </div>
      </div>
    </section>
  );
}

function RailCard({
  title,
  eyebrow,
  connectorId,
  description,
  connectorStartResults,
  connectingConnectorId,
  syncingConnectorId,
  connected,
  serverConnectors,
  onStartConnector,
  onDisconnectConnector,
  onRunConnectorSync,
  bankRail,
}: {
  title: string;
  eyebrow: string;
  connectorId: string;
  description: string;
  connectorStartResults: Record<string, ConnectorStartPayload>;
  connectingConnectorId: string | null;
  syncingConnectorId: string | null;
  connected: boolean;
  serverConnectors: WorkspaceConnectorStatusPayload | null;
  onStartConnector: (connector: Connector) => void;
  onDisconnectConnector: (connector: Connector) => void;
  onRunConnectorSync: (connector: Connector) => void;
  bankRail?: {
    signedIn: boolean;
    vuaDraft: string;
    onVuaDraftChange: (value: string) => void;
    onStart: () => void;
  };
}) {
  const connector = connectors.find((entry) => entry.id === connectorId) ?? null;
  if (!connector) return null;
  const result = connectorStartResults[connectorId];
  const busy = connectingConnectorId === connectorId;
  const syncing = syncingConnectorId === connectorId;
  const missing = result?.missingEnv ?? result?.requiredEnv ?? [];
  const activationPending = result?.availability === "company-activation-pending" || missing.length > 0;
  const serverAccount = getServerAccount(serverConnectors, connectorId);
  const pendingApproval = serverAccount?.status === "pending";
  const needsReauth = serverAccount?.status === "needs_reauth";
  const isConnected = connected && !pendingApproval && !needsReauth;
  const health = serverAccount ? sourceHealthPresentation(serverAccount) : null;
  const syncNeedsAttention = Boolean(serverAccount && !pendingApproval && !needsReauth && sourceNeedsAttention(serverAccount));
  const statusLabel = pendingApproval ? "Awaiting approval" : needsReauth ? "Reconnect" : isConnected ? health?.label ?? "Awaiting sync" : activationPending ? "Company activation pending" : "Review access";
  const statusClass = needsReauth ? "pill pill-blocked" : isConnected ? health?.className ?? "pill pill-planned" : "pill pill-partial";

  return (
    <div className="rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.05)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="eyebrow muted-on-dark" style={{ fontSize: "0.6rem" }}>{eyebrow}</span>
          <p className="mt-1 font-display text-xl font-semibold text-(--dossier-ink)">{title}</p>
        </div>
        <span className={statusClass}>{statusLabel}</span>
      </div>
      <p className="mt-2 text-xs leading-5 muted-on-dark">{description}</p>
      {bankRail ? (
        <p className="mt-2 text-xs leading-5 muted-on-dark">
          A regulated partner handles account access. No credentials or technical setup are required from you.
        </p>
      ) : null}

      {bankRail && !isConnected && !pendingApproval ? (
        <label className="mt-3 block">
          <span className="eyebrow muted-on-dark" style={{ fontSize: "0.62rem" }}>Account Aggregator handle</span>
          <input
            value={bankRail.vuaDraft}
            onChange={(event) => bankRail.onVuaDraftChange(event.target.value)}
            type="text"
            inputMode="text"
            autoComplete="off"
            disabled={!bankRail.signedIn || busy}
            placeholder={bankRail.signedIn ? "9999999999@onemoney" : "Sign in to link bank data"}
            className="mt-2 h-11 w-full rounded-[10px] border px-3 font-data text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: "rgba(10,12,16,0.28)", borderColor: "var(--dossier-line)", color: "var(--dossier-ink)" }}
          />
          <span className="mt-1 block text-[0.68rem] leading-4 muted-on-dark">Your AA handle identifies you in the consent flow — it is not a password. Approval happens in the Account Aggregator experience.</span>
        </label>
      ) : null}

      {pendingApproval ? <p className="mt-3 text-xs leading-5 text-ochre">The source is not connected yet. Vognary is waiting for the Account Aggregator to confirm your approval.</p> : null}

      {activationPending ? <p className="mt-2 text-xs leading-5 text-ochre">Vognary is completing this provider connection. No credentials or technical setup are required from you.</p> : null}

      {serverAccount ? (
        <div className="mt-2 grid gap-1 font-data text-[0.68rem] leading-5 muted-on-dark">
          <p>Source: <span className="text-(--dossier-ink)">{serverAccount.displayName}</span> · {serverAccount.evidenceCount} evidence record(s)</p>
          <p>Last synced: <span className="text-(--dossier-ink)">{formatSyncTime(serverAccount.lastSyncedAt)}</span> · Next: <span className="text-(--dossier-ink)">{formatSyncTime(serverAccount.nextSyncAt)}</span></p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || activationPending || (pendingApproval && !result?.approvalUrl)}
          onClick={() => {
            if (isConnected) return onDisconnectConnector(connector);
            if (pendingApproval && result?.approvalUrl) {
              window.location.assign(result.approvalUrl);
              return;
            }
            if (pendingApproval) return;
            if (bankRail) return bankRail.onStart();
            return onStartConnector(connector);
          }}
          className={`${isConnected ? "btn btn-ondark" : "btn btn-primary"} h-10 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {busy ? "Connecting..." : isConnected ? "Disconnect" : activationPending ? "Not available yet" : pendingApproval ? (result?.approvalUrl ? "Continue approval" : "Approval pending") : needsReauth ? "Reconnect" : "Connect"}
        </button>
        {serverAccount && !isConnected ? <button type="button" disabled={busy} onClick={() => onDisconnectConnector(connector)} className="btn btn-ondark h-10 px-3 text-xs disabled:opacity-60">Disconnect source</button> : null}
        {syncNeedsAttention ? <button type="button" disabled={syncing} onClick={() => onRunConnectorSync(connector)} className="btn btn-ondark h-10 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60">{syncing ? "Retrying" : "Retry sync"}</button> : null}
      </div>
    </div>
  );
}

function EmptyWorkspaceOnboarding({
  onConnectGmail,
  onPasteReceipts,
  onSeedSample,
}: {
  onConnectGmail: () => void;
  onPasteReceipts: () => void;
  onSeedSample: () => void;
}) {
  return (
    <section className="panel p-6 sm:p-8" aria-labelledby="empty-workspace-title">
      <div className="mx-auto max-w-3xl text-center">
        <span className="folio" data-folio="1.1">First evidence</span>
        <h3 id="empty-workspace-title" className="mt-3 font-display text-3xl font-semibold text-(--ink)">How would you like to start?</h3>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-(--muted)">Your data stays private to your workspace, and every connection can be revoked.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={onConnectGmail} className="inset lift p-5 text-left transition hover:border-ember">
            <span className="font-data text-[0.62rem] uppercase tracking-[0.14em] text-verdict">Automatic</span>
            <span className="mt-2 block font-display text-lg font-semibold text-(--ink)">Connect Gmail</span>
            <span className="mt-1 block text-xs leading-5 text-(--muted)">Find recurring receipts with read-only access.</span>
          </button>
          <button type="button" onClick={onPasteReceipts} className="inset lift p-5 text-left transition hover:border-ember">
            <span className="font-data text-[0.62rem] uppercase tracking-[0.14em] text-verdict">Private and quick</span>
            <span className="mt-2 block font-display text-lg font-semibold text-(--ink)">Paste receipts</span>
            <span className="mt-1 block text-xs leading-5 text-(--muted)">Paste invoice or renewal text directly.</span>
          </button>
          <button type="button" onClick={onSeedSample} className="inset lift p-5 text-left transition hover:border-ember">
            <span className="font-data text-[0.62rem] uppercase tracking-[0.14em] text-verdict">No setup</span>
            <span className="mt-2 block font-display text-lg font-semibold text-(--ink)">See a sample audit</span>
            <span className="mt-1 block text-xs leading-5 text-(--muted)">Explore eight clearly labelled demo subscriptions.</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function ReceiptPastePanel({
  receiptText,
  onReceiptTextChange,
  autoFocus = false,
  onBack,
}: {
  receiptText: string;
  onReceiptTextChange: (value: string) => void;
  autoFocus?: boolean;
  onBack?: () => void;
}) {
  return (
    <section id="receipt-paste" className="panel p-5 sm:p-6" aria-labelledby="receipt-paste-title">
      <SectionHead
        folio="1.2"
        kicker="Receipt paste"
        title="Add receipt evidence"
        desc="Paste one or more receipts; merchant, amount, date, and renewal language are enough. Remove account numbers and private identifiers."
      />
      <label className="mt-4 block">
        <span id="receipt-paste-title" className="field-label">Receipt, invoice, renewal, or payment-success text</span>
        <textarea
          autoFocus={autoFocus}
          value={receiptText}
          onChange={(event) => onReceiptTextChange(event.target.value)}
          className="field min-h-32"
          placeholder="Example: Acme invoice paid INR 999 on 2026-07-01. Renews monthly."
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs leading-5 text-(--muted)">Candidates appear in the ledger immediately and merge with matching connected evidence.</p>
        {onBack ? <button type="button" onClick={onBack} className="btn btn-ghost h-9 px-3 text-xs">Choose another way</button> : null}
      </div>
    </section>
  );
}

function AdvancedImportPanel({ onImportFiles }: { onImportFiles: (files: File[]) => void }) {
  return (
    <section className="panel p-5 sm:p-6">
      <SectionHead folio="5.1" kicker="Advanced import" title="Bring an existing export" desc="Use this only when a connected source or receipt paste is not available. The original file is processed request-time and is not intentionally retained." />
      <label className="btn btn-ghost mt-4 cursor-pointer text-center">
        Choose statement files
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
    </section>
  );
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

async function fetchCurrentWorkspace(): Promise<WorkspaceProfilePayload> {
  try {
    const response = await fetch("/api/workspaces/current", { cache: "no-store" });
    return await response.json() as WorkspaceProfilePayload;
  } catch {
    return { status: "error" };
  }
}

async function fetchWorkspaceCommitments(): Promise<WorkspaceCommitmentsPayload> {
  try {
    const response = await fetch("/api/workspaces/current/commitments", { cache: "no-store" });
    return await response.json() as WorkspaceCommitmentsPayload;
  } catch {
    return { status: "error", commitments: [] };
  }
}

async function fetchWorkspaceActions(): Promise<WorkspaceActionsPayload> {
  try {
    const response = await fetch("/api/workspaces/current/actions", { cache: "no-store" });
    return await response.json() as WorkspaceActionsPayload;
  } catch {
    return { status: "error", actionCases: [], concierge: { available: false } };
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
// WP-6.3 — a ₹ figure that is an aggregate (a sum of several commitments) has
// no single detail sheet to open, so it carries its own proof chip: tapping it
// reveals the exact evidence rows that compose the number. Per-item figures keep
// tracing through the detail sheet; this closes the gap on Home's aggregates.
function ProofDisclosure({
  entries,
  emptyText,
}: {
  entries: { key: string; label: string; detail: string }[];
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={regionId}
        className="inline-flex items-center gap-1 rounded-full border border-line bg-(--card-2) px-2 py-0.5 font-data text-[0.58rem] uppercase tracking-[0.12em] text-(--muted) transition hover:border-(--line-strong) hover:text-(--ink)"
      >
        <span aria-hidden>◆</span> {open ? "Hide proof" : "Proof"}
      </button>
      {open ? (
        <ul id={regionId} className="mt-2 grid gap-1 rounded-lg border border-line bg-(--card-2) p-2 font-data text-[0.66rem] leading-5 text-(--ink-soft)">
          {entries.length ? (
            entries.map((entry) => (
              <li key={entry.key} className="flex items-center justify-between gap-3">
                <span className="truncate">{entry.label}</span>
                <span className="tnum shrink-0 text-(--muted)">{entry.detail}</span>
              </li>
            ))
          ) : (
            <li className="text-(--muted)">{emptyText}</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

function OverviewPanel({
  audit,
  timeline,
  savings,
  proofGraph,
  priorityItems,
  userActions,
  hasRealData,
  reviewDiff,
  monthlyBudget,
  categoryBudgets,
  sourceHealth,
  onSelect,
  onOpenSubscriptions,
  onOpenConnect,
  onMonthlyBudgetChange,
  onCategoryBudgetChange,
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
  reviewDiff: ReviewDiff | null;
  monthlyBudget: number | null;
  categoryBudgets: Record<string, number>;
  sourceHealth: ServerSourceHealth[];
  onSelect: (identityKey: string) => void;
  onOpenSubscriptions: () => void;
  onOpenConnect: () => void;
  onMonthlyBudgetChange: (value: number | null) => void;
  onCategoryBudgetChange: (category: string, value: number | null) => void;
  onExportPack: () => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
}) {
  const nextEvent = timeline.events[0] ?? null;
  const topAction = priorityItems[0] ?? null;
  const attentionSources = sourceHealth.filter(sourceNeedsAttention);
  const burnDeltaTone = reviewDiff?.monthlyDelta
    ? reviewDiff.monthlyDelta > 0 ? "text-ember" : "text-verdict"
    : "text-(--muted)";
  const proofStrength = proofGraph.totalMonthly > 0 ? Math.round((1 - proofGraph.singleSourceShare) * 100) : 0;
  const foreignEntries = Object.entries(audit.summary.foreignMonthlyTotals);
  const categorySpend = audit.recurringItems.reduce<Record<string, number>>((totals, item) => {
    if (item.currency !== audit.summary.primaryCurrency) return totals;
    totals[item.category] = (totals[item.category] ?? 0) + item.monthlyCost;
    return totals;
  }, {});
  const categoryBudgetAlerts = Object.entries(categorySpend)
    .filter(([category, spend]) => Boolean(categoryBudgets[category]) && spend > categoryBudgets[category])
    .map(([category, spend]) => `${category} is ${formatCurrency(spend - categoryBudgets[category], audit.summary.primaryCurrency)} over`);
  const alerts = [
    monthlyBudget !== null && audit.summary.monthlyRecurringSpend > monthlyBudget
      ? `Monthly burn is ${formatCurrency(audit.summary.monthlyRecurringSpend - monthlyBudget, audit.summary.primaryCurrency)} over budget`
      : null,
    ...categoryBudgetAlerts,
    audit.recurringItems.some((item) => item.priceChange?.direction === "increase")
      ? `${audit.recurringItems.filter((item) => item.priceChange?.direction === "increase").length} price increase${audit.recurringItems.filter((item) => item.priceChange?.direction === "increase").length === 1 ? "" : "s"} detected`
      : null,
    timeline.events.some((event) => event.daysAway <= 3)
      ? `${timeline.events.filter((event) => event.daysAway <= 3).length} renewal${timeline.events.filter((event) => event.daysAway <= 3).length === 1 ? "" : "s"} due within 3 days`
      : null,
    attentionSources.length
      ? `${attentionSources.length === 1 ? "Evidence source needs" : "Evidence sources need"} attention: ${attentionSources.map(sourceDisplayName).join(", ")}`
      : null,
  ].filter((alert): alert is string => Boolean(alert));
  const suggestedCuts = rankSuggestedCuts(audit.recurringItems, userActions);

  if (!audit.summary.recurringCount) {
    return (
      <section className="panel p-6 text-center sm:p-8">
        <h3 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Your recurring money, answered in five seconds.</h3>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-(--muted)">{hasRealData ? "Add one more evidence source to prove a recurring pattern." : "Connect one source to reveal your burn, next renewal, and first action."}</p>
        <a href="#connect" className="btn btn-primary mt-5">Connect evidence</a>
      </section>
    );
  }

  return (
    <section className="panel p-5 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button type="button" onClick={onOpenSubscriptions} className="inset p-4 text-left transition hover:border-ember">
          <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Monthly burn</p>
          <p className="font-data mt-2 text-2xl font-semibold tnum text-(--ink)">{formatCurrency(audit.summary.monthlyRecurringSpend, audit.summary.primaryCurrency)}</p>
          <p className="mt-1 font-data text-[0.66rem] text-(--muted)">
            {formatCurrency(audit.summary.annualRecurringSpend, audit.summary.primaryCurrency)}/yr · {audit.summary.recurringCount} commitments
            {foreignEntries.map(([code, total]) => (
              <span key={code} className="ml-2 text-ochre">+ {formatCurrency(total, code)}/mo</span>
            ))}
          </p>
          <p className={`mt-1.5 font-data text-[0.66rem] ${burnDeltaTone}`}>
            {reviewDiff
              ? `${reviewDiff.monthlyDelta > 0 ? "+" : ""}${formatCurrency(reviewDiff.monthlyDelta, audit.summary.primaryCurrency)} since last review`
              : "No comparison yet · complete a review to set the baseline"}
          </p>
        </button>
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
          <ProofDisclosure
            entries={timeline.events
              .filter((event) => event.daysAway <= 30)
              .map((event) => ({ key: `${event.itemId}-${event.date}`, label: event.merchant, detail: `${formatCurrency(event.amount, event.currency)} · ${event.date}` }))}
            emptyText="No projected debits inside 30 days."
          />
        </div>
        <div className="inset p-4">
          <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Verified savings</p>
          <p className={`font-data mt-2 text-2xl font-semibold tnum ${savings.verifiedAnnual > 0 ? "text-verdict" : "text-(--muted)"}`}>
            {formatCurrency(savings.verifiedAnnual)}/yr
          </p>
          <p className="mt-1 font-data text-[0.66rem] text-(--muted)">
            {savings.verifiedAnnual > 0
              ? `${savings.entries.length} decision(s) tracked · mint the receipt in Review`
              : savings.entries.length
                ? `${savings.entries.length} decision(s) tracked`
                : "Mark a cancel to start proving savings"}
          </p>
          <ProofDisclosure
            entries={savings.entries.map((entry) => ({ key: entry.itemId, label: `${entry.merchant} · ${entry.status}`, detail: `${formatCurrency(entry.annualSaving, entry.currency)}/yr` }))}
            emptyText="Mark a cancel to start proving savings."
          />
        </div>
        <div className={`inset p-4 ${monthlyBudget !== null && audit.summary.monthlyRecurringSpend > monthlyBudget ? "border-ochre" : ""}`}>
          <label htmlFor="monthly-budget" className="eyebrow" style={{ fontSize: "0.6rem" }}>Monthly budget · {audit.summary.primaryCurrency}</label>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-data text-sm text-(--muted)">₹</span>
            <input
              id="monthly-budget"
              type="number"
              min="1"
              max="100000000"
              step="100"
              inputMode="decimal"
              value={monthlyBudget ?? ""}
              onChange={(event) => onMonthlyBudgetChange(sanitizeBudget(event.target.valueAsNumber))}
              placeholder="Set budget"
              className="field h-10 min-w-0 flex-1 py-0 font-data text-sm"
            />
          </div>
          <p className={`mt-2 font-data text-[0.66rem] ${monthlyBudget !== null && audit.summary.monthlyRecurringSpend > monthlyBudget ? "text-ochre" : "text-(--muted)"}`}>
            {monthlyBudget === null
              ? `${proofStrength}% of monthly spend is multi-source verified`
              : audit.summary.monthlyRecurringSpend > monthlyBudget
                ? `${formatCurrency(audit.summary.monthlyRecurringSpend - monthlyBudget, audit.summary.primaryCurrency)} over budget`
                : `${formatCurrency(monthlyBudget - audit.summary.monthlyRecurringSpend, audit.summary.primaryCurrency)} remaining`}
          </p>
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
      {alerts.length ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-ochre/50 bg-(--gold-tint) p-3 sm:flex-row sm:items-end sm:justify-between" role="status" aria-label="Workspace alerts">
          <div>
            <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Needs attention</p>
            <ul className="mt-2 grid gap-1 text-xs leading-5 text-(--ink-soft) sm:grid-cols-2">
              {alerts.map((alert) => <li key={alert}>• {alert}</li>)}
            </ul>
          </div>
          {attentionSources.length ? <button type="button" onClick={onOpenConnect} className="btn btn-ghost h-9 shrink-0 px-3 text-xs">Review sources</button> : null}
        </div>
      ) : null}
      <RunwayStrip items={audit.recurringItems} />
      {suggestedCuts.length ? (
        <section className="mt-4 rounded-xl border border-line bg-(--card-2) p-3" aria-labelledby="suggested-cuts-heading">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Suggested cuts</p>
              <h4 id="suggested-cuts-heading" className="mt-1 font-display text-base font-semibold text-(--ink)">Review these first</h4>
            </div>
            <span className="font-data text-[0.62rem] text-(--muted)">Cost · proof · price movement</span>
          </div>
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            {suggestedCuts.map(({ item, action }, index) => {
              const cancelPath = findActionableCancelAction(item.merchant, item.category, action);
              return (
                <li key={item.identityKey} className="inset flex min-w-0 flex-col p-3">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-data text-[0.6rem] text-(--muted)">0{index + 1}</span>
                      <span className="mt-1 block truncate text-sm font-semibold text-(--ink)">{item.merchant}</span>
                    </span>
                    <span className={statusStyles[action]}>{action}</span>
                  </span>
                  <button type="button" onClick={() => onSelect(item.identityKey)} className="mt-3 text-left font-data text-sm font-semibold tnum text-(--ink) hover:text-ember">
                    {formatCurrency(item.monthlyCost, item.currency)}/mo <span className="text-[0.62rem] font-normal text-(--muted)">· view proof →</span>
                  </button>
                  {cancelPath ? (
                    <a href={cancelPath.manageUrl ?? "#ledger"} target={cancelPath.manageUrl ? "_blank" : undefined} rel={cancelPath.manageUrl ? "noopener noreferrer" : undefined} onClick={cancelPath.manageUrl ? undefined : () => onSelect(item.identityKey)} className="mt-2 text-xs font-semibold text-ember underline underline-offset-4">
                      {cancelPath.manageUrl ? `Open ${manageUrlHostname(cancelPath)} ↗` : "Open cancel guide"}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      {Object.keys(categorySpend).length ? (
        <details className="mt-4 rounded-xl border border-line bg-(--card-2) p-3">
          <summary className="cursor-pointer text-sm font-semibold text-(--ink)">Category budgets</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(categorySpend).sort(([left], [right]) => left.localeCompare(right)).map(([category, spend]) => {
              const budget = categoryBudgets[category] ?? null;
              const over = budget !== null && spend > budget;
              return (
                <label key={category} className={`inset p-3 ${over ? "border-ochre" : ""}`}>
                  <span className="flex items-center justify-between gap-2 text-xs font-semibold text-(--ink)">
                    <span>{category}</span>
                    <span className="font-data text-[0.64rem] text-(--muted)">{formatCurrency(spend, audit.summary.primaryCurrency)}/mo</span>
                  </span>
                  <span className="mt-2 flex items-center gap-2">
                    <span className="font-data text-xs text-(--muted)">₹</span>
                    <input
                      type="number"
                      min="1"
                      max="100000000"
                      step="100"
                      inputMode="decimal"
                      value={budget ?? ""}
                      onChange={(event) => onCategoryBudgetChange(category, sanitizeBudget(event.target.valueAsNumber))}
                      placeholder="No limit"
                      aria-label={`${category} monthly budget`}
                      className="field h-9 min-w-0 flex-1 py-0 font-data text-xs"
                    />
                  </span>
                  {over ? <span className="mt-1 block font-data text-[0.62rem] text-ochre">{formatCurrency(spend - budget, audit.summary.primaryCurrency)} over</span> : null}
                </label>
              );
            })}
          </div>
        </details>
      ) : null}
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

const proofQuestionPrompts = [
  "What is my total recurring spend?",
  "Which commitments have the weakest proof?",
  "What renews next?",
  "How much have I verifiably stopped paying?",
];

function AskProofPanel({
  signedIn,
  question,
  answer,
  busy,
  onQuestion,
  onAsk,
  onOpenCitation,
}: {
  signedIn: boolean;
  question: string;
  answer: CitedProofAnswer | null;
  busy: boolean;
  onQuestion: (value: string) => void;
  onAsk: (value: string) => void;
  onOpenCitation: (entityId: string | null) => void;
}) {
  return (
    <section className="panel overflow-hidden" aria-labelledby="ask-proof-heading">
      <div className="grid lg:grid-cols-[0.78fr_1.22fr]">
        <div className="dossier p-5 sm:p-6">
          <span className="folio" data-folio="0.6" style={{ color: "var(--dossier-muted)" }}>Cited answers</span>
          <h3 id="ask-proof-heading" className="mt-4 font-display text-2xl font-semibold text-(--dossier-ink)">Ask your proof</h3>
          <p className="mt-2 text-sm leading-6 muted-on-dark">Every question compiles into a bounded ledger query. Every financial claim links to its graph evidence. If Vognary cannot prove an answer, it refuses to guess.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {proofQuestionPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={!signedIn || busy}
                onClick={() => onAsk(prompt)}
                className="rounded-full border px-3 py-1.5 text-left font-data text-[0.62rem] transition disabled:opacity-45"
                style={{ borderColor: "var(--dossier-line)", color: "var(--dossier-muted)" }}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5 sm:p-6">
          {signedIn ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onAsk(question);
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <label className="sr-only" htmlFor="proof-question">Question for the Proof Graph</label>
              <input
                id="proof-question"
                value={question}
                onChange={(event) => onQuestion(event.target.value)}
                maxLength={300}
                className="field flex-1"
                placeholder="Ask about spend, renewals, confidence, sources, or verified savings"
              />
              <button type="submit" disabled={busy || question.trim().length < 3} className="btn btn-primary shrink-0 disabled:opacity-60">
                {busy ? "Reading proof…" : "Answer with citations"}
              </button>
            </form>
          ) : (
            <div className="inset p-4">
              <p className="text-sm font-semibold text-(--ink)">Protected workspace required</p>
              <p className="mt-1 text-xs leading-5 text-(--muted)">Sign in before asking the server-side graph. Guest evidence stays on this device unless you explicitly transfer it.</p>
              <a href="/login?next=%2Fapp" className="btn btn-primary mt-3 h-9 px-3 text-xs">Sign in</a>
            </div>
          )}

          {answer ? (
            <div className="mt-4" aria-live="polite">
              <div className={`rounded-xl border p-4 ${answer.answerable ? "border-(--gold-line) bg-(--gold-tint)" : "border-ember bg-(--ember-tint)"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="eyebrow">{answer.answerable ? "Evidence-backed answer" : "No supported query"}</p>
                  <span className={answer.answerable ? "pill pill-ready" : "pill pill-blocked"}>{answer.answerable ? `${answer.citations.length} citation${answer.citations.length === 1 ? "" : "s"}` : "No guess"}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-(--ink)">{answer.summary.text}</p>
              </div>
              {answer.claims.length ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {answer.claims.map((claim, index) => (
                    <div key={`${claim.label}-${index}`} className="inset p-3">
                      <p className="font-data text-[0.62rem] uppercase tracking-[0.12em] text-(--muted)">{claim.label}</p>
                      <p className="mt-1 font-display text-lg font-semibold text-(--ink)">{claim.value}</p>
                      <p className="mt-1 text-xs leading-5 text-(--muted)">{claim.text}</p>
                      <p className="mt-2 font-data text-[0.6rem] text-indigo">{claim.citationIds.map((id) => `[${answer.citations.findIndex((citation) => citation.id === id) + 1}]`).join(" ")}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {answer.citations.length ? (
                <details className="mt-3 rounded-xl border border-line bg-card p-3" open>
                  <summary className="cursor-pointer font-display text-sm font-semibold text-(--ink)">Proof citations</summary>
                  <ol className="mt-3 grid gap-2">
                    {answer.citations.map((citation, index) => (
                      <li key={citation.id} className="flex flex-col gap-2 rounded-lg border border-line bg-(--card-2) p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs font-semibold text-(--ink)">[{index + 1}] {citation.title}</p>
                          <p className="mt-1 font-data text-[0.6rem] text-(--muted)">Graph r{citation.graphRevision} · observed {citation.observedAt} · {citation.sourceNames.join(", ")}</p>
                        </div>
                        {citation.kind === "commitment" ? (
                          <button type="button" onClick={() => onOpenCitation(citation.entityId)} className="btn btn-ghost h-8 shrink-0 px-2.5 text-[0.66rem]">Open proof</button>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              {answer.limitations.length ? <p className="mt-3 font-data text-[0.6rem] leading-5 text-(--muted)">{answer.limitations.join(" · ")}</p> : null}
            </div>
          ) : null}
        </div>
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
  workspaceType,
  workspaceTypeSaving,
  onWorkspaceType,
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
  workspaceType: WorkspaceType;
  workspaceTypeSaving: boolean;
  onWorkspaceType: (value: WorkspaceType) => void;
  onEnableLocalSave: () => void;
  onDisableLocalSave: () => void;
  onSaveServerWorkspace: () => void;
  onLoadServerWorkspace: () => void;
  onDeleteServerWorkspace: () => void;
}) {
  const signedInEmail = serverSession?.authenticated ? serverSession.session?.email : null;
  const missingSignals = coverageSignals.filter((signal) => !signal.done).slice(0, 4);

  return (
    <section className="grid gap-4 lg:grid-cols-[0.78fr_1.22fr]">
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
          <div className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-data text-[0.68rem] text-(--muted)">Adaptive workspace</p>
              <p className="mt-1 text-xs leading-5 text-(--muted)">{workspaceTypeDescription(workspaceType)}</p>
            </div>
            <select
              value={workspaceType}
              disabled={!signedInEmail || workspaceTypeSaving}
              onChange={(event) => onWorkspaceType(event.target.value as WorkspaceType)}
              className="field h-10 sm:w-40"
              aria-label="Adaptive workspace mode"
            >
              <option value="personal">Personal</option>
              <option value="family">Family</option>
              <option value="founder">Founder</option>
              <option value="team">Team</option>
            </select>
          </div>
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
        <p className="mt-3 text-xs leading-5 text-(--muted)">Do not enable browser save on shared machines. Local backups contain source text. Automatic encrypted sync is available only when the company-managed account service is active; revision conflicts pause uploads instead of overwriting another device.</p>
      </div>
    </section>
  );
}

function RecurringGraph({
  audit,
  selectedItem,
  userActions,
  categoryBudgets,
  onSelect,
}: {
  audit: AuditResult;
  selectedItem: RecurringItem | null;
  userActions: Record<string, RecommendationType>;
  categoryBudgets: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  const [sortBy, setSortBy] = useState<"cost" | "renewal">("cost");
  const sortedItems = [...audit.recurringItems].sort((left, right) => {
    if (sortBy === "renewal") return left.nextExpectedDate.localeCompare(right.nextExpectedDate) || right.monthlyCost - left.monthlyCost;
    return right.monthlyCost - left.monthlyCost || left.nextExpectedDate.localeCompare(right.nextExpectedDate);
  });
  const categorySpend = audit.recurringItems.reduce<Record<string, number>>((totals, item) => {
    if (item.currency === audit.summary.primaryCurrency) totals[item.category] = (totals[item.category] ?? 0) + item.monthlyCost;
    return totals;
  }, {});

  return (
    <section id="recurring-ledger" className="panel scroll-mt-36 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="folio" data-folio="2.1">Results</span>
          <h3 className="mt-2 font-display text-xl font-semibold text-(--ink)">Your subscriptions</h3>
          <p className="mt-1 text-sm text-(--muted)">{audit.summary.recurringCount} recurring payment{audit.summary.recurringCount === 1 ? "" : "s"}, each linked to proof.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-(--muted)">
          Sort
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "cost" | "renewal")} className="field h-10 w-auto py-0 text-xs" aria-label="Sort subscriptions">
            <option value="cost">Highest cost</option>
            <option value="renewal">Renews next</option>
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2" aria-label="Subscriptions list">
        {sortedItems.map((item) => {
          const action = userActions[item.identityKey] ?? item.recommendationType;
          const selected = selectedItem?.identityKey === item.identityKey;
          const categoryOverBudget = Boolean(categoryBudgets[item.category]) && categorySpend[item.category] > categoryBudgets[item.category];
          return (
            <button
              key={item.identityKey}
              type="button"
              onClick={() => onSelect(item.identityKey)}
              aria-pressed={selected}
              className={`group min-h-36 rounded-2xl border p-4 text-left transition ${selected ? "border-(--gold-line) bg-(--gold-tint)" : categoryOverBudget ? "border-ochre bg-(--gold-tint)" : "border-line bg-(--card-2) hover:border-(--line-strong)"}`}
            >
              <span className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card font-display text-lg font-semibold text-(--ink)" aria-hidden>{item.merchant.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate font-display text-lg font-semibold text-(--ink)">{item.merchant}</span>
                      <span className="mt-0.5 block truncate text-xs text-(--muted)">{item.category} · <span className="capitalize">{item.frequency}</span></span>
                    </span>
                    <span className="font-data text-lg font-semibold tnum text-(--ink)">{formatCurrency(item.monthlyCost, item.currency)}<span className="text-[0.62rem] font-normal text-(--muted)">/mo</span></span>
                  </span>
                  <span className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="pill pill-partial">{item.confidenceScore}% proof</span>
                    <span className={statusStyles[action]}>{action}</span>
                    {categoryOverBudget ? <span className="pill pill-blocked">Category over budget</span> : null}
                    {item.priceChange?.direction === "increase" ? <span className="pill pill-blocked">↑ was {formatCurrency(item.priceChange.previousAmount, item.currency)}</span> : null}
                  </span>
                  <span className="mt-3 flex items-center justify-between gap-2 font-data text-[0.68rem] text-(--muted)">
                    <span>Renews {item.nextExpectedDate}</span>
                    <span className="text-(--ink-soft) transition group-hover:translate-x-0.5">View proof →</span>
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// Renewal calendar — projects every proven cadence into the next debits, so the
// workspace answers "what renews next and what will it cost" before anything else.
function RenewalRadar({ timeline, onSelect, onOpenSubscriptions }: { timeline: RenewalTimeline; onSelect: (id: string) => void; onOpenSubscriptions: () => void }) {
  const { events, horizonDays } = timeline;
  const maxAmount = Math.max(1, ...events.map((event) => event.amount));
  const ticks = Array.from(new Set([0, 7, 15, 30, horizonDays]))
    .filter((tick) => tick <= horizonDays)
    .sort((left, right) => left - right);
  const nextEvent = events[0] ?? null;
  const trackHeight = 128;

  return (
    <section className="panel overflow-hidden p-5 sm:p-6" aria-labelledby="renewal-radar-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Renewal Radar · next {horizonDays} days</p>
          <h3 id="renewal-radar-heading" className="mt-1 font-display text-xl font-semibold text-(--ink)">
            {events.length ? `${formatCurrency(timeline.totalDue)} across ${events.length} proven debit${events.length === 1 ? "" : "s"}` : "No projected debits yet"}
          </h3>
        </div>
        {nextEvent ? (
          <button type="button" onClick={() => onSelect(nextEvent.itemId)} className="inset px-3 py-2 text-left transition hover:border-ember">
            <span className="eyebrow block" style={{ fontSize: "0.54rem" }}>Next up</span>
            <span className="mt-0.5 block text-sm font-semibold text-(--ink)">{nextEvent.merchant} · {formatCurrency(nextEvent.amount, nextEvent.currency)}</span>
            <span className="block font-data text-[0.62rem] text-(--muted)">{nextEvent.daysAway === 0 ? "today" : `in ${nextEvent.daysAway}d`} · {nextEvent.date}</span>
          </button>
        ) : null}
      </div>

      {events.length ? (
        <>
          <div className="relative mt-7 w-full" style={{ height: `${trackHeight}px` }}>
            {ticks.map((tick) => (
              <div key={`grid-${tick}`} className="absolute top-0 border-l border-line" style={{ left: `${(tick / horizonDays) * 100}%`, height: `${trackHeight}px`, opacity: 0.5 }} aria-hidden />
            ))}
            <div className="absolute inset-x-0 bottom-0 h-px bg-(--line-strong)" aria-hidden />
            {events.map((event) => {
              const leftPercent = Math.min(97.5, Math.max(2.5, (event.daysAway / horizonDays) * 100));
              const barHeight = Math.round(20 + (event.amount / maxAmount) * (trackHeight - 34));
              const dueSoon = event.daysAway <= 7;

              return (
                <button
                  key={`${event.itemId}-${event.date}`}
                  type="button"
                  onClick={() => onSelect(event.itemId)}
                  aria-label={`${event.merchant}, ${formatCurrency(event.amount, event.currency)}, renews ${event.daysAway === 0 ? "today" : `in ${event.daysAway} days`} (${event.date})`}
                  className="group absolute bottom-0 z-10 w-11 -translate-x-1/2 focus-visible:z-20"
                  style={{ left: `${leftPercent}%`, height: `${Math.max(44, barHeight)}px` }}
                >
                  <span
                    className="pointer-events-none absolute bottom-0 left-1/2 w-3 -translate-x-1/2 rounded-t-md transition group-hover:brightness-110"
                    style={{ height: `${barHeight}px`, background: dueSoon ? "var(--gold)" : "var(--muted)" }}
                    aria-hidden
                  />
                  <span
                    className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-data text-[0.54rem] text-(--ink-soft) opacity-0 transition group-hover:opacity-100 group-focus:opacity-100"
                    style={{ bottom: `${barHeight + 4}px` }}
                  >
                    {event.merchant.split(" ")[0]}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative mt-1.5 h-4 w-full">
            {ticks.map((tick) => (
              <span
                key={`tick-${tick}`}
                className="absolute font-data text-[0.56rem] text-(--muted)"
                style={{ left: `${(tick / horizonDays) * 100}%`, transform: tick === 0 ? "translateX(0)" : tick === horizonDays ? "translateX(-100%)" : "translateX(-50%)" }}
              >
                {tick === 0 ? "today" : `+${tick}d`}
              </span>
            ))}
          </div>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
            <MiniStat label="Due in 7 days" value={formatCurrency(timeline.dueNext7Days)} proofEntries={events.filter((event) => event.daysAway <= 7).map(renewalEventProofEntry)} proofEmptyText="No proven debit is due in seven days." />
            <MiniStat label="Due in 30 days" value={formatCurrency(timeline.dueNext30Days)} proofEntries={events.filter((event) => event.daysAway <= 30).map(renewalEventProofEntry)} proofEmptyText="No proven debit is due in 30 days." />
            <MiniStat label={`Total in ${horizonDays} days`} value={formatCurrency(timeline.totalDue)} proofEntries={events.map(renewalEventProofEntry)} proofEmptyText="No proven debit is due in this window." />
          </div>
        </>
      ) : <TaskEmptyState sentence={`No projected debit is proven in the next ${horizonDays} days.`} actionLabel="Review subscriptions" onAction={onOpenSubscriptions} />}
    </section>
  );
}

function RenewalTimelinePanel({ timeline, onSelect, onConnect }: { timeline: RenewalTimeline; onSelect: (id: string) => void; onConnect: () => void }) {
  const visibleEvents = 12;

  return (
    <section className="panel p-5 sm:p-6">
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
            <MiniStat label="Due in 7 days" value={formatCurrency(timeline.dueNext7Days)} proofEntries={timeline.events.filter((event) => event.daysAway <= 7).map(renewalEventProofEntry)} proofEmptyText="No proven debit is due in seven days." />
            <MiniStat label="Due in 30 days" value={formatCurrency(timeline.dueNext30Days)} proofEntries={timeline.events.filter((event) => event.daysAway <= 30).map(renewalEventProofEntry)} proofEmptyText="No proven debit is due in 30 days." />
            <MiniStat label={`Total in ${timeline.horizonDays} days`} value={formatCurrency(timeline.totalDue)} proofEntries={timeline.events.map(renewalEventProofEntry)} proofEmptyText="No proven debit is due in this window." />
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
      ) : <TaskEmptyState sentence="No projected renewals are proven in this window yet." actionLabel="Connect evidence" onAction={onConnect} />}
    </section>
  );
}

function renewalEventProofEntry(event: RenewalTimeline["events"][number]) {
  return {
    key: `${event.itemId}-${event.date}`,
    label: event.merchant,
    detail: `${formatRenewalDay(event.date)} · ${formatCurrency(event.amount, event.currency)}`,
  };
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

// Relative countdown for a YYYY-MM-DD renewal date, computed against local
// midnight so "in 3d" stays stable regardless of the current time of day.
function renewalCountdown(dateStr: string): string | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - startToday.getTime()) / 86_400_000);
  if (days === 0) return "today";
  return days > 0 ? `in ${days}d` : `${Math.abs(days)}d ago`;
}

function DetailStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="inset p-3">
      <p className="eyebrow" style={{ fontSize: "0.58rem" }}>{label}</p>
      <p className="font-data mt-1.5 text-base font-semibold tnum text-(--ink)">{value}</p>
      {sub ? <p className="mt-0.5 font-data text-[0.6rem] text-(--muted)">{sub}</p> : null}
    </div>
  );
}

// WP-1.3 — the subscription detail sheet. Opens in place on any card tap so
// the proof, history, and Keep/Watch/Cancel-guide are reachable in one tap from
// Home or Subscriptions. Reuses recordAction, the commitment policy, and the
// existing cancel-action registry; "Open full review" hands off to the inline
// deep-dive + assisted-cancel flow.
function SubscriptionDetailSheet({
  item,
  action,
  onAction,
  onOpenFullReview,
  onClose,
}: {
  item: RecurringItem;
  action: RecommendationType;
  onAction: (action: RecommendationType) => void;
  onOpenFullReview: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const policy = getCommitmentPolicy(item.category);
  const cancelGuide = findCancelAction(item.merchant, item.category);
  const allowedActions = recommendationActions.filter((candidate) => isReviewActionAllowed(item.category, candidate.value));
  const countdown = renewalCountdown(item.nextExpectedDate);
  // identityKey carries spaces/colons ("google one::INR::…"); a raw id would be
  // read by aria-labelledby as several missing references, so slugify it.
  const headingId = `subscription-detail-${item.identityKey.replace(/[^a-z0-9]+/gi, "-")}`;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Escape (window keydown above) is the keyboard close path; backdrop click is a pointer-only convenience.
    <div
      className="fixed inset-0 z-70 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only stops backdrop-close propagation for pointer clicks; keyboard flow is unaffected. */}
      <section
        className="panel flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-b-none rounded-t-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-4 border-b border-line bg-(--card-2) p-5 sm:p-6">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-line bg-card font-display text-xl font-semibold text-(--ink)" aria-hidden>{item.merchant.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="truncate font-display text-2xl font-semibold text-(--ink)">{item.merchant}</h2>
            <p className="mt-1 text-sm text-(--muted)">{item.category} · <span className="capitalize">{item.frequency}</span></p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="pill pill-partial">{item.confidenceScore}% proof</span>
              <span className={statusStyles[action]}>{action}</span>
              {item.priceChange?.direction === "increase" ? <span className="pill pill-blocked">↑ was {formatCurrency(item.priceChange.previousAmount, item.currency)}</span> : null}
            </div>
          </div>
          <button type="button" autoFocus onClick={onClose} aria-label="Close subscription details" className="btn btn-ghost grid size-9 shrink-0 place-items-center p-0 text-lg leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <DetailStat label={`Monthly · ${item.currency}`} value={`${formatCurrency(item.monthlyCost, item.currency)}`} />
            <DetailStat label="Annual" value={formatCurrency(item.annualCost, item.currency)} />
            <DetailStat label="Renews" value={countdown ?? item.nextExpectedDate} sub={countdown ? item.nextExpectedDate : undefined} />
            <DetailStat label="Amount range" value={`${formatCurrency(item.amountMin, item.currency)} – ${formatCurrency(item.amountMax, item.currency)}`} />
            <DetailStat label="Proof rows" value={`${item.evidence.length}`} />
            {item.priceChange ? (
              <DetailStat label={`Price ${item.priceChange.direction === "increase" ? "up" : "down"} ${item.priceChange.changePercent}%`} value={`${formatCurrency(item.priceChange.previousAmount, item.currency)} → ${formatCurrency(item.priceChange.latestAmount, item.currency)}`} />
            ) : item.missedCycles >= 2 ? (
              <DetailStat label="Evidence gap" value={`${item.missedCycles} cycles`} />
            ) : null}
          </div>

          <div className="mt-5">
            <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Your decision</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Choose an action for this subscription">
              {allowedActions.map((candidate) => {
                const active = candidate.value === action;
                return (
                  <button
                    key={candidate.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onAction(candidate.value)}
                    className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition ${active ? "border-(--gold-line) bg-(--gold-tint) text-(--ink)" : "border-line bg-(--card-2) text-(--ink-soft) hover:border-(--line-strong)"}`}
                  >
                    {candidate.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-5 text-ochre">{policy.consequenceWarning}</p>
          </div>

          {cancelGuide ? (
            <div className="mt-5 rounded-xl border border-line bg-(--card-2) p-4">
              <p className="font-display text-base font-semibold text-(--ink)">{cancelGuide.kind === "rail-guide" ? "How to stop this payment" : "Manage at the official account"}</p>
              <ol className="mt-3 grid gap-1 text-xs leading-5 text-(--ink-soft)">
                {cancelGuide.steps.map((step, index) => <li key={step}>{index + 1}. {step}</li>)}
              </ol>
              {cancelGuide.caveat ? <p className="mt-2 text-xs leading-5 text-ochre">{cancelGuide.caveat}</p> : null}
              {cancelGuide.manageUrl ? <a href={cancelGuide.manageUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost mt-3 h-9 px-3 text-xs">Open {manageUrlHostname(cancelGuide)} ↗</a> : null}
            </div>
          ) : null}

          <div className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow" style={{ fontSize: "0.6rem" }}>Proof · where this came from</p>
              <span className="truncate font-data text-[0.62rem] text-(--muted)">{item.sourceNames.join(", ")}</span>
            </div>
            {item.evidence.length ? (
              <div className="mt-2 overflow-hidden rounded-xl border border-line">
                <table className="w-full border-separate border-spacing-0 text-left text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-line bg-(--card-2) px-3 py-2 font-data text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-(--muted)">Date</th>
                      <th className="border-b border-line bg-(--card-2) px-3 py-2 font-data text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-(--muted)">Amount</th>
                      <th className="border-b border-line bg-(--card-2) px-3 py-2 font-data text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-(--muted)">Statement text</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.evidence.map((evidence) => (
                      <tr key={`${evidence.source}-${evidence.rowNumber}-${evidence.date}`}>
                        <td className="border-t border-line px-3 py-2 font-data text-xs text-(--muted)">{evidence.date}</td>
                        <td className="border-t border-line px-3 py-2 font-data font-semibold tnum text-(--ink)">{formatCurrency(evidence.amount, item.currency)}</td>
                        <td className="border-t border-line px-3 py-2 text-(--ink-soft)">{evidence.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-(--muted)">No individual proof rows yet — this pattern is inferred from summary evidence.</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line p-4">
          <button type="button" onClick={onOpenFullReview} className="btn btn-ghost h-10 px-3 text-sm">Open full review →</button>
          <button type="button" onClick={onClose} className="btn btn-primary h-10 px-4 text-sm">Done</button>
        </div>
      </section>
    </div>
  );
}

function SelectedItemPanel({ item, action, onAction }: { item: RecurringItem; action: RecommendationType; onAction: (action: RecommendationType) => void }) {
  const confidence = getConfidenceStory(item);
  const policy = getCommitmentPolicy(item.category);
  const allowedReviewActions = recommendationActions.filter((candidate) => isReviewActionAllowed(item.category, candidate.value));
  const displayedAction = allowedReviewActions.some((candidate) => candidate.value === action) ? action : "investigate";
  const managementTarget = getCommitmentManagementTarget(item);
  const cancelGuide = findCancelAction(item.merchant, item.category);

  return (
    <section className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr]">
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
        {cancelGuide || managementTarget ? (
          <div className="mt-4 rounded-[11px] border p-4" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
            <p className="font-display text-base font-semibold text-(--dossier-ink)">{cancelGuide?.kind === "rail-guide" ? "How to stop this payment" : "Continue at the official account"}</p>
            <p className="mt-2 text-xs leading-5 muted-on-dark">Vognary takes you directly to the provider&apos;s own management surface. You keep control of the final confirmation; if the source remains connected, later evidence can verify the financial outcome.</p>
            {cancelGuide ? (
              <ol className="mt-3 grid gap-1 text-xs leading-5 muted-on-dark">
                {cancelGuide.steps.map((step, index) => <li key={step}>{index + 1}. {step}</li>)}
              </ol>
            ) : null}
            {cancelGuide?.caveat ? <p className="mt-2 text-xs leading-5 text-ochre">{cancelGuide.caveat}</p> : null}
            {cancelGuide?.manageUrl ? (
              <a href={cancelGuide.manageUrl} target="_blank" rel="noreferrer" className="btn btn-ondark mt-3 h-9 px-3 text-xs">Open {manageUrlHostname(cancelGuide)}</a>
            ) : managementTarget ? (
              <a href={managementTarget.url} target="_blank" rel="noreferrer" className="btn btn-ondark mt-3 h-9 px-3 text-xs">Open {managementTarget.label}</a>
            ) : null}
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

function ConciergeOutcomePanel({
  item,
  selectedAction,
  actionCase,
  authorizationRequest,
  available,
  signedIn,
  busy,
  onStart,
  onAuthorize,
  onWithdraw,
  onDispute,
}: {
  item: RecurringItem;
  selectedAction: RecommendationType;
  actionCase: ServerActionCase | null;
  authorizationRequest: { actionCase: ServerActionCase; preview: AuthorizationPreview } | null;
  available: boolean;
  signedIn: boolean;
  busy: boolean;
  onStart: (action: "cancel" | "downgrade") => void;
  onAuthorize: () => void;
  onWithdraw: (id: string) => void;
  onDispute: (id: string) => void;
}) {
  const policy = getCommitmentPolicy(item.category);
  const executableAction = selectedAction === "cancel" || selectedAction === "downgrade" ? selectedAction : null;
  if (!actionCase && (!available || policy.class !== "discretionary-subscription" || !executableAction)) return null;
  const preview = authorizationRequest?.preview ?? actionCase?.authorizationPreview ?? null;
  const withdrawable = actionCase && ["awaiting-authorization", "authorized", "in-progress", "provider-pending"].includes(actionCase.status);
  const disputable = actionCase && ["executed", "verifying", "verified"].includes(actionCase.status);

  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="concierge-outcome-heading">
      <SectionHead
        folio="2.8"
        kicker="Permissioned outcome"
        title="From decision to proven result"
        desc="Vognary can carry out one explicitly authorized action, then watch the commitment's own debit windows. Only the proof worker—not an operator—can mark the saving verified."
        right={actionCase ? <span className={actionCaseStatusClass(actionCase.status)}>{formatCaseStatus(actionCase.status)}</span> : <span className="pill pill-ready">Available</span>}
      />
      {!actionCase && executableAction ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-(--gold-line) bg-(--card-2) p-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h4 id="concierge-outcome-heading" className="text-sm font-semibold text-(--ink)">Ask Vognary to {executableAction} {item.merchant}</h4>
            <p className="mt-1 text-xs leading-5 text-(--muted)">First Vognary opens a case and shows the exact scope and maximum fee. Nothing starts until you accept that one-action authorization.</p>
          </div>
          <button type="button" disabled={busy} onClick={() => onStart(executableAction)} className="btn btn-primary disabled:opacity-60">
            {busy ? "Opening case…" : signedIn ? "Review authorization" : "Sign in to continue"}
          </button>
        </div>
      ) : null}
      {actionCase ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="inset p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-display text-lg font-semibold text-(--ink)">{actionCase.merchant} · {actionCase.action}</p>
                <p className="mt-1 font-data text-[0.66rem] uppercase tracking-[0.12em] text-(--muted)">Case {actionCase.id.slice(0, 8)} · updated {new Date(actionCase.updatedAt).toLocaleString("en-IN")}</p>
              </div>
              <span className={actionCaseStatusClass(actionCase.status)}>{formatCaseStatus(actionCase.status)}</span>
            </div>
            <ol className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" aria-label="Action case progress">
              {[
                ["Authorized", actionCase.authorization !== null],
                ["Executed", ["executed", "verifying", "verified"].includes(actionCase.status)],
                ["Proof window", ["verifying", "verified"].includes(actionCase.status)],
                ["Verified", actionCase.status === "verified"],
              ].map(([label, done]) => (
                <li key={String(label)} className={`rounded-lg border px-2 py-2 ${done ? "border-verdict bg-(--verdict-tint) text-verdict" : "border-line text-(--muted)"}`}>{String(label)}</li>
              ))}
            </ol>
            {actionCase.receipt ? (
              <div className="mt-4 rounded-lg border border-verdict bg-(--verdict-tint) p-3">
                <p className="text-sm font-semibold text-verdict">Verified {formatCurrency(actionCase.receipt.verifiedAnnualSaving, actionCase.currency)}/year stopped leaving</p>
                <p className="mt-1 text-xs leading-5 text-(--muted)">A durable checksummed receipt is attached to the Proof Graph. The success-fee review remains separate and disputable.</p>
              </div>
            ) : null}
          </div>
          <div className="inset p-4">
            <p className="eyebrow">Commercial guardrail</p>
            <p className="mt-2 text-sm leading-6 text-(--ink-soft)">No verified saving, no success-fee invoice. The maximum authorized fee for this case is <strong className="text-(--ink)">{formatMinorCurrency(actionCase.maximumSuccessFeeMinor, actionCase.currency)}</strong>.</p>
            {actionCase.invoice ? (
              <p className="mt-3 rounded-lg border border-line bg-card p-3 text-xs leading-5 text-(--muted)">Invoice: <strong className="text-(--ink)">{formatMinorCurrency(actionCase.invoice.amountMinor, actionCase.currency)}</strong> · {formatCaseStatus(actionCase.invoice.status)}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {withdrawable ? <button type="button" disabled={busy} onClick={() => onWithdraw(actionCase.id)} className="btn btn-ghost btn-sm disabled:opacity-60">Withdraw authorization</button> : null}
              {disputable ? <button type="button" disabled={busy} onClick={() => onDispute(actionCase.id)} className="btn btn-ghost btn-sm disabled:opacity-60">Dispute result</button> : null}
            </div>
          </div>
        </div>
      ) : null}
      {actionCase?.status === "awaiting-authorization" && preview ? (
        <div className="mt-4 rounded-xl border border-ochre bg-(--ochre-tint) p-4">
          <p className="eyebrow text-ochre">Read before authorizing</p>
          <p className="mt-2 text-sm leading-6 text-(--ink)">{preview.text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={onAuthorize} className="btn btn-primary disabled:opacity-60">{busy ? "Recording…" : "Authorize this one action"}</button>
            <span className="font-data text-[0.66rem] text-(--muted)">Terms {preview.termsVersion} · scope {preview.scope}</span>
          </div>
        </div>
      ) : null}
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

function DossierStat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const content = <><p className="font-data text-[0.54rem] uppercase tracking-[0.18em]" style={{ color: "var(--dossier-muted)" }}>{label}</p><p className="font-data mt-1.5 text-sm font-semibold tnum text-(--dossier-ink)">{value}</p></>;
  if (onClick) return <button type="button" onClick={onClick} className="rounded-[9px] border px-3 py-2.5 text-left transition hover:border-(--gold)" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }} aria-label={`${label}: ${value}. Open subscriptions`}>{content}</button>;
  return (
    <div className="rounded-[9px] border px-3 py-2.5" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
      {content}
    </div>
  );
}

function TeamReviewPanel({
  audit,
  collaborative,
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
  onOpenSubscriptions,
  onSelect,
}: {
  audit: AuditResult;
  collaborative: boolean;
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
  onOpenSubscriptions: () => void;
  onSelect: (id: string) => void;
}) {
  const assignedCount = audit.recurringItems.filter((item) => itemOwners[item.identityKey]).length;
  const actionedCount = audit.recurringItems.filter((item) => ["cancel", "downgrade", "investigate", "watch"].includes(item.recommendationType)).length;

  if (!audit.recurringItems.length) {
    return (
      <section className="panel p-5 sm:p-6">
        <SectionHead folio="3.3" kicker="Review" title="Monthly review" />
        <TaskEmptyState sentence="No proven commitment is ready for review yet." actionLabel="Open subscriptions" onAction={onOpenSubscriptions} />
      </section>
    );
  }

  return (
    <section className="panel p-5 sm:p-6">
      <SectionHead
        folio="3.3"
        kicker="Review"
        title={collaborative ? "Shared monthly review" : "Personal monthly review"}
        desc={collaborative ? "Assign payments to owners, record notes, and close the monthly review." : "Record why each payment stays or changes, then close the review."}
        right={<button type="button" onClick={onCompleteReview} className="btn btn-primary">Mark review complete</button>}
      />
      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        <MiniStat label={collaborative ? "Reviewers" : "Workspace"} value={collaborative ? `${teamMembers.length}` : "Personal"} />
        <MiniStat label="Assigned items" value={`${assignedCount}/${audit.recurringItems.length}`} />
        <MiniStat label="Needs review" value={`${actionedCount}`} />
      </div>
      {reviewCompletedAt ? <p className="mt-3 rounded-md border border-verdict bg-(--verdict-tint) px-3 py-2 text-sm text-verdict">Review completed at {new Date(reviewCompletedAt).toLocaleString("en-IN")}.</p> : null}

      {collaborative ? <div className="mt-4 inset p-4">
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
      </div> : null}

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
                <td className="border-t border-line px-4 py-3"><button type="button" onClick={() => onSelect(item.identityKey)} className="font-data tnum text-(--ink-soft) underline decoration-line underline-offset-4 transition hover:text-(--ink)" aria-label={`Open proof for ${item.merchant}, ${formatCurrency(item.monthlyCost, item.currency)} monthly`}>{formatCurrency(item.monthlyCost, item.currency)}</button></td>
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
    <section className="panel p-5 sm:p-6">
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
    <section className="panel p-5 sm:p-6">
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
function VerifiedSavingsPanel({
  savings,
  onSelect,
  onOpenSubscriptions,
  onShareProof,
  onMintReceipt,
  onDownloadCard,
  onCopyShareText,
}: {
  savings: VerifiedSavingsSummary;
  onSelect: (id: string) => void;
  onOpenSubscriptions: () => void;
  onShareProof: () => void;
  onMintReceipt: () => void;
  onDownloadCard: () => void;
  onCopyShareText: () => void;
}) {
  const hasVerified = savings.verifiedAnnual > 0;
  return (
    <section className="panel p-5 sm:p-6">
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
            <MiniStat label="Verified savings" value={`${formatCurrency(savings.verifiedMonthly)}/mo`} proofEntries={savings.entries.filter((entry) => entry.status === "verified").map((entry) => ({ key: entry.itemId, label: entry.merchant, detail: `${formatCurrency(entry.monthlySaving, entry.currency)}/mo` }))} proofEmptyText="No saving has been verified yet." />
            <MiniStat label="Verified annual" value={formatCurrency(savings.verifiedAnnual)} proofEntries={savings.entries.filter((entry) => entry.status === "verified").map((entry) => ({ key: entry.itemId, label: entry.merchant, detail: `${formatCurrency(entry.annualSaving, entry.currency)}/yr` }))} proofEmptyText="No annual saving has been verified yet." />
            <MiniStat label="Pending proof" value={`${formatCurrency(savings.pendingMonthly)}/mo`} proofEntries={savings.entries.filter((entry) => entry.status !== "verified").map((entry) => ({ key: entry.itemId, label: entry.merchant, detail: `${formatCurrency(entry.monthlySaving, entry.currency)}/mo · ${entry.status}` }))} proofEmptyText="No saving is waiting for proof." />
          </div>
          {hasVerified ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-(--gold-line) bg-(--card-2) p-4">
              <Nakul pose="celebrate" size={56} className="shrink-0 text-(--ink)" title="Nakul celebrating a verified saving" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-(--ink)">Money you verifiably stopped paying</p>
                <p className="mt-0.5 text-xs leading-5 text-(--muted)">
                  Mint the sealed receipt — a checkable proof of {formatCurrency(savings.verifiedAnnual)}/yr, not a claim. Anyone can verify it at /verify without seeing your data.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onShareProof} className="btn btn-primary btn-sm">Share proof</button>
                <button type="button" onClick={onMintReceipt} className="btn btn-primary btn-sm">Mint sealed receipt</button>
                <button type="button" onClick={onDownloadCard} className="btn btn-ghost btn-sm">Download share card</button>
                <button type="button" onClick={onCopyShareText} className="btn btn-ghost btn-sm">Copy share text</button>
              </div>
            </div>
          ) : null}
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
      ) : <TaskEmptyState sentence="No cancel or downgrade decision is waiting for savings proof." actionLabel="Review subscriptions" onAction={onOpenSubscriptions} />}
    </section>
  );
}

// Month-over-month diff — the review opens with what changed, not a cold table.
function SinceLastReviewPanel({ diff, onSelectMerchant }: { diff: ReviewDiff; onSelectMerchant: () => void }) {
  const deltaTone = diff.monthlyDelta > 0 ? "text-ember" : diff.monthlyDelta < 0 ? "text-verdict" : "text-(--muted)";

  return (
    <section className="panel p-5 sm:p-6">
      <SectionHead
        folio="3.1"
        kicker="Since last review"
        title={`What changed in ${diff.daysSincePrevious} day(s)`}
        desc={`Compared against the review completed on ${diff.previousTakenAt.slice(0, 10)}.`}
        right={<span className={`font-data text-xs tnum ${deltaTone}`}>{diff.monthlyDelta >= 0 ? "+" : ""}{formatCurrency(diff.monthlyDelta)}/mo</span>}
      />
      <ProofDisclosure
        entries={[
          ...diff.added.map((item) => ({ key: `added-${item.key}`, label: `${item.merchant} · added`, detail: `+${formatCurrency(item.monthlyCost, item.currency)}/mo` })),
          ...diff.removed.map((item) => ({ key: `removed-${item.key}`, label: `${item.merchant} · removed`, detail: `−${formatCurrency(item.monthlyCost, item.currency)}/mo` })),
          ...diff.priceChanges.map((change, index) => ({ key: `price-${change.merchant}-${index}`, label: `${change.merchant} · price ${change.direction}`, detail: `${formatCurrency(change.fromAmount, change.currency)} → ${formatCurrency(change.toAmount, change.currency)}` })),
        ]}
        emptyText="No added, removed, or price-changed commitment composes this delta."
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
function ProofGraphPanel({ graph, audit, onConnect }: { graph: ProofGraphSummary; audit: AuditResult; onConnect: () => void }) {
  const singleShare = Math.round(graph.singleSourceShare * 100);

  return (
    <section className="panel p-5 sm:p-6">
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
            <MiniStat label="Single-source spend" value={`${formatCurrency(graph.singleSourceMonthly)}/mo (${singleShare}%)`} proofEntries={audit.recurringItems.filter((item) => item.currency === audit.summary.primaryCurrency && new Set(item.sourceNames.map((name) => name.toLowerCase())).size <= 1).map((item) => ({ key: item.identityKey, label: item.merchant, detail: `${formatCurrency(item.monthlyCost, item.currency)}/mo · ${item.sourceNames.length || 0} source` }))} proofEmptyText="No primary-currency spend rests on one source." />
            <MiniStat label="Multi-source spend" value={`${formatCurrency(graph.multiSourceMonthly)}/mo`} proofEntries={audit.recurringItems.filter((item) => item.currency === audit.summary.primaryCurrency && new Set(item.sourceNames.map((name) => name.toLowerCase())).size > 1).map((item) => ({ key: item.identityKey, label: item.merchant, detail: `${formatCurrency(item.monthlyCost, item.currency)}/mo · ${new Set(item.sourceNames.map((name) => name.toLowerCase())).size} sources` }))} proofEmptyText="No commitment is corroborated by multiple sources yet." />
            <MiniStat label="Stale evidence" value={`${formatCurrency(graph.staleMonthly)}/mo`} proofEntries={audit.recurringItems.filter((item) => item.currency === audit.summary.primaryCurrency && item.missedCycles >= 2).map((item) => ({ key: item.identityKey, label: item.merchant, detail: `${formatCurrency(item.monthlyCost, item.currency)}/mo · ${item.missedCycles} missed cycles` }))} proofEmptyText="No primary-currency evidence is stale." />
            <MiniStat label="Avg proof rows" value={graph.averageProofRows.toFixed(1)} proofEntries={audit.recurringItems.map((item) => ({ key: item.identityKey, label: item.merchant, detail: `${item.evidence.length} proof row${item.evidence.length === 1 ? "" : "s"}` }))} proofEmptyText="No proof rows are available." />
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
      ) : <TaskEmptyState sentence="No proof structure is available until evidence forms a recurring commitment." actionLabel="Connect evidence" onAction={onConnect} />}
    </section>
  );
}

function ReadinessPanel() {
  return (
    <section className="panel p-5 sm:p-6">
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

function SpendSpectrum({ audit, userActions, onSelect, onConnect }: { audit: AuditResult; userActions: Record<string, RecommendationType>; onSelect: (id: string) => void; onConnect: () => void }) {
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
      ) : <TaskEmptyState
        sentence={hasForeignItems ? `No ${audit.summary.primaryCurrency} commitments are available for this chart.` : "No merchant spend is proven yet."}
        actionLabel={hasForeignItems ? "Open a commitment" : "Connect evidence"}
        onAction={() => {
          const firstItem = audit.recurringItems[0];
          if (firstItem) onSelect(firstItem.identityKey);
          else onConnect();
        }}
      />}
    </section>
  );
}

function TickerStat({ label, value, tone, onClick }: { label: string; value: string; tone: "ember" | "ochre" | "paper"; onClick?: () => void }) {
  const color = tone === "ember" ? "var(--ember)" : tone === "ochre" ? "var(--ochre)" : "var(--dossier-ink)";
  return (
    <button type="button" onClick={onClick} className="flex items-baseline gap-2 text-left" aria-label={`${label}: ${value}. Open subscriptions`}>
      <span className="eyebrow muted-on-dark" style={{ fontSize: "0.58rem" }}>{label}</span>
      <span className="font-data text-sm font-medium tnum" style={{ color }}>{value}</span>
    </button>
  );
}

function SectionHead({ folio, kicker, title, desc, right }: { folio: string; kicker: string; title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <span className="folio" data-folio={folio}>{kicker}</span>
        <h3 className="mt-2 font-display text-[1.22rem] font-semibold text-(--ink)">{title}</h3>
        {desc ? (
          <details className="mt-1 max-w-xl">
            <summary className="cursor-pointer select-none font-data text-[0.64rem] uppercase tracking-[0.12em] text-(--muted) transition hover:text-(--ink)">How this works</summary>
            <p className="mt-1 text-sm leading-6 text-(--muted)">{desc}</p>
          </details>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

type AggregateProofEntry = { key: string; label: string; detail: string };

function Metric({ label, value, tone, proofEntries, proofEmptyText }: { label: string; value: string; tone: "ink" | "blue" | "caution" | "accent"; proofEntries?: AggregateProofEntry[]; proofEmptyText?: string }) {
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
      {proofEntries ? <ProofDisclosure entries={proofEntries} emptyText={proofEmptyText ?? "No evidence composes this value."} /> : null}
      <span className="mt-3 block h-px w-full" style={{ background: `color-mix(in srgb, ${color} 40%, var(--line))` }} />
    </div>
  );
}

function MiniStat({ label, value, proofEntries, proofEmptyText }: { label: string; value: string; proofEntries?: AggregateProofEntry[]; proofEmptyText?: string }) {
  return (
    <div className="inset px-3 py-2.5">
      <p className="eyebrow" style={{ fontSize: "0.62rem" }}>{label}</p>
      <p className="font-data mt-1.5 text-sm font-semibold tnum text-(--ink)">{value}</p>
      {proofEntries ? <ProofDisclosure entries={proofEntries} emptyText={proofEmptyText ?? "No evidence composes this value."} /> : null}
    </div>
  );
}

function TaskEmptyState({ sentence, actionLabel, onAction }: { sentence: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="inset mt-4 flex flex-col items-center gap-4 px-4 py-6 text-center">
      <p className="text-sm leading-6 text-(--muted)">{sentence}</p>
      <button type="button" onClick={onAction} className="btn btn-primary h-9 px-3 text-xs">{actionLabel}</button>
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
    { label: "Google identity", value: "Company activation is required before Google sign-in is publicly available", state: "partial" as const },
    { label: "Email receipts", value: "Optional receipt sync remains unavailable until provider approval is complete", state: "partial" as const },
    { label: "Cloud and AI tools", value: "Organization billing sources require source-specific administrator approval", state: "partial" as const },
    { label: "App-store subscriptions", value: "Apple and Google Play need official source access or provider-supported evidence", state: "planned" as const },
    { label: "Bank/card data", value: "Needs Account Aggregator, issuer, network, or payment partner access", state: "blocked" as const },
    { label: "UPI/card mandates", value: "Needs an approved issuer, bank, network, or regulated partner connection", state: "blocked" as const },
  ];
}

function getReadinessItems() {
  return [
    { label: "Integration launchpad", value: "Users connect consent rails and save merchant watches without implying direct merchant access", state: "ready" as const },
    { label: "Recurring ledger", value: "Connected evidence lands in one review table with next debit and action labels", state: "ready" as const },
    { label: "Data handling", value: "Signed-in workspaces automatically synchronize encrypted state and normalized upload/manual ledger rows; browser mode remains a local fallback", state: "ready" as const },
    { label: "Exports", value: "JSON audit pack export remains available from the review workspace", state: "ready" as const },
    { label: "Company-managed connections", value: "Every automatic source requires its own approved access path", state: "partial" as const },
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
  merchantLinks,
  monthlyBudget,
  categoryBudgets,
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
  merchantLinks?: string[];
  monthlyBudget?: number | null;
  categoryBudgets?: Record<string, number>;
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
    merchantLinks: sanitizeMerchantLinks(merchantLinks),
    monthlyBudget: sanitizeBudget(monthlyBudget),
    categoryBudgets: sanitizeCategoryBudgets(categoryBudgets),
  };
}

function sanitizeMerchantLinks(value: unknown) {
  if (!Array.isArray(value)) return [];
  const known = new Set(merchantTiles.map((tile) => tile.id));
  return [...new Set(value.filter((id): id is string => typeof id === "string" && known.has(id)))];
}

function sanitizeBudget(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100_000_000) return null;
  return Math.round(value * 100) / 100;
}

function sanitizeCategoryBudgets(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const budgets: Record<string, number> = {};
  for (const [category, rawBudget] of Object.entries(value)) {
    const budget = sanitizeBudget(rawBudget);
    if (category.trim() && category.length <= 100 && budget !== null) budgets[category] = budget;
  }
  return budgets;
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

function buildGuestTransferNotice(guest: GuestAuditSnapshot) {
  const commitmentCount = analyzeStatements(
    guest.statementSources.map(({ name, text }) => ({ name, text })),
    [...guest.manualItems, ...receiptTextToManualInputs(guest.receiptText)],
  ).summary.recurringCount;
  return `${commitmentCount} commitment${commitmentCount === 1 ? "" : "s"} carried into your encrypted workspace. The same-tab transfer copy has been cleared.`;
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

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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

function resolveServerCommitmentId(item: RecurringItem, commitments: ServerRecurringItem[]): string | null {
  if (item.canonicalRecurringItemId && commitments.some((candidate) => candidate.id === item.canonicalRecurringItemId)) {
    return item.canonicalRecurringItemId;
  }

  const merchant = item.normalizedMerchant.trim().toLowerCase();
  const exact = commitments.find((candidate) => (
    candidate.normalizedMerchant.trim().toLowerCase() === merchant
    && candidate.currency === item.currency
    && candidate.frequency === item.frequency
  ));
  if (exact) return exact.id;

  const sameMerchant = commitments
    .filter((candidate) => candidate.normalizedMerchant.trim().toLowerCase() === merchant && candidate.currency === item.currency)
    .sort((left, right) => Math.abs(left.monthlyCost - item.monthlyCost) - Math.abs(right.monthlyCost - item.monthlyCost));
  return sameMerchant[0]?.id ?? null;
}

function workspaceTypeLabel(workspaceType: WorkspaceType): string {
  return {
    personal: "Personal",
    family: "Family",
    founder: "Founder",
    team: "Team",
  }[workspaceType];
}

function workspaceTypeDescription(workspaceType: WorkspaceType): string {
  return {
    personal: "A private recurring-money review built around your own evidence and decisions.",
    family: "Shared household commitments, ownership, and review notes in one accountable workspace.",
    founder: "Founder subscriptions, cloud costs, and renewal decisions organized around runway.",
    team: "Collaborative recurring-spend review with assignments, notes, and an auditable decision trail.",
  }[workspaceType];
}

function actionCaseStatusClass(status: string): string {
  if (status === "verified") return "pill pill-ready";
  if (["failed", "withdrawn", "disputed"].includes(status)) return "pill pill-blocked";
  if (["authorized", "in-progress", "provider-pending", "executed", "verifying"].includes(status)) return "pill pill-partial";
  return "pill pill-planned";
}

function formatCaseStatus(status: string): string {
  return status
    .replace(/_/g, "-")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function formatMinorCurrency(valueMinor: number, currency = "INR"): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(valueMinor / 100);
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
