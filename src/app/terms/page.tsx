import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for using Vognary's evidence-backed Commitment Control workspace.",
  alternates: { canonical: "/terms" },
  openGraph: {
    url: "/terms",
    title: "Terms - Vognary",
    description: "Terms for using Vognary's evidence-backed Commitment Control workspace.",
  },
};

const effectiveDate = "1 September 2026";

const terms = [
  ["1. The service", "Vognary is software for discovering, organizing, forecasting, reviewing, and documenting recurring financial commitments from available evidence. Vognary is not a bank, payment institution, account aggregator, broker, investment adviser, insurance adviser, accountant, law firm, or cancellation service."],
  ["2. Eligibility and authority", "You must be legally able to accept these terms and authorized to submit every workspace record, inbox message, file, or provider record you use. Do not submit another person's confidential or financial data without lawful authority."],
  ["3. Accounts and security", "You are responsible for protecting access to your email and provider accounts, keeping your device secure, and promptly disconnecting sources you no longer authorize. Vognary may require verified identity, reauthentication, or workspace-role checks before sensitive operations."],
  ["4. Source coverage", "Vognary does not access or scan your mailbox. Messages sent to your private Vognary receipt address, plus evidence you paste or upload, are treated as submitted evidence. Keep the receipt address confidential. Each source covers only the fields, history, and timing it contains and does not guarantee that every subscription or charge has been found."],
  ["5. Financial decisions", "Forecasts, classifications, duplicate matches, savings, and action suggestions are informational outputs from available evidence. You must review the merchant, amount, contract, notice period, consequences, and source before acting. Debt, EMIs, insurance, taxes, investments, utilities, and contractual services must not be treated as ordinary cancellable subscriptions."],
  ["6. Actions and third parties", "Vognary may provide instructions, drafts, or deep links. Unless a separately identified provider-supported integration says otherwise, Vognary does not itself cancel a service, stop a bank mandate, release a contractual obligation, or guarantee a merchant outcome. Third-party services remain governed by their own terms and privacy notices."],
  ["7. Acceptable use", "Do not use Vognary to access accounts without authorization, evade payment obligations, commit fraud, upload malware, probe other workspaces, overwhelm the service, reverse engineer protected systems, or violate law or provider terms. Security research should be reported responsibly rather than used to access real data."],
  ["8. Your content and permissions", "You retain rights in data and evidence you submit. You grant Vognary the limited permission needed to process it for the product functions you request, secure the service, and meet legal obligations. Vognary does not acquire ownership of your financial evidence."],
  ["9. Privacy and deletion", "Processing is described in the Privacy Notice. Deleting a workspace or account revokes its receipt address and removes Vognary-held active product data through the deletion workflow. Provider-held email copies, limited security or legal records, and encrypted backup copies can remain under their separate retention or recovery periods."],
  ["10. Availability", "Vognary can change, pause, lose provider access, contain errors, or require migration. Vognary may suspend a connection or account to protect users, investigate abuse, comply with law, or address a security risk. Material product claims follow the status displayed for each source."],
  ["11. Payments", "The Commitment Control private pilot costs ₹14,999 as a one-time payment for one month. It includes one policy setup, up to ten proposals, up to four weekly 30-minute reconciliation reviews, and up to two additional founder-support hours. Service and customer-data access begin only after the written activation conditions, including the required independent security review, are complete. If Vognary cannot activate the pilot within ten business days after payment, you may request a full refund. A second month requires a separate purchase and does not renew automatically. Vognary does not store card, UPI, or bank credentials and does not itself debit accounts. The retired public checkout route remains unavailable. Keep the payment provider's confirmation; email support@vognary.com for a letterhead receipt. GST is charged only when a GSTIN is stated on the invoice; the listed price does not include GST. After pilot work begins, further refund eligibility follows applicable law."],
  ["12. Warranty disclaimer", "To the extent permitted by law, Vognary is provided on an as-available basis. Vognary does not warrant uninterrupted provider access, universal discovery, exact forecasts, merchant cooperation, or that a suggested action is suitable for your legal or financial situation. Mandatory consumer rights are not excluded."],
  ["13. Liability", "To the extent permitted by law, Vognary is not responsible for losses caused by decisions taken without verifying source evidence, provider outages, unauthorized account access outside Vognary's reasonable control, or obligations that continue after a payment method is stopped. Liability that cannot legally be excluded remains unaffected."],
  ["14. Governing rules", "These terms are governed by applicable laws of India, subject to mandatory consumer protections and the jurisdiction of a competent court. This page does not claim legal or regulatory approval."],
  ["15. Changes and contact", "Material changes will be dated and communicated where required. Continued use after an effective update means acceptance only where the law permits that method. Questions can be sent to legal@vognary.com."],
] as const;

export default function TermsPage() {
  return (
    <main id="ledger-main" className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex gap-2">
            <Link href="/privacy" className="btn btn-sm btn-ghost">Privacy</Link>
            <Link href="/app" className="btn btn-sm btn-ghost">Back to app</Link>
          </div>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Trust">Terms</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">Terms for evidence-backed decisions</h1>
          <p className="mt-3 text-sm leading-7 text-(--muted)">Effective {effectiveDate}. These terms define Vognary 1.0 capabilities, user responsibilities, payment boundaries, and financial-safety limits.</p>
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
