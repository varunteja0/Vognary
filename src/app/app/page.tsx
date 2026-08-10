import { headers } from "next/headers";
import { permanentRedirect } from "next/navigation";
import { getConnectorById } from "@/lib/connectors";
import { getConnectorHonesty } from "@/lib/connector-runtime";
import { readCurrentSession } from "@/lib/server/session";
import { getRecoveryCutoverStatus } from "@/lib/server/recovery-store";
import ExperienceClient from "./experience-client";

export const dynamic = "force-dynamic";

type AppPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AppPage({ searchParams }: AppPageProps) {
  const params = await searchParams;
  if (params && (Object.hasOwn(params, "demo") || Object.hasOwn(params, "guest"))) {
    permanentRedirect(buildCanonicalAppUrl(params));
  }

  const session = await readRequestSession();
  const recoveryCutover = session?.workspaceId
    ? await getRecoveryCutoverStatus({ workspaceId: session.workspaceId, actorUserId: session.userId })
    : null;
  return <ExperienceClient signedIn={Boolean(session)} recoveryCutover={recoveryCutover} gmailConnect={readGmailConnectAvailability()} />;
}

// Honesty state for the guest "Connect Gmail" card, resolved server-side so the
// card can never promise a connection this deployment cannot deliver.
function readGmailConnectAvailability() {
  const connector = getConnectorById("gmail-readonly");
  if (!connector) return { available: false, label: "Unavailable", meaning: "Gmail sync is not registered in this deployment." };
  const honesty = getConnectorHonesty(connector);
  return {
    available: honesty.state === "live" || honesty.state === "setup-ready",
    label: honesty.label,
    meaning: honesty.meaning,
  };
}

function buildCanonicalAppUrl(params: Record<string, string | string[] | undefined>) {
  const canonical = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "demo" || key === "guest" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((entry) => canonical.append(key, entry));
    else canonical.append(key, value);
  }
  const query = canonical.toString();
  return query ? `/app?${query}` : "/app";
}

async function readRequestSession() {
  const requestHeaders = await headers();
  return readCurrentSession(new Request("https://vognary.local", {
    headers: { cookie: requestHeaders.get("cookie") ?? "" },
  }));
}
