export const providerRoutes = ["EMAIL_SUPPORT", "IN_APP_CANCEL", "PHONE", "UNKNOWN"] as const;
export type ProviderRoute = (typeof providerRoutes)[number];

export const expectedProofKinds = ["MERCHANT_CONFIRMATION_EMAIL", "CANCELLATION_RECEIPT"] as const;
export type ExpectedProofKind = (typeof expectedProofKinds)[number];

export const providerProofStatuses = ["hypothesis", "under_validation", "proven", "disabled", "retired"] as const;
export type ProviderProofStatus = (typeof providerProofStatuses)[number];

export const testContractAdapterId = "vognary-test-adapter";

export type ProviderRegistryEntry = {
  id: string;
  displayName: string;
  merchantPattern: RegExp;
  cancellationRoute: ProviderRoute;
  requiredAuthority: "STANDING_MANDATE_AGENCY";
  requiresLogin: boolean;
  requiresOtp: boolean;
  requiresPhone: boolean;
  requiresEmail: boolean;
  zeroCustomerWork: boolean;
  expectedProof: ExpectedProofKind;
  medianOperatorMinutesBudget: number;
  reversalWindowDays: number | null;
  emergencyDisabled: boolean;
  /** A route is proven only after a real zero-chore cancellation succeeds. Default false. */
  routeProven: boolean;
  proofStatus: ProviderProofStatus;
};

function catalogEntry(entry: Omit<ProviderRegistryEntry, "requiredAuthority" | "emergencyDisabled" | "zeroCustomerWork" | "routeProven" | "proofStatus"> & {
  zeroCustomerWork?: boolean;
  emergencyDisabled?: boolean;
  routeProven?: boolean;
  proofStatus?: ProviderProofStatus;
}): ProviderRegistryEntry {
  return {
    ...entry,
    requiredAuthority: "STANDING_MANDATE_AGENCY",
    zeroCustomerWork: entry.zeroCustomerWork ?? false,
    emergencyDisabled: entry.emergencyDisabled ?? false,
    routeProven: entry.routeProven ?? false,
    proofStatus: entry.proofStatus ?? "hypothesis",
  };
}

/** Research hypotheses only. Unknown merchants are never treated as supported. */
export const supportedProviders: readonly ProviderRegistryEntry[] = [
  catalogEntry({ id: "notion", displayName: "Notion", merchantPattern: /\bnotion\b/i, cancellationRoute: "IN_APP_CANCEL", requiresLogin: true, requiresOtp: false, requiresPhone: false, requiresEmail: false, expectedProof: "CANCELLATION_RECEIPT", medianOperatorMinutesBudget: 15, reversalWindowDays: 14 }),
  catalogEntry({ id: "figma", displayName: "Figma", merchantPattern: /\bfigma\b/i, cancellationRoute: "IN_APP_CANCEL", requiresLogin: true, requiresOtp: false, requiresPhone: false, requiresEmail: false, expectedProof: "CANCELLATION_RECEIPT", medianOperatorMinutesBudget: 15, reversalWindowDays: 14 }),
  catalogEntry({ id: "linear", displayName: "Linear", merchantPattern: /\blinear\.app\b|\blinear\b/i, cancellationRoute: "IN_APP_CANCEL", requiresLogin: true, requiresOtp: false, requiresPhone: false, requiresEmail: false, expectedProof: "CANCELLATION_RECEIPT", medianOperatorMinutesBudget: 15, reversalWindowDays: 14 }),
  catalogEntry({ id: "canva", displayName: "Canva", merchantPattern: /\bcanva\b/i, cancellationRoute: "IN_APP_CANCEL", requiresLogin: true, requiresOtp: false, requiresPhone: false, requiresEmail: false, expectedProof: "CANCELLATION_RECEIPT", medianOperatorMinutesBudget: 15, reversalWindowDays: 14 }),
  catalogEntry({ id: "calendly", displayName: "Calendly", merchantPattern: /\bcalendly\b/i, cancellationRoute: "IN_APP_CANCEL", requiresLogin: true, requiresOtp: false, requiresPhone: false, requiresEmail: false, expectedProof: "CANCELLATION_RECEIPT", medianOperatorMinutesBudget: 15, reversalWindowDays: 14 }),
  catalogEntry({ id: "loom", displayName: "Loom", merchantPattern: /\bloom\b/i, cancellationRoute: "IN_APP_CANCEL", requiresLogin: true, requiresOtp: false, requiresPhone: false, requiresEmail: false, expectedProof: "CANCELLATION_RECEIPT", medianOperatorMinutesBudget: 15, reversalWindowDays: 14 }),
  catalogEntry({ id: "grammarly", displayName: "Grammarly", merchantPattern: /\bgrammarly\b/i, cancellationRoute: "IN_APP_CANCEL", requiresLogin: true, requiresOtp: false, requiresPhone: false, requiresEmail: false, expectedProof: "CANCELLATION_RECEIPT", medianOperatorMinutesBudget: 15, reversalWindowDays: 14 }),
  catalogEntry({ id: "perplexity", displayName: "Perplexity", merchantPattern: /\bperplexity\b/i, cancellationRoute: "IN_APP_CANCEL", requiresLogin: true, requiresOtp: false, requiresPhone: false, requiresEmail: false, expectedProof: "CANCELLATION_RECEIPT", medianOperatorMinutesBudget: 15, reversalWindowDays: 14 }),
  catalogEntry({ id: "openai", displayName: "OpenAI ChatGPT", merchantPattern: /\bopenai\b|\bchatgpt\b/i, cancellationRoute: "IN_APP_CANCEL", requiresLogin: true, requiresOtp: false, requiresPhone: false, requiresEmail: false, expectedProof: "CANCELLATION_RECEIPT", medianOperatorMinutesBudget: 15, reversalWindowDays: 14 }),
  catalogEntry({ id: "anthropic", displayName: "Anthropic Claude", merchantPattern: /\banthropic\b|\bclaude\.ai\b|\bclaude\b/i, cancellationRoute: "IN_APP_CANCEL", requiresLogin: true, requiresOtp: false, requiresPhone: false, requiresEmail: false, expectedProof: "CANCELLATION_RECEIPT", medianOperatorMinutesBudget: 15, reversalWindowDays: 14 }),
];

