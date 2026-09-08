import "server-only";
import { isCommitmentControlWorkspaceEnrolled } from "@/lib/commitment-control/enrollment";
import { RecoveryServiceError } from "@/lib/server/recovery-api";
import { createZohoBooksClient, type ZohoBooksConfig } from "@/lib/server/zoho-books-client";
import { createZohoBooksService } from "@/lib/server/zoho-books-store";

export function zohoBooksWorkspaceEnabled(workspaceId: string): boolean {
  const entries = (process.env.ZOHO_BOOKS_PILOT_WORKSPACE_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const local = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  if (local && entries.includes("*")) return true;
  return /^[0-9a-f-]{36}$/i.test(workspaceId) && entries.includes(workspaceId)
    && (local || isCommitmentControlWorkspaceEnrolled(workspaceId));
}

export function readZohoBooksConfiguration(): ZohoBooksConfig | null {
  const clientId = process.env.ZOHO_BOOKS_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOHO_BOOKS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !process.env.NEXT_PUBLIC_APP_URL) return null;
  try {
    const url = new URL(process.env.NEXT_PUBLIC_APP_URL);
    const local = process.env.NODE_ENV !== "production" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password) return null;
    return { clientId, clientSecret, redirectUri: `${url.origin}/api/workspaces/current/sources/zoho-books/callback` };
  } catch {
    return null;
  }
}

export function requireZohoBooksConfiguration(workspaceId: string) {
  const configuration = readZohoBooksConfiguration();
  if (!configuration || !zohoBooksWorkspaceEnabled(workspaceId)) {
    throw new RecoveryServiceError("FEATURE_UNAVAILABLE", "Zoho Books access is not configured for this private pilot workspace.");
  }
  return configuration;
}

export function configuredZohoBooksService(workspaceId?: string) {
  const config = readZohoBooksConfiguration();
  const entries = (process.env.ZOHO_BOOKS_PILOT_WORKSPACE_IDS ?? "").split(",").map(value => value.trim());
  const local = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  const workspaceIds = local && entries.includes("*")
    ? undefined : entries.filter(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) && zohoBooksWorkspaceEnabled(value));
  return createZohoBooksService({
    client: config && (!workspaceId || zohoBooksWorkspaceEnabled(workspaceId)) ? createZohoBooksClient(config) : null,
    workspaceIds,
    isWorkspaceEnabled: zohoBooksWorkspaceEnabled,
    operatorUserId: process.env.ZOHO_BOOKS_OPERATOR_USER_ID?.trim(),
  });
}
