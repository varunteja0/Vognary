"use client";

import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
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

const categoryOptions = [
  "AI tools",
  "Cloud hosting",
  "Developer tools",
  "Design tools",
  "Creative tools",
  "Productivity",
  "Streaming",
  "App store",
  "UPI AutoPay",
  "Card mandate",
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

type CoverageSignal = {
  label: string;
  done: boolean;
};

const workspaceStorageKey = "vognary.workspace.v1";

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
  { label: "Apple", merchant: "Apple / iCloud", amount: "749", category: "App store", sourceName: "Apple subscriptions" },
  { label: "Google Play", merchant: "Google Play subscription", amount: "499", category: "App store", sourceName: "Google Play" },
  { label: "UPI AutoPay", merchant: "UPI AutoPay mandate", amount: "999", category: "UPI AutoPay", sourceName: "UPI app mandate" },
  { label: "Card Mandate", merchant: "Card merchant mandate", amount: "1999", category: "Card mandate", sourceName: "card recurring payments" },
  { label: "Domain", merchant: "Domain renewal", amount: "1200", category: "Domains", sourceName: "registrar dashboard" },
  { label: "Insurance", merchant: "Insurance premium", amount: "3000", category: "Insurance", sourceName: "policy dashboard" },
];

export default function VognaryMvpClient() {
  const [initialWorkspace] = useState<WorkspaceBackup | null>(() => getInitialWorkspace());
  const [statementSources, setStatementSources] = useState<StatementFile[]>(initialWorkspace?.statementSources ?? []);
  const [manualItems, setManualItems] = useState<ManualRecurringInput[]>(initialWorkspace?.manualItems ?? []);
  const [manualDraft, setManualDraft] = useState<ManualDraft>(emptyManualDraft);
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

  const audit = useMemo<AuditResult>(
    () => analyzeStatements(statementSources.map(({ name, text }) => ({ name, text })), manualItems),
    [statementSources, manualItems],
  );
  const receiptCandidates = useMemo(() => extractReceiptCandidates(splitReceiptText(receiptText)), [receiptText]);
  const selectedItem = audit.recurringItems.find((item) => item.id === selectedItemId) ?? audit.recurringItems[0] ?? null;
  const hasRealData = statementSources.length > 0 || manualItems.length > 0;
  const coverageSignals = useMemo(() => getCoverageSignals(statementSources, manualItems, receiptText), [statementSources, manualItems, receiptText]);
  const coverageScore = Math.round((coverageSignals.filter((signal) => signal.done).length / coverageSignals.length) * 100);
  const priorityItems = useMemo(() => getPriorityItems(audit.recurringItems, userActions), [audit.recurringItems, userActions]);

  useEffect(() => {
    if (!localSaveEnabled || typeof window === "undefined") return;
    const backup = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText });
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(backup));
  }, [itemOwners, localSaveEnabled, manualItems, receiptText, reviewNotes, statementSources, teamMembers, userActions]);

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

  function clearWorkspace() {
    setStatementSources([]);
    setManualItems([]);
    setUserActions({});
    setItemOwners({});
    setReviewNotes({});
    setSelectedItemId(null);
    setReceiptText("");
    setNotice("Workspace cleared. No user data is stored by this MVP.");
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
  }

  function exportWorkspaceBackup() {
    const backup = buildWorkspaceBackup({ statementSources, manualItems, userActions, itemOwners, reviewNotes, teamMembers, receiptText });
    downloadText("vognary-workspace-backup.json", JSON.stringify(backup, null, 2), "application/json");
    setNotice("Workspace backup downloaded. It includes your source text, so keep it private.");
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
    doc.text(`Monthly recurring: ${formatCurrency(audit.summary.monthlyRecurringSpend)} | Annual run-rate: ${formatCurrency(audit.summary.annualRecurringSpend)}`, margin, y);
    y += 18;
    doc.text(`Reviewable burn: ${formatCurrency(audit.summary.reviewableMonthlySpend)} | Items: ${audit.summary.recurringCount}`, margin, y);
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

  return (
    <main id="ledger-main" className="relative px-4 pb-12 pt-4 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        {/* Instrument bar — live money tape */}
        <div className="sticky top-3 z-30 rise">
          <div className="dossier glass tape flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-lg border border-(--dossier-line) font-display text-xl font-semibold text-(--dossier-ink)">V</span>
              <div className="leading-tight">
                <p className="font-display text-lg font-semibold tracking-tight text-(--dossier-ink)">Vognary</p>
                <p className="eyebrow muted-on-dark" style={{ fontSize: "0.54rem", letterSpacing: "0.24em" }}>Blacklight for money</p>
              </div>
            </div>
            <div className="hidden h-8 w-px bg-(--dossier-line) lg:block" />
            <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2">
              <TickerStat label="Monthly burn" value={formatCurrency(audit.summary.monthlyRecurringSpend)} tone="ember" />
              <TickerStat label="Annual run-rate" value={formatCurrency(audit.summary.annualRecurringSpend)} tone="paper" />
              <TickerStat label="Reviewable" value={formatCurrency(audit.summary.reviewableMonthlySpend)} tone="ochre" />
              <TickerStat label="Renewals ≤10d" value={`${audit.summary.renewalsNextTenDays}`} tone="paper" />
            </div>
            <div className="flex items-center gap-2">
              <span className="live-dot" aria-hidden />
              <span className="eyebrow muted-on-dark" style={{ fontSize: "0.54rem" }}>Local · Live</span>
            </div>
          </div>
        </div>

        {/* Masthead — the blacklight chamber */}
        <header
          className="dossier spotlight scan overflow-hidden rise"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            event.currentTarget.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
            event.currentTarget.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
          }}
        >
          <div className="grid gap-0 lg:grid-cols-[1.4fr_1fr]">
            <div className="p-7 sm:p-10">
              <span className="folio" data-folio="§ 00" style={{ color: "var(--dossier-muted)" }}>Blacklight · recurring money</span>
              <h1 className="hero-title mt-6 font-display font-bold text-(--dossier-ink)">
                The charges
                <br />
                you never <span className="glow-num">see</span>
                <br />
                leaving.
              </h1>
              <p className="mt-6 max-w-xl text-sm leading-7 muted-on-dark sm:text-base">
                Ordinary in daylight, they slip out every month unnoticed. Vognary is the blacklight — it makes every silent recurring charge glow, shows the evidence, and helps you cut it before the next debit.
              </p>
              <div className="mt-7 flex flex-wrap gap-2.5">
                <button type="button" onClick={exportReport} className="btn btn-primary">Export audit pack</button>
                <button type="button" onClick={clearWorkspace} className="btn btn-ondark">Clear workspace</button>
              </div>
              <div className="spectral mt-8 h-px w-full opacity-70" />
              <p className="mt-4 font-data text-[0.68rem] uppercase tracking-[0.16em] muted-on-dark">
                <span className="text-(--dossier-ink)">{audit.summary.recurringCount}</span> signatures detected
                <span className="mx-2 text-(--dossier-line)">·</span>
                <span className="text-(--dossier-ink)">{Math.round(audit.summary.averageConfidence)}%</span> avg confidence
              </p>
            </div>
            <div className="border-t p-7 sm:p-10 lg:border-l lg:border-t-0" style={{ borderColor: "var(--dossier-line)" }}>
              <p className="eyebrow muted-on-dark">Exports &amp; workspace</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={exportPdfReport} className="btn btn-ondark w-full">PDF report</button>
                <button type="button" onClick={exportCsvReport} className="btn btn-ondark w-full">Spreadsheet report</button>
                <button type="button" onClick={exportWorkspaceBackup} className="btn btn-ondark w-full">Backup file</button>
                <label className="btn btn-ondark w-full cursor-pointer">
                  Import backup
                  <input type="file" accept="application/json,.json" onChange={importWorkspaceBackup} className="sr-only" />
                </label>
              </div>
              <div className="mt-5 rounded-[12px] border border-dashed p-4" style={{ borderColor: "var(--dossier-line)" }}>
                <p className="eyebrow muted-on-dark" style={{ fontSize: "0.6rem" }}>Verdict spectrum</p>
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
          onEnableLocalSave={enableLocalSave}
          onDisableLocalSave={disableLocalSave}
        />

        <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]" data-reveal>
          <div className="flex flex-col gap-5">
            <DataSourcesPanel
              sources={statementSources}
              manualItems={manualItems}
              pastedCsv={pastedCsv}
              pastedName={pastedName}
              manualDraft={manualDraft}
              notice={notice}
              warnings={audit.warnings}
              onFiles={handleFiles}
              onRemoveSource={removeSource}
              onPastedCsv={setPastedCsv}
              onPastedName={setPastedName}
              onAddPastedStatement={addPastedStatement}
              onManualDraft={setManualDraft}
              onAddManualItem={addManualItem}
              onRemoveManualItem={removeManualItem}
              onNotice={setNotice}
            />
            <ReceiptIntelligencePanel
              receiptText={receiptText}
              candidates={receiptCandidates}
              onReceiptText={setReceiptText}
              onImportCandidate={importReceiptCandidate}
              onImportAll={importAllReceiptCandidates}
            />
            <CoveragePanel statementCount={statementSources.length} manualCount={manualItems.length} />
          </div>

          <div className="flex flex-col gap-5">
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Monthly recurring" value={formatCurrency(audit.summary.monthlyRecurringSpend)} tone="ink" />
              <Metric label="Annual run-rate" value={formatCurrency(audit.summary.annualRecurringSpend)} tone="blue" />
              <Metric label="Reviewable burn" value={formatCurrency(audit.summary.reviewableMonthlySpend)} tone="caution" />
              <Metric label="Renewals in 10 days" value={`${audit.summary.renewalsNextTenDays}`} tone="accent" />
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
          <span className="font-display text-base font-semibold text-(--ink)">Vognary <span className="text-(--muted)">· Blacklight for money</span></span>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-data text-[0.66rem] uppercase tracking-[0.16em] text-(--muted)">
            <a className="transition hover:text-ember" href="/privacy">Privacy</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-ember" href="/security">Security</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-ember" href="/sources">Source guide</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-ember" href="/integrations">Integrations</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-ember" href="/terms">Terms</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-ember" href="/beta-readiness">Beta readiness</a>
            <span className="text-(--line-strong)">·</span>
            <a className="transition hover:text-ember" href="/launch">Launch</a>
          </div>
        </footer>
      </div>
    </main>
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
  onManualDraft,
  onAddManualItem,
  onRemoveManualItem,
  onNotice,
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
  onManualDraft: (draft: ManualDraft) => void;
  onAddManualItem: () => void;
  onRemoveManualItem: (id: string) => void;
  onNotice: (notice: string) => void;
}) {
  const liveSources = [
    {
      name: "Gmail receipts",
      state: "Ready with OAuth",
      body: "Read-only receipt discovery is wired. Configure Google OAuth to make this live for users.",
      action: "Connect Gmail",
      href: "/api/integrations/gmail/start",
    },
    {
      name: "Bank accounts",
      state: "Partner required",
      body: "Account Aggregator needs an FIU/TSP or regulated partner. No password scraping.",
      action: "View requirement",
      notice: "Bank sync requires Account Aggregator partner approval. Use manual source checks until that is approved.",
    },
    {
      name: "UPI and card mandates",
      state: "Provider required",
      body: "Direct mandate visibility needs issuer, UPI, or payment-provider APIs.",
      action: "View requirement",
      notice: "Direct UPI/card mandate sync requires provider APIs. Add visible mandates manually for now.",
    },
    {
      name: "Cloud and SaaS usage",
      state: "Scoped API required",
      body: "Usage intelligence needs read-only tokens for OpenAI, Anthropic, GitHub, Vercel, Render, AWS, and domains.",
      action: "View requirement",
      notice: "Cloud/SaaS usage connectors require provider tokens and encrypted storage before live sync.",
    },
  ];

  return (
    <section className="panel p-5 sm:p-6">
      <SectionHead
        folio="§ 03"
        kicker="Live sources"
        title="Connect recurring money sources"
        desc="Start with live-capable sources and mandate checks. Use statement import only as a fallback when providers do not expose APIs yet."
        right={<span className="pill pill-ready">Self-serve ready</span>}
      />

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {liveSources.map((source) => (
          <div key={source.name} className="inset p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-base font-semibold text-(--ink)">{source.name}</p>
                <p className="mt-1 text-xs leading-5 text-(--muted)">{source.body}</p>
              </div>
              <span className="pill pill-partial shrink-0">{source.state}</span>
            </div>
            {source.href ? (
              <a href={source.href} className="btn btn-ghost mt-3 inline-flex h-9 items-center px-3 text-xs">{source.action}</a>
            ) : (
              <button type="button" onClick={() => onNotice(source.notice ?? "Connector requires setup.")} className="btn btn-ghost mt-3 h-9 px-3 text-xs">{source.action}</button>
            )}
          </div>
        ))}
      </div>

      <details className="mt-5 inset p-4">
        <summary className="cursor-pointer font-display text-base font-semibold text-(--ink)">Fallback: import statement exports</summary>
        <p className="mt-2 text-xs leading-5 text-(--muted)">Use this only when a bank, card, or provider cannot connect directly yet. Vognary will parse the export and still show evidence/confidence.</p>
        <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[11px] border border-dashed border-(--line-strong) bg-(--card-2) px-4 py-8 text-center transition hover:border-ember hover:bg-(--ember-tint)">
          <span className="font-display text-base font-semibold text-(--ink)">Drop statement export files</span>
          <span className="max-w-sm text-xs leading-5 text-(--muted)">Readable statement exports are converted into evidence-backed recurring items.</span>
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
        )) : <p className="inset px-3 py-3 text-sm text-(--muted)">No real statement sources added yet.</p>}
      </div>

      <div className="mt-5 inset p-4">
        <p className="eyebrow">Paste a statement export</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[0.55fr_1.45fr]">
          <input value={pastedName} onChange={(event) => onPastedName(event.target.value)} className="field" placeholder="source-name" />
          <button type="button" onClick={onAddPastedStatement} className="btn btn-primary">Add pasted export</button>
        </div>
        <textarea value={pastedCsv} onChange={(event) => onPastedCsv(event.target.value)} className="field field-mono mt-3 min-h-28" placeholder="Paste exported statement rows here when a live source is unavailable." />
      </div>

      <div className="mt-4 inset p-4">
        <p className="eyebrow">Manual commitment</p>
        <p className="mt-1 text-xs leading-5 text-(--muted)">For Apple, Google Play, UPI AutoPay, insurance, domains, or cloud not visible in a connected source.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {manualTemplates.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => onManualDraft({
                ...manualDraft,
                merchant: template.merchant,
                amount: template.amount,
                category: template.category,
                sourceName: template.sourceName,
              })}
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
        <button type="button" onClick={onAddManualItem} className="btn btn-ember mt-3 w-full">Add manual commitment</button>
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
    ["1", "Connect sources", "Start with Gmail receipts, provider dashboards, app-store checks, and mandate sources."],
    ["2", "Add missing mandates", "Use templates for Apple, Google Play, UPI AutoPay, card mandates, domains, insurance, and cloud."],
    ["3", "Review evidence", "Open each recurring item, verify the proof, then mark keep, watch, downgrade, cancel, or investigate."],
    ["4", "Export actions", "Download PDF, spreadsheet, or a private workspace backup for later review."],
  ];

  return (
    <section className="panel p-5 sm:p-6" data-reveal>
      <span className="folio" data-folio="§ 01">Procedure</span>
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
  onEnableLocalSave,
  onDisableLocalSave,
}: {
  coverageScore: number;
  coverageSignals: CoverageSignal[];
  localSaveEnabled: boolean;
  onEnableLocalSave: () => void;
  onDisableLocalSave: () => void;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-[0.78fr_1.22fr]" data-reveal>
      <div className="panel p-5 sm:p-6">
        <p className="eyebrow">Audit completeness</p>
        <div className="mt-3 flex items-end gap-3">
          <p className="font-display text-6xl font-semibold leading-none text-ember">{coverageScore}<span className="text-3xl">%</span></p>
          <p className="pb-2 text-sm text-(--muted)">source coverage</p>
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
        <SectionHead folio="§ 02" kicker="Chain of custody" title="Use it safely" desc="By default Vognary needs no account and stores nothing on a backend. Export a backup file, or opt in to save this workspace in this browser only." />
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
        <p className="mt-3 text-xs leading-5 text-(--muted)">Do not enable browser save on shared machines. Backups contain source text — keep them private.</p>
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
    <section className="panel p-5 sm:p-6">
      <SectionHead
        folio="§ 04"
        kicker="Receipts"
        title="Receipt intelligence"
        desc="Paste invoice or renewal snippets. Gmail OAuth can feed this parser after verification."
        right={<button type="button" onClick={onImportAll} className="btn btn-primary">Import all</button>}
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
      <SectionHead folio="§ 05" kicker="Sources" title="Connected sources" desc="What is connected and what still needs a manual check, so the audit stays honest." />
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
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-line px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="folio" data-folio="§ 07">The ledger</span>
          <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-(--ink)">Recurring money graph</h2>
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
                <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Cadence</th>
                <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Monthly</th>
                <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Next debit</th>
                <th className="border-b border-line bg-(--card-2) px-5 py-3 font-data text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-(--muted)">Verdict</th>
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
          <p className="font-data text-xs uppercase tracking-[0.2em] text-(--muted)">{hasRealData ? "No pattern yet" : "Awaiting evidence"}</p>
          <h3 className="mt-3 font-display text-2xl font-semibold text-(--ink)">{hasRealData ? "No recurring pattern found yet" : "Start with real sources"}</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-(--muted)">
            {hasRealData ? "Add more source history or use manual entries for app-store, UPI, insurance, cloud, or domain commitments that do not appear in connected evidence." : "Connect a live source, paste receipt evidence, or add manual commitments to start your audit."}
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
      <SectionHead folio="§ 08" kicker="Priority" title="Priority action plan" desc="Start with these before the next billing cycle." />
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
        <span className="folio" data-folio="§ 10" style={{ color: "var(--dossier-muted)" }}>Exhibit</span>
        <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-(--dossier-ink)">{item.merchant}</h2>
        <p className="mt-2 text-sm leading-6 muted-on-dark">{item.recommendationReason}</p>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <DossierStat label="Average debit" value={formatCurrency(item.averageAmount)} />
          <DossierStat label="Annual cost" value={formatCurrency(item.annualCost)} />
          <DossierStat label="Amount range" value={`${formatCurrency(item.amountMin)} – ${formatCurrency(item.amountMax)}`} />
          <DossierStat label="Evidence rows" value={`${item.evidence.length}`} />
        </div>
        <div className="mt-5">
          <label className="font-data text-[0.62rem] uppercase tracking-[0.18em]" style={{ color: "var(--dossier-muted)" }} htmlFor="action-select">Issue verdict</label>
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
        <SectionHead folio="§ 10" kicker="Proof" title="Evidence trail" desc="Every verdict traces back to transaction-level proof." right={<span className="pill pill-partial">{item.sourceNames.join(", ")}</span>} />
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
        folio="§ 11"
        kicker="Review"
        title="Team monthly review"
        desc="Assign recurring spend to owners, record notes, and close the monthly review."
        right={<button type="button" onClick={onCompleteReview} className="btn btn-primary">Mark review complete</button>}
      />
      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        <MiniStat label="Team members" value={`${teamMembers.length}`} />
        <MiniStat label="Assigned items" value={`${assignedCount}/${audit.recurringItems.length}`} />
        <MiniStat label="Needs review" value={`${actionedCount}`} />
      </div>
      {reviewCompletedAt ? <p className="mt-3 rounded-md border border-verdict bg-(--verdict-tint) px-3 py-2 text-sm text-verdict">Review completed at {new Date(reviewCompletedAt).toLocaleString("en-IN")}.</p> : null}

      <div className="mt-4 inset p-4">
        <p className="eyebrow">Review team</p>
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
        folio="§ 12"
        kicker="Readiness"
        title="User readiness"
        desc="What works in this self-serve audit and which connected features still need setup or partners."
        right={<span className="pill pill-ready">Self-serve ready</span>}
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
    <section className="panel p-5 sm:p-6" data-reveal>
      <SectionHead
        folio="§ 06"
        kicker="Spectrum"
        title="Spend spectrum"
        desc="Every recurring rupee, split by merchant and lit by its verdict. The hottest bands are where money leaves fastest."
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
                <button key={item.id} type="button" onClick={() => onSelect(item.id)} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-white/[0.04]">
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
        <p className="inset mt-5 px-3 py-6 text-center text-sm text-(--muted)">Add sources to light up your spend spectrum.</p>
      )}
    </section>
  );
}

