import { createHash } from "node:crypto";
import type { ConnectorAdapter, ConnectorConnection, ConnectorEvidence } from "@/lib/connector-runtime";

type VercelDomainsResponse = {
  domains?: Array<{
    id?: string;
    name?: string;
    expiresAt?: number | null;
    renew?: boolean;
    serviceType?: string;
    verified?: boolean;
    teamId?: string | null;
  }>;
};

type RenderServicesResponse = Array<{
  service?: {
    id?: string;
    name?: string;
    type?: string;
    region?: string;
    suspended?: string;
    dashboardUrl?: string;
    updatedAt?: string;
  };
}>;

type CloudflareAccountsResponse = {
  success?: boolean;
  result?: Array<{
    id?: string;
    name?: string;
    type?: string;
    created_on?: string;
    settings?: { enforce_twofactor?: boolean };
  }>;
  errors?: Array<{ message?: string }>;
};

type GitHubCopilotReportResponse = {
  download_links?: string[];
  report_start_day?: string;
  report_end_day?: string;
  report_day?: string;
};

export const vercelPlatformAdapter: ConnectorAdapter = {
  id: "vercel-platform",
  async connect(connection) {
    return ensureApiKeyConnection(connection, "Vercel API token is required.");
  },
  async sync(connection) {
    const apiKey = getApiKey(connection, "Vercel API token is required.");
    const url = new URL("https://api.vercel.com/v5/domains");
    url.searchParams.set("limit", "100");
    if (connection.providerAccountId && connection.providerAccountId !== "default") url.searchParams.set("slug", connection.providerAccountId);

    const payload = await fetchJson<VercelDomainsResponse>(url, {
      authorization: `Bearer ${apiKey}`,
    }, "Vercel domain sync");

    return (payload.domains ?? []).map((domain): ConnectorEvidence | null => {
      const providerIdentity = domain.id ?? domain.name;
      if (!providerIdentity) return null;
      const observedAt = new Date().toISOString();
      const expiresAt = domain.expiresAt ? new Date(domain.expiresAt).toISOString().slice(0, 10) : undefined;
      return {
        connectorId: vercelPlatformAdapter.id,
        externalId: `vercel-domain:${providerIdentity}`,
        provider: "vercel",
        observedAt,
        evidenceType: "subscription",
        merchantRaw: domain.name ? `Vercel domain ${domain.name}` : "Vercel domain",
        category: "Domains",
        cadenceHint: domain.renew ? "yearly" : "irregular",
        nextDebitHint: domain.renew ? expiresAt : undefined,
        sourcePayloadHash: hashPayload({ provider: "vercel", domain, workspaceId: connection.workspaceId }),
        confidence: domain.renew ? 82 : 68,
      };
    }).filter((item): item is ConnectorEvidence => Boolean(item));
  },
};

export const renderPlatformAdapter: ConnectorAdapter = {
  id: "render-platform",
  async connect(connection) {
    return ensureApiKeyConnection(connection, "Render API key is required.");
  },
  async sync(connection) {
    const apiKey = getApiKey(connection, "Render API key is required.");
    const url = new URL("https://api.render.com/v1/services");
    url.searchParams.set("includePreviews", "true");
    url.searchParams.set("limit", "100");
    if (connection.providerAccountId && connection.providerAccountId !== "default") url.searchParams.set("ownerId", connection.providerAccountId);

    const payload = await fetchJson<RenderServicesResponse>(url, {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
    }, "Render services sync");

    return payload.map(({ service }): ConnectorEvidence | null => {
      if (!service?.id) return null;
      return {
        connectorId: renderPlatformAdapter.id,
        externalId: `render-service:${service.id}`,
        provider: "render",
        observedAt: service.updatedAt ?? new Date().toISOString(),
        evidenceType: "workspace",
        merchantRaw: service.name ? `Render ${service.type ?? "service"} ${service.name}` : "Render service",
        category: "Cloud hosting",
        cadenceHint: service.suspended === "suspended" ? "irregular" : "monthly",
        sourcePayloadHash: hashPayload({ provider: "render", service, workspaceId: connection.workspaceId }),
        confidence: service.suspended === "suspended" ? 62 : 82,
      };
    }).filter((item): item is ConnectorEvidence => Boolean(item));
  },
};

