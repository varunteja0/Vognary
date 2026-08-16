import { sendQueuedAutopilotNotices } from "../../src/lib/server/recovery-autopilot-store";
import { getDatabasePool } from "../../src/lib/server/database";

async function main() {
  const workspaceId = process.argv[2]?.trim();
  if (!workspaceId) throw new Error("workspace id is required");

  const accepted = await sendQueuedAutopilotNotices(new Date(), { workspaceId });
  console.log(JSON.stringify({ accepted }));
  await getDatabasePool().end();
}

void main();
