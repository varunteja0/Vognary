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
      provider_checkout_id: string;
      status: string;
      amount_minor: string;
      currency: string;
    }>(
      `select id, provider_checkout_id, status, amount_minor::text, currency
       from billing_checkout_sessions
       where provider = 'razorpay'
         and provider_checkout_id is not null
         and created_at > now() - interval '120 days'
       order by created_at desc
       limit 100`,
    );
    const checks = [];
    for (const checkout of result.rows) {
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
      reportOnly: true,
      checked: checks.length,
      mismatches: mismatchCount,
      checks,
      note: "Resolve mismatches through provider investigation or a replayed signed webhook; this command never mutates entitlements.",
    }, null, 2));
    if (!reportOnly && mismatchCount) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

function compatibleStatus(localStatus: string, providerStatus: string | undefined) {
  if (localStatus === "paid" || localStatus === "refunded") return providerStatus === "paid";
  if (localStatus === "cancelled") return providerStatus === "cancelled";
  if (localStatus === "expired") return providerStatus === "expired";
  return providerStatus === "created" || providerStatus === "issued" || providerStatus === "partially_paid";
}