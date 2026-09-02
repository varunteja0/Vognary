import "../public.css";
import "../ledger.css";
import type { Metadata } from "next";
import Link from "next/link";
import { VognaryMark } from "../brand";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach Vognary about the product, your data, security, or legal questions.",
  alternates: { canonical: "/contact" },
  openGraph: {
    url: "/contact",
    title: "Contact - Vognary",
    description: "How to reach Vognary about the product, your data, security, or legal questions.",
  },
};

const channels = [
  {
    heading: "Product and support",
    address: "support@vognary.com",
    body:
      "Questions about reading a commitment, correcting an amount, a receipt that was not understood, or anything that looks wrong in your workspace. Include the merchant name and the date you expected, and say whether the evidence was pasted, uploaded, or forwarded. Do not send passwords, card numbers, or one-time codes — Vognary never needs them.",
  },
  {
    heading: "Your data",
    address: "support@vognary.com",
    body:
      "Requests to export or delete a workspace, revoke a private receipt address, or ask what Vognary holds about you. Deletion removes Vognary-held active product data through the deletion workflow; provider-held copies, limited security records, and encrypted backups follow the separate periods described in the Privacy Notice.",
  },
  {
    heading: "Security reports",
    address: "security@vognary.com",
    body:
      "Suspected vulnerabilities, exposed data, or anything that looks like a security defect. Report responsibly rather than testing against real workspaces or other people's data. The machine-readable contact is published at /.well-known/security.txt.",
  },
  {
    heading: "Pilot payment",
    address: "support@vognary.com",
    body:
      "Reserve the one-time ₹14,999 Commitment Control private pilot from /pay when online collection is configured. For an invoice and unique one-time payment link, email this address with the company legal name and GSTIN if any. Service starts only after the written activation conditions are met. Do not send card numbers, OTPs, or bank passwords — those stay with the payment provider.",
  },
  {
    heading: "Legal",
    address: "legal@vognary.com",
    body:
      "Questions about the Terms, the Privacy Notice, or a formal notice. This page is not legal advice and does not claim regulatory approval or registration.",
  },
] as const;

export default function ContactPage() {
  return (
    <main id="ledger-main" className="relative px-4 pb-12 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex gap-2">
            <Link href="/security" className="btn btn-sm btn-ghost">Security</Link>
            <Link href="/" className="btn btn-sm btn-ghost">Back</Link>
          </div>
        </div>

        <article className="public-ledger">
          <header className="public-ledger-rail">
          <span className="folio" data-folio="Company">Contact</span>
          <h1 className="mt-5 font-display text-4xl font-semibold leading-tight text-(--ink) sm:text-5xl">Reach a person, not a queue</h1>
          <p className="mt-5 text-sm leading-7 text-(--ink-soft)">
            Vognary is a small team building Commitment Control for India-first AI-native companies. Mail is read by
            the people who build the product. Response time is not guaranteed and no support hours are published, because
            promising a window Vognary cannot yet keep would be the same kind of unproven claim the product refuses to make.
          </p>
          <a className="btn btn-primary btn-lg mt-6 w-full" href="mailto:support@vognary.com">Email support@vognary.com</a>
          </header>

          <div className="public-ledger-body">
          <section className="public-band public-band-lead">
            <p className="truth-label truth-citation">Route the message</p>
            <h2 className="mt-3 font-display text-2xl font-semibold text-(--ink)">Choose the address by purpose</h2>
            <dl className="public-record-list mt-5">
              {channels.map((channel) => (
                <div key={channel.heading}>
                  <dt>{channel.heading}</dt>
                  <dd>
                  <a className="link-quiet font-data text-sm text-(--ink)" href={`mailto:${channel.address}`}>
                    {channel.address}
                  </a>
                  <p className="mt-2">{channel.body}</p>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="public-band">
            <p className="truth-label truth-frozen">Identity check</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-(--ink)">What Vognary will never ask you for</h2>
            <ul className="reason-list mt-4">
              <li>Bank, card, or UPI credentials, or a one-time passcode.</li>
              <li>Mailbox access. Vognary does not read your inbox.</li>
              <li>Permission to cancel a service or move money. It does neither.</li>
            </ul>
            <p className="mt-4 text-sm leading-7 text-(--muted)">
              A message that asks you for any of the above is not from Vognary. Read the{" "}
              <Link href="/security" className="link-quiet">security page</Link> for the controls that are proven today and the
              ones that are still marked unproven.
            </p>
          </section>
          </div>
        </article>
      </div>
    </main>
  );
}
