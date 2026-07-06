"use client";

import { useMemo, useState } from "react";
import {
  analyzeStatements,
  type AuditResult,
  type Frequency,
  type ManualRecurringInput,
  type RecommendationType,
  type RecurringItem,
  type StatementSource,
} from "@/lib/recurring-audit";

const sampleStatement = `Date,Description,Debit,Credit
2026-01-05,OPENAI CHATGPT PLUS,1999,
2026-02-05,OPENAI CHATGPT PLUS,1999,
2026-03-05,OPENAI CHATGPT PLUS,1999,
2026-04-05,OPENAI CHATGPT PLUS,1999,
2026-05-05,OPENAI CHATGPT PLUS,1999,
2026-06-05,OPENAI CHATGPT PLUS,1999,
2026-01-08,ANTHROPIC CLAUDE PRO,1700,
2026-02-08,ANTHROPIC CLAUDE PRO,1700,
2026-03-08,ANTHROPIC CLAUDE PRO,1700,
2026-04-08,ANTHROPIC CLAUDE PRO,1700,
2026-05-08,ANTHROPIC CLAUDE PRO,1700,
2026-06-08,ANTHROPIC CLAUDE PRO,1700,
2026-01-12,RENDER.COM HOSTING,2240,
2026-02-12,RENDER.COM HOSTING,2260,
2026-03-12,RENDER.COM HOSTING,2280,
2026-04-12,RENDER.COM HOSTING,2310,
2026-05-12,RENDER.COM HOSTING,2480,
2026-06-12,RENDER.COM HOSTING,2710,
2026-01-14,VERCEL PRO PLAN,1650,
2026-02-14,VERCEL PRO PLAN,1650,
2026-03-14,VERCEL PRO PLAN,1650,
2026-04-14,VERCEL PRO PLAN,1650,
2026-05-14,VERCEL PRO PLAN,1650,
2026-06-14,VERCEL PRO PLAN,1650,
2026-01-18,NETFLIX INDIA,649,
2026-02-18,NETFLIX INDIA,649,
2026-03-18,NETFLIX INDIA,649,
2026-04-18,NETFLIX INDIA,649,
2026-05-18,NETFLIX INDIA,649,
2026-06-18,NETFLIX INDIA,649,
2026-01-21,ADOBE CREATIVE CLOUD,4230,
2026-02-21,ADOBE CREATIVE CLOUD,4230,
2026-03-21,ADOBE CREATIVE CLOUD,4230,
2026-04-21,ADOBE CREATIVE CLOUD,4230,
2026-05-21,ADOBE CREATIVE CLOUD,4230,
2026-06-21,ADOBE CREATIVE CLOUD,4230,
2026-01-25,SIP ZERODHA MUTUAL FUND,5000,
2026-02-25,SIP ZERODHA MUTUAL FUND,5000,
2026-03-25,SIP ZERODHA MUTUAL FUND,5000,
2026-04-25,SIP ZERODHA MUTUAL FUND,5000,
2026-05-25,SIP ZERODHA MUTUAL FUND,5000,
2026-06-25,SIP ZERODHA MUTUAL FUND,5000,
2026-06-28,SWIGGY ORDER,620,
2026-06-30,UBER TRIP,440,
2026-06-30,SALARY CREDIT,,180000`;

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
  keep: "border-emerald-700/20 bg-emerald-50 text-emerald-800",
  watch: "border-blue-700/20 bg-blue-50 text-blue-800",
  downgrade: "border-amber-700/20 bg-amber-50 text-amber-800",
  cancel: "border-red-700/20 bg-red-50 text-red-800",
  investigate: "border-stone-700/20 bg-stone-100 text-stone-800",
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
};

const emptyManualDraft: ManualDraft = {
  merchant: "",
  amount: "",
  frequency: "monthly",
  nextExpectedDate: new Date().toISOString().slice(0, 10),
  category: "Other",
  sourceName: "manual entry",
};

