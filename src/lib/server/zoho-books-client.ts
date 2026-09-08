import "server-only";
import { normalizeZohoBill, parseZohoJson, providerId, providerString, zohoBooksScopes, type ZohoOrganization } from "@/lib/zoho-books/contracts";

const accountsOrigin = "https://accounts.zoho.in";
const apiOrigin = "https://www.zohoapis.in";
const pageSize = 100;

export type ZohoBooksConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type ZohoTokens = { accessToken: string; refreshToken?: string; expiresIn: number };
export type ZohoFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type ZohoBooksErrorCode = "REAUTH_REQUIRED" | "THROTTLED" | "PROVIDER_UNAVAILABLE" | "SCHEMA_CHANGED" | "REGION_UNSUPPORTED" | "ABSENCE_UNCONFIRMED";

export class ZohoBooksError extends Error {
  constructor(readonly code: ZohoBooksErrorCode, readonly retryAfterSeconds = 60) {
    super({
      REAUTH_REQUIRED: "Zoho read access needs to be authorized again.",
      THROTTLED: "Zoho has temporarily limited requests. Background recovery is scheduled.",
      PROVIDER_UNAVAILABLE: "Zoho could not be reached. Background recovery is scheduled.",
      SCHEMA_CHANGED: "Zoho returned an unsupported response. Vognary must review the source before continuing.",
      REGION_UNSUPPORTED: "This connection supports the Zoho India data center only.",
      ABSENCE_UNCONFIRMED: "A bill could not be located, but provider removal is unconfirmed. The prior observation is retained.",
    }[code]);
    this.name = "ZohoBooksError";
  }
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new ZohoBooksError("SCHEMA_CHANGED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 1_048_576) {
        await reader.cancel();
        throw new ZohoBooksError("SCHEMA_CHANGED");
      }
      chunks.push(chunk.value);
    }
    return parseZohoJson(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ZohoBooksError) throw error;
    throw new ZohoBooksError("SCHEMA_CHANGED");
  } finally {
    reader.releaseLock();
  }
}

