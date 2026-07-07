"use client";

import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
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

type QuickRecurringDraft = {
  merchant: string;
  amount: string;
  frequency: Frequency;
  category: string;
  sourceName: string;
};

type ConnectorStartPayload = {
  status?: string;
  state?: string;
  missingEnv?: string[];
  nextSteps?: string[];
  requiredEnv?: string[];
  message?: string;
  authUrl?: string;
};

const workspaceStorageKey = "vognary.workspace.v1";
const gmailReceiptStorageKey = "vognary.gmail.receipts.v1";

const quickCategories = [
  "AI tools",
  "Cloud hosting",
  "Developer tools",
  "Productivity",
  "App store",
  "UPI AutoPay",
  "Card mandate",
  "Domains",
  "Insurance",
  "Debt",
  "Investments",
  "Utilities",
  "Streaming",
  "Other",
];

const quickFrequencies: Frequency[] = ["weekly", "monthly", "quarterly", "yearly", "irregular"];

const emptyQuickDraft: QuickRecurringDraft = {
  merchant: "",
  amount: "",
  frequency: "monthly",
  category: "AI tools",
  sourceName: "known recurring payment",
};

const quickTemplates: QuickRecurringDraft[] = [
  { merchant: "Claude", amount: "1999", frequency: "monthly", category: "AI tools", sourceName: "Claude billing" },
  { merchant: "OpenAI / ChatGPT", amount: "1999", frequency: "monthly", category: "AI tools", sourceName: "OpenAI billing" },
  { merchant: "Kling", amount: "999", frequency: "monthly", category: "AI tools", sourceName: "Kling account" },
  { merchant: "Render", amount: "700", frequency: "monthly", category: "Cloud hosting", sourceName: "Render dashboard" },
  { merchant: "Vercel", amount: "1600", frequency: "monthly", category: "Cloud hosting", sourceName: "Vercel dashboard" },
  { merchant: "GitHub Copilot", amount: "850", frequency: "monthly", category: "Developer tools", sourceName: "GitHub billing" },
  { merchant: "Domain renewal", amount: "1200", frequency: "yearly", category: "Domains", sourceName: "registrar dashboard" },
  { merchant: "UPI AutoPay mandate", amount: "999", frequency: "monthly", category: "UPI AutoPay", sourceName: "UPI app mandate" },
  { merchant: "Card merchant mandate", amount: "1999", frequency: "monthly", category: "Card mandate", sourceName: "card recurring payments" },
  { merchant: "Insurance premium", amount: "3000", frequency: "monthly", category: "Insurance", sourceName: "policy dashboard" },
  { merchant: "Loan EMI", amount: "15000", frequency: "monthly", category: "Debt", sourceName: "loan account" },
  { merchant: "Investment SIP", amount: "5000", frequency: "monthly", category: "Investments", sourceName: "investment app" },
];

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

