import pg from "pg";

const { Pool } = pg;
const reportOnly = process.argv.includes("--report-only");
const databaseUrl = process.env.DATABASE_URL?.trim();
const keyId = process.env.RAZORPAY_KEY_ID?.trim();
const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

if (process.argv.includes("--help")) {
  console.log("Compare recent tracked Vognary checkouts with Razorpay Payment Link status. This command is report-only and never grants or revokes entitlements.\n\nUsage:\n  DATABASE_URL='...' RAZORPAY_KEY_ID='...' RAZORPAY_KEY_SECRET='...' npm run billing:reconcile -- --report-only");
  process.exit(0);
}
if (!databaseUrl || !keyId || !keySecret) {
  console.error("DATABASE_URL, RAZORPAY_KEY_ID, and RAZORPAY_KEY_SECRET are required.");
  process.exit(1);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Billing reconciliation failed.");
  process.exitCode = 1;
});

async function main() {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.POSTGRES_SSL === "true" ? {
      ca: process.env.POSTGRES_CA_CERT || undefined,
      rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false",
    } : undefined,
  });

  try {
    const result = await pool.query<{
      id: string;
      provider_checkout_id: string | null;
      status: string;
      amount_minor: string;
      refunded_amount_minor: string;
      currency: string;
      plan: string;
      provider_creation_started_at: Date | null;
      order_count: number;
      applied_refund_total: string;
    }>(
      `select checkout.id, checkout.provider_checkout_id, checkout.status,
              checkout.amount_minor::text, checkout.refunded_amount_minor::text,
              checkout.currency, checkout.plan, checkout.provider_creation_started_at,
              (select count(*)::int from assisted_audit_orders orders where orders.checkout_session_id = checkout.id) as order_count,
              coalesce((select sum(refund.amount_minor)::text
                        from billing_refunds refund
                        where refund.checkout_session_id = checkout.id and refund.status = 'applied'), '0') as applied_refund_total
       from billing_checkout_sessions checkout
       where checkout.provider = 'razorpay'
         and checkout.created_at > now() - interval '120 days'
       order by checkout.created_at desc
       limit 100`,
    );
    const checks = [];
    const unresolvedRefunds = await pool.query<{ status: string; count: number }>(
      `select status, count(*)::int as count
       from billing_refunds
       where status in ('pending_payment', 'rejected')
       group by status`,
    );
    for (const row of unresolvedRefunds.rows) {
      checks.push({ checkoutId: null, status: "unresolved-refunds", refundStatus: row.status, count: row.count });
    }
    const failedRefundWebhooks = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from billing_webhook_events
       where event_type = 'refund.processed'
         and status = 'failed'`,
    );
    if ((failedRefundWebhooks.rows[0]?.count ?? 0) > 0) {
      checks.push({ checkoutId: null, status: "failed-refund-webhooks", count: failedRefundWebhooks.rows[0].count });
    }
    for (const checkout of result.rows) {
      const localMismatches = [
        Number(checkout.refunded_amount_minor) === Number(checkout.applied_refund_total) ? null : "refund-total",
        ["paid", "partially_refunded", "refunded"].includes(checkout.status) && ["assisted-audit", "annual"].includes(checkout.plan) && checkout.order_count !== 1 ? "assisted-audit-order" : null,
        !["paid", "partially_refunded", "refunded"].includes(checkout.status) && checkout.order_count !== 0 ? "premature-assisted-audit-order" : null,
      ].filter((value): value is string => Boolean(value));
      if (!checkout.provider_checkout_id) {
        checks.push({
          checkoutId: checkout.id,
          status: "local-reconciliation-required",
          localStatus: checkout.status,
          providerCreationStartedAt: checkout.provider_creation_started_at?.toISOString() ?? null,
          mismatches: [...localMismatches, "provider-checkout-id"],
        });
        continue;
      }
      const response = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(checkout.provider_checkout_id)}`, {
        headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        checks.push({ checkoutId: checkout.id, status: "provider-unavailable", httpStatus: response.status });
        continue;
      }
      const provider = await response.json() as { reference_id?: string; status?: string; amount?: number; currency?: string };
      const mismatchFields = [
        ...localMismatches,
        provider.reference_id === checkout.id ? null : "reference",
        Number(checkout.amount_minor) === provider.amount ? null : "amount",
        checkout.currency === provider.currency ? null : "currency",
        compatibleStatus(checkout.status, provider.status) ? null : "status",
      ].filter((value): value is string => Boolean(value));
      checks.push({
        checkoutId: checkout.id,
        status: mismatchFields.length ? "mismatch" : "matched",
        localStatus: checkout.status,
        providerStatus: provider.status ?? "unknown",
        mismatches: mismatchFields,
      });
    }
    const mismatchCount = checks.filter((check) => check.status !== "matched").length;
    console.log(JSON.stringify({
      status: mismatchCount ? "attention-required" : "matched",
      reportOnly,
      checked: checks.length,
      mismatches: mismatchCount,
      checks,
      note: "Resolve mismatches through provider investigation or a replayed signed webhook; this command never mutates entitlements.",
    }, null, 2));
    if (mismatchCount) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

function compatibleStatus(localStatus: string, providerStatus: string | undefined) {
  if (localStatus === "paid" || localStatus === "partially_refunded" || localStatus === "refunded") return providerStatus === "paid";
  if (localStatus === "cancelled") return providerStatus === "cancelled";
  if (localStatus === "expired") return providerStatus === "expired";
  return providerStatus === "created" || providerStatus === "issued" || providerStatus === "partially_paid";
}