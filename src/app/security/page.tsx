import Link from "next/link";
import { VognaryMark } from "../brand";

export default function SecurityPage() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <Link href="/" className="btn btn-ghost">Back to app</Link>
        </div>
        <article className="panel p-6 sm:p-8 rise">
          <span className="folio" data-folio="Trust">Security</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-(--ink) sm:text-4xl">How Vognary handles data</h1>
          <p className="mt-3 text-sm leading-7 text-(--muted)">Today, the review runs without backend file storage by default. Encrypted account storage is only for signed-in beta users.</p>
          <div className="mt-8 grid gap-3">
            {items.map((item) => (
              <div key={item.title} className="inset p-4">
                <h2 className="font-display text-base font-semibold text-(--ink)">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-(--muted)">{item.body}</p>
              </div>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}

const items = [
  { title: "No passwords or PINs", body: "Vognary never asks for bank passwords, card PINs, UPI PINs, or netbanking credentials." },
  { title: "No backend file storage by default", body: "The current audit and file-import APIs process request data and return results without storing uploaded financial files." },
  { title: "Proof before action", body: "Each suggestion links back to transaction or receipt text so users can verify before acting." },
  { title: "Encrypted account storage", body: "Signed-in beta storage must be encrypted, access logged, and deletable by the user." },
  { title: "Approved integrations only", body: "Gmail, Account Aggregator, UPI, and card-mandate integrations require approved scopes, partners, and legal review." },
];