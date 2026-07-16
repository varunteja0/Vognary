import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { VognaryMark } from "../brand";
import { getConnectorById } from "@/lib/connectors";
import { getConnectorHonesty } from "@/lib/connector-runtime";
import SourceHealthClient from "./source-health-client";
import SourceSetupClient, { type SourceSetupOption } from "./source-setup-client";

export const metadata: Metadata = {
  title: "Sources",
  description: "Connect, refresh, and remove recurring-spend evidence sources without overstating their coverage.",
};

const managedConnectorIds = [
  "gmail-readonly",
  "openai-costs",
  "github-copilot",
  "cloudflare-billing",
  "render-platform",
  "vercel-platform",
] as const;

const redactionChecklist = [
  "Hide account and card numbers, CVV, OTPs, passwords, addresses, and identity-document numbers.",
  "Keep the merchant, charge date, amount, currency, cadence, and renewal text needed to verify the commitment.",
  "Use one redacted statement range only when a connected source cannot cover that account and period.",
];

export default async function SourcesPage() {
  await connection();
  const sourceOptions = buildSourceOptions();

  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/app?guest=1" prefetch={false} className="btn btn-ghost">Back to audit</Link>
        </div>

        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Sources">Evidence sources</span>
          <h1 className="mt-4 max-w-3xl font-display text-3xl font-semibold text-(--ink) sm:text-4xl">Keep the evidence behind your renewals current</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-(--muted)">See what is connected, refresh a source that needs attention, or remove access you no longer want. Freshness describes the evidence Vognary received; it never guarantees a provider has published every pending charge.</p>
          <SourceHealthClient />
        </article>

        <SourceSetupClient options={sourceOptions} />

        <details className="panel mt-5 p-5 sm:p-6">
          <summary className="cursor-pointer font-display text-lg font-semibold text-(--ink)">Fill a source gap with redacted evidence</summary>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
            <div>
              <p className="text-sm leading-6 text-(--muted)">Receipt or invoice paste is the safest fallback for one missing commitment. Statement import is useful when several repeated debits are absent. Manual entry is available when no document is needed.</p>
              <ul className="mt-3 grid gap-2 text-sm leading-6 text-(--muted)">
                {redactionChecklist.map((item) => <li key={item}>- {item}</li>)}
              </ul>
            </div>
            <Link href="/app?guest=1" prefetch={false} className="btn btn-ghost">Add fallback evidence</Link>
          </div>
        </details>

        <details className="panel mt-5 p-5 sm:p-6">
          <summary className="cursor-pointer font-display text-lg font-semibold text-(--ink)">Why bank, UPI, and card access is not offered here</summary>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-(--muted)">Direct Indian bank, UPI AutoPay, and card-mandate access requires an approved regulated partner path. Until that path is proven, Vognary accepts redacted evidence and does not ask for netbanking passwords, card numbers, UPI PINs, or card PINs.</p>
        </details>
      </div>
    </main>
  );
}

function buildSourceOptions() {
  return managedConnectorIds.flatMap((id): SourceSetupOption[] => {
    const connector = getConnectorById(id);
    if (!connector) return [];
    const honesty = getConnectorHonesty(connector);
    return [{
      id: connector.id,
      name: connector.name,
      authType: connector.authType,
      honestyLabel: honesty.label,
      honestyMeaning: honesty.meaning,
      evidenceBoundary: getPublicEvidenceBoundary(connector.id),
      requirements: getPublicRequirements(connector.id),
      accountLabel: getAccountLabel(connector.id),
      accountRequired: connector.id === "github-copilot",
    }];
  });
}

function getAccountLabel(connectorId: string) {
  if (connectorId === "github-copilot") return "GitHub organization slug";
  if (connectorId === "vercel-platform") return "Vercel team slug (optional)";
  if (connectorId === "render-platform") return "Render owner ID (optional)";
  return "Provider account ID (optional)";
}

function getPublicEvidenceBoundary(connectorId: string) {
  const boundaries: Record<string, string> = {
    "gmail-readonly": "Looks for supported receipt, invoice, renewal, trial, and pre-debit messages through read-only Gmail access. Complete mailbox or merchant coverage is not implied.",
    "openai-costs": "Reads organization usage and cost observations for an administered OpenAI account. It does not read a personal ChatGPT subscription or create recurring financial commitments from usage alone.",
    "github-copilot": "Records whether an organization Copilot report is available and its date range. It does not yet import seat rows or calculate seat cost.",
    "cloudflare-billing": "Records authorized Cloudflare account inventory and source health. The available response does not provide billing amounts.",
    "render-platform": "Records authorized Render service inventory and source health. Exact invoice and cost mapping is not available from this source.",
    "vercel-platform": "Records authorized Vercel domain inventory and renewal dates. It does not provide renewal amounts.",
  };
  return boundaries[connectorId] ?? "Coverage is limited to the evidence returned by the authorized provider account.";
}

function getPublicRequirements(connectorId: string) {
  const requirements: Record<string, string[]> = {
    "gmail-readonly": ["Google consent", "Read-only Gmail scope"],
    "openai-costs": ["Workspace-scoped OpenAI Admin API key"],
    "github-copilot": ["GitHub organization slug", "Token with organization or Copilot metrics read access", "Copilot Business or Enterprise"],
    "cloudflare-billing": ["Scoped Cloudflare API token", "Account read permission"],
    "render-platform": ["Render API key", "Workspace owner access"],
    "vercel-platform": ["Vercel token", "Optional team slug", "Domain read access"],
  };
  return requirements[connectorId] ?? [];
}
