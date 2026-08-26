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
    heading: "Legal",
    address: "legal@vognary.com",
    body:
      "Questions about the Terms, the Privacy Notice, or a formal notice. This page is not legal advice and does not claim regulatory approval or registration.",
  },
] as const;

export default function ContactPage() {
  return (
    <main id="ledger-main" className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <div className="flex gap-2">
            <Link href="/security" className="btn btn-sm btn-ghost">Security</Link>
            <Link href="/" className="btn btn-sm btn-ghost">Back</Link>
          </div>
        </div>

        <article className="panel p-6 sm:p-8">
          <span className="folio" data-folio="Company">Contact</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">Reach a person, not a queue</h1>
          <p className="mt-3 text-sm leading-7 text-(--muted)">
            Vognary is a small team building Commitment Control for India-first AI-native companies. Mail is read by
            the people who build the product. Response time is not guaranteed and no support hours are published, because
            promising a window Vognary cannot yet keep would be the same kind of unproven claim the product refuses to make.
          </p>

          <div className="mt-8 grid gap-6">
            {channels.map((channel) => (
              <section key={channel.heading} className="border-t border-line pt-5">
                <h2 className="font-display text-lg font-semibold text-(--ink)">{channel.heading}</h2>
                <p className="mt-1">
                  <a className="link-quiet font-data text-sm text-(--ink)" href={`mailto:${channel.address}`}>
                    {channel.address}
                  </a>
                </p>
                <p className="mt-2 text-sm leading-7 text-(--muted)">{channel.body}</p>
              </section>
            ))}
          </div>

          <section className="mt-8 border-t border-line pt-5">
            <h2 className="font-display text-lg font-semibold text-(--ink)">What Vognary will never ask you for</h2>
            <ul className="reason-list mt-3">
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
        </article>
      </div>
    </main>
  );
}