export function createZohoBooksClient(config: ZohoBooksConfig, fetchImpl: ZohoFetch = fetch) {
  async function request(url: URL, init: RequestInit, allowMissing = false): Promise<Record<string, unknown> | null> {
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new ZohoBooksError("PROVIDER_UNAVAILABLE");
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      throw new ZohoBooksError("THROTTLED", Number.isSafeInteger(seconds) && seconds > 0 ? Math.min(seconds, 86_400) : 3_600);
    }
    if (response.status === 401 || response.status === 403) throw new ZohoBooksError("REAUTH_REQUIRED");
    if (response.status >= 500) throw new ZohoBooksError("PROVIDER_UNAVAILABLE");
    const payload = await boundedJson(response);
    if (response.status === 404 && allowMissing) throw new ZohoBooksError("ABSENCE_UNCONFIRMED");
    if (!response.ok || typeof payload.error === "string") throw new ZohoBooksError("REAUTH_REQUIRED");
    if (payload.code !== undefined && payload.code !== "0") {
      if (["44", "45", "1070"].includes(String(payload.code))) throw new ZohoBooksError("THROTTLED", payload.code === "45" ? 86_400 : 300);
      if (["57", "14"].includes(String(payload.code))) throw new ZohoBooksError("REAUTH_REQUIRED");
      throw new ZohoBooksError("SCHEMA_CHANGED");
    }
    return payload;
  }

  async function token(parameters: Record<string, string>): Promise<ZohoTokens> {
    const payload = await request(new URL("/oauth/v2/token", accountsOrigin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ ...parameters, client_id: config.clientId, client_secret: config.clientSecret }).toString(),
    });
    if (payload?.api_domain !== apiOrigin) throw new ZohoBooksError("REGION_UNSUPPORTED");
    try {
      const expiresIn = Number(payload.expires_in);
      if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 86_400) throw new Error("Invalid token expiry.");
      return {
        accessToken: providerString(payload.access_token, "access_token", 8_192),
        ...(payload.refresh_token === undefined ? {} : { refreshToken: providerString(payload.refresh_token, "refresh_token", 8_192) }),
        expiresIn,
      };
    } catch {
      throw new ZohoBooksError("SCHEMA_CHANGED");
    }
  }

  async function read(path: string, accessToken: string, parameters: Record<string, string> = {}, allowMissing = false) {
    const url = new URL(`/books/v3${path}`, apiOrigin);
    url.search = new URLSearchParams(parameters).toString();
    return request(url, { method: "GET", headers: { authorization: `Zoho-oauthtoken ${accessToken}`, accept: "application/json" } }, allowMissing);
  }

  return {
    authorizationUrl(state: string) {
      const url = new URL("/oauth/v2/auth", accountsOrigin);
      url.search = new URLSearchParams({
        client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri,
        scope: zohoBooksScopes.join(","), access_type: "offline", prompt: "consent", state,
      }).toString();
      return url.toString();
    },
    exchangeCode: (code: string) => token({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri }),
    refresh: (refreshToken: string) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
    async revoke(refreshToken: string) {
      const result = await request(new URL("/oauth/v2/token/revoke", accountsOrigin), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
      if (result?.status !== "success") throw new ZohoBooksError("SCHEMA_CHANGED");
    },
    async organizations(accessToken: string): Promise<ZohoOrganization[]> {
      const payload = await read("/organizations", accessToken);
      if (!Array.isArray(payload?.organizations)) throw new ZohoBooksError("SCHEMA_CHANGED");
      try {
        return payload.organizations.map((value: unknown) => {
          if (!value || typeof value !== "object") throw new Error("Invalid organization.");
          const organization = value as Record<string, unknown>;
          if (typeof organization.is_org_active !== "boolean") throw new Error("Missing organization state.");
          return {
            id: providerId(organization.organization_id, "organization_id"),
            name: providerString(organization.name, "organization name"),
            currency: providerString(organization.currency_code, "organization currency", 3),
            active: organization.is_org_active,
          };
        });
      } catch {
        throw new ZohoBooksError("SCHEMA_CHANGED");
      }
    },
    async listBills(accessToken: string, organizationId: string, input: { page: number; coverageStart: string; modifiedSince: string | null }) {
      providerId(organizationId, "organization_id");
      if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 100_000) throw new ZohoBooksError("SCHEMA_CHANGED");
      const payload = await read("/bills", accessToken, {
        organization_id: organizationId,
        page: String(input.page), per_page: String(pageSize), date_start: input.coverageStart,
        sort_column: "created_time", sort_order: "A", filter_by: "Status.All",
        ...(input.modifiedSince ? { last_modified_time: input.modifiedSince } : {}),
      });
      try {
        const context = payload?.page_context as Record<string, unknown> | undefined;
        if (!Array.isArray(payload?.bills) || payload.bills.length > pageSize || !context
          || Number(context.page) !== input.page || typeof context.has_more_page !== "boolean") throw new Error("Invalid page.");
        return { bills: payload.bills.map(normalizeZohoBill), hasMore: context.has_more_page };
      } catch {
        throw new ZohoBooksError("SCHEMA_CHANGED");
      }
    },
    async bill(accessToken: string, organizationId: string, billId: string) {
      providerId(organizationId, "organization_id");
      providerId(billId, "bill_id");
      const payload = await read(`/bills/${billId}`, accessToken, { organization_id: organizationId }, true);
      if (payload === null) return null;
      try {
        const bill = normalizeZohoBill(payload.bill);
        if (bill.billId !== billId) throw new Error("Wrong provider record.");
        return bill;
      } catch {
        throw new ZohoBooksError("SCHEMA_CHANGED");
      }
    },
  };
}

export type ZohoBooksClient = ReturnType<typeof createZohoBooksClient>;
