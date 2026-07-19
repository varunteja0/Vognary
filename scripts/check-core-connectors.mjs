const requirements = [
  ["GOOGLE_CLIENT_ID or GOOGLE_AUTH_CLIENT_ID", Boolean(process.env.GOOGLE_CLIENT_ID?.trim() || process.env.GOOGLE_AUTH_CLIENT_ID?.trim())],
  ["GOOGLE_CLIENT_SECRET or GOOGLE_AUTH_CLIENT_SECRET", Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim() || process.env.GOOGLE_AUTH_CLIENT_SECRET?.trim())],
  ["GOOGLE_REDIRECT_URI", Boolean(process.env.GOOGLE_REDIRECT_URI?.trim())],
  ["GOOGLE_OAUTH_VERIFICATION_COMPLETE=true", process.env.GOOGLE_OAUTH_VERIFICATION_COMPLETE?.trim() === "true"],
  ["ACCOUNT_AGGREGATOR_PARTNER_STATUS=production-live", process.env.ACCOUNT_AGGREGATOR_PARTNER_STATUS?.trim() === "production-live"],
  ["SETU_AA_CLIENT_ID", Boolean(process.env.SETU_AA_CLIENT_ID?.trim())],
  ["SETU_AA_CLIENT_SECRET", Boolean(process.env.SETU_AA_CLIENT_SECRET?.trim())],
  ["SETU_AA_PRODUCT_INSTANCE_ID", Boolean(process.env.SETU_AA_PRODUCT_INSTANCE_ID?.trim())],
  ["SETU_AA_BASE_URL (approved non-sandbox production endpoint)", isProductionSetuUrl(process.env.SETU_AA_BASE_URL)],
];

const missing = requirements.filter(([, ready]) => !ready).map(([requirement]) => requirement);
console.log(JSON.stringify({
  status: missing.length ? "activation-pending" : "production-live",
  launchBoundary: ["gmail-readonly", "account-aggregator"],
  nonBlockingFollowOnRails: ["upi-mandates", "card-mandates"],
  missing,
}, null, 2));
if (missing.length) process.exit(1);

function isProductionSetuUrl(value) {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !/sandbox/i.test(url.hostname + url.pathname);
  } catch {
    return false;
  }
}
