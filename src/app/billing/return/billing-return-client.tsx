"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type CheckoutStatusPayload = {
  status: "created" | "pending" | "paid" | "failed" | "cancelled" | "expired" | "refunded";
  plan: string;
  currency: string;
  amountMinor: number;
  paidAt: string | null;
  refundedAt: string | null;
};

type ViewState =
  | { kind: "missing" }
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "unavailable" }
  | { kind: "status"; payload: CheckoutStatusPayload };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pendingStatuses = new Set(["created", "pending"]);
const maxPendingRefreshes = 10;

export default function BillingReturnClient({ checkoutId }: { checkoutId: string | null }) {
  const validId = useMemo(() => (checkoutId && uuidPattern.test(checkoutId) ? checkoutId.toLowerCase() : null), [checkoutId]);
  const [view, setView] = useState<ViewState>(validId ? { kind: "loading" } : { kind: "missing" });
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`/api/checkout/${validId}`, { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 404) return setView({ kind: "not-found" });
        if (!response.ok) return setView({ kind: "unavailable" });
        const payload = await response.json() as CheckoutStatusPayload;
        setView({ kind: "status", payload });
        if (pendingStatuses.has(payload.status) && refreshCount < maxPendingRefreshes) {
          window.setTimeout(() => { if (!cancelled) setRefreshCount((count) => count + 1); }, 3_000);
        }
      } catch {
        if (!cancelled) setView({ kind: "unavailable" });
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [validId, refreshCount]);

  if (view.kind === "missing") {
    return (
      <StatusPanel tone="neutral" heading="No checkout reference">
        This page needs the checkout link you received when starting payment. If you completed a payment,
        your Razorpay receipt email is authoritative proof; reply to it if you need help.
      </StatusPanel>
    );
  }
  if (view.kind === "loading") {
    return <StatusPanel tone="neutral" heading="Checking payment status...">Fetching the latest settlement state.</StatusPanel>;
  }
  if (view.kind === "not-found") {
    return (
      <StatusPanel tone="warn" heading="Checkout not found">
        This checkout reference does not match any payment on file. If money left your account,
        keep the Razorpay receipt email and reply to it — payments are always reconciled against Razorpay&apos;s records.
      </StatusPanel>
    );
  }
  if (view.kind === "unavailable") {
    return (
      <StatusPanel tone="warn" heading="Status temporarily unavailable">
        The status service could not be reached. Refresh this page in a moment; your payment state is stored
        server-side and is not affected by this page.
      </StatusPanel>
    );
  }

  const { payload } = view;
  const amount = `${payload.currency === "INR" ? "INR " : `${payload.currency} `}${(payload.amountMinor / 100).toLocaleString("en-IN")}`;
  const label = payload.plan === "annual" ? "one-time private audit" : `${payload.plan} monitoring`;

  if (payload.status === "paid") {
    return (
      <StatusPanel tone="good" heading={`Payment settled — ${amount}`}>
        Your {label} payment is confirmed by Razorpay&apos;s signed webhook.
        {payload.plan === "annual"
          ? " Next step: we reply to your audit-request email with the safest minimum source to share. Nothing else to do right now."
          : " Your workspace entitlement is active; open the app to continue."}
        {payload.plan !== "annual" ? <span className="mt-3 block"><Link href="/app" className="btn btn-primary">Open the app</Link></span> : null}
      </StatusPanel>
    );
  }
  if (payload.status === "refunded") {
    return (
      <StatusPanel tone="neutral" heading={`Refunded — ${amount}`}>
        This payment was refunded{payload.refundedAt ? ` on ${new Date(payload.refundedAt).toLocaleDateString("en-IN")}` : ""}.
        Refunds appear on your statement within your bank&apos;s usual timeline.
      </StatusPanel>
    );
  }
  if (payload.status === "cancelled" || payload.status === "expired" || payload.status === "failed") {
    return (
      <StatusPanel tone="warn" heading="Payment not completed">
        This {label} checkout is {payload.status}. No money is due on it. You can start again from the
        {" "}<Link href="/private-audit" className="underline">private audit page</Link> whenever you are ready.
      </StatusPanel>
    );
  }
  return (
    <StatusPanel tone="neutral" heading={`Awaiting settlement — ${amount}`}>
      Razorpay has not confirmed this payment yet. This page refreshes automatically for a short while.
      If you completed payment, the confirmation usually lands within a minute; your Razorpay receipt email
      remains the authoritative proof either way.
    </StatusPanel>
  );
}

function StatusPanel({ tone, heading, children }: { tone: "good" | "warn" | "neutral"; heading: string; children: React.ReactNode }) {
  const borderColor = tone === "good" ? "var(--green, #2e7d32)" : tone === "warn" ? "var(--gold)" : "var(--line)";
  return (
    <section className="mt-6 rounded-[11px] border p-5" style={{ borderColor }} aria-live="polite">
      <h2 className="font-display text-xl font-semibold text-(--ink)">{heading}</h2>
      <p className="mt-2 text-sm leading-7 text-(--muted)">{children}</p>
    </section>
  );
}