function testProvenProviderIds(): ReadonlySet<string> {
  if (process.env.NODE_ENV === "production") return new Set();
  const raw = process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS?.trim() ?? "";
  if (!raw) return new Set();
  return new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
}

export function providerProofStatus(provider: ProviderRegistryEntry): ProviderProofStatus {
  if (provider.emergencyDisabled) return "disabled";
  return provider.proofStatus;
}

export function isTestContractAdapterActivatable(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.AUTOPILOT_TEST_ADAPTER === "true";
}

/** Production-safe catalog proof: proven route, no login/OTP/phone, and zero customer work. */
export function isCatalogProviderProven(provider: ProviderRegistryEntry): boolean {
  if (provider.emergencyDisabled || provider.proofStatus === "disabled" || provider.proofStatus === "retired") return false;
  return provider.routeProven && provider.proofStatus === "proven" && !providerRequiresCustomerWork(provider);
}

export function isProviderRouteProven(provider: ProviderRegistryEntry): boolean {
  if (isCatalogProviderProven(provider)) return true;
  return process.env.NODE_ENV !== "production" && testProvenProviderIds().has(provider.id);
}

/** Catalog merchants that are proven without test-env flags. Empty until a real zero-chore route exists. */
export function catalogProvenProviderIds(): string[] {
  return supportedProviders.filter(isCatalogProviderProven).map((provider) => provider.id);
}

/** Same proven-id source execution uses: catalog proof, plus test allowlist only outside production. */
export function canonicalProvenProviderIds(): string[] {
  return supportedProviders.filter(isProviderRouteProven).map((provider) => provider.id);
}

export function isProviderExecutable(provider: ProviderRegistryEntry): boolean {
  if (provider.emergencyDisabled || provider.proofStatus === "disabled" || provider.proofStatus === "retired") return false;
  if (process.env.NODE_ENV === "production") return isCatalogProviderProven(provider);
  if (testProvenProviderIds().has(provider.id)) return true;
  if (provider.id === testContractAdapterId && isTestContractAdapterActivatable()) {
    return provider.proofStatus === "proven" && provider.zeroCustomerWork;
  }
  return isCatalogProviderProven(provider);
}

export function matchCatalogProvider(merchant: string): ProviderRegistryEntry | null {
  const normalized = merchant.trim();
  if (!normalized) return null;
  return supportedProviders.find((provider) => provider.merchantPattern.test(normalized)) ?? null;
}

export function matchSupportedProvider(merchant: string): ProviderRegistryEntry | null {
  const provider = matchCatalogProvider(merchant);
  if (!provider || !isProviderExecutable(provider)) return null;
  return provider;
}

export function lookupSupportedProviderById(providerId: string): ProviderRegistryEntry | null {
  const id = providerId.trim();
  if (!id) return null;
  const provider = supportedProviders.find((entry) => entry.id === id) ?? null;
  if (!provider || !isProviderExecutable(provider)) return null;
  return provider;
}

export function lookupCatalogProviderById(providerId: string): ProviderRegistryEntry | null {
  const id = providerId.trim();
  if (!id) return null;
  return supportedProviders.find((entry) => entry.id === id) ?? null;
}

export function providerRequiresCustomerWork(provider: ProviderRegistryEntry): boolean {
  return provider.requiresLogin || provider.requiresOtp || provider.requiresPhone || !provider.zeroCustomerWork;
}

export function exceptionCodeForUnsupportedPath(input: {
  requiresLogin?: boolean;
  requiresOtp?: boolean;
  requiresPhone?: boolean;
  upiAppConfirmation?: boolean;
  bankScrape?: boolean;
  unknown?: boolean;
}): "LOGIN_REQUIRED" | "OTP_REQUIRED" | "PHONE_REQUIRED" | "UPI_APP_CONFIRMATION" | "BANK_SCRAPE" | "UNKNOWN_PATH" {
  if (input.requiresOtp) return "OTP_REQUIRED";
  if (input.requiresLogin) return "LOGIN_REQUIRED";
  if (input.requiresPhone) return "PHONE_REQUIRED";
  if (input.upiAppConfirmation) return "UPI_APP_CONFIRMATION";
  if (input.bankScrape) return "BANK_SCRAPE";
  return "UNKNOWN_PATH";
}
