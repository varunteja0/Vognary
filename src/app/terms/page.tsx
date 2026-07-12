import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";

export const metadata: Metadata = {
  title: "Beta terms",
  description: "Terms for using Vognary's evidence-backed recurring-commitment beta.",
};

const effectiveDate = "11 July 2026";

const terms = [
  ["1. The service", "Vognary is software for discovering, organizing, forecasting, reviewing, and documenting recurring financial commitments from available evidence. The beta is not a bank, payment institution, account aggregator, broker, investment adviser, insurance adviser, accountant, or law firm."],
  ["2. Eligibility and authority", "You must be legally able to accept these terms and authorized to connect every account, workspace, inbox, file, or provider you use. Do not submit another person's confidential or financial data without lawful authority."],
  ["3. Accounts and security", "You are responsible for protecting access to your email and provider accounts, keeping your device secure, and promptly disconnecting sources you no longer authorize. Vognary may require verified identity, reauthentication, or workspace-role checks before sensitive operations."],
  ["4. Source coverage", "A connected source covers only the fields, accounts, history, timing, and permissions made available by that provider. Labels such as connected, fresh, partial, delayed, or reauthentication required describe evidence coverage; they do not guarantee that every commitment or charge has been found."],
  ["5. Financial decisions", "Forecasts, classifications, duplicate matches, savings, and action suggestions are informational outputs from available evidence. You must review the merchant, amount, contract, notice period, consequences, and source before acting. Debt, EMIs, insurance, taxes, investments, utilities, and contractual services must not be treated as ordinary cancellable subscriptions."],
  ["6. Actions and third parties", "Vognary may provide instructions, drafts, or deep links. Unless a separately identified provider-supported integration says otherwise, Vognary does not itself cancel a service, stop a bank mandate, release a contractual obligation, or guarantee a merchant outcome. Third-party services remain governed by their own terms and privacy notices."],
  ["7. Acceptable use", "Do not use Vognary to access accounts without authorization, evade payment obligations, commit fraud, upload malware, probe other workspaces, overwhelm the service, reverse engineer protected systems, or violate law or provider terms. Security research should be reported responsibly rather than used to access real data."],
  ["8. Your content and permissions", "You retain rights in data and evidence you submit. You grant Vognary the limited permission needed to process it for the product functions you request, secure the service, and meet legal obligations. Vognary does not acquire ownership of your financial evidence."],
  ["9. Privacy and deletion", "Processing is described in the Privacy Notice. Deleting a workspace or account removes active product data according to the available deletion workflow. Limited security records, legal records, and encrypted backup copies can remain for defined recovery or compliance periods."],
  ["10. Beta availability", "The beta can change, pause, lose provider access, contain errors, or require migration. Vognary may suspend a connection or account to protect users, investigate abuse, comply with law, or address a security risk. Material product claims must follow the status displayed for each source."],
  ["11. Fees", "Any paid audit, subscription, or partner service will present its price, billing period, taxes, renewal behavior, refund terms, and included limits before purchase. A link to an external checkout does not by itself create a Vognary entitlement or guarantee continuing service."],
  ["12. Warranty disclaimer", "To the extent permitted by law, the beta is provided on an as-available basis. Vognary does not warrant uninterrupted provider access, universal discovery, exact forecasts, merchant cooperation, or that a suggested action is suitable for your legal or financial situation. Mandatory consumer rights are not excluded."],
  ["13. Liability", "To the extent permitted by law, Vognary is not responsible for losses caused by decisions taken without verifying source evidence, provider outages, unauthorized account access outside Vognary's reasonable control, or obligations that continue after a payment method is stopped. Liability that cannot legally be excluded remains unaffected."],
  ["14. Governing rules", "These beta terms are governed by applicable laws of India, subject to mandatory consumer protections and the jurisdiction of a competent court. A future paid or enterprise agreement may replace these terms for that service."],
  ["15. Changes and contact", "Material changes will be dated and communicated where required. Continued use after an effective update means acceptance only where the law permits that method. Questions can be sent to legal@vognary.com."],
] as const;

export default function TermsPage() {
  return (
    <main id="ledger-main" className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex gap-2">
            <Link href="/privacy" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">Privacy</Link>
            <Link href="/app" className="btn btn-sm btn-ghost">Back to app</Link>
          </div>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Trust">Beta terms</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">Terms for evidence-backed decisions</h1>
          <p className="mt-3 text-sm leading-7 text-(--muted)">Effective {effectiveDate}. These terms define the current beta&apos;s capabilities, user responsibilities, and financial-safety boundaries.</p>
          <div className="mt-8 grid gap-6">
            {terms.map(([heading, body]) => (
              <section key={heading}>
                <h2 className="font-display text-lg font-semibold text-(--ink)">{heading}</h2>
                <p className="mt-2 text-sm leading-7 text-(--muted)">{body}</p>
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}
