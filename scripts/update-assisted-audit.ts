import { transitionAssistedAuditOrderByCheckout } from "../src/lib/server/billing-store";
import { getDatabasePool } from "../src/lib/server/database";
import type { AssistedAuditOrderAction } from "../src/lib/billing";

const checkoutId = readFlag("--checkout");
const action = readFlag("--action") as AssistedAuditOrderAction | null;
const confirmed = process.argv.includes("--confirm");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (process.argv.includes("--help")) {
  console.log("Update one assisted-audit fulfillment order.\n\nUsage:\n  DATABASE_URL='...' npm run billing:audit-order -- --checkout <uuid> --action start|deliver|cancel --confirm");
  process.exit(0);
}
if (!process.env.DATABASE_URL || !checkoutId || !uuidPattern.test(checkoutId) || !action || !["start", "deliver", "cancel"].includes(action) || !confirmed) {
  console.error("DATABASE_URL, a valid --checkout UUID, --action start|deliver|cancel, and --confirm are required.");
  process.exit(1);
}

void main();

async function main() {
  try {
    const result = await transitionAssistedAuditOrderByCheckout({ checkoutId: checkoutId!.toLowerCase(), action: action! });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "updated") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Assisted-audit order update failed.");
    process.exitCode = 1;
  } finally {
    await getDatabasePool().end();
  }
}

function readFlag(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}