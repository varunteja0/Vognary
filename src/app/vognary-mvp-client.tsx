"use client";

import { useEffect, useMemo, useState } from "react";
import { connectors, type Connector, type ConnectorStatus } from "@/lib/connectors";
import {
  analyzeStatements,
  type AuditResult,
  type Frequency,
  type ManualRecurringInput,
  type RecommendationType,
  type RecurringItem,
  type StatementSource,
} from "@/lib/recurring-audit";
import type { ReceiptCandidate } from "@/lib/receipt-parser";
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
  kind?: "csv" | "pdf";
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
};

type ServerConnectedAccount = {
  id: string;
  connectorId: string;
  providerAccountId: string | null;
  displayName: string;
  status: string;
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

type WorkspaceConnectorStatusPayload = {
  status?: string;
  accounts?: ServerConnectedAccount[];
  evidence?: ServerConnectorEvidence[];
  error?: string;
  message?: string;
};

type ExperienceMode = "signed-in" | "guest" | "demo";

type IngestSourcePayload = {
  name: string;
  text: string;
  kind?: "csv" | "pdf";
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
  live: "Live",
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
  { id: "connect", folio: "01", label: "Connect", title: "Connect evidence", note: "Bring receipts, statements, and provider sources into one workspace." },
  { id: "ledger", folio: "02", label: "Ledger", title: "Recurring ledger", note: "Every detected item with proof, cadence, and a decision." },
  { id: "review", folio: "03", label: "Review", title: "Monthly review", note: "Assign owners, capture notes, and close the review." },
  { id: "data", folio: "04", label: "Data", title: "Data & readiness", note: "Control where data lives and what is already live." },
] as const;

const workspaceSectionIds = workspaceSections.map((section) => section.id);

export default function VognaryMvpClient({ experienceMode = "signed-in" }: { experienceMode?: ExperienceMode }) {
  const [initialWorkspace] = useState<WorkspaceBackup | null>(() => experienceMode === "demo" ? buildDemoWorkspace() : getInitialWorkspace());
  const [statementSources, setStatementSources] = useState<StatementFile[]>(initialWorkspace?.statementSources ?? []);
  const [manualItems, setManualItems] = useState<ManualRecurringInput[]>(initialWorkspace?.manualItems ?? []);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [userActions, setUserActions] = useState<Record<string, RecommendationType>>(initialWorkspace?.userActions ?? {});
  const [itemOwners, setItemOwners] = useState<Record<string, string>>(initialWorkspace?.itemOwners ?? {});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>(initialWorkspace?.reviewNotes ?? {});
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(initialWorkspace?.teamMembers?.length ? initialWorkspace.teamMembers : [{ id: "founder", name: "Founder", role: "Owner" }]);
  const [memberDraft, setMemberDraft] = useState({ name: "", role: "Finance / Ops" });
  const [receiptText, setReceiptText] = useState(initialWorkspace?.receiptText ?? "");
  const [reviewCompletedAt, setReviewCompletedAt] = useState<string | null>(null);
  const [localSaveEnabled, setLocalSaveEnabled] = useState(experienceMode !== "demo" && Boolean(initialWorkspace));
  const [notice, setNotice] = useState<string | null>(null);
  const [serverSession, setServerSession] = useState<ServerSessionPayload | null>(null);
  const [serverSaveStatus, setServerSaveStatus] = useState<string | null>(null);
  const [connectorStartResults, setConnectorStartResults] = useState<Record<string, ConnectorStartPayload>>({});
  const [connectingConnectorId, setConnectingConnectorId] = useState<string | null>(null);
  const [syncingConnectorId, setSyncingConnectorId] = useState<string | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState("gmail-readonly");
  const [connectorApiKeyDraft, setConnectorApiKeyDraft] = useState("");
  const [connectorAccountDraft, setConnectorAccountDraft] = useState("");
  const [serverConnectors, setServerConnectors] = useState<WorkspaceConnectorStatusPayload | null>(null);
  const [disconnectedConnectorIds, setDisconnectedConnectorIds] = useState<string[]>([]);

  const audit = useMemo<AuditResult>(
    () => analyzeStatements(statementSources.map(({ name, text }) => ({ name, text })), manualItems),
    [statementSources, manualItems],
  );
  const selectedItem = audit.recurringItems.find((item) => item.id === selectedItemId) ?? audit.recurringItems[0] ?? null;
  const hasRealData = statementSources.length > 0 || manualItems.length > 0 || receiptText.trim().length > 0;
  const coverageSignals = useMemo(() => getCoverageSignals(statementSources, manualItems, receiptText), [statementSources, manualItems, receiptText]);
  const coverageScore = Math.round((coverageSignals.filter((signal) => signal.done).length / coverageSignals.length) * 100);
  const priorityItems = useMemo(() => getPriorityItems(audit.recurringItems, userActions), [audit.recurringItems, userActions]);
  const connectedConnectorIds = useMemo(() => {
    const connected = new Set<string>();
    if (receiptText.trim()) connected.add("gmail-readonly");
    for (const [id, result] of Object.entries(connectorStartResults)) {
      if (result.status?.startsWith("connected")) connected.add(id);
    }
    for (const account of serverConnectors?.accounts ?? []) {
      if (account.status === "active") connected.add(account.connectorId);
    }
    for (const id of disconnectedConnectorIds) connected.delete(id);
    return connected;
  }, [connectorStartResults, disconnectedConnectorIds, receiptText, serverConnectors]);
  useEffect(() => {
    if (!localSaveEnabled || typeof window === "undefined") return;
    const backup = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText });
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(backup));
  }, [itemOwners, localSaveEnabled, manualItems, receiptText, reviewNotes, statementSources, teamMembers, userActions]);

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
    let ignore = false;

    async function loadWorkspaceConnectors() {
      if (!serverSession?.authenticated) {
        setServerConnectors(null);
        return;
      }

      const payload = await fetchWorkspaceConnectors();
      if (!ignore) setServerConnectors(payload);
    }

    loadWorkspaceConnectors();
    return () => {
      ignore = true;
    };
  }, [serverSession?.authenticated, serverSession?.session?.workspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = window.localStorage.getItem(gmailReceiptStorageKey);
    if (!raw) return;

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

  function selectAndReviewItem(itemId?: string) {
    if (itemId) setSelectedItemId(itemId);
    document.getElementById("recurring-ledger")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearWorkspace() {
    setStatementSources([]);
    setManualItems([]);
    setUserActions({});
    setItemOwners({});
    setReviewNotes({});
    setSelectedItemId(null);
    setReceiptText("");
    setNotice("Workspace cleared. This browser has no audit data now.");
  }

  function loadDemoWorkspace() {
    const demo = buildDemoWorkspace();
    setStatementSources(demo.statementSources);
    setManualItems(demo.manualItems);
    setUserActions({});
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
        setNotice(payload.message ?? payload.error ?? "Could not import those files. Use CSV/TXT/PDF statement exports under 8 MB.");
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

  function exportReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      product: "Vognary Recurring Audit",
      mode: "self-serve-stateless-audit",
      readiness: getReadinessItems(),
      sourceCoverage: getCoverageItems(),
      summary: audit.summary,
      sources: statementSources.map(({ name, rowCount }) => ({ name, rowCount })),
      manualItems,
      teamMembers,
      itemOwners,
      reviewNotes,
      recurringItems: audit.recurringItems.map((item) => ({
        ...item,
        userAction: userActions[item.id] ?? item.recommendationType,
        owner: getOwnerName(itemOwners[item.id], teamMembers),
        reviewNote: reviewNotes[item.id] ?? "",
      })),
      warnings: audit.warnings,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vognary-private-beta-audit.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Audit pack downloaded as JSON. Keep it private because it includes your source text.");
  }

  async function saveServerWorkspace() {
    if (!serverSession?.authenticated) {
      setNotice("Sign in before saving an encrypted server snapshot.");
      return;
    }

    setServerSaveStatus("Saving encrypted snapshot...");
    const snapshot = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText });
    const response = await fetch("/api/workspaces/current/audit-snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Vognary workspace snapshot",
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
    const payload = await response.json();
    const message = response.ok
      ? "Encrypted server snapshot saved to your beta workspace."
      : payload.message ?? payload.error ?? "Could not save server snapshot.";
    setServerSaveStatus(message);
    setNotice(message);
  }

  async function loadServerWorkspace() {
    if (!serverSession?.authenticated) {
      setNotice("Sign in before loading an encrypted server snapshot.");
      return;
    }

    setServerSaveStatus("Loading encrypted snapshot...");
    const response = await fetch("/api/workspaces/current/audit-snapshot", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      const message = payload.message ?? payload.error ?? "Could not load server snapshot.";
      setServerSaveStatus(message);
      setNotice(message);
      return;
    }
    if (payload.status === "empty" || !payload.snapshot?.snapshot) {
      setServerSaveStatus("No saved server snapshot yet.");
      setNotice("No saved server snapshot yet.");
      return;
    }

    const snapshot = payload.snapshot.snapshot as Partial<WorkspaceBackup>;
    if (snapshot.version !== 1 || !Array.isArray(snapshot.statementSources) || !Array.isArray(snapshot.manualItems)) {
      setServerSaveStatus("Saved snapshot is not a valid Vognary workspace backup.");
      return;
    }

    setStatementSources(snapshot.statementSources);
    setManualItems(snapshot.manualItems);
    setUserActions(snapshot.userActions ?? {});
    setItemOwners(snapshot.itemOwners ?? {});
    setReviewNotes(snapshot.reviewNotes ?? {});
    setTeamMembers(snapshot.teamMembers?.length ? snapshot.teamMembers : [{ id: "founder", name: "Founder", role: "Owner" }]);
    setReceiptText(snapshot.receiptText ?? "");
    setSelectedItemId(null);
    setServerSaveStatus("Encrypted server snapshot loaded into this browser.");
    setNotice("Encrypted server snapshot loaded into this browser.");
  }

  async function deleteServerWorkspace() {
    if (!serverSession?.authenticated) {
      setNotice("Sign in before deleting server snapshots.");
      return;
    }

    setServerSaveStatus("Deleting server snapshots...");
    const response = await fetch("/api/workspaces/current/audit-snapshot", { method: "DELETE" });
    const payload = await response.json();
    const message = response.ok
      ? `Deleted ${payload.deletedCount ?? 0} server snapshot(s).`
      : payload.message ?? payload.error ?? "Could not delete server snapshots.";
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
    setNotice("Monthly review marked complete for this local workspace. Export the audit pack for evidence.");
  }

  function enableLocalSave() {
    setLocalSaveEnabled(true);
    const backup = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText });
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(backup));
    setNotice("Local save enabled on this device. Do not use it on shared computers.");
  }

  function disableLocalSave() {
    setLocalSaveEnabled(false);
    window.localStorage.removeItem(workspaceStorageKey);
    setNotice("Saved browser workspace deleted from this device.");
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
        setNotice(`${connector.name} key stored in the encrypted vault. Initial sync job queued.`);
        return;
      }

      if (connector.id === "gmail-readonly") {
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
    const account = getActiveServerAccount(serverConnectors, connector.id);
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

  async function runConnectorSyncNow(connector: Connector) {
    const account = getActiveServerAccount(serverConnectors, connector.id);
    if (!account) {
      setNotice(`Connect ${connector.name} before running sync.`);
      return;
    }

    setSyncingConnectorId(connector.id);
    try {
      const response = await fetch(`/api/workspaces/current/connectors/${account.id}/sync`, { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { status?: string; error?: string; message?: string; result?: { evidenceWritten?: number; error?: string } };
      await refreshWorkspaceConnectors();
      if (!response.ok) {
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

  function importConnectorEvidence(connectorId: string) {
    const evidence = (serverConnectors?.evidence ?? []).filter((item) => item.connectorId === connectorId);
    const nextItems = evidence.map(evidenceToManualItem).filter((item): item is ManualRecurringInput => Boolean(item));

    if (!nextItems.length) {
      setNotice("No importable connector evidence yet. Run sync after connecting a provider.");
      return;
    }

    setManualItems((current) => {
      const existing = new Set(current.map((item) => recurringIdentity(item)));
      const uniqueItems = nextItems.filter((item) => !existing.has(recurringIdentity(item)));
      if (!uniqueItems.length) return current;
      return [...current, ...uniqueItems];
    });
    setNotice(`Imported ${nextItems.length} connector evidence item(s) into the ledger.`);
  }

  return (
    <main id="ledger-main" className="relative px-4 pb-12 pt-4 text-foreground sm:px-6 lg:px-8">
      <GlobalNotice notice={notice} onDismiss={() => setNotice(null)} />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        {/* Command header — live money tape + sticky section index */}
        <div className="sticky top-3 z-30 flex flex-col gap-2 rise">
          <div className="dossier glass tape flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-5">
            <a href="#ledger-main" className="flex items-center gap-2.5 rounded-lg transition hover:opacity-90" aria-label="Vognary — back to top">
              <VognaryMark size={32} className="text-(--dossier-ink)" animated />
              <div className="leading-tight">
                <p className="font-display text-lg font-semibold tracking-[-0.02em] text-(--dossier-ink)">Vognary</p>
                <p className="eyebrow muted-on-dark" style={{ fontSize: "0.58rem" }}>Recurring payments, reviewed</p>
              </div>
            </a>
            <div className="hidden h-8 w-px bg-(--dossier-line) lg:block" />
            <div className="hidden flex-1 flex-wrap items-center gap-x-6 gap-y-2 lg:flex">
              <TickerStat label="Monthly total" value={formatCurrency(audit.summary.monthlyRecurringSpend)} tone="ember" />
              <TickerStat label="Yearly total" value={formatCurrency(audit.summary.annualRecurringSpend)} tone="paper" />
              <TickerStat label="Needs review" value={formatCurrency(audit.summary.reviewableMonthlySpend)} tone="ochre" />
              <TickerStat label="Renewals in 10d" value={`${audit.summary.renewalsNextTenDays}`} tone="paper" />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="live-dot" aria-hidden />
              <span className="eyebrow muted-on-dark" style={{ fontSize: "0.58rem" }}>On this device</span>
              <a href="/profile" className="btn btn-ondark h-9 px-3 text-xs">Profile</a>
            </div>
          </div>
          <WorkspaceNav activeId={activeSection} />
        </div>

        {/* 01 · Connect evidence */}
        <section id="connect" className="flex scroll-mt-36 flex-col gap-5">
          <StageHeader folio="01" title="Connect evidence" note="Bring receipts, statements, and provider sources into one workspace." />
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
            onImportConnectorEvidence={importConnectorEvidence}
            onRefreshWorkspaceConnectors={refreshWorkspaceConnectors}
            onJumpToLedger={() => selectAndReviewItem()}
            onExportReport={exportReport}
            onClearWorkspace={clearWorkspace}
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
        </section>

        {/* 02 · Recurring ledger */}
        <section id="ledger" className="flex scroll-mt-36 flex-col gap-5">
          <StageHeader folio="02" title="Recurring ledger" note="Every detected item with proof, cadence, and a decision." />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-reveal>
            <Metric label="Monthly recurring" value={formatCurrency(audit.summary.monthlyRecurringSpend)} tone="ink" />
            <Metric label="Yearly total" value={formatCurrency(audit.summary.annualRecurringSpend)} tone="blue" />
            <Metric label="Needs review" value={formatCurrency(audit.summary.reviewableMonthlySpend)} tone="caution" />
            <Metric label="Renewing in 10 days" value={`${audit.summary.renewalsNextTenDays}`} tone="accent" />
          </div>
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
          {selectedItem ? (
            <SelectedItemPanel
              item={selectedItem}
              action={userActions[selectedItem.id] ?? selectedItem.recommendationType}
              onAction={(action) => setUserActions((current) => ({ ...current, [selectedItem.id]: action }))}
            />
          ) : null}
        </section>

        {/* 03 · Monthly review */}
        <section id="review" className="flex scroll-mt-36 flex-col gap-5">
          <StageHeader folio="03" title="Monthly review" note="Assign owners, capture notes, and close the review." />
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
        <section id="data" className="flex scroll-mt-36 flex-col gap-5">
          <StageHeader folio="04" title="Data & readiness" note="Control where data lives and what is already live." />
          <ReadinessPanel />
          <UserControlPanel
            coverageScore={coverageScore}
            coverageSignals={coverageSignals}
            localSaveEnabled={localSaveEnabled}
            serverSession={serverSession}
            serverSaveStatus={serverSaveStatus}
            onEnableLocalSave={enableLocalSave}
            onDisableLocalSave={disableLocalSave}
            onSaveServerWorkspace={saveServerWorkspace}
            onLoadServerWorkspace={loadServerWorkspace}
            onDeleteServerWorkspace={deleteServerWorkspace}
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
            <a className="transition hover:text-(--ink)" href="/sources">How to add sources</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/integrations">Integrations</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/terms">Terms</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/beta-readiness">Beta status</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/profile">Profile</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/login">Sign in</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-(--ink)" href="/launch">Launch</a>
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
function WorkspaceNav({ activeId }: { activeId: string }) {
  return (
    <nav aria-label="Workspace sections" className="glass flex items-center gap-1 overflow-x-auto rounded-2xl border border-line px-1.5 py-1.5">
      {workspaceSections.map((section) => {
        const active = activeId === section.id;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={active ? "true" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition ${active ? "bg-(--gold) text-[#17130a]" : "text-(--ink-soft) hover:bg-white/5 hover:text-(--ink)"}`}
          >
            <span className={`font-data text-[0.6rem] tnum ${active ? "opacity-70" : "text-(--muted)"}`}>{section.folio}</span>
            <span>{section.label}</span>
          </a>
        );
      })}
      <a href="#ledger-main" className="ml-auto hidden shrink-0 items-center rounded-xl px-3 py-1.5 font-data text-[0.6rem] uppercase tracking-[0.14em] text-(--muted) transition hover:text-(--ink) sm:inline-flex" aria-label="Back to top of workspace">Top</a>
    </nav>
  );
}

// Chapter divider — the folio marker + intent that opens each workspace section.
function StageHeader({ folio, title, note }: { folio: string; title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4" data-reveal>
      <span className="folio shrink-0" data-folio={folio}>{title}</span>
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
  onImportConnectorEvidence,
  onRefreshWorkspaceConnectors,
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
  onImportConnectorEvidence: (connectorId: string) => void;
  onRefreshWorkspaceConnectors: () => void;
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
  const statusLabel = connected ? "Connected" : connectorStatusLabels[selectedConnector.status];
  const statusClass = connected ? "pill pill-ready" : connectorStatusClass[selectedConnector.status];
  const signedIn = Boolean(serverSession?.authenticated && serverSession.session?.workspaceId);
  const hasApiKeyDraft = Boolean(apiKeyDraft.trim());
  const showApiKeyControl = selectedConnector.authType === "api-key";
  const serverAccount = getActiveServerAccount(serverConnectors, selectedConnector.id);
  const selectedEvidence = (serverConnectors?.evidence ?? []).filter((item) => item.connectorId === selectedConnector.id);
  const syncing = syncingConnectorId === selectedConnector.id;

  return (
    <section className="dossier spotlight scan p-5 sm:p-6" data-reveal onMouseMove={trackSpotlightPointer}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="folio" data-folio="1.1" style={{ color: "var(--dossier-muted)" }}>Connections</span>
          <h1 className="mt-3 font-display text-3xl font-semibold leading-tight text-(--dossier-ink) sm:text-4xl">Connect proof. Reveal renewals.</h1>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DossierStat label="Items" value={`${audit.summary.recurringCount}`} />
          <DossierStat label="Monthly" value={formatCurrency(audit.summary.monthlyRecurringSpend)} />
          <DossierStat label="Yearly" value={formatCurrency(audit.summary.annualRecurringSpend)} />
          <DossierStat label="Review" value={formatCurrency(audit.summary.reviewableMonthlySpend)} />
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
          {busy ? "Connecting..." : connected ? "Disconnect" : showApiKeyControl && hasApiKeyDraft ? "Store & sync" : "Connect"}
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
            {signedIn ? "Stored through the token vault, then queued for scheduled sync." : "API-key connectors require a signed-in beta workspace."}
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
            <p className="mt-2 text-xs leading-5 muted-on-dark">
              Server account: <span className="text-(--dossier-ink)">{serverAccount.displayName}</span> · Evidence {serverAccount.evidenceCount} · Last run {serverAccount.latestRunStatus ?? "not run"}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" disabled={!serverAccount || syncing} onClick={() => onRunConnectorSync(selectedConnector)} className="btn btn-ondark h-9 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60">{syncing ? "Syncing" : "Run now"}</button>
          <button type="button" disabled={!selectedEvidence.length} onClick={() => onImportConnectorEvidence(selectedConnector.id)} className="btn btn-ondark h-9 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60">Import evidence</button>
          <button type="button" onClick={onRefreshWorkspaceConnectors} className="btn btn-ondark h-9 px-3 text-xs">Refresh</button>
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
    { label: "Keep control", done: saved, detail: "Export, browser-save, or sign in for encrypted snapshots." },
  ];
  const modeCopy = experienceMode === "demo"
    ? "You are viewing a complete sample workspace. Replace it with your own evidence whenever ready."
    : experienceMode === "guest"
      ? "Browser-only mode is active. Nothing is stored on the server unless you sign in and save an encrypted snapshot."
      : "Signed-in workspace. Use this guide to complete the first review and improve coverage.";

  return (
    <section id="first-success" className="panel p-5 sm:p-6" data-reveal>
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div>
          <span className="folio" data-folio="1.2">First successful audit</span>
          <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Reach the useful ledger before login friction.</h2>
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
              Import CSV/PDF
              <input
                type="file"
                accept=".csv,.txt,.pdf,text/csv,text/plain,application/pdf"
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
            <p className="mt-2 text-xs leading-5 text-(--muted)">Pasted receipts improve source coverage immediately. Gmail OAuth can automate this later when configured.</p>
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

function getActiveServerAccount(payload: WorkspaceConnectorStatusPayload | null, connectorId: string) {
  return payload?.accounts?.find((account) => account.connectorId === connectorId && account.status === "active") ?? null;
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

function evidenceToManualItem(evidence: ServerConnectorEvidence): ManualRecurringInput | null {
  if (!evidence.merchantRaw || typeof evidence.amount !== "number" || !Number.isFinite(evidence.amount) || evidence.amount <= 0) return null;
  const connector = connectors.find((item) => item.id === evidence.connectorId);

  return {
    id: `connector-${evidence.id}`,
    merchant: evidence.merchantRaw,
    amount: evidence.amount,
    frequency: normalizeEvidenceFrequency(evidence.cadenceHint),
    nextExpectedDate: evidence.nextDebitHint ?? evidence.observedAt.slice(0, 10),
    category: inferEvidenceCategory(evidence, connector),
    sourceName: connector ? `${connector.name} evidence` : `${evidence.provider} evidence`,
  };
}

function normalizeEvidenceFrequency(value: string | null): Frequency {
  if (value === "weekly" || value === "biweekly" || value === "monthly" || value === "bimonthly" || value === "quarterly" || value === "yearly" || value === "irregular") return value;
  if (value === "usage-window") return "monthly";
  return "monthly";
}

function inferEvidenceCategory(evidence: ServerConnectorEvidence, connector: Connector | undefined) {
  if (connector?.category.includes("AI")) return "AI tools";
  if (connector?.category.includes("Cloud")) return "Cloud hosting";
  if (connector?.category.includes("Developer")) return "Developer tools";
  if (evidence.evidenceType === "receipt" || evidence.evidenceType === "invoice") return "Receipts";
  return "Other";
}

function GlobalNotice({ notice, onDismiss }: { notice: string | null; onDismiss: () => void }) {
  if (!notice) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 rounded-xl border border-line-strong bg-[#14161b]/95 p-3 shadow-2xl backdrop-blur sm:left-auto sm:w-[min(30rem,calc(100vw-2rem))]" role="status" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow" style={{ fontSize: "0.56rem" }}>Action result</p>
          <p className="mt-1 text-sm leading-6 text-(--ink)">{notice}</p>
        </div>
        <button type="button" onClick={onDismiss} className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-(--muted) transition hover:border-ember hover:text-ember">
          Dismiss
        </button>
      </div>
    </div>
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
          <p className="pb-2 text-sm text-(--muted)">checked</p>
        </div>
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
        <SectionHead folio="4.2" kicker="Your data" title="Control where your data is saved" desc="By default Vognary keeps this review in your browser. Signed-in beta users can also save an encrypted snapshot." />
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
          <a href="/integrations" className="btn btn-ghost">Open integrations</a>
        </div>
        <div className="mt-4 rounded-[11px] border border-line bg-(--card-2) p-3">
          <p className="font-data text-[0.68rem] text-(--muted)">Beta account</p>
          <p className="mt-2 text-sm leading-6 text-(--muted)">
            {signedInEmail ? <>Signed in as <strong className="text-(--ink)">{signedInEmail}</strong>.</> : <>Not signed in. Use login to save encrypted snapshots across devices.</>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {signedInEmail ? (
              <>
                <button type="button" onClick={onSaveServerWorkspace} className="btn btn-primary">Save encrypted snapshot</button>
                <button type="button" onClick={onLoadServerWorkspace} className="btn btn-ghost">Load latest</button>
                <button type="button" onClick={onDeleteServerWorkspace} className="btn btn-ghost" style={{ borderColor: "var(--ember)", color: "var(--ember)" }}>Delete server copies</button>
              </>
            ) : (
              <a href="/login" className="btn btn-primary">Sign in</a>
            )}
          </div>
          {serverSaveStatus ? <p className="mt-3 text-xs leading-5 text-(--muted)">{serverSaveStatus}</p> : null}
        </div>
        <p className="mt-3 text-xs leading-5 text-(--muted)">Do not enable browser save on shared machines. Local backups contain source text. Server snapshots require configured login, database, and TOKEN_ENCRYPTION_KEY.</p>
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
          <h2 className="mt-2 font-display text-xl font-semibold text-(--ink)">Recurring payments found</h2>
          <p className="mt-1 text-sm text-(--muted)">{audit.summary.recurringCount} recurring items from {audit.summary.transactionCount} debit transactions.</p>
        </div>
        <p className="font-data text-xs text-(--muted)">Avg confidence {Math.round(audit.summary.averageConfidence)}%</p>
      </div>

      {audit.recurringItems.length ? (
        <div className="overflow-x-auto">
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
                const action = userActions[item.id] ?? item.recommendationType;
                return (
                  <tr key={item.id} onClick={() => onSelect(item.id)} data-active={selectedItem?.id === item.id} className="ledger-row cursor-pointer">
                    <td className="border-b border-line px-5 py-3.5">
                      <p className="font-semibold text-(--ink)">{item.merchant}</p>
                      <p className="mt-0.5 font-data text-[11px] text-(--muted)">{item.category} · {item.confidenceScore}% confidence</p>
                    </td>
                    <td className="border-b border-line px-5 py-3.5 capitalize text-(--ink-soft)">{item.frequency}</td>
                    <td className="border-b border-line px-5 py-3.5 font-data font-semibold tnum text-(--ink)">{formatCurrency(item.monthlyCost)}</td>
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
      <SectionHead folio="2.3" kicker="Priority" title="What to review first" desc="Start with these before the next billing cycle." />
      <div className="mt-4 grid gap-2">
        {priorityItems.length ? priorityItems.map((item) => {
          const action = userActions[item.id] ?? item.recommendationType;
          return (
            <button key={item.id} type="button" onClick={() => onSelect(item.id)} className="inset w-full p-3 text-left transition hover:border-ember">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-(--ink)">{item.merchant}</p>
                  <p className="mt-0.5 font-data text-xs leading-5 text-(--muted)">{formatCurrency(item.monthlyCost)}/mo · renews {item.nextExpectedDate} · {item.confidenceScore}%</p>
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

  return (
    <section className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr]" data-reveal>
      <div className="dossier p-6">
        <span className="folio" data-folio="2.4" style={{ color: "var(--dossier-muted)" }}>Selected item</span>
        <h2 className="mt-4 font-display text-2xl font-semibold text-(--dossier-ink)">{item.merchant}</h2>
        <p className="mt-2 text-sm leading-6 muted-on-dark">{item.recommendationReason}</p>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <DossierStat label="Average debit" value={formatCurrency(item.averageAmount)} />
          <DossierStat label="Annual cost" value={formatCurrency(item.annualCost)} />
          <DossierStat label="Amount range" value={`${formatCurrency(item.amountMin)} – ${formatCurrency(item.amountMax)}`} />
          <DossierStat label="Proof rows" value={`${item.evidence.length}`} />
        </div>
        <div className="mt-5">
          <label className="font-data text-[0.68rem]" style={{ color: "var(--dossier-muted)" }} htmlFor="action-select">Choose action</label>
          <select id="action-select" value={action} onChange={(event) => onAction(event.target.value as RecommendationType)} className="mt-2 h-11 w-full rounded-[9px] border px-3 text-sm outline-none" style={{ background: "rgba(243,234,214,0.06)", borderColor: "var(--dossier-line)", color: "var(--dossier-ink)" }}>
            <option value="keep">Keep</option>
            <option value="watch">Watch</option>
            <option value="downgrade">Downgrade</option>
            <option value="cancel">Cancel</option>
            <option value="investigate">Investigate</option>
          </select>
        </div>
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
        <SectionHead folio="2.4" kicker="Proof" title="Where this came from" desc="Each suggestion links back to transaction or receipt text." right={<span className="pill pill-partial">{item.sourceNames.join(", ")}</span>} />
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
                  <td className="border-t border-line px-4 py-3 font-data font-semibold tnum text-(--ink)">{formatCurrency(evidence.amount)}</td>
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
  const assignedCount = audit.recurringItems.filter((item) => itemOwners[item.id]).length;
  const actionedCount = audit.recurringItems.filter((item) => ["cancel", "downgrade", "investigate", "watch"].includes(item.recommendationType)).length;

  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <SectionHead
        folio="3.1"
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
          <input value={memberDraft.name} onChange={(event) => onMemberDraft({ ...memberDraft, name: event.target.value })} className="field" placeholder="Name" />
          <input value={memberDraft.role} onChange={(event) => onMemberDraft({ ...memberDraft, role: event.target.value })} className="field" placeholder="Role" />
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
              <tr key={item.id}>
                <td className="border-t border-line px-4 py-3 font-semibold text-(--ink)">{item.merchant}</td>
                <td className="border-t border-line px-4 py-3 font-data tnum text-(--ink-soft)">{formatCurrency(item.monthlyCost)}</td>
                <td className="border-t border-line px-4 py-3"><span className={statusStyles[item.recommendationType]}>{item.recommendationType}</span></td>
                <td className="border-t border-line px-4 py-3">
                  <select value={itemOwners[item.id] ?? ""} onChange={(event) => onItemOwner(item.id, event.target.value)} className="field" style={{ height: "2.3rem", fontSize: "0.78rem" }}>
                    <option value="">Unassigned</option>
                    {teamMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </td>
                <td className="border-t border-line px-4 py-3">
                  <input value={reviewNotes[item.id] ?? ""} onChange={(event) => onReviewNote(item.id, event.target.value)} className="field" style={{ height: "2.3rem", fontSize: "0.78rem" }} placeholder="Usage, cancel path, decision" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const items = [...audit.recurringItems].sort((left, right) => right.monthlyCost - left.monthlyCost);
  const total = items.reduce((sum, item) => sum + item.monthlyCost, 0);

  return (
    <section className="panel p-5 sm:p-6">
      <SectionHead
        folio="2.2"
        kicker="Spend"
        title="Spend by merchant"
        desc="Shows which recurring payments cost the most each month."
        right={<span className="font-data text-xs text-(--muted)">{formatCurrency(audit.summary.monthlyRecurringSpend)}/mo</span>}
      />
      {items.length ? (
        <>
          <div className="spectrum-track mt-5" role="img" aria-label="Recurring spend by merchant">
            {items.map((item) => {
              const action = userActions[item.id] ?? item.recommendationType;
              const pct = total > 0 ? (item.monthlyCost / total) * 100 : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={`spectrum-seg seg-${action}`}
                  style={{ flexGrow: Math.max(item.monthlyCost, 1), flexBasis: 0 }}
                  title={`${item.merchant} · ${formatCurrency(item.monthlyCost)}/mo · ${Math.round(pct)}%`}
                  aria-label={`${item.merchant}, ${formatCurrency(item.monthlyCost)} per month`}
                />
              );
            })}
          </div>
          <div className="mt-4 grid gap-1 sm:grid-cols-2">
            {items.slice(0, 6).map((item) => {
              const action = userActions[item.id] ?? item.recommendationType;
              const pct = total > 0 ? (item.monthlyCost / total) * 100 : 0;
              const color = verdictColor(action);
              return (
                <button key={item.id} type="button" onClick={() => onSelect(item.id)} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-white/4">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px 0 ${color}` }} />
                    <span className="truncate text-sm text-(--ink)">{item.merchant}</span>
                  </span>
                  <span className="font-data shrink-0 text-xs tnum text-(--muted)">{formatCurrency(item.monthlyCost)} · {Math.round(pct)}%</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <p className="inset mt-5 px-3 py-6 text-center text-sm text-(--muted)">Add sources to see spend by merchant.</p>
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
        <h2 className="mt-2 font-display text-[1.22rem] font-semibold text-(--ink)">{title}</h2>
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
    { label: "Data handling", value: "Browser-local review works; encrypted server snapshots require configured database, session secret, and token key", state: "partial" as const },
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
    { label: "Email receipts", done: receiptText.trim().length > 0 },
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
      const leftAction = userActions[left.id] ?? left.recommendationType;
      const rightAction = userActions[right.id] ?? right.recommendationType;
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
}: {
  statementSources: StatementFile[];
  manualItems: ManualRecurringInput[];
  userActions: Record<string, RecommendationType>;
  itemOwners: Record<string, string>;
  reviewNotes: Record<string, string>;
  teamMembers: TeamMember[];
  receiptText: string;
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
  };
}

function getOwnerName(ownerId: string | undefined, teamMembers: TeamMember[]): string {
  if (!ownerId) return "Unassigned";
  return teamMembers.find((member) => member.id === ownerId)?.name ?? "Unassigned";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}