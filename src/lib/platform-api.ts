export const platformApiScopes = ["ledger:read", "sources:read"] as const;
export type PlatformApiScope = typeof platformApiScopes[number];

export function normalizePlatformApiScopes(value: unknown): PlatformApiScope[] {
  if (!Array.isArray(value)) throw new Error("API token scopes must be an array.");
  const scopes = [...new Set(value)];
  if (!scopes.length || scopes.some((scope) => typeof scope !== "string" || !platformApiScopes.includes(scope as PlatformApiScope))) {
    throw new Error(`API token scopes must use: ${platformApiScopes.join(", ")}.`);
  }
  return scopes as PlatformApiScope[];
}