export const cloudflareBillingAdapter: ConnectorAdapter = {
  id: "cloudflare-billing",
  async connect(connection) {
    return ensureApiKeyConnection(connection, "Cloudflare API token is required.");
  },
  async sync(connection) {
    const apiKey = getApiKey(connection, "Cloudflare API token is required.");
    const url = new URL("https://api.cloudflare.com/client/v4/accounts");
    url.searchParams.set("per_page", "50");

    const payload = await fetchJson<CloudflareAccountsResponse>(url, {
      authorization: `Bearer ${apiKey}`,
    }, "Cloudflare account sync");

    if (payload.success === false) {
      throw new Error(payload.errors?.[0]?.message ?? "Cloudflare account sync failed.");
    }

    return (payload.result ?? []).map((account): ConnectorEvidence | null => {
      const providerIdentity = account.id ?? account.name;
      if (!providerIdentity) return null;
      return {
        connectorId: cloudflareBillingAdapter.id,
        externalId: `cloudflare-account:${providerIdentity}`,
        provider: "cloudflare",
        observedAt: account.created_on ?? new Date().toISOString(),
        evidenceType: "workspace",
        merchantRaw: account.name ? `Cloudflare account ${account.name}` : "Cloudflare account",
        category: "Cloud infrastructure",
        cadenceHint: "monthly",
        sourcePayloadHash: hashPayload({ provider: "cloudflare", account, workspaceId: connection.workspaceId }),
        confidence: 74,
      };
    }).filter((item): item is ConnectorEvidence => Boolean(item));
  },
};

export const githubCopilotAdapter: ConnectorAdapter = {
  id: "github-copilot",
  async connect(connection) {
    if (!connection.providerAccountId || connection.providerAccountId === "default") throw new Error("GitHub organization slug is required for Copilot metrics.");
    return ensureApiKeyConnection(connection, "GitHub token with read:org or Copilot metrics permissions is required.");
  },
  async sync(connection) {
    const org = connection.providerAccountId;
    if (!org || org === "default") throw new Error("GitHub organization slug is required for Copilot metrics.");
    const apiKey = getApiKey(connection, "GitHub token with read:org or Copilot metrics permissions is required.");
    const payload = await fetchJson<GitHubCopilotReportResponse>(
      new URL(`https://api.github.com/orgs/${encodeURIComponent(org)}/copilot/metrics/reports/organization-28-day/latest`),
      {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${apiKey}`,
        "x-github-api-version": "2026-03-10",
      },
      "GitHub Copilot metrics sync",
    );

    const observedAt = payload.report_end_day ? `${payload.report_end_day}T00:00:00.000Z` : new Date().toISOString();
    return [{
      connectorId: githubCopilotAdapter.id,
      externalId: `github-copilot-report:${hashPayload({
        org,
        reportStartDay: payload.report_start_day ?? null,
        reportEndDay: payload.report_end_day ?? payload.report_day ?? null,
      })}`,
      provider: "github",
      observedAt,
      evidenceType: "usage",
      merchantRaw: `GitHub Copilot metrics for ${org}`,
      category: "Developer tools",
      cadenceHint: "monthly",
      sourcePayloadHash: hashPayload({ provider: "github", org, payload, workspaceId: connection.workspaceId }),
      confidence: payload.download_links?.length ? 88 : 72,
    }];
  },
};

function ensureApiKeyConnection(connection: ConnectorConnection, message: string): ConnectorConnection {
  getApiKey(connection, message);
  return {
    ...connection,
    accessRef: connection.accessRef ?? "vault:api_key",
  };
}

function getApiKey(connection: ConnectorConnection, message: string) {
  const apiKey = connection.apiKey?.trim();
  if (!apiKey) throw new Error(message);
  return apiKey;
}

async function fetchJson<T>(url: URL, headers: Record<string, string>, label: string): Promise<T> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) throw new Error(`${label} failed with ${response.status}.`);
  return await response.json() as T;
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}
