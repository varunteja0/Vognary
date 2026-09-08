import { RecoveryServiceError } from "@/lib/server/recovery-api";
import { runRecoveryRoute } from "@/lib/server/recovery-route";
import { configuredZohoBooksService, requireZohoBooksConfiguration } from "@/lib/server/zoho-books-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runRecoveryRoute(request, { namespace: "zoho-books-callback", limit: 30, windowMs: 60_000 }, async ({ session }) => {
    const config = requireZohoBooksConfiguration(session.workspaceId);
    const parameters = new URL(request.url).searchParams;
    const destination = new URL("/app?view=ADD_EVIDENCE", config.redirectUri);
    if (parameters.has("error")) {
      destination.searchParams.set("sourceError", "authorization-not-completed");
      return Response.redirect(destination, 303);
    }
    const state = parameters.get("state");
    const code = parameters.get("code");
    if (!state || state.length > 128 || !code || code.length > 2_048) throw new RecoveryServiceError("INVALID_EVIDENCE", "Source authorization is incomplete.");
    if ((parameters.has("location") && parameters.get("location") !== "in")
      || (parameters.has("accounts-server") && parameters.get("accounts-server") !== "https://accounts.zoho.in")) {
      throw new RecoveryServiceError("FORBIDDEN", "Only the Zoho India data center is supported by this source.");
    }
    await configuredZohoBooksService(session.workspaceId).complete(session.workspaceId, session.userId, state, code);
    return Response.redirect(destination, 303);
  });
}
