import { buildConnectorStartResponse } from "@/lib/connector-runtime";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type ConnectorRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: ConnectorRouteContext) {
  const { id } = await context.params;
  const response = buildConnectorStartResponse(id);
  const status = response.status === "error" ? 404 : 200;

  return Response.json(response, { status });
}

export async function POST(request: Request, context: ConnectorRouteContext) {
  const limit = rateLimit(request, { namespace: "connector-start", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const { id } = await context.params;
  const body = await readJson(request);
  const response = buildConnectorStartResponse(id);
  const status = response.status === "error" ? 404 : 200;

  return Response.json({
    ...response,
    requestedWorkspaceId: typeof body.workspaceId === "string" ? body.workspaceId : null,
  }, { status });
}

async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}