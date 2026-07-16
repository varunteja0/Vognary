import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "How Vognary collects, uses, protects, retains, exports, and deletes personal and financial evidence.",
};

const effectiveDate = "13 July 2026";

const sections = [
  {
    title: "1. Scope and contact",
    body: (
      <>
        This notice describes Vognary 1.0 as operated through vognary.com. Questions, correction requests, export requests,
        deletion requests, and grievances can be sent to{" "}
        <a className="underline underline-offset-2" href="mailto:privacy@vognary.com">privacy@vognary.com</a>. This notice describes
        product behavior; it is not a claim of regulatory certification.
      </>
    ),
  },
  {
    title: "2. Data Vognary may process",
    body: (
      <>
        Account data can include your name, verified email, workspace membership, consent choices, and authentication events. Product
        data can include recurring-payment evidence, merchant names, dates, amounts, currency, cadence, source references, decisions,
        notes, and review history. Connected sources can provide receipt, invoice, subscription, usage, or billing metadata within the
        exact scope you approve. Operational data can include IP-derived rate-limit keys, request timestamps, error codes, device/browser
        metadata, and synchronization status. Private-audit and contact forms store the information you submit when durable intake is configured.
      </>
    ),
  },
  {
    title: "3. Data Vognary does not request",
    body: (
      <>
        Do not provide netbanking passwords, email passwords, UPI PINs, card PINs, full card numbers, CVVs, or credentials belonging to
        another person. OAuth connections happen on the provider&apos;s official consent screen. Vognary receives a scoped token, not the
        provider password.
      </>
    ),
  },
  {
    title: "4. How data is collected",
    body: (
      <>
        Data comes directly from you, from files or text you intentionally submit, from providers you explicitly connect, and from
        service telemetry needed to secure and operate Vognary. A connection does not imply universal coverage: each source has its own
        date range, fields, update timing, and authorization limits.
      </>
    ),
  },
  {
    title: "5. Why data is used",
    body: (
      <>
        Vognary uses data to authenticate you; create and secure your workspace; discover, reconcile, classify, and forecast recurring
        commitments; show evidence and source freshness; prepare user-approved actions and exports; operate synchronization; prevent
        fraud and abuse; diagnose reliability issues; respond to support or rights requests; and comply with applicable law. Financial
        evidence is not used to sell third-party advertising.
      </>
    ),
  },
  {
    title: "6. Consent and user control",
    body: (
      <>
        Connecting a source is optional. Provider consent can be withdrawn by disconnecting it in Vognary and, where available, in the
        provider account. Disconnecting stops future Vognary synchronization; provider-side revocation can take separate processing.
        Material actions such as cancellation or mandate changes require an explicit user decision. Optional aggregate merchant
        intelligence is not enabled without a separate opt-in. Optional product analytics is off until opt-in and accepts only
        allowlisted event names/bounded numeric counts—no merchant, amount, currency, email, notes, tokens, source text or arbitrary
        metadata. Renewal email alerts are also off by default. Enabling them records a separate purpose-specific consent with the
        selected reminder windows, time zone, and local delivery hour; disabling alerts or withdrawing that consent cancels unsent
        reminders. The email provider receives the recipient and the reminder content only when a due alert is sent.
      </>
    ),
  },
  {
    title: "7. Storage and retention",
    body: (
      <>
        Statement and PDF upload endpoints process files for the request and do not intentionally retain the original file by default.
        A guest audit keeps converted evidence in the current tab&apos;s session storage for up to two hours so the same tab can survive a
        refresh and complete sign-in. The transfer is bounded, never placed in a URL, can be cleared from the guest page, and is removed
        only after encrypted workspace persistence succeeds.
        When the operator activates the lifecycle executor described in Vognary&apos;s production runbook, the default workspace policy
        minimizes stored raw connector and connector-transaction JSON after 30 days. Terminal webhook JSON is minimized after 30 days;
        a verified webhook that remains unprocessed through that window is marked ignored and minimized instead of being retained
        indefinitely. The executor deletes optional product events after 90 days and clears stored connector synchronization error text
        after 30 days. Workspace admins can select shorter or longer bounded windows. It preserves normalized recurring facts, evidence columns,
        transaction facts, payload hashes, and audit events so the ledger remains explainable after raw payload minimization. Privacy
        request metadata is retained for up to 730 days and retention-run metadata for up to 365 days. This job does not delete uploaded
        objects, provider-held data, backups, or records held by external delivery and monitoring services; those remain governed by
        their separate deletion and recovery processes. Renewal preferences and minimized delivery status remain with the workspace
        until the user or workspace is deleted; delivery rows do not duplicate recipient email, merchant, amount, or source evidence.
        Paid checkout rows, provider payment/refund identifiers, amounts, currency, offer/terms versions, and one-time fulfillment status
        can be retained or pseudonymized when narrowly required for reconciliation, refunds, disputes, accounting, fraud prevention, or
        legal obligations. Account deletion removes direct email and user/workspace links from those retained settlement rows. Vognary
        does not promise instant deletion from immutable backups.
      </>
    ),
  },
  {
    title: "8. Service providers and transfers",
    body: (
      <>
        Vognary can use hosting, database, email-delivery, monitoring, backup, and connected-provider services solely to operate the
        product. Those providers process only the data required for their role and may process it outside your state or country subject
        to their terms, contractual safeguards, and applicable transfer restrictions. Vognary does not sell personal financial evidence.
      </>
    ),
  },
  {
    title: "9. Security",
    body: (
      <>
        Stored connector secrets and signed-in workspace state use authenticated application-layer encryption. Sessions use secure cookie
        controls, sensitive routes require server-side authorization, and the product applies rate limits and security headers. No
        internet service is risk-free. Security details and current limitations are published on the{" "}
        <Link className="underline underline-offset-2" href="/security">security page</Link>.
      </>
    ),
  },
  {
    title: "10. Your rights",
    body: (
      <>
        Depending on applicable law, you may request access, correction, export, erasure, withdrawal of consent, or information about
        processing. Authenticated workspace admins can request and download a machine-readable workspace export; exports are generated
        live, expire after seven days, and omit connector secrets and raw payloads. Workspace roles and another person&apos;s rights can limit
        a request. The existing profile flow can delete the signed-in account under the workspace conditions shown there and pseudonymizes
        retained settlement records; assisted erasure is available for data that flow does not remove automatically. Vognary may verify identity before fulfilling assisted
        requests and may retain narrowly required records for security, dispute, tax, or legal obligations. Correction, assisted export,
        erasure, and other rights requests can be sent to the privacy contact above.
      </>
    ),
  },
  {
    title: "11. Children and restricted use",
    body: (
      <>
        Vognary is not directed to children and should not be used to upload a child&apos;s financial data without lawful authority. Users
        must have the right to connect each account and submit each document they provide.
      </>
    ),
  },
  {
    title: "12. Changes",
    body: (
      <>
        Material changes will be dated on this page and, where required, presented for renewed notice or consent. A new purpose that is
        incompatible with the purpose originally explained will not silently inherit an earlier consent.
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <main id="ledger-main" className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <TrustNav />
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Trust">Privacy notice</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">Privacy, without hidden coverage claims</h1>
          <p className="mt-3 text-sm leading-7 text-(--muted)">Effective {effectiveDate}. This notice explains Vognary 1.0 and the boundaries users should understand before connecting financial evidence.</p>
          <div className="mt-8 grid gap-6">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="font-display text-lg font-semibold text-(--ink)">{section.title}</h2>
                <div className="mt-2 text-sm leading-7 text-(--muted)">{section.body}</div>
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}

function TrustNav() {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
        <VognaryMark size={22} />
        Vognary
      </Link>
      <div className="flex gap-2">
        <Link href="/terms" className="btn btn-sm btn-ondark border-transparent text-(--ink-soft)">Terms</Link>
        <Link href="/app" className="btn btn-sm btn-ghost">Back to app</Link>
      </div>
    </div>
  );
}