function TickerStat({ label, value, tone }: { label: string; value: string; tone: "ember" | "ochre" | "paper" }) {
  const color = tone === "ember" ? "var(--ember)" : tone === "ochre" ? "var(--ochre)" : "var(--dossier-ink)";
  const textShadow = tone === "paper" ? "none" : `0 0 16px color-mix(in srgb, ${color} 45%, transparent)`;
  return (
    <div className="flex items-baseline gap-2">
      <span className="eyebrow muted-on-dark" style={{ fontSize: "0.54rem", letterSpacing: "0.16em" }}>{label}</span>
      <span className="font-data text-sm font-semibold tnum" style={{ color, textShadow }}>{value}</span>
    </div>
  );
}

function SectionHead({ folio, kicker, title, desc, right }: { folio: string; kicker: string; title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <span className="folio" data-folio={folio}>{kicker}</span>
        <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-(--ink)">{title}</h2>
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
        <p className="eyebrow" style={{ fontSize: "0.58rem" }}>{label}</p>
        <span className="size-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 10px 0 ${color}` }} />
      </div>
      <p className="font-data mt-3 text-[1.7rem] font-semibold leading-none tnum" style={{ color, textShadow: `0 0 20px color-mix(in srgb, ${color} 40%, transparent)` }}>{value}</p>
      <span className="mt-3 block h-px w-full" style={{ background: `color-mix(in srgb, ${color} 45%, var(--line))` }} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inset px-3 py-2.5">
      <p className="eyebrow" style={{ fontSize: "0.54rem" }}>{label}</p>
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
    { label: "Statement exports", value: statementCount ? `${statementCount} source(s) connected` : "Use only when live source access is unavailable", state: statementCount ? "ready" as const : "planned" as const },
    { label: "Manual commitments", value: manualCount ? `${manualCount} item(s) added` : "Use for Apple, UPI, domains, insurance", state: manualCount ? "ready" as const : "partial" as const },
    { label: "PDF statements", value: "Readable PDFs are supported with verification warnings", state: "partial" as const },
    { label: "Receipt snippets", value: "Paste invoice snippets now; Gmail OAuth needs setup", state: "partial" as const },
    { label: "Connected bank data", value: "Requires Account Aggregator partner route", state: "blocked" as const },
    { label: "UPI/card mandates", value: "Manual today; provider APIs required for direct sync", state: "blocked" as const },
  ];
}

function getReadinessItems(statementCount: number, manualCount: number) {
  return [
    { label: "Audit engine", value: "Deterministic recurring detection, confidence, next debit, evidence", state: "ready" as const },
    { label: "Real-user workflow", value: statementCount || manualCount ? "Real sources can be audited now" : "Add sources to run a real audit", state: statementCount || manualCount ? "ready" as const : "partial" as const },
    { label: "Data handling", value: "Session-local by default; backup file is user-controlled", state: "ready" as const },
    { label: "Exports", value: "PDF, spreadsheet, JSON audit pack, and private workspace backup", state: "ready" as const },
    { label: "Accounts", value: "Optional future layer for encrypted cloud sync", state: "planned" as const },
    { label: "Direct integrations", value: "Gmail, AA, and mandate APIs need credentials/partners", state: "blocked" as const },
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