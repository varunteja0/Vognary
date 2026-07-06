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
import { extractReceiptCandidates, type ReceiptCandidate } from "@/lib/receipt-parser";
import { VognaryMark } from "./brand";

const categoryOptions = [
  "AI tools",
  "Cloud hosting",
  "Developer tools",
  "Domains",
  "Design tools",
  "Creative tools",
  "Productivity",
  "Social tools",
  "Streaming",
  "App store",
  "UPI AutoPay",
  "Card mandate",
  "Payments",
  "Debt",
  "Investments",
  "Insurance",
  "Utilities",
  "Other",
];

const frequencyOptions: Frequency[] = ["weekly", "biweekly", "monthly", "bimonthly", "quarterly", "yearly", "irregular"];

const statusStyles: Record<RecommendationType, string> = {
  keep: "stamp stamp-keep",
  watch: "stamp stamp-watch",
  downgrade: "stamp stamp-downgrade",
  cancel: "stamp stamp-cancel",
  investigate: "stamp stamp-investigate",
};

type ManualDraft = {
  merchant: string;
  amount: string;
  frequency: Frequency;
  nextExpectedDate: string;
  category: string;
  sourceName: string;
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

type AuditModeId = "founder" | "personal" | "household" | "cloud" | "mandates" | "appStores";
type AuditActionId = "manual" | "receipt" | "statement" | "gmail" | "review";

type AuditMode = {
  id: AuditModeId;
  label: string;
  title: string;
  promise: string;
  bestFor: string;
};

type AuditModeSignal = {
  label: string;
  done: boolean;
  action: AuditActionId;
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

type ActivationState = {
  headline: string;
  detail: string;
  primaryAction: {
    id: AuditActionId;
    label: string;
  };
  secondaryMetric: string;
};

const workspaceStorageKey = "vognary.workspace.v1";

const auditModes: AuditMode[] = [
  {
    id: "founder",
    label: "Founder stack",
    title: "Check my work tools",
    promise: "Find paid tools, cloud bills, domains, app-store charges, cards, and UPI AutoPay before they renew.",
    bestFor: "Founders and small teams with many tools.",
  },
  {
    id: "personal",
    label: "Personal subscriptions",
    title: "Check my subscriptions",
    promise: "Use receipts, app stores, card statements, and manual entries to find what keeps renewing.",
    bestFor: "One person looking for forgotten charges.",
  },
  {
    id: "household",
    label: "Household auto-debits",
    title: "Check household auto-debits",
    promise: "Track utilities, insurance, telecom, EMIs, SIPs, app stores, and mandates in one place.",
    bestFor: "Families and shared budgets.",
  },
  {
    id: "cloud",
    label: "Cloud/SaaS spend",
    title: "Check cloud and SaaS spend",
    promise: "Review AI tools, cloud, developer tools, domains, hosting, and paid seats.",
    bestFor: "Engineering, AI, and product teams.",
  },
  {
    id: "mandates",
    label: "UPI/card mandates",
    title: "Check UPI and card mandates",
    promise: "Add visible mandates manually when banks or payment apps do not expose them yet.",
    bestFor: "People worried about AutoPay or card mandates.",
  },
  {
    id: "appStores",
    label: "App stores",
    title: "Review app-store renewals",
    promise: "Check Apple, Google Play, iCloud, and app receipts without needing a direct app-store connection.",
    bestFor: "Mobile subscriptions and family app purchases.",
  },
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

const emptyManualDraft: ManualDraft = {
  merchant: "",
  amount: "",
  frequency: "monthly",
  nextExpectedDate: new Date().toISOString().slice(0, 10),
  category: "Other",
  sourceName: "manual entry",
};

const manualTemplates = [
  { label: "Claude", merchant: "Claude", amount: "1700", category: "AI tools", sourceName: "AI subscription check" },
  { label: "Kling", merchant: "Kling", amount: "800", category: "AI tools", sourceName: "AI subscription check" },
  { label: "Vercel", merchant: "Vercel", amount: "1700", category: "Cloud hosting", sourceName: "cloud dashboard" },
  { label: "Render", merchant: "Render", amount: "600", category: "Cloud hosting", sourceName: "cloud dashboard" },
  { label: "X", merchant: "X Premium", amount: "900", category: "Social tools", sourceName: "app subscription check" },
  { label: "Apple", merchant: "Apple / iCloud", amount: "749", category: "App store", sourceName: "Apple subscriptions" },
  { label: "Google Play", merchant: "Google Play subscription", amount: "499", category: "App store", sourceName: "Google Play" },
  { label: "UPI AutoPay", merchant: "UPI AutoPay mandate", amount: "999", category: "UPI AutoPay", sourceName: "UPI app mandate" },
  { label: "Card Mandate", merchant: "Card merchant mandate", amount: "1999", category: "Card mandate", sourceName: "card recurring payments" },
  { label: "Domain", merchant: "Domain renewal", amount: "1200", category: "Domains", sourceName: "registrar dashboard" },
  { label: "Insurance", merchant: "Insurance premium", amount: "3000", category: "Insurance", sourceName: "policy dashboard" },
];

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
  const [manualDraft, setManualDraft] = useState<ManualDraft>(emptyManualDraft);
  const [bulkEntryText, setBulkEntryText] = useState("");
  const [pastedCsv, setPastedCsv] = useState("");
  const [pastedName, setPastedName] = useState("pasted-statement");
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
  const [selectedAuditMode, setSelectedAuditMode] = useState<AuditModeId>("founder");
  const [statementFallbackOpen, setStatementFallbackOpen] = useState(false);
  const [serverSession, setServerSession] = useState<ServerSessionPayload | null>(null);
  const [serverSaveStatus, setServerSaveStatus] = useState<string | null>(null);
  const [connectorStartResults, setConnectorStartResults] = useState<Record<string, ConnectorStartPayload>>({});
  const [connectingConnectorId, setConnectingConnectorId] = useState<string | null>(null);

  const audit = useMemo<AuditResult>(
    () => analyzeStatements(statementSources.map(({ name, text }) => ({ name, text })), manualItems),
    [statementSources, manualItems],
  );
  const receiptCandidates = useMemo(() => extractReceiptCandidates(splitReceiptText(receiptText)), [receiptText]);
  const selectedItem = audit.recurringItems.find((item) => item.id === selectedItemId) ?? audit.recurringItems[0] ?? null;
  const hasRealData = statementSources.length > 0 || manualItems.length > 0 || receiptText.trim().length > 0;
  const coverageSignals = useMemo(() => getCoverageSignals(statementSources, manualItems, receiptText), [statementSources, manualItems, receiptText]);
  const coverageScore = Math.round((coverageSignals.filter((signal) => signal.done).length / coverageSignals.length) * 100);
  const priorityItems = useMemo(() => getPriorityItems(audit.recurringItems, userActions), [audit.recurringItems, userActions]);
  const modeSignals = useMemo(() => getAuditModeSignals(selectedAuditMode, statementSources, manualItems, receiptText, audit), [audit, manualItems, receiptText, selectedAuditMode, statementSources]);
  const activationState = useMemo(() => getActivationState(selectedAuditMode, modeSignals, audit, statementSources, manualItems, receiptText), [audit, manualItems, modeSignals, receiptText, selectedAuditMode, statementSources]);

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

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    const response = await fetch("/api/ingest", {
      method: "POST",
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      setNotice(payload.error ?? "File ingestion failed.");
      return;
    }

    const nextSources = (payload.sources ?? []).map((source: Omit<StatementFile, "id">) => ({
      ...source,
      id: `${source.name}-${Date.now()}-${crypto.randomUUID()}`,
    }));

    setStatementSources((current) => [...current, ...nextSources]);
    const warningCount = nextSources.reduce((count: number, source: StatementFile) => count + (source.warnings?.length ?? 0), 0);
    setNotice(`${nextSources.length} source(s) ingested${warningCount ? ` with ${warningCount} warning(s)` : ""}.`);
    event.target.value = "";
  }

  async function startGmailConnection() {
    const response = await fetch("/api/integrations/gmail/start?mode=json");
    const payload = await response.json().catch(() => null) as { status?: string; authUrl?: string; requiredEnv?: string[] } | null;

    if (response.ok && payload?.authUrl) {
      window.location.href = payload.authUrl;
      return;
    }

    setNotice(payload?.requiredEnv?.length
      ? `Gmail connection needs setup first: ${payload.requiredEnv.join(", ")}. Receipt paste works now.`
      : "Gmail connection is not ready yet. Paste receipt evidence for now.");
  }

  function addPastedStatement() {
    if (!pastedCsv.trim()) {
      setNotice("Paste statement export rows before adding them as a source.");
      return;
    }

    setStatementSources((current) => [
      ...current,
      {
        id: `${pastedName}-${Date.now()}`,
        name: pastedName || "pasted-statement",
        text: pastedCsv,
        rowCount: countRows(pastedCsv),
        kind: "csv",
        warnings: [],
      },
    ]);
    setPastedCsv("");
    setNotice("Pasted statement added to the audit workspace.");
  }

  function addManualItem() {
    const amount = Number.parseFloat(manualDraft.amount);
    if (!manualDraft.merchant.trim() || !Number.isFinite(amount) || amount <= 0) {
      setNotice("Add a merchant name and a positive amount for the manual commitment.");
      return;
    }

    setManualItems((current) => [
      ...current,
      {
        id: `manual-${Date.now()}`,
        merchant: manualDraft.merchant.trim(),
        amount,
        frequency: manualDraft.frequency,
        nextExpectedDate: manualDraft.nextExpectedDate,
        category: manualDraft.category,
        sourceName: manualDraft.sourceName,
      },
    ]);
    setManualDraft(emptyManualDraft);
    setNotice("Manual recurring commitment added.");
  }

  function addBulkSubscriptions() {
    const parsed = parseBulkSubscriptionLines(bulkEntryText);
    if (!parsed.items.length) {
      setNotice("Paste at least one line with merchant and INR amount, for example: Claude, 1700, monthly.");
      return;
    }

    const createdAt = Date.now();
    setManualItems((current) => [
      ...current,
      ...parsed.items.map((item, index) => ({ ...item, id: `bulk-${createdAt}-${index}` })),
    ]);
    setBulkEntryText("");
    const skippedText = parsed.skipped.length ? ` ${parsed.skipped.length} line(s) skipped because amount or merchant was missing.` : "";
    setNotice(`${parsed.items.length} auto-debit item(s) added to the single list.${skippedText}`);
  }

  function loadFounderStackTemplate() {
    setBulkEntryText([
      "Claude, 1700, monthly",
      "Kling, 800, monthly",
      "Vercel, 1700, monthly",
      "Render, 600, monthly",
      "X Premium, 900, monthly",
      "Cursor, 1700, monthly",
    ].join("\n"));
    setNotice("Starter stack loaded. Replace amounts with your real debits, then import.");
  }

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

  function removeSource(id: string) {
    setStatementSources((current) => current.filter((source) => source.id !== id));
  }

  function removeManualItem(id: string) {
    setManualItems((current) => current.filter((item) => item.id !== id));
  }

  function exportReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      product: "Vognary Recurring Audit",
      mode: "self-serve-stateless-audit",
      readiness: getReadinessItems(statementSources.length, manualItems.length),
      sourceCoverage: getCoverageItems(statementSources.length, manualItems.length),
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

  function importReceiptCandidate(candidate: ReceiptCandidate) {
    setManualItems((current) => [
      ...current,
      {
        id: `${candidate.id}-${Date.now()}`,
        merchant: candidate.merchant,
        amount: candidate.amount,
        frequency: candidate.frequency,
        nextExpectedDate: candidate.nextExpectedDate,
        category: candidate.category,
        sourceName: candidate.sourceName,
      },
    ]);
    setNotice(`${candidate.merchant} imported from receipt evidence.`);
  }

  function importAllReceiptCandidates() {
    receiptCandidates.forEach(importReceiptCandidate);
    if (!receiptCandidates.length) setNotice("No receipt candidates found. Paste invoice or renewal snippets with merchant and amount.");
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

  function focusAuditAction(action: AuditActionId) {
    if (action === "statement") setStatementFallbackOpen(true);

    const targetId = {
      manual: "source-inputs",
      statement: "statement-fallback",
      receipt: "receipt-intelligence",
      gmail: "source-inputs",
      review: "recurring-ledger",
    }[action];

    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setNotice(getActionNotice(action, selectedAuditMode));
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
            <CoveragePanel statementCount={statementSources.length} manualCount={manualItems.length} />
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

        <ReadinessPanel statementCount={statementSources.length} manualCount={manualItems.length} />
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

function AutoDebitCommandPanel({
  audit,
  bulkEntryText,
  onBulkEntryText,
  onImportBulk,
  onLoadFounderStack,
  onReviewItem,
  onJumpToLedger,
}: {
  audit: AuditResult;
  bulkEntryText: string;
  onBulkEntryText: (value: string) => void;
  onImportBulk: () => void;
  onLoadFounderStack: () => void;
  onReviewItem: (itemId: string) => void;
  onJumpToLedger: () => void;
}) {
  const items = audit.recurringItems.slice(0, 8);

  return (
    <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]" data-reveal>
      <div className="panel p-5 sm:p-6">
        <SectionHead
          folio="02"
          kicker="One list"
          title="Build your auto-debit list"
          desc="Paste the subscriptions you already know, then add statements or receipts to fill the gaps. Every item appears in one recurring ledger."
          right={<span className="pill pill-ready">Works now</span>}
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <MiniStat label="Items found" value={`${audit.summary.recurringCount}`} />
          <MiniStat label="Monthly" value={formatCurrency(audit.summary.monthlyRecurringSpend)} />
          <MiniStat label="Yearly" value={formatCurrency(audit.summary.annualRecurringSpend)} />
        </div>
        <textarea
          value={bulkEntryText}
          onChange={(event) => onBulkEntryText(event.target.value)}
          className="field field-mono mt-4 min-h-32"
          placeholder={[
            "Claude, 1700, monthly",
            "Kling, 800, monthly",
            "Vercel, 1700, monthly",
            "Render, 600, monthly",
            "X Premium, 900, monthly",
          ].join("\n")}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onImportBulk} className="btn btn-primary">Import to single list</button>
          <button type="button" onClick={onLoadFounderStack} className="btn btn-ghost">Load startup stack</button>
          <button type="button" onClick={onJumpToLedger} className="btn btn-ghost">Open full ledger</button>
        </div>
        <p className="mt-3 text-xs leading-5 text-(--muted)">Use INR amounts for now. Direct bank, phone-number, UPI, and card mandate sync still needs provider access; this list is the working beta path for verified manual, receipt, and statement evidence.</p>
      </div>

      <div className="panel overflow-hidden p-5 sm:p-6">
        <SectionHead
          folio="02A"
          kicker="Current ledger"
          title="Everything in one place"
          desc="This is the same list used by the report, snapshot, and review workflow."
          right={<span className="font-data text-xs text-(--muted)">{formatCurrency(audit.summary.monthlyRecurringSpend)}/mo</span>}
        />
        <div className="mt-4 grid gap-2">
          {items.length ? items.map((item) => (
            <button key={item.id} type="button" onClick={() => onReviewItem(item.id)} className="inset w-full p-3 text-left transition hover:border-ember">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-(--ink)">{item.merchant}</p>
                  <p className="mt-0.5 font-data text-xs leading-5 text-(--muted)">{item.category} · {item.frequency} · next {item.nextExpectedDate}</p>
                  <p className="mt-0.5 truncate text-xs text-(--muted)">{item.sourceNames.join(", ")}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-data text-sm font-semibold tnum text-(--ink)">{formatCurrency(item.monthlyCost)}</p>
                  <span className={statusStyles[item.recommendationType]}>{item.recommendationType}</span>
                </div>
              </div>
            </button>
          )) : (
            <div className="inset px-4 py-8 text-center">
              <p className="font-data text-xs text-(--muted)">No auto-debits added yet</p>
              <h3 className="mt-2 font-display text-xl font-semibold text-(--ink)">Paste your known subscriptions to start</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-(--muted)">Start with Claude, Kling, Vercel, Render, X, domains, insurance, UPI AutoPay, or any card mandate you can verify.</p>
            </div>
          )}
        </div>
      </div>
    </section>
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
  const liveCount = integrationConnectors.filter((connector) => connector.status === "live" || connector.status === "ready-with-env").length;
  const partnerCount = integrationConnectors.filter((connector) => connector.status === "partner-required").length;

  return (
    <section className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr]" data-reveal>
      <div className="dossier p-6 sm:p-7">
        <span className="folio" data-folio="Connect" style={{ color: "var(--dossier-muted)" }}>Integration-first</span>
        <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-(--dossier-ink) sm:text-5xl">Connect sources, then watch one ledger.</h1>
        <p className="mt-4 text-sm leading-7 muted-on-dark">The product direction is not file upload. Users should connect official sources and let Vognary keep recurring payments current. This beta launchpad starts that flow with provider handoffs and honest setup states.</p>
        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          <DossierStat label="Integration targets" value={`${integrationConnectors.length}`} />
          <DossierStat label="Live/setup-ready" value={`${liveCount}`} />
          <DossierStat label="Partner-gated" value={`${partnerCount}`} />
        </div>
        <div className="mt-5 rounded-[11px] border p-3" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
          <p className="eyebrow muted-on-dark" style={{ fontSize: "0.62rem" }}>Current result</p>
          <p className="mt-2 font-display text-2xl font-semibold text-(--dossier-ink)">{audit.summary.recurringCount} recurring item{audit.summary.recurringCount === 1 ? "" : "s"}</p>
          <p className="mt-1 text-sm leading-6 muted-on-dark">{formatCurrency(audit.summary.monthlyRecurringSpend)} per month · {formatCurrency(audit.summary.annualRecurringSpend)} per year</p>
          <button type="button" onClick={onJumpToLedger} className="btn btn-primary mt-3">Open recurring ledger</button>
        </div>
      </div>

      <div className="panel p-5 sm:p-6">
        <SectionHead
          folio="01"
          kicker="Sources"
          title="Click to integrate official sources"
          desc="Each button starts the Vognary connector route and opens the official provider page or consent flow when available. No CSV upload is part of the primary path."
          right={<span className="pill pill-ready">No upload path</span>}
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
        desc="Start with identity/email, then cloud/SaaS, then regulated money rails. Items become true auto-sync only after the official provider grants API, OAuth, or partner access."
        right={<a href="/integrations" className="btn btn-ghost">All integrations</a>}
      />

      <div className="mt-5 grid gap-4">
        <ConnectorGroup title="Cloud, SaaS, and AI tools" connectors={cloudConnectors} connectorStartResults={connectorStartResults} connectingConnectorId={connectingConnectorId} onStartConnector={onStartConnector} />
        <ConnectorGroup title="Banks, UPI, cards, wallets" connectors={mandateConnectors} connectorStartResults={connectorStartResults} connectingConnectorId={connectingConnectorId} onStartConnector={onStartConnector} />
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

function GuidedAuditLauncher({
  selectedMode,
  modeSignals,
  audit,
  activationState,
  coverageScore,
  onSelectMode,
  onAction,
}: {
  selectedMode: AuditModeId;
  modeSignals: AuditModeSignal[];
  audit: AuditResult;
  activationState: ActivationState;
  coverageScore: number;
  onSelectMode: (mode: AuditModeId) => void;
  onAction: (action: AuditActionId) => void;
}) {
  const selectedModeConfig = auditModes.find((mode) => mode.id === selectedMode) ?? auditModes[0];
  const completedSignals = modeSignals.filter((signal) => signal.done).length;
  const progressPercent = Math.round((completedSignals / modeSignals.length) * 100);

  return (
    <section className="panel overflow-hidden p-5 sm:p-6" data-reveal>
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div>
          <span className="folio" data-folio="Start">Guided review</span>
          <h1 className="mt-3 font-display text-2xl font-semibold text-(--ink) sm:text-4xl">Start a recurring payment review</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-(--muted)">Choose what you want to check. Add one real source, then Vognary will show repeated payments, proof, and the next action.</p>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {auditModes.map((mode) => {
              const selected = mode.id === selectedMode;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => onSelectMode(mode.id)}
                  className={`inset p-3 text-left transition ${selected ? "border-ember bg-(--ember-tint)" : "hover:border-line-strong"}`}
                  aria-pressed={selected}
                >
                  <p className="font-display text-sm font-semibold text-(--ink)">{mode.label}</p>
                  <p className="mt-1 text-xs leading-5 text-(--muted)">{mode.bestFor}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="dossier p-5">
          <span className="folio" data-folio="§ PATH" style={{ color: "var(--dossier-muted)" }}>{selectedModeConfig.label}</span>
          <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-(--dossier-ink)">{selectedModeConfig.title}</h2>
          <p className="mt-2 text-sm leading-6 muted-on-dark">{selectedModeConfig.promise}</p>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <DossierStat label="Mode progress" value={`${completedSignals}/${modeSignals.length}`} />
            <DossierStat label="Coverage" value={`${coverageScore}%`} />
            <DossierStat label="Found" value={`${audit.summary.recurringCount}`} />
          </div>

          <div className="mt-5 rounded-[11px] border p-3" style={{ borderColor: "var(--dossier-line)", background: "rgba(243,234,214,0.04)" }}>
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow muted-on-dark" style={{ fontSize: "0.62rem" }}>Next step</p>
              <span className="font-data text-xs tnum" style={{ color: "var(--dossier-ink)" }}>{progressPercent}%</span>
            </div>
            <h3 className="mt-2 font-display text-lg font-semibold text-(--dossier-ink)">{activationState.headline}</h3>
            <p className="mt-1 text-sm leading-6 muted-on-dark">{activationState.detail}</p>
            <button type="button" onClick={() => onAction(activationState.primaryAction.id)} className="btn btn-primary mt-3">{activationState.primaryAction.label}</button>
            <p className="mt-3 font-data text-[0.62rem] uppercase tracking-[0.14em] muted-on-dark">{activationState.secondaryMetric}</p>
          </div>

          <div className="mt-4 grid gap-2">
            {modeSignals.map((signal) => (
              <button key={signal.label} type="button" onClick={() => onAction(signal.action)} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition" style={{ borderColor: "var(--dossier-line)", background: signal.done ? "rgba(67,198,160,0.09)" : "rgba(243,234,214,0.03)" }}>
                <span className="text-sm font-semibold text-(--dossier-ink)">{signal.label}</span>
                <span className={signal.done ? "stamp stamp-keep" : "stamp stamp-watch"}>{signal.done ? "done" : "next"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function DataSourcesPanel({
  sources,
  manualItems,
  pastedCsv,
  pastedName,
  manualDraft,
  notice,
  warnings,
  onFiles,
  onRemoveSource,
  onPastedCsv,
  onPastedName,
  onAddPastedStatement,
  statementFallbackOpen,
  onStatementFallbackOpen,
  onManualDraft,
  onAddManualItem,
  onRemoveManualItem,
  onNotice,
  onConnectGmail,
}: {
  sources: StatementFile[];
  manualItems: ManualRecurringInput[];
  pastedCsv: string;
  pastedName: string;
  manualDraft: ManualDraft;
  notice: string | null;
  warnings: string[];
  onFiles: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveSource: (id: string) => void;
  onPastedCsv: (value: string) => void;
  onPastedName: (value: string) => void;
  onAddPastedStatement: () => void;
  statementFallbackOpen: boolean;
  onStatementFallbackOpen: (open: boolean) => void;
  onManualDraft: (draft: ManualDraft) => void;
  onAddManualItem: () => void;
  onRemoveManualItem: (id: string) => void;
  onNotice: (notice: string) => void;
  onConnectGmail: () => void;
}) {
  const liveSources = [
    {
      name: "Gmail receipts",
      state: "Needs setup",
      body: "Connect Gmail after OAuth is configured, or paste receipt text below now.",
      action: "Connect Gmail",
      onAction: onConnectGmail,
    },
    {
      name: "Bank accounts",
      state: "Needs partner",
      body: "Direct bank sync needs an approved Account Aggregator partner. Vognary never asks for bank passwords.",
      action: "View requirement",
      notice: "Bank sync requires Account Aggregator partner approval. Use manual source checks until that is approved.",
    },
    {
      name: "UPI and card mandates",
      state: "Needs provider",
      body: "Direct mandate visibility needs issuer, UPI, or payment-provider APIs. Add visible mandates manually for now.",
      action: "View requirement",
      notice: "Direct UPI/card mandate sync requires provider APIs. Add visible mandates manually for now.",
    },
    {
      name: "Cloud and SaaS usage",
      state: "Needs tokens",
      body: "Read-only tokens are needed for live checks from OpenAI, Anthropic, GitHub, Vercel, Render, AWS, and domain tools.",
      action: "View requirement",
      notice: "Cloud/SaaS usage connectors require provider tokens and encrypted storage before live sync.",
    },
  ];

  return (
    <section id="source-inputs" className="panel scroll-mt-24 p-5 sm:p-6">
      <SectionHead
        folio="03"
        kicker="Sources"
        title="Add payment sources"
        desc="Add one source first. Use statement import when a direct connection is not available."
        right={<span className="pill pill-ready">Ready to use</span>}
      />

      <div className="mt-5 grid gap-3">
        {liveSources.map((source) => (
          <div key={source.name} className="inset p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-display text-base font-semibold text-(--ink)">{source.name}</p>
                <p className="mt-1 max-w-xl text-sm leading-6 text-(--muted)">{source.body}</p>
              </div>
              <span className="pill pill-partial w-fit shrink-0">{source.state}</span>
            </div>
            <button type="button" onClick={source.onAction ?? (() => onNotice(source.notice ?? "Connector requires setup."))} className="btn btn-ghost mt-3 h-9 px-3 text-xs">{source.action}</button>
          </div>
        ))}
      </div>

      <details id="statement-fallback" className="mt-5 scroll-mt-24 inset p-4" open={statementFallbackOpen} onToggle={(event) => onStatementFallbackOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer font-display text-base font-semibold text-(--ink)">Import statement exports</summary>
        <p className="mt-2 text-xs leading-5 text-(--muted)">Use this when a bank, card, or provider cannot connect directly yet. Vognary will look for repeated charges and show confidence.</p>
        <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[11px] border border-dashed border-(--line-strong) bg-(--card-2) px-4 py-8 text-center transition hover:border-ember hover:bg-(--ember-tint)">
          <span className="font-display text-base font-semibold text-(--ink)">Choose CSV or PDF statement files</span>
          <span className="max-w-sm text-xs leading-5 text-(--muted)">Readable exports are converted into recurring payment items you can verify.</span>
          <input type="file" multiple accept=".csv,text/csv,.pdf,application/pdf" onChange={onFiles} className="sr-only" />
        </label>
      </details>

      <div className="mt-4 grid gap-2">
        {sources.length ? sources.map((source) => (
          <div key={source.id} className="inset flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-(--ink)">{source.name}</p>
              <p className="font-data text-[11px] text-(--muted)">{source.rowCount} rows · {source.kind === "pdf" ? "PDF" : "structured export"}</p>
              {source.warnings?.length ? <p className="mt-1 text-xs text-ochre">{source.warnings[0]}</p> : null}
            </div>
            <button type="button" onClick={() => onRemoveSource(source.id)} className="rounded-md border border-line px-3 py-1 text-xs font-semibold text-(--muted) transition hover:border-ember hover:text-ember">
              Remove
            </button>
          </div>
        )) : <p className="inset px-3 py-3 text-sm text-(--muted)">No statements added yet.</p>}
      </div>

      <div className="mt-5 inset p-4">
        <p className="eyebrow">Paste statement rows</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[0.55fr_1.45fr]">
          <input value={pastedName} onChange={(event) => onPastedName(event.target.value)} className="field" placeholder="source-name" />
          <button type="button" onClick={onAddPastedStatement} className="btn btn-primary">Add pasted export</button>
        </div>
        <textarea value={pastedCsv} onChange={(event) => onPastedCsv(event.target.value)} className="field field-mono mt-3 min-h-28" placeholder="Paste exported statement rows here when a live source is unavailable." />
      </div>

      <div className="mt-4 inset p-4">
        <p className="eyebrow">Add one payment manually</p>
        <p className="mt-1 text-xs leading-5 text-(--muted)">Use this for Apple, Google Play, UPI AutoPay, insurance, domains, or cloud bills that are not visible in a source.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {manualTemplates.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => {
                onManualDraft({
                  ...manualDraft,
                  merchant: template.merchant,
                  amount: template.amount,
                  category: template.category,
                  sourceName: template.sourceName,
                });
                onNotice(`${template.label} template loaded. Verify the amount and date, then add it.`);
              }}
              className="rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold text-(--muted) transition hover:border-ember hover:text-ember"
            >
              {template.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <input value={manualDraft.merchant} onChange={(event) => onManualDraft({ ...manualDraft, merchant: event.target.value })} className="field" placeholder="Merchant, e.g. Apple iCloud" />
          <input value={manualDraft.amount} onChange={(event) => onManualDraft({ ...manualDraft, amount: event.target.value })} className="field" placeholder="Amount in INR" inputMode="decimal" />
          <select value={manualDraft.frequency} onChange={(event) => onManualDraft({ ...manualDraft, frequency: event.target.value as Frequency })} className="field capitalize">
            {frequencyOptions.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}
          </select>
          <input value={manualDraft.nextExpectedDate} onChange={(event) => onManualDraft({ ...manualDraft, nextExpectedDate: event.target.value })} type="date" className="field" />
          <select value={manualDraft.category} onChange={(event) => onManualDraft({ ...manualDraft, category: event.target.value })} className="field">
            {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <input value={manualDraft.sourceName} onChange={(event) => onManualDraft({ ...manualDraft, sourceName: event.target.value })} className="field" placeholder="Source, e.g. phone check" />
        </div>
        <button type="button" onClick={onAddManualItem} className="btn btn-ember mt-3 w-full">Add payment</button>
        {manualItems.length ? (
          <div className="mt-3 grid gap-2">
            {manualItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-card px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-(--ink)">{item.merchant}</p>
                  <p className="font-data text-xs text-(--muted)">{formatCurrency(item.amount)} · {item.frequency} · {item.category}</p>
                </div>
                <button type="button" onClick={() => onRemoveManualItem(item.id)} className="rounded-md border border-line px-3 py-1 text-xs font-semibold text-(--muted) transition hover:border-ember hover:text-ember">
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {notice ? <p className="mt-4 rounded-md border border-indigo bg-(--indigo-tint) px-3 py-2 text-sm text-indigo">{notice}</p> : null}
      {warnings.length ? (
        <div className="mt-3 rounded-md border border-ochre bg-(--ochre-tint) px-3 py-2 text-xs leading-5 text-ochre">
          {warnings.slice(0, 4).map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}
    </section>
  );
}

function QuickStartPanel() {
  const steps = [
    ["1", "Choose a provider", "Start with Gmail, Claude, Kling, Vercel, Render, X, bank rails, UPI, cards, or wallets."],
    ["2", "Use official consent", "Vognary opens the provider path or tells you exactly what partner/API access is still required."],
    ["3", "Sync into one ledger", "Connected evidence becomes one recurring-payment list with renewal dates, source, and confidence."],
    ["4", "Review and save", "Choose keep, watch, downgrade, cancel, or investigate, then save an encrypted snapshot."],
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
          <a href="/sources" className="btn btn-ghost">Open source guide</a>
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

function ReceiptIntelligencePanel({
  receiptText,
  candidates,
  onReceiptText,
  onImportCandidate,
  onImportAll,
}: {
  receiptText: string;
  candidates: ReceiptCandidate[];
  onReceiptText: (value: string) => void;
  onImportCandidate: (candidate: ReceiptCandidate) => void;
  onImportAll: () => void;
}) {
  return (
    <section id="receipt-intelligence" className="panel scroll-mt-24 p-5 sm:p-6">
      <SectionHead
        folio="04"
        kicker="Receipts"
        title="Paste receipts"
        desc="Paste invoice or renewal snippets. Vognary will pull out likely recurring payments."
        right={<button type="button" onClick={onImportAll} className="btn btn-primary">Import all found</button>}
      />
      <textarea
        value={receiptText}
        onChange={(event) => onReceiptText(event.target.value)}
        className="field mt-4 min-h-28 leading-6"
        placeholder="Paste email snippets: Your Claude subscription renewed for ₹1,700. Next billing 2026-08-08."
      />
      <div className="mt-3 grid gap-2">
        {candidates.length ? candidates.map((candidate) => (
          <div key={candidate.id} className="inset p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-(--ink)">{candidate.merchant}</p>
                <p className="font-data text-xs text-(--muted)">{formatCurrency(candidate.amount)} · {candidate.frequency} · {candidate.category} · {candidate.confidenceScore}%</p>
              </div>
              <button type="button" onClick={() => onImportCandidate(candidate)} className="btn btn-ember" style={{ height: "2.1rem", padding: "0 0.85rem" }}>
                Add
              </button>
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-(--muted)">{candidate.evidenceText}</p>
          </div>
        )) : <p className="inset px-3 py-3 text-sm text-(--muted)">No receipt candidates yet.</p>}
      </div>
    </section>
  );
}

function CoveragePanel({ statementCount, manualCount }: { statementCount: number; manualCount: number }) {
  return (
    <section className="panel p-5 sm:p-6">
      <SectionHead folio="05" kicker="Sources" title="What has been checked" desc="Shows what you added and what still needs a manual check." />
      <div className="mt-4 grid gap-2">
        {getCoverageItems(statementCount, manualCount).map((item) => <StatusRow key={item.label} {...item} />)}
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
          <h3 className="mt-3 font-display text-2xl font-semibold text-(--ink)">{hasRealData ? "No repeated payments found yet" : "Add one source to start"}</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-(--muted)">
            {hasRealData ? "Add more history or add app-store, UPI, insurance, cloud, or domain payments manually." : "Connect a source, paste a receipt, or add one payment manually."}
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

function ReadinessPanel({ statementCount, manualCount }: { statementCount: number; manualCount: number }) {
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
        {getReadinessItems(statementCount, manualCount).map((item) => <StatusRow key={item.label} {...item} />)}
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

function getCoverageItems(statementCount: number, manualCount: number) {
  return [
    { label: "Google identity", value: "Ready for private beta login and workspace sessions", state: "ready" as const },
    { label: "Gmail receipts", value: "OAuth path exists; production Gmail receipt sync needs Google app verification", state: "partial" as const },
    { label: "Cloud and AI tools", value: "OpenAI adapter exists; Claude, Kling, Vercel, Render, GitHub, and X are connector targets", state: "partial" as const },
    { label: "App-store subscriptions", value: "Apple and Google Play need official source access or provider-supported evidence", state: "planned" as const },
    { label: "Bank/card data", value: "Needs Account Aggregator, issuer, network, or payment partner access", state: "blocked" as const },
    { label: "UPI/card mandates", value: "Needs PSP, issuer, bank, network, or regulated partner API access", state: "blocked" as const },
  ];
}

function getReadinessItems(statementCount: number, manualCount: number) {
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

function getAuditModeSignals(mode: AuditModeId, statementSources: StatementFile[], manualItems: ManualRecurringInput[], receiptText: string, audit: AuditResult): AuditModeSignal[] {
  const evidenceText = buildEvidenceText(statementSources, manualItems, receiptText);
  const hasStatement = statementSources.length > 0;
  const hasReceipt = receiptText.trim().length > 0;
  const hasRecurringItem = audit.recurringItems.length > 0;
  const hasManual = manualItems.length > 0;

  const signals: Record<AuditModeId, AuditModeSignal[]> = {
    founder: [
      { label: "AI or SaaS evidence", done: /openai|anthropic|claude|cursor|github|notion|slack|figma|zoom/i.test(evidenceText), action: hasReceipt ? "manual" : "receipt" },
      { label: "Cloud or hosting source", done: /aws|vercel|render|cloudflare|google cloud|gcp|hosting|domain|namecheap|godaddy/i.test(evidenceText), action: hasStatement ? "manual" : "statement" },
      { label: "App-store or mandate check", done: /apple|google play|upi|autopay|mandate|card/i.test(evidenceText), action: "manual" },
      { label: "At least one recurring item", done: hasRecurringItem, action: hasManual || hasStatement || hasReceipt ? "review" : "manual" },
    ],
    personal: [
      { label: "Email receipt evidence", done: hasReceipt, action: "receipt" },
      { label: "Card or bank fallback", done: hasStatement, action: "statement" },
      { label: "App-store subscriptions", done: /apple|google play|app store|icloud/i.test(evidenceText), action: "manual" },
      { label: "Recurring result", done: hasRecurringItem, action: hasRecurringItem ? "review" : "manual" },
    ],
    household: [
      { label: "Utilities or telecom", done: /utility|utilities|telecom|airtel|jio|electric|broadband/i.test(evidenceText), action: "manual" },
      { label: "Insurance or EMI/SIP", done: /insurance|emi|loan|sip|investment|policy/i.test(evidenceText), action: "manual" },
      { label: "Statement fallback", done: hasStatement, action: "statement" },
      { label: "Exportable audit", done: hasRecurringItem, action: hasRecurringItem ? "review" : "manual" },
    ],
    cloud: [
      { label: "AI provider cost", done: /openai|anthropic|claude|cursor/i.test(evidenceText), action: "manual" },
      { label: "Cloud provider spend", done: /aws|google cloud|gcp|cloudflare|vercel|render/i.test(evidenceText), action: hasStatement ? "manual" : "statement" },
      { label: "Developer tools or domains", done: /github|domain|namecheap|godaddy|hosting/i.test(evidenceText), action: "manual" },
      { label: "Reviewable cloud item", done: audit.recurringItems.some((item) => /ai|cloud|developer|domain/i.test(item.category)), action: hasRecurringItem ? "review" : "receipt" },
    ],
    mandates: [
      { label: "UPI AutoPay check", done: /upi|autopay/i.test(evidenceText), action: "manual" },
      { label: "Card mandate check", done: /card|mandate/i.test(evidenceText), action: "manual" },
      { label: "Bank or card statement fallback", done: hasStatement, action: "statement" },
      { label: "Mandate payment found", done: audit.recurringItems.some((item) => /upi|card|mandate/i.test(item.category + item.merchant)), action: hasRecurringItem ? "review" : "manual" },
    ],
    appStores: [
      { label: "Apple subscription check", done: /apple|icloud/i.test(evidenceText), action: "manual" },
      { label: "Google Play check", done: /google play|play store|playstore/i.test(evidenceText), action: "manual" },
      { label: "Receipt evidence", done: hasReceipt, action: "receipt" },
      { label: "App-store payment found", done: audit.recurringItems.some((item) => /app store|apple|google play/i.test(item.category + item.merchant)), action: hasRecurringItem ? "review" : "manual" },
    ],
  };

  return signals[mode];
}

function getActivationState(mode: AuditModeId, signals: AuditModeSignal[], audit: AuditResult, statementSources: StatementFile[], manualItems: ManualRecurringInput[], receiptText: string): ActivationState {
  const firstMissing = signals.find((signal) => !signal.done);
  const selectedMode = auditModes.find((item) => item.id === mode) ?? auditModes[0];

  if (audit.recurringItems.length > 0) {
    return {
      headline: `${audit.recurringItems.length} recurring commitment${audit.recurringItems.length === 1 ? "" : "s"} found`,
      detail: `Monthly recurring total is ${formatCurrency(audit.summary.monthlyRecurringSpend)}. Review the top item and choose keep, watch, change, cancel, or investigate.`,
      primaryAction: { id: "review", label: "Review payments" },
      secondaryMetric: `${audit.summary.renewalsNextTenDays} renewal${audit.summary.renewalsNextTenDays === 1 ? "" : "s"} in the next 10 days`,
    };
  }

  if (statementSources.length || manualItems.length || receiptText.trim()) {
    return {
      headline: "Source added, no recurring pattern yet",
      detail: firstMissing ? `Next best action for ${selectedMode.label}: ${firstMissing.label}.` : "Add more history or one manual commitment to make the recurring pattern visible.",
      primaryAction: { id: firstMissing?.action ?? "manual", label: firstMissing ? `Complete: ${firstMissing.label}` : "Add one commitment" },
      secondaryMetric: `${statementSources.length} source${statementSources.length === 1 ? "" : "s"} · ${manualItems.length} manual commitment${manualItems.length === 1 ? "" : "s"}`,
    };
  }

  return {
    headline: "Get the first useful result in under 5 minutes",
    detail: firstMissing ? `Start with ${firstMissing.label.toLowerCase()}. Vognary will update this checklist as soon as a source is added.` : "Start by adding one real source.",
    primaryAction: { id: firstMissing?.action ?? "manual", label: firstMissing ? `Start: ${firstMissing.label}` : "Start audit" },
    secondaryMetric: "Goal: add 1 source, find 1 item, download 1 report",
  };
}

function buildEvidenceText(statementSources: StatementFile[], manualItems: ManualRecurringInput[], receiptText: string) {
  const statementText = statementSources.map((source) => `${source.name} ${source.text.slice(0, 3000)}`).join(" ");
  const manualText = manualItems.map((item) => `${item.merchant} ${item.category} ${item.sourceName ?? ""}`).join(" ");
  return `${statementText} ${manualText} ${receiptText}`;
}

function parseBulkSubscriptionLines(text: string): { items: Omit<ManualRecurringInput, "id">[]; skipped: string[] } {
  const items: Omit<ManualRecurringInput, "id">[] = [];
  const skipped: string[] = [];

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const parsed = parseBulkSubscriptionLine(line);
    if (!parsed) {
      skipped.push(line);
      return;
    }

    items.push(parsed);
  });

  return { items, skipped };
}

function parseBulkSubscriptionLine(line: string): Omit<ManualRecurringInput, "id"> | null {
  const cells = line.split(/,|\t/).map((cell) => cell.trim()).filter(Boolean);
  const amountFromSecondCell = cells.length >= 2 ? parseMoneyAmount(cells[1]) : null;
  const amountMatch = line.match(/(?:₹|rs\.?|inr)?\s*\d[\d,]*(?:\.\d+)?/i);

  const merchant = amountFromSecondCell
    ? cells[0]
    : amountMatch
      ? line.slice(0, amountMatch.index).replace(/[–—:-]+$/g, "").trim()
      : "";
  const amount = amountFromSecondCell ?? (amountMatch ? parseMoneyAmount(amountMatch[0]) : null);

  if (!merchant || !amount || amount <= 0) return null;

  const detailText = cells.length >= 3 ? cells.slice(2).join(" ") : line;
  const frequency = inferBulkFrequency(detailText);
  const category = inferBulkCategory(`${merchant} ${line}`);

  return {
    merchant,
    amount,
    frequency,
    nextExpectedDate: inferBulkDate(detailText, frequency),
    category,
    sourceName: "bulk auto-debit list",
  };
}

function parseMoneyAmount(value: string): number | null {
  const normalized = value.replace(/(?:₹|rs\.?|inr)/gi, "").replace(/,/g, "").trim();
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function inferBulkFrequency(text: string): Frequency {
  if (/yearly|annual|annually|per year|\/yr/i.test(text)) return "yearly";
  if (/quarter|qtr|3 months/i.test(text)) return "quarterly";
  if (/biweekly|fortnight/i.test(text)) return "biweekly";
  if (/weekly|per week/i.test(text)) return "weekly";
  if (/bimonthly|two months|2 months/i.test(text)) return "bimonthly";
  if (/irregular|variable|usage/i.test(text)) return "irregular";
  return "monthly";
}

function inferBulkDate(text: string, frequency: Frequency): string {
  const isoMatch = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoMatch) return isoMatch[0];

  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const days = {
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    bimonthly: 61,
    quarterly: 91,
    yearly: 365,
    irregular: 30,
  }[frequency];
  const nextDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return nextDate.toISOString().slice(0, 10);
}

function inferBulkCategory(text: string): string {
  if (/claude|anthropic|openai|chatgpt|kling|cursor|perplexity|runway|midjourney|elevenlabs/i.test(text)) return "AI tools";
  if (/vercel|render|aws|gcp|google cloud|digitalocean|cloudflare|hosting/i.test(text)) return "Cloud hosting";
  if (/domain|namecheap|godaddy|registrar/i.test(text)) return "Domains";
  if (/github|gitlab|bitbucket/i.test(text)) return "Developer tools";
  if (/apple|icloud|app store|google play|play store/i.test(text)) return "App store";
  if (/upi|autopay/i.test(text)) return "UPI AutoPay";
  if (/card|mandate/i.test(text)) return "Card mandate";
  if (/x\.com|twitter|x premium/i.test(text)) return "Social tools";
  if (/insurance|policy/i.test(text)) return "Insurance";
  if (/emi|loan/i.test(text)) return "Debt";
  if (/sip|mutual fund|investment/i.test(text)) return "Investments";
  return "Other";
}

function getActionNotice(action: AuditActionId, mode: AuditModeId) {
  const selectedMode = auditModes.find((item) => item.id === mode)?.label ?? "selected audit";
  const notices: Record<AuditActionId, string> = {
    manual: `Add one real ${selectedMode} commitment you can verify in the source app or dashboard.`,
    receipt: `Paste one real renewal or invoice snippet for the ${selectedMode} audit.`,
    statement: `Use statement import only when the provider cannot connect directly yet.`,
    gmail: `Gmail needs OAuth configuration before public receipt sync. Receipt paste works now.`,
    review: `Review the recurring payments and choose an action before the next billing cycle.`,
  };
  return notices[action];
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

function countRows(text: string): number {
  return Math.max(0, text.split(/\r?\n/).filter((row) => row.trim()).length - 1);
}

function splitReceiptText(text: string): string[] {
  return text
    .split(/\n\s*\n|---+|={3,}/)
    .map((part) => part.trim())
    .filter(Boolean);
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