export default function VognaryMvpClient() {
  const [initialWorkspace] = useState<WorkspaceBackup | null>(() => getInitialWorkspace());
  const [statementSources, setStatementSources] = useState<StatementFile[]>(initialWorkspace?.statementSources ?? []);
  const [manualItems, setManualItems] = useState<ManualRecurringInput[]>(initialWorkspace?.manualItems ?? []);
  const [quickDraft, setQuickDraft] = useState<QuickRecurringDraft>(emptyQuickDraft);
  const [knownDebitsText, setKnownDebitsText] = useState("Claude 1999\nRender 700\nKling 999");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [userActions, setUserActions] = useState<Record<string, RecommendationType>>(initialWorkspace?.userActions ?? {});
  const [itemOwners, setItemOwners] = useState<Record<string, string>>(initialWorkspace?.itemOwners ?? {});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>(initialWorkspace?.reviewNotes ?? {});
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(initialWorkspace?.teamMembers?.length ? initialWorkspace.teamMembers : [{ id: "founder", name: "Founder", role: "Owner" }]);
  const [memberDraft, setMemberDraft] = useState({ name: "", role: "Finance / Ops" });
  const [receiptText, setReceiptText] = useState(initialWorkspace?.receiptText ?? "");
  const [reviewCompletedAt, setReviewCompletedAt] = useState<string | null>(null);
  const [localSaveEnabled, setLocalSaveEnabled] = useState(Boolean(initialWorkspace));
  const [notice, setNotice] = useState<string | null>(null);
  const [serverSession, setServerSession] = useState<ServerSessionPayload | null>(null);
  const [serverSaveStatus, setServerSaveStatus] = useState<string | null>(null);
  const [connectorStartResults, setConnectorStartResults] = useState<Record<string, ConnectorStartPayload>>({});
  const [connectingConnectorId, setConnectingConnectorId] = useState<string | null>(null);

  const audit = useMemo<AuditResult>(
    () => analyzeStatements(statementSources.map(({ name, text }) => ({ name, text })), manualItems),
    [statementSources, manualItems],
  );
  const selectedItem = audit.recurringItems.find((item) => item.id === selectedItemId) ?? audit.recurringItems[0] ?? null;
  const hasRealData = statementSources.length > 0 || manualItems.length > 0 || receiptText.trim().length > 0;
  const coverageSignals = useMemo(() => getCoverageSignals(statementSources, manualItems, receiptText), [statementSources, manualItems, receiptText]);
  const coverageScore = Math.round((coverageSignals.filter((signal) => signal.done).length / coverageSignals.length) * 100);
  const priorityItems = useMemo(() => getPriorityItems(audit.recurringItems, userActions), [audit.recurringItems, userActions]);
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
    if (typeof window === "undefined") return;

    const raw = window.localStorage.getItem(gmailReceiptStorageKey);
    if (!raw) return;

    try {
      const payload = JSON.parse(raw) as { candidates?: ReceiptCandidate[]; messageCount?: number };
      const candidates = Array.isArray(payload.candidates) ? payload.candidates.filter(isReceiptCandidate) : [];

      if (!candidates.length) {
        queueMicrotask(() => {
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

  function addQuickRecurringItem(draft: QuickRecurringDraft = quickDraft) {
    const amount = Number.parseFloat(draft.amount.replace(/,/g, ""));
    if (!draft.merchant.trim() || !Number.isFinite(amount) || amount <= 0) {
      setNotice("Add a merchant name and a positive amount first.");
      return;
    }

    const item = buildQuickManualItem(draft, amount);
    setManualItems((current) => recurringExists(current, item) ? current : [...current, item]);
    setQuickDraft(emptyQuickDraft);
    setSelectedItemId(item.id);
    setNotice(`${item.merchant} added to your recurring ledger.`);
  }

  function importKnownDebits() {
    const parsed = knownDebitsText
      .split(/\r?\n/)
      .map((line) => parseKnownDebitLine(line))
      .filter((item): item is ManualRecurringInput => Boolean(item));

    if (!parsed.length) {
      setNotice("Paste one recurring payment per line, for example: Claude 1999");
      return;
    }

    setManualItems((current) => {
      const next = [...current];
      for (const item of parsed) {
        if (!recurringExists(next, item)) next.push(item);
      }
      return next;
    });
    setSelectedItemId(parsed[0].id);
    setNotice(`${parsed.length} known recurring payment(s) imported.`);
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

  function exportWorkspaceBackup() {
    const backup = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText });
    downloadText("vognary-workspace-backup.json", JSON.stringify(backup, null, 2), "application/json");
    setNotice("Workspace backup downloaded. It includes your source text, so keep it private.");
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

  async function importWorkspaceBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const backup = JSON.parse(await file.text()) as Partial<WorkspaceBackup>;
      if (backup.version !== 1 || !Array.isArray(backup.statementSources) || !Array.isArray(backup.manualItems)) {
        setNotice("This is not a valid Vognary workspace backup.");
        return;
      }

      setStatementSources(backup.statementSources);
      setManualItems(backup.manualItems);
      setUserActions(backup.userActions ?? {});
      setItemOwners(backup.itemOwners ?? {});
      setReviewNotes(backup.reviewNotes ?? {});
      setTeamMembers(backup.teamMembers?.length ? backup.teamMembers : [{ id: "founder", name: "Founder", role: "Owner" }]);
      setReceiptText(backup.receiptText ?? "");
      setNotice("Workspace backup imported on this device.");
    } catch {
      setNotice("Could not import this workspace backup.");
    } finally {
      event.target.value = "";
    }
  }

  function exportCsvReport() {
    const rows = [
      ["Merchant", "Category", "Frequency", "Monthly Cost", "Annual Cost", "Next Debit", "Confidence", "Action", "Owner", "Review Note"],
      ...audit.recurringItems.map((item) => [
        item.merchant,
        item.category,
        item.frequency,
        Math.round(item.monthlyCost).toString(),
        Math.round(item.annualCost).toString(),
        item.nextExpectedDate,
        `${item.confidenceScore}%`,
        userActions[item.id] ?? item.recommendationType,
        getOwnerName(itemOwners[item.id], teamMembers),
        reviewNotes[item.id] ?? "",
      ]),
    ];
    downloadText("vognary-recurring-audit.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv");
    setNotice("Spreadsheet report exported.");
  }

  function exportPdfReport() {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 42;
    let y = 48;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("Vognary Recurring Audit", margin, y);
    y += 28;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, margin, y);
    y += 24;
    doc.setFontSize(12);
    doc.text(`Monthly total: ${formatCurrency(audit.summary.monthlyRecurringSpend)} | Yearly total: ${formatCurrency(audit.summary.annualRecurringSpend)}`, margin, y);
    y += 18;
    doc.text(`Needs review: ${formatCurrency(audit.summary.reviewableMonthlySpend)} | Items: ${audit.summary.recurringCount}`, margin, y);
    y += 28;

    doc.setFont("helvetica", "bold");
    doc.text("Recurring commitments", margin, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    for (const item of audit.recurringItems.slice(0, 18)) {
      const line = `${item.merchant} | ${formatCurrency(item.monthlyCost)}/mo | ${item.frequency} | next ${item.nextExpectedDate} | ${userActions[item.id] ?? item.recommendationType} | ${getOwnerName(itemOwners[item.id], teamMembers)}`;
      const wrapped = doc.splitTextToSize(line, 510) as string[];
      if (y + wrapped.length * 12 > 760) {
        doc.addPage();
        y = 48;
      }
      doc.text(wrapped, margin, y);
      y += wrapped.length * 12 + 8;
    }

    doc.save("vognary-recurring-audit.pdf");
    setNotice("PDF report exported.");
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

    try {
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
          ? `Gmail needs production OAuth setup first: ${payload.requiredEnv.join(", ")}. Opening the official setup page.`
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

  return (
    <main id="ledger-main" className="relative px-4 pb-12 pt-4 text-foreground sm:px-6 lg:px-8">
      <GlobalNotice notice={notice} onDismiss={() => setNotice(null)} />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        {/* Instrument bar — live money tape */}
        <div className="sticky top-3 z-30 rise">
          <div className="dossier glass tape flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2.5">
              <VognaryMark size={32} className="text-(--dossier-ink)" animated />
              <div className="leading-tight">
                <p className="font-display text-lg font-semibold tracking-[-0.02em] text-(--dossier-ink)">Vognary</p>
                <p className="eyebrow muted-on-dark" style={{ fontSize: "0.58rem" }}>Recurring payments, reviewed</p>
              </div>
            </div>
            <div className="hidden h-8 w-px bg-(--dossier-line) lg:block" />
            <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2">
              <TickerStat label="Monthly total" value={formatCurrency(audit.summary.monthlyRecurringSpend)} tone="ember" />
              <TickerStat label="Yearly total" value={formatCurrency(audit.summary.annualRecurringSpend)} tone="paper" />
              <TickerStat label="Needs review" value={formatCurrency(audit.summary.reviewableMonthlySpend)} tone="ochre" />
              <TickerStat label="Renewals in 10d" value={`${audit.summary.renewalsNextTenDays}`} tone="paper" />
            </div>
            <div className="flex items-center gap-2">
              <span className="live-dot" aria-hidden />
              <span className="eyebrow muted-on-dark" style={{ fontSize: "0.58rem" }}>On this device</span>
              <a href="/profile" className="btn btn-ondark h-9 px-3 text-xs">Profile</a>
            </div>
          </div>
        </div>

        <IntegrationCommandCenter
          audit={audit}
          connectorStartResults={connectorStartResults}
          connectingConnectorId={connectingConnectorId}
          onStartConnector={startConnector}
          onJumpToLedger={() => selectAndReviewItem()}
        />

        <QuickRecurringPanel
          draft={quickDraft}
          knownDebitsText={knownDebitsText}
          audit={audit}
          onDraft={setQuickDraft}
          onKnownDebitsText={setKnownDebitsText}
          onAddDraft={() => addQuickRecurringItem()}
          onAddTemplate={addQuickRecurringItem}
          onImportKnownDebits={importKnownDebits}
          onReview={() => selectAndReviewItem()}
        />

        {/* Masthead */}
        <header
          className="dossier spotlight scan overflow-hidden rise"
          onMouseMove={trackSpotlightPointer}
        >
          <div className="grid gap-0 lg:grid-cols-[1.4fr_1fr]">
            <div className="p-7 sm:p-10">
              <span className="folio" data-folio="Start" style={{ color: "var(--dossier-muted)" }}>Overview</span>
              <h2 className="hero-title mt-6 font-display font-bold text-(--dossier-ink)">
                Find recurring{" "}
                <br />
                payments before{" "}
                <br />
                they <span className="glow-num">renew.</span>
              </h2>
              <p className="mt-6 max-w-xl text-sm leading-7 muted-on-dark sm:text-base">
                Connect official sources first. Vognary turns provider evidence into one recurring-payment ledger, then shows renewals, proof, owners, and actions.
              </p>
              <div className="mt-7 flex flex-wrap gap-2.5">
                <button type="button" onClick={exportReport} className="btn btn-primary">Download report</button>
                <button type="button" onClick={clearWorkspace} className="btn btn-ondark">Clear data</button>
              </div>
              <div className="spectral mt-8 h-px w-full opacity-70" />
              <p className="mt-4 font-data text-[0.68rem] uppercase tracking-[0.16em] muted-on-dark">
                <span className="text-(--dossier-ink)">{audit.summary.recurringCount}</span> items found
                <span className="mx-2 text-(--dossier-line)">·</span>
                <span className="text-(--dossier-ink)">{Math.round(audit.summary.averageConfidence)}%</span> avg confidence
              </p>
            </div>
            <div className="border-t p-7 sm:p-10 lg:border-l lg:border-t-0" style={{ borderColor: "var(--dossier-line)" }}>
              <p className="eyebrow muted-on-dark">Reports &amp; saved work</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={exportPdfReport} className="btn btn-ondark w-full">PDF report</button>
                <button type="button" onClick={exportCsvReport} className="btn btn-ondark w-full">Spreadsheet report</button>
                <button type="button" onClick={exportWorkspaceBackup} className="btn btn-ondark w-full">Backup file</button>
                <label className="btn btn-ondark w-full cursor-pointer">
                  Import backup
                  <input type="file" accept="application/json,.json" onChange={importWorkspaceBackup} className="sr-only" />
                </label>
              </div>
              <div className="mt-5 rounded-xl border border-dashed p-4" style={{ borderColor: "var(--dossier-line)" }}>
                <p className="eyebrow muted-on-dark" style={{ fontSize: "0.62rem" }}>Action labels</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="stamp stamp-keep">Keep</span>
                  <span className="stamp stamp-watch">Watch</span>
                  <span className="stamp stamp-downgrade">Downgrade</span>
                  <span className="stamp stamp-cancel">Cancel</span>
                  <span className="stamp stamp-investigate">Investigate</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <QuickStartPanel />
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

        <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]" data-reveal>
          <div className="flex flex-col gap-5">
            <ConnectedSourcePanel
              connectorStartResults={connectorStartResults}
              onStartConnector={startConnector}
              connectingConnectorId={connectingConnectorId}
            />
            <CoveragePanel />
          </div>

          <div className="flex flex-col gap-5">
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Monthly recurring" value={formatCurrency(audit.summary.monthlyRecurringSpend)} tone="ink" />
              <Metric label="Yearly total" value={formatCurrency(audit.summary.annualRecurringSpend)} tone="blue" />
              <Metric label="Needs review" value={formatCurrency(audit.summary.reviewableMonthlySpend)} tone="caution" />
              <Metric label="Renewing in 10 days" value={`${audit.summary.renewalsNextTenDays}`} tone="accent" />
            </section>

            <SpendSpectrum audit={audit} userActions={userActions} onSelect={setSelectedItemId} />

            <RecurringGraph
              audit={audit}
              hasRealData={hasRealData}
              selectedItem={selectedItem}
              userActions={userActions}
              onSelect={setSelectedItemId}
            />
            <PriorityActionPanel priorityItems={priorityItems} userActions={userActions} onSelect={setSelectedItemId} />
          </div>
        </section>

        {selectedItem ? (
          <SelectedItemPanel
            item={selectedItem}
            action={userActions[selectedItem.id] ?? selectedItem.recommendationType}
            onAction={(action) => setUserActions((current) => ({ ...current, [selectedItem.id]: action }))}
          />
        ) : null}

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

        <ReadinessPanel />
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

function IntegrationCommandCenter({
  audit,
  connectorStartResults,
  connectingConnectorId,
  onStartConnector,
  onJumpToLedger,
}: {
  audit: AuditResult;
  connectorStartResults: Record<string, ConnectorStartPayload>;
  connectingConnectorId: string | null;
  onStartConnector: (connector: Connector) => void;
  onJumpToLedger: () => void;
}) {
  const integrationConnectors = getIntegrationConnectors();
  const gmailConnector = integrationConnectors.find((connector) => connector.id === "gmail-readonly");
  const liveCount = integrationConnectors.filter((connector) => connector.status === "live" || connector.status === "ready-with-env").length;
  const partnerCount = integrationConnectors.filter((connector) => connector.status === "partner-required").length;

  return (
    <section className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr]" data-reveal>
      <div className="dossier p-6 sm:p-7">
        <span className="folio" data-folio="Start" style={{ color: "var(--dossier-muted)" }}>First useful result</span>
        <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-(--dossier-ink) sm:text-5xl">Connect Gmail, then review one recurring ledger.</h1>
        <p className="mt-4 text-sm leading-7 muted-on-dark">A first-time user should not paste CSVs or remember every subscription. Start with official Gmail consent. Vognary scans receipt-like messages, imports recurring candidates, and keeps the review in one workspace.</p>
        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          <DossierStat label="Integration targets" value={`${integrationConnectors.length}`} />
          <DossierStat label="Live/setup-ready" value={`${liveCount}`} />
          <DossierStat label="Partner-gated" value={`${partnerCount}`} />
        </div>
        <div className="mt-5 rounded-[11px] border p-3" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
          <p className="eyebrow muted-on-dark" style={{ fontSize: "0.62rem" }}>Current result</p>
          <p className="mt-2 font-display text-2xl font-semibold text-(--dossier-ink)">{audit.summary.recurringCount} recurring item{audit.summary.recurringCount === 1 ? "" : "s"}</p>
          <p className="mt-1 text-sm leading-6 muted-on-dark">{formatCurrency(audit.summary.monthlyRecurringSpend)} per month · {formatCurrency(audit.summary.annualRecurringSpend)} per year</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {gmailConnector ? <button type="button" onClick={() => onStartConnector(gmailConnector)} className="btn btn-primary">Connect Gmail receipts</button> : null}
            <button type="button" onClick={onJumpToLedger} className="btn btn-ondark">Open recurring ledger</button>
          </div>
        </div>
      </div>

      <div className="panel p-5 sm:p-6">
        <SectionHead
          folio="01"
          kicker="Sources"
          title="Connect official sources"
          desc="Gmail is the first real no-paste connector. Other cards show the official path or the API/partner access still needed before automatic sync can be honest."
          right={<span className="pill pill-ready">Gmail ready</span>}
        />
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {integrationConnectors.slice(0, 12).map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              result={connectorStartResults[connector.id]}
              busy={connectingConnectorId === connector.id}
              onStart={() => onStartConnector(connector)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ConnectedSourcePanel({
  connectorStartResults,
  connectingConnectorId,
  onStartConnector,
}: {
  connectorStartResults: Record<string, ConnectorStartPayload>;
  connectingConnectorId: string | null;
  onStartConnector: (connector: Connector) => void;
}) {
  const integrationConnectors = getIntegrationConnectors();
  const mandateConnectors = integrationConnectors.filter((connector) => ["account-aggregator", "upi-autopay-mandates", "card-emandates", "paypal-automatic-payments"].includes(connector.id));
  const cloudConnectors = integrationConnectors.filter((connector) => /Cloud|AI|Developer|Consumer SaaS/.test(connector.category)).slice(0, 8);

  return (
    <section id="source-inputs" className="panel scroll-mt-24 p-5 sm:p-6">
      <SectionHead
        folio="03"
        kicker="Integrations"
        title="Connection queue"
        desc="Optional provider handoffs. Items become true auto-sync only after the official provider grants API, OAuth, or partner access."
        right={<a href="/integrations" className="btn btn-ghost">All integrations</a>}
      />

      <div className="mt-5 grid gap-4">
        <ConnectorGroup title="Cloud, SaaS, and AI tools" connectors={cloudConnectors} connectorStartResults={connectorStartResults} connectingConnectorId={connectingConnectorId} onStartConnector={onStartConnector} />
        <ConnectorGroup title="Banks, UPI, cards, wallets" connectors={mandateConnectors} connectorStartResults={connectorStartResults} connectingConnectorId={connectingConnectorId} onStartConnector={onStartConnector} />
      </div>
    </section>
  );
}

function QuickRecurringPanel({
  draft,
  knownDebitsText,
  audit,
  onDraft,
  onKnownDebitsText,
  onAddDraft,
  onAddTemplate,
  onImportKnownDebits,
  onReview,
}: {
  draft: QuickRecurringDraft;
  knownDebitsText: string;
  audit: AuditResult;
  onDraft: (draft: QuickRecurringDraft) => void;
  onKnownDebitsText: (value: string) => void;
  onAddDraft: () => void;
  onAddTemplate: (draft: QuickRecurringDraft) => void;
  onImportKnownDebits: () => void;
  onReview: () => void;
}) {
  return (
    <section className="grid gap-5 xl:grid-cols-[0.88fr_1.12fr]" data-reveal>
      <div className="panel p-5 sm:p-6">
        <SectionHead
          folio="02"
          kicker="Fallback"
          title="Add known debits only if Gmail misses them"
          desc="Gmail is the primary path. This fallback is for obvious payments you already know, so the first review still has value while provider APIs are being added."
          right={<span className="pill pill-partial">Fallback</span>}
        />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <input value={draft.merchant} onChange={(event) => onDraft({ ...draft, merchant: event.target.value })} className="field" placeholder="Merchant, e.g. Claude" />
          <input value={draft.amount} onChange={(event) => onDraft({ ...draft, amount: event.target.value })} className="field" placeholder="Amount in INR" inputMode="decimal" />
          <select value={draft.frequency} onChange={(event) => onDraft({ ...draft, frequency: event.target.value as Frequency })} className="field capitalize">
            {quickFrequencies.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}
          </select>
          <select value={draft.category} onChange={(event) => onDraft({ ...draft, category: event.target.value })} className="field">
            {quickCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <input value={draft.sourceName} onChange={(event) => onDraft({ ...draft, sourceName: event.target.value })} className="field sm:col-span-2" placeholder="Source, e.g. Claude billing page" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onAddDraft} className="btn btn-primary">Add known debit</button>
          <button type="button" onClick={onReview} className="btn btn-ghost">Review ledger</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {quickTemplates.slice(0, 8).map((template) => (
            <button key={`${template.merchant}-${template.category}`} type="button" onClick={() => onAddTemplate(template)} className="rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold text-(--muted) transition hover:border-ember hover:text-ember">
              {template.merchant}
            </button>
          ))}
        </div>
      </div>

      <div className="panel p-5 sm:p-6">
        <SectionHead
          folio="02A"
          kicker="Fast import"
          title="Paste names only when you already know them"
          desc="One per line, such as Claude 1999 or Render 700. This is a fallback, not the intended long-term integration model."
          right={<span className="font-data text-xs text-(--muted)">{audit.summary.recurringCount} found</span>}
        />
        <textarea value={knownDebitsText} onChange={(event) => onKnownDebitsText(event.target.value)} className="field field-mono mt-4 min-h-28" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onImportKnownDebits} className="btn btn-primary">Import known debits</button>
          <button type="button" onClick={onReview} className="btn btn-ghost">Open recurring ledger</button>
        </div>
      </div>
    </section>
  );
}

function ConnectorGroup({
  title,
  connectors: connectorItems,
  connectorStartResults,
  connectingConnectorId,
  onStartConnector,
}: {
  title: string;
  connectors: Connector[];
  connectorStartResults: Record<string, ConnectorStartPayload>;
  connectingConnectorId: string | null;
  onStartConnector: (connector: Connector) => void;
}) {
  return (
    <div className="inset p-4">
      <h3 className="font-display text-base font-semibold text-(--ink)">{title}</h3>
      <div className="mt-3 grid gap-2">
        {connectorItems.map((connector) => (
          <ConnectorCard
            key={connector.id}
            connector={connector}
            result={connectorStartResults[connector.id]}
            busy={connectingConnectorId === connector.id}
            compact
            onStart={() => onStartConnector(connector)}
          />
        ))}
      </div>
    </div>
  );
}

function ConnectorCard({ connector, result, busy, compact, onStart }: { connector: Connector; result?: ConnectorStartPayload; busy?: boolean; compact?: boolean; onStart: () => void }) {
  const launchTarget = connectorLaunchTargets[connector.id];
  const state = result?.state;
  const missing = result?.missingEnv ?? result?.requiredEnv ?? [];

  return (
    <div className={`inset ${compact ? "p-3" : "p-4"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow" style={{ fontSize: "0.56rem" }}>{connector.category} · {connector.authType}</p>
          <h3 className="mt-1 font-display text-base font-semibold text-(--ink)">{connector.name}</h3>
          {!compact ? <p className="mt-1 text-xs leading-5 text-(--muted)">{connector.userValue}</p> : null}
          {state ? <p className="mt-2 font-data text-[0.68rem] text-(--muted)">State: {state}</p> : null}
          {missing.length ? <p className="mt-1 text-xs leading-5 text-ochre">Needs setup: {missing.join(", ")}</p> : null}
        </div>
        <span className={`${connectorStatusClass[connector.status]} w-fit shrink-0`}>{connectorStatusLabels[connector.status]}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onStart} disabled={busy} className="btn btn-primary h-9 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? "Starting..." : getConnectorActionLabel(connector)}
        </button>
        {launchTarget ? <a href={launchTarget.url} target="_blank" rel="noreferrer" className="btn btn-ghost h-9 px-3 text-xs">Open {launchTarget.label}</a> : null}
      </div>
      {connector.limitation && !compact ? <p className="mt-3 text-xs leading-5 text-(--muted)">Boundary: {connector.limitation}</p> : null}
    </div>
  );
}

function getIntegrationConnectors() {
  const selected = new Set(integrationConnectorIds);
  return connectors.filter((connector) => selected.has(connector.id));
}

function getConnectorActionLabel(connector: Connector) {
  if (connector.status === "partner-required") return "Request partner path";
  if (connector.status === "planned") return "Open official source";
  if (connector.status === "ready-with-env") return "Start setup";
  return "Connect";
}

function openOfficialConnectorTarget(connectorId: string) {
  const target = connectorLaunchTargets[connectorId];
  if (!target) return;
  window.open(target.url, "_blank", "noopener,noreferrer");
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

function QuickStartPanel() {
  const steps = [
    ["1", "Connect Gmail", "Use the official Google consent screen to scan receipt-like renewal emails."],
    ["2", "Review candidates", "Vognary imports likely recurring payments into one ledger with source and confidence."],
    ["3", "Connect more sources", "Use provider cards for OpenAI, Vercel, Render, GitHub, wallets, banks, UPI, and cards as they become available."],
    ["4", "Save or delete", "Save an encrypted snapshot, export a report, or delete your data from Profile."],
  ];

  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <span className="folio" data-folio="01">Start here</span>
      <div className="mt-5 grid gap-5 md:grid-cols-4">
        {steps.map(([number, title, body], index) => (
          <div key={title} className="relative">
            {index < steps.length - 1 ? <span className="absolute -right-4 top-4 hidden h-px w-7 bg-(--line-strong) md:block" aria-hidden /> : null}
            <span className="font-display text-4xl font-semibold leading-none text-ember">{number}</span>
            <h2 className="mt-3 font-display text-base font-semibold text-(--ink)">{title}</h2>
            <p className="mt-1.5 text-xs leading-5 text-(--muted)">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
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
      </div>

      <div className="panel p-5 sm:p-6">
        <SectionHead folio="02" kicker="Your data" title="Control where your data is saved" desc="By default Vognary keeps this review in your browser. Signed-in beta users can also save an encrypted snapshot." />
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

function CoveragePanel() {
  return (
    <section className="panel p-5 sm:p-6">
      <SectionHead folio="05" kicker="Sources" title="What has been checked" desc="Shows which official source categories are connected, setup-ready, planned, or partner-gated." />
      <div className="mt-4 grid gap-2">
        {getCoverageItems().map((item) => <StatusRow key={item.label} {...item} />)}
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
    <section id="recurring-ledger" className="panel scroll-mt-24 overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-line px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="folio" data-folio="07">Results</span>
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
          <p className="font-data text-xs text-(--muted)">{hasRealData ? "No pattern yet" : "No source added yet"}</p>
          <h3 className="mt-3 font-display text-2xl font-semibold text-(--ink)">{hasRealData ? "No repeated payments found yet" : "Connect Gmail to start"}</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-(--muted)">
            {hasRealData ? "Connect more official sources or wait for provider/partner access to deepen coverage." : "Start with Gmail receipts, then add provider connections as they become available."}
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
      <SectionHead folio="08" kicker="Priority" title="What to review first" desc="Start with these before the next billing cycle." />
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
        }) : <p className="inset px-3 py-3 text-sm text-(--muted)">Add sources to generate an action plan.</p>}
      </div>
    </section>
  );
}

function SelectedItemPanel({ item, action, onAction }: { item: RecurringItem; action: RecommendationType; onAction: (action: RecommendationType) => void }) {
  return (
    <section className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr]" data-reveal>
      <div className="dossier p-6">
        <span className="folio" data-folio="10" style={{ color: "var(--dossier-muted)" }}>Selected item</span>
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
      </div>

      <div className="panel p-5 sm:p-6">
        <SectionHead folio="10" kicker="Proof" title="Where this came from" desc="Each suggestion links back to transaction or receipt text." right={<span className="pill pill-partial">{item.sourceNames.join(", ")}</span>} />
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
        folio="11"
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
        folio="12"
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
        folio="06"
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
    { label: "Google identity", value: "Ready for private beta login and workspace sessions", state: "ready" as const },
    { label: "Gmail receipts", value: "OAuth path exists; production Gmail receipt sync needs Google app verification", state: "partial" as const },
    { label: "Cloud and AI tools", value: "OpenAI adapter exists; Claude, Kling, Vercel, Render, GitHub, and X are connector targets", state: "partial" as const },
    { label: "App-store subscriptions", value: "Apple and Google Play need official source access or provider-supported evidence", state: "planned" as const },
    { label: "Bank/card data", value: "Needs Account Aggregator, issuer, network, or payment partner access", state: "blocked" as const },
    { label: "UPI/card mandates", value: "Needs PSP, issuer, bank, network, or regulated partner API access", state: "blocked" as const },
  ];
}

function getReadinessItems() {
  return [
    { label: "Integration launchpad", value: "Users start from official provider connection cards, not upload-first flows", state: "ready" as const },
    { label: "Recurring ledger", value: "Connected evidence lands in one review table with next debit and action labels", state: "ready" as const },
    { label: "Data handling", value: "Private beta login, database, token vault, and encrypted snapshots are configured", state: "ready" as const },
    { label: "Exports", value: "PDF, spreadsheet, JSON audit pack, and private workspace backup remain available", state: "ready" as const },
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

function buildQuickManualItem(draft: QuickRecurringDraft, amount: number): ManualRecurringInput {
  const merchant = draft.merchant.trim();
  return {
    id: `quick-${Date.now()}-${slugify(merchant)}`,
    merchant,
    amount,
    frequency: draft.frequency,
    nextExpectedDate: inferNextExpectedDate(draft.frequency),
    category: draft.category,
    sourceName: draft.sourceName.trim() || "known recurring payment",
  };
}

function recurringExists(items: ManualRecurringInput[], candidate: Pick<ManualRecurringInput, "merchant" | "amount" | "frequency">) {
  const identity = recurringIdentity(candidate);
  return items.some((item) => recurringIdentity(item) === identity);
}

function parseKnownDebitLine(line: string): ManualRecurringInput | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const amountMatch = trimmed.match(/(?:₹|rs\.?|inr)?\s*\d[\d,]*(?:\.\d+)?/i);
  if (!amountMatch) return null;

  const amount = Number.parseFloat(amountMatch[0].replace(/(?:₹|rs\.?|inr)/gi, "").replace(/,/g, "").trim());
  const merchant = trimmed.slice(0, amountMatch.index).replace(/[–—:-]+$/g, "").trim();
  if (!merchant || !Number.isFinite(amount) || amount <= 0) return null;

  const frequency = /year|annual/i.test(trimmed) ? "yearly" : /week/i.test(trimmed) ? "weekly" : /quarter/i.test(trimmed) ? "quarterly" : "monthly";
  return {
    id: `known-${Date.now()}-${slugify(merchant)}`,
    merchant,
    amount,
    frequency,
    nextExpectedDate: inferNextExpectedDate(frequency),
    category: inferQuickCategory(merchant),
    sourceName: "known recurring payment",
  };
}

function inferQuickCategory(merchant: string) {
  if (/claude|openai|chatgpt|kling|cursor|perplexity/i.test(merchant)) return "AI tools";
  if (/render|vercel|aws|cloudflare|digitalocean|gcp|cloud/i.test(merchant)) return "Cloud hosting";
  if (/github|copilot|gitlab/i.test(merchant)) return "Developer tools";
  if (/apple|icloud|google play|play store/i.test(merchant)) return "App store";
  if (/upi|autopay/i.test(merchant)) return "UPI AutoPay";
  if (/card|mandate/i.test(merchant)) return "Card mandate";
  if (/domain|namecheap|godaddy/i.test(merchant)) return "Domains";
  if (/insurance|policy/i.test(merchant)) return "Insurance";
  if (/emi|loan/i.test(merchant)) return "Debt";
  if (/sip|mutual|investment/i.test(merchant)) return "Investments";
  return "Other";
}

function inferNextExpectedDate(frequency: Frequency) {
  const days = {
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    bimonthly: 61,
    quarterly: 91,
    yearly: 365,
    irregular: 30,
  }[frequency];
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
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

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadText(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}