export default function VognaryMvpClient() {
  const [statementSources, setStatementSources] = useState<StatementFile[]>([]);
  const [manualItems, setManualItems] = useState<ManualRecurringInput[]>([]);
  const [manualDraft, setManualDraft] = useState<ManualDraft>(emptyManualDraft);
  const [pastedCsv, setPastedCsv] = useState("");
  const [pastedName, setPastedName] = useState("pasted-statement.csv");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [userActions, setUserActions] = useState<Record<string, RecommendationType>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const audit = useMemo<AuditResult>(
    () => analyzeStatements(statementSources.map(({ name, text }) => ({ name, text })), manualItems),
    [statementSources, manualItems],
  );
  const selectedItem = audit.recurringItems.find((item) => item.id === selectedItemId) ?? audit.recurringItems[0] ?? null;
  const hasRealData = statementSources.length > 0 || manualItems.length > 0;

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
    const rejectedCount = files.length - csvFiles.length;
    const nextSources = await Promise.all(
      csvFiles.map(async (file) => {
        const text = await file.text();
        return {
          id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
          name: file.name,
          text,
          rowCount: countRows(text),
        } satisfies StatementFile;
      }),
    );

    setStatementSources((current) => [...current, ...nextSources]);
    setNotice(rejectedCount ? `${rejectedCount} non-CSV file was skipped. PDF ingestion is the next backend slice.` : `${nextSources.length} statement source added.`);
    event.target.value = "";
  }

  function addPastedStatement() {
    if (!pastedCsv.trim()) {
      setNotice("Paste CSV text before adding it as a source.");
      return;
    }

    setStatementSources((current) => [
      ...current,
      {
        id: `${pastedName}-${Date.now()}`,
        name: pastedName || "pasted-statement.csv",
        text: pastedCsv,
        rowCount: countRows(pastedCsv),
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

  function loadSample() {
    setStatementSources([
      {
        id: "sample-founder-stack",
        name: "sample-founder-stack.csv",
        text: sampleStatement,
        rowCount: countRows(sampleStatement),
      },
    ]);
    setManualItems([
      {
        id: "manual-apple-icloud",
        merchant: "Apple iCloud Storage",
        amount: 749,
        frequency: "monthly",
        nextExpectedDate: "2026-07-10",
        category: "App store",
        sourceName: "manual app-store check",
      },
    ]);
    setUserActions({});
    setNotice("Loaded sample data. Clear workspace before auditing a real user.");
  }

  function clearWorkspace() {
    setStatementSources([]);
    setManualItems([]);
    setUserActions({});
    setSelectedItemId(null);
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
      mode: "private-beta-local-audit",
      readiness: getReadinessItems(statementSources.length, manualItems.length),
      sourceCoverage: getCoverageItems(statementSources.length, manualItems.length),
      summary: audit.summary,
      sources: statementSources.map(({ name, rowCount }) => ({ name, rowCount })),
      manualItems,
      recurringItems: audit.recurringItems.map((item) => ({
        ...item,
        userAction: userActions[item.id] ?? item.recommendationType,
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

  return (
    <main className="min-h-screen px-5 py-5 text-[var(--foreground)] sm:px-8 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)]/90 p-5 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Vognary Private Beta</p>
              <h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-normal text-[#12140f] sm:text-5xl">
                Recurring money control for founders before money leaves.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:text-base">
                Upload real statements, add missing mandates manually, inspect evidence, mark actions, and export an audit pack. This is the production-MVP path: usable now for private audits, transparent about integrations still pending.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={loadSample} className="h-10 rounded-[6px] border border-[var(--line)] bg-white px-4 text-sm font-semibold transition hover:border-[var(--accent)]">
                Load Example
              </button>
              <button type="button" onClick={clearWorkspace} className="h-10 rounded-[6px] border border-[var(--line)] bg-white px-4 text-sm font-semibold transition hover:border-[var(--danger)]">
                Clear Workspace
              </button>
              <button type="button" onClick={exportReport} className="h-10 rounded-[6px] bg-[var(--accent)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]">
                Export Audit Pack
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
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

            <RecurringGraph
              audit={audit}
              hasRealData={hasRealData}
              selectedItem={selectedItem}
              userActions={userActions}
              onSelect={setSelectedItemId}
            />
          </div>
        </section>

        {selectedItem ? (
          <SelectedItemPanel
            item={selectedItem}
            action={userActions[selectedItem.id] ?? selectedItem.recommendationType}
            onAction={(action) => setUserActions((current) => ({ ...current, [selectedItem.id]: action }))}
          />
        ) : null}

        <ReadinessPanel statementCount={statementSources.length} manualCount={manualItems.length} />
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
}) {
  return (
    <section className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#151712]">Audit Workspace</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Add multiple card, bank, and manual sources. The current MVP keeps all processing in the browser.</p>
        </div>
        <span className="rounded-[999px] border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-1 font-mono text-[11px] font-semibold text-[var(--accent-strong)]">
          Local-first
        </span>
      </div>

      <label className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-[var(--accent)] bg-[#f4fbf7] px-4 py-7 text-center transition hover:bg-[#eef8f2]">
        <span className="text-sm font-semibold text-[#172018]">Upload one or more CSV statements</span>
        <span className="max-w-sm text-xs leading-5 text-[var(--muted)]">Use exported bank/card CSVs with Date, Description, Amount or Debit/Credit columns.</span>
        <input type="file" multiple accept=".csv,text/csv" onChange={onFiles} className="sr-only" />
      </label>

      <div className="mt-4 grid gap-2">
        {sources.length ? sources.map((source) => (
          <div key={source.id} className="flex items-center justify-between gap-3 rounded-[6px] border border-[var(--line)] bg-[#fbfcf8] px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#20251d]">{source.name}</p>
              <p className="font-mono text-[11px] text-[var(--muted)]">{source.rowCount} data rows</p>
            </div>
            <button type="button" onClick={() => onRemoveSource(source.id)} className="rounded-[6px] border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--muted)] hover:border-[var(--danger)] hover:text-[var(--danger)]">
              Remove
            </button>
          </div>
        )) : <p className="rounded-[6px] border border-[var(--line)] bg-[#fbfcf8] px-3 py-3 text-sm text-[var(--muted)]">No real statement sources added yet.</p>}
      </div>

      <div className="mt-5 rounded-[8px] border border-[var(--line)] bg-[#fbfcf8] p-4">
        <div className="grid gap-3 sm:grid-cols-[0.55fr_1.45fr]">
          <input
            value={pastedName}
            onChange={(event) => onPastedName(event.target.value)}
            className="h-11 rounded-[6px] border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]"
            placeholder="source-name.csv"
          />
          <button type="button" onClick={onAddPastedStatement} className="h-11 rounded-[6px] bg-[#151712] px-4 text-sm font-semibold text-white transition hover:bg-[#2b3026]">
            Add Pasted CSV
          </button>
        </div>
        <textarea
          value={pastedCsv}
          onChange={(event) => onPastedCsv(event.target.value)}
          className="mt-3 min-h-28 w-full resize-y rounded-[6px] border border-[var(--line)] bg-white p-3 font-mono text-xs leading-5 outline-none focus:border-[var(--accent)]"
          placeholder="Paste CSV text here when a user cannot upload a file."
        />
      </div>

      <div className="mt-5 rounded-[8px] border border-[var(--line)] bg-[#fbfcf8] p-4">
        <h3 className="text-sm font-semibold text-[#151712]">Manual recurring commitment</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Use this for Apple, Google Play, UPI AutoPay, insurance, domains, or cloud subscriptions not visible in a CSV.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <input value={manualDraft.merchant} onChange={(event) => onManualDraft({ ...manualDraft, merchant: event.target.value })} className="h-11 rounded-[6px] border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]" placeholder="Merchant, e.g. Apple iCloud" />
          <input value={manualDraft.amount} onChange={(event) => onManualDraft({ ...manualDraft, amount: event.target.value })} className="h-11 rounded-[6px] border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]" placeholder="Amount in INR" inputMode="decimal" />
          <select value={manualDraft.frequency} onChange={(event) => onManualDraft({ ...manualDraft, frequency: event.target.value as Frequency })} className="h-11 rounded-[6px] border border-[var(--line)] bg-white px-3 text-sm capitalize outline-none focus:border-[var(--accent)]">
            {frequencyOptions.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}
          </select>
          <input value={manualDraft.nextExpectedDate} onChange={(event) => onManualDraft({ ...manualDraft, nextExpectedDate: event.target.value })} type="date" className="h-11 rounded-[6px] border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]" />
          <select value={manualDraft.category} onChange={(event) => onManualDraft({ ...manualDraft, category: event.target.value })} className="h-11 rounded-[6px] border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]">
            {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <input value={manualDraft.sourceName} onChange={(event) => onManualDraft({ ...manualDraft, sourceName: event.target.value })} className="h-11 rounded-[6px] border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]" placeholder="Source, e.g. phone check" />
        </div>
        <button type="button" onClick={onAddManualItem} className="mt-3 h-11 w-full rounded-[6px] bg-[var(--accent)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]">
          Add Manual Commitment
        </button>
        {manualItems.length ? (
          <div className="mt-3 grid gap-2">
            {manualItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-[6px] border border-[var(--line)] bg-white px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-[#20251d]">{item.merchant}</p>
                  <p className="text-xs text-[var(--muted)]">{formatCurrency(item.amount)} | {item.frequency} | {item.category}</p>
                </div>
                <button type="button" onClick={() => onRemoveManualItem(item.id)} className="rounded-[6px] border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--muted)] hover:border-[var(--danger)] hover:text-[var(--danger)]">
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {notice ? <p className="mt-4 rounded-[6px] border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">{notice}</p> : null}
      {warnings.length ? (
        <div className="mt-3 rounded-[6px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          {warnings.slice(0, 4).map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}
    </section>
  );
}

function CoveragePanel({ statementCount, manualCount }: { statementCount: number; manualCount: number }) {
  return (
    <section className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-[#151712]">Coverage Map</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">This is how we avoid fake completeness claims. Vognary shows exactly what is and is not connected.</p>
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
    <section className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)] shadow-sm">
      <div className="flex flex-col gap-2 border-b border-[var(--line)] px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#151712]">Recurring Money Graph</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {audit.summary.recurringCount} recurring items from {audit.summary.transactionCount} debit transactions.
          </p>
        </div>
        <p className="font-mono text-xs text-[var(--muted)]">Avg confidence {Math.round(audit.summary.averageConfidence)}%</p>
      </div>

      {audit.recurringItems.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-[#f5f7f0] text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
              <tr>
                <th className="px-5 py-3 font-semibold">Merchant</th>
                <th className="px-5 py-3 font-semibold">Frequency</th>
                <th className="px-5 py-3 font-semibold">Monthly</th>
                <th className="px-5 py-3 font-semibold">Next debit</th>
                <th className="px-5 py-3 font-semibold">Signal</th>
              </tr>
            </thead>
            <tbody>
              {audit.recurringItems.map((item) => {
                const action = userActions[item.id] ?? item.recommendationType;
                return (
                  <tr key={item.id} onClick={() => onSelect(item.id)} className={`cursor-pointer transition hover:bg-[#f8fbf4] ${selectedItem?.id === item.id ? "bg-[#eef8f2]" : "bg-white"}`}>
                    <td className="border-b border-[var(--line)] px-5 py-4">
                      <p className="font-semibold text-[#151712]">{item.merchant}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{item.category} | {item.confidenceScore}% confidence</p>
                    </td>
                    <td className="border-b border-[var(--line)] px-5 py-4 capitalize">{item.frequency}</td>
                    <td className="border-b border-[var(--line)] px-5 py-4 font-semibold">{formatCurrency(item.monthlyCost)}</td>
                    <td className="border-b border-[var(--line)] px-5 py-4 font-mono text-xs">{item.nextExpectedDate}</td>
                    <td className="border-b border-[var(--line)] px-5 py-4"><span className={`rounded-[999px] border px-3 py-1 text-xs font-semibold capitalize ${statusStyles[action]}`}>{action}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 py-12 text-center">
          <h3 className="text-xl font-semibold text-[#151712]">{hasRealData ? "No recurring pattern found yet" : "Start with real sources"}</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">
            {hasRealData ? "Add more months of statements or use manual entries for app-store, UPI, insurance, cloud, or domain commitments that do not appear in this statement." : "Upload CSV statements or add manual commitments. The sample is optional and only for demos."}
          </p>
        </div>
      )}
    </section>
  );
}

function SelectedItemPanel({ item, action, onAction }: { item: RecurringItem; action: RecommendationType; onAction: (action: RecommendationType) => void }) {
  return (
    <section className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr]">
      <div className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Selected recurring item</p>
        <h2 className="mt-3 text-2xl font-semibold text-[#151712]">{item.merchant}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.recommendationReason}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <MiniStat label="Average debit" value={formatCurrency(item.averageAmount)} />
          <MiniStat label="Annual cost" value={formatCurrency(item.annualCost)} />
          <MiniStat label="Amount range" value={`${formatCurrency(item.amountMin)} - ${formatCurrency(item.amountMax)}`} />
          <MiniStat label="Evidence rows" value={`${item.evidence.length}`} />
        </div>
        <div className="mt-5">
          <label className="block text-sm font-semibold text-[#20251d]" htmlFor="action-select">Founder action</label>
          <select id="action-select" value={action} onChange={(event) => onAction(event.target.value as RecommendationType)} className="mt-2 h-11 w-full rounded-[6px] border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]">
            <option value="keep">Keep</option>
            <option value="watch">Watch</option>
            <option value="downgrade">Downgrade</option>
            <option value="cancel">Cancel</option>
            <option value="investigate">Investigate</option>
          </select>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {item.riskTags.length ? item.riskTags.map((tag) => <span key={tag} className="rounded-[999px] border border-[var(--line)] bg-[#f8faf4] px-3 py-1 text-xs font-semibold text-[var(--muted)]">{tag}</span>) : <span className="text-sm text-[var(--muted)]">No risk tags yet.</span>}
        </div>
      </div>

      <div className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#151712]">Evidence Trail</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Every recommendation has transaction-level proof.</p>
          </div>
          <span className="rounded-[999px] bg-[#edf3e8] px-3 py-1 font-mono text-xs text-[var(--muted)]">{item.sourceNames.join(", ")}</span>
        </div>
        <div className="mt-4 overflow-hidden rounded-[8px] border border-[var(--line)]">
          <table className="w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-[#f5f7f0] text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Statement text</th>
              </tr>
            </thead>
            <tbody>
              {item.evidence.map((evidence) => (
                <tr key={`${evidence.source}-${evidence.rowNumber}-${evidence.date}`} className="bg-white">
                  <td className="border-t border-[var(--line)] px-4 py-3 font-mono text-xs">{evidence.date}</td>
                  <td className="border-t border-[var(--line)] px-4 py-3 font-semibold">{formatCurrency(evidence.amount)}</td>
                  <td className="border-t border-[var(--line)] px-4 py-3 text-[var(--muted)]">{evidence.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function ReadinessPanel({ statementCount, manualCount }: { statementCount: number; manualCount: number }) {
  return (
    <section className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#151712]">Production Readiness Track</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">This is the honest investor view: what works now, what must be built before regulated financial production.</p>
        </div>
        <span className="rounded-[999px] border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">Private beta MVP</span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {getReadinessItems(statementCount, manualCount).map((item) => <StatusRow key={item.label} {...item} />)}
      </div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "ink" | "blue" | "caution" | "accent" }) {
  const toneClass = {
    ink: "text-[#151712]",
    blue: "text-[var(--blue)]",
    caution: "text-[var(--caution)]",
    accent: "text-[var(--accent)]",
  }[tone];

  return (
    <div className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-4 py-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
      <p className={`mt-3 text-2xl font-semibold tracking-normal ${toneClass}`}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-[var(--line)] bg-[#fbfcf8] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[#151712]">{value}</p>
    </div>
  );
}

function StatusRow({ label, value, state }: { label: string; value: string; state: "ready" | "partial" | "blocked" | "planned" }) {
  const stateClass = {
    ready: "bg-emerald-50 text-emerald-800 border-emerald-200",
    partial: "bg-blue-50 text-blue-800 border-blue-200",
    blocked: "bg-amber-50 text-amber-900 border-amber-200",
    planned: "bg-stone-100 text-stone-800 border-stone-200",
  }[state];

  return (
    <div className="flex items-center justify-between gap-3 rounded-[6px] border border-[var(--line)] bg-[#fbfcf8] px-3 py-2">
      <div>
        <p className="text-sm font-semibold text-[#20251d]">{label}</p>
        <p className="text-xs leading-5 text-[var(--muted)]">{value}</p>
      </div>
      <span className={`shrink-0 rounded-[999px] border px-2 py-1 text-[11px] font-semibold capitalize ${stateClass}`}>{state}</span>
    </div>
  );
}

function getCoverageItems(statementCount: number, manualCount: number) {
  return [
    { label: "CSV statements", value: statementCount ? `${statementCount} source(s) connected` : "Connect bank/card exports", state: statementCount ? "ready" as const : "planned" as const },
    { label: "Manual commitments", value: manualCount ? `${manualCount} item(s) added` : "Use for Apple, UPI, domains, insurance", state: manualCount ? "ready" as const : "partial" as const },
    { label: "Gmail receipts", value: "Needs OAuth app verification and read-only scope", state: "blocked" as const },
    { label: "PDF statements", value: "Backend parser next; CSV is live now", state: "planned" as const },
    { label: "Account Aggregator", value: "Requires partner/TSP route and compliance review", state: "blocked" as const },
    { label: "UPI/card mandates", value: "Requires provider or issuer integrations", state: "blocked" as const },
  ];
}

function getReadinessItems(statementCount: number, manualCount: number) {
  return [
    { label: "Audit engine", value: "Deterministic recurring detection, confidence, next debit, evidence", state: "ready" as const },
    { label: "Real-user workflow", value: statementCount || manualCount ? "Real sources can be audited now" : "Add sources to run a real audit", state: statementCount || manualCount ? "ready" as const : "partial" as const },
    { label: "Data handling", value: "Browser-local; no server storage in this MVP", state: "ready" as const },
    { label: "Export pack", value: "JSON audit pack for founder/user validation", state: "ready" as const },
    { label: "Persistent accounts", value: "Needs auth, encrypted storage, deletion flow", state: "planned" as const },
    { label: "Regulated production", value: "Needs legal, security review, privacy policy, integration approvals", state: "blocked" as const },
  ];
}

function countRows(text: string): number {
  return Math.max(0, text.split(/\r?\n/).filter((row) => row.trim()).length - 1);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}