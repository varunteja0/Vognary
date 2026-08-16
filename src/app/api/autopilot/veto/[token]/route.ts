import { createHash } from "node:crypto";
import { RecoveryServiceError } from "@/lib/server/recovery-api";
import { vetoAutopilotCandidateByToken } from "@/lib/server/recovery-autopilot-store";
import { rateLimit } from "@/lib/rate-limit";
import { inspectVetoToken } from "@/lib/recovery/veto-token";
import { publicVetoConfirmationHtml, type PublicVetoOutcome } from "@/lib/recovery/veto-confirmation";
import { autopilotVetoTokenSecret } from "@/lib/server/autopilot-mailer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ token: string }> };

function htmlResponse(outcome: PublicVetoOutcome, status: number) {
  return new Response(publicVetoConfirmationHtml({ outcome }), {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function GET() {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>This veto link only works when you submit the form</title>
</head>
<body>
  <main class="mx-auto max-w-lg px-4 py-16">
    <h1>This veto link only works when you submit the form</h1>
    <p>Opening this address did not change any Autopilot case.</p>
  </main>
</body>
</html>`, {
    status: 405,
    headers: {
      allow: "POST",
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { token: rawToken } = await context.params;
  const token = decodeURIComponent(rawToken ?? "").trim();
  if (!token || token.length > 2_000) {
    return htmlResponse("invalid", 403);
  }
  const rateIdentity = createHash("sha256").update(token).digest("hex").slice(0, 32);
  const rate = await rateLimit(request, {
    namespace: "autopilot-signed-veto",
    limit: 30,
    windowMs: 60 * 60_000,
    identity: rateIdentity,
  });
  if (!rate.allowed) {
    return htmlResponse("rate-limited", 429);
  }
  const secret = autopilotVetoTokenSecret();
  if (!secret) {
    return htmlResponse("unavailable", 503);
  }
  const inspected = inspectVetoToken(token, secret);
  if (inspected.status === "invalid") return htmlResponse("invalid", 403);
  if (inspected.status === "expired") return htmlResponse("expired", 403);
  try {
    const result = await vetoAutopilotCandidateByToken(token);
    return htmlResponse(result.replayed ? "already-vetoed" : "vetoed", 200);
  } catch (error) {
    if (error instanceof RecoveryServiceError) {
      if (error.code === "RATE_LIMITED") return htmlResponse("rate-limited", 429);
      if (error.code === "FEATURE_UNAVAILABLE" || error.code === "DATABASE_UNAVAILABLE" || error.code === "SAVE_FAILED" || error.code === "UNKNOWN") {
        return htmlResponse("unavailable", 503);
      }
      if (error.code === "FORBIDDEN" || error.code === "NOT_FOUND" || error.code === "CONFLICT") {
        return htmlResponse("invalid", 403);
      }
      return htmlResponse("unavailable", 503);
    }
    return htmlResponse("unavailable", 503);
  }
}
