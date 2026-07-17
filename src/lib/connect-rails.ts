/**
 * Consent rails and merchant watches for the Connections panel.
 *
 * Users never type provider credentials on this surface. Every tile resolves to
 * one of three rails:
 *
 *   - "email-oauth": redirect to the provider's own consent page (Gmail today).
 *   - "bank-consent": redirect to the RBI Account Aggregator approval page
 *     (Setu FIU rail) where the account holder approves read-only access.
 *   - "merchant-watch": an instant, local preference that filters evidence arriving
 *     through the two rails above for one merchant (Netflix, Spotify, ...).
 *
 * Merchant tiles exist because consumer platforms expose no third-party
 * billing APIs; the honest coverage for them is bank descriptors plus email
 * receipts. Workspace admins who hold provider API keys can still register
 * scoped keys on /sources — that advanced path is intentionally not part of
 * this consumer consent surface.
 */

export type ConnectRail = "email-oauth" | "bank-consent" | "merchant-watch";

export type ConnectFeed = "gmail" | "bank";

export type ConnectTileCategory =
  | "Rail"
  | "Streaming & music"
  | "AI tools"
  | "App stores & social"
  | "Developer & cloud";

export type ConnectTile = {
  id: string;
  name: string;
  category: ConnectTileCategory;
  rail: ConnectRail;
  /** Honest one-liner rendered under the tile name. */
  tagline: string;
  /** Case-insensitive regex sources matched against merchant names and bank narrations. */
  merchantPatterns: string[];
  /** Which consent rails feed this tile's evidence. */
  feeds: ConnectFeed[];
  /** Connector registry ids that carry this tile's data. */
  backingConnectorIds: string[];
};

export const railTiles: ConnectTile[] = [
  {
    id: "rail-gmail",
    name: "Email receipts",
    category: "Rail",
    rail: "email-oauth",
    tagline: "Approve read-only access on Google's own consent page. Receipts and renewal notices become ledger evidence.",
    merchantPatterns: [],
    feeds: ["gmail"],
    backingConnectorIds: ["gmail-readonly"],
  },
  {
    id: "rail-bank",
    name: "Bank & UPI",
    category: "Rail",
    rail: "bank-consent",
    tagline: "Review consent in the regulated Account Aggregator flow. Supported bank transaction evidence can then arrive read-only.",
    merchantPatterns: [],
    feeds: ["bank"],
    backingConnectorIds: ["account-aggregator"],
  },
];

export const merchantTiles: ConnectTile[] = [
  {
    id: "netflix",
    name: "Netflix",
    category: "Streaming & music",
    rail: "merchant-watch",
    tagline: "Billing shows up from bank descriptors and receipt emails — Netflix offers no direct third-party API.",
    merchantPatterns: ["netflix"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "spotify",
    name: "Spotify",
    category: "Streaming & music",
    rail: "merchant-watch",
    tagline: "Premium renewals tracked through bank debits and Spotify's receipt emails.",
    merchantPatterns: ["spotify"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "prime-video",
    name: "Amazon Prime",
    category: "Streaming & music",
    rail: "merchant-watch",
    tagline: "Prime membership charges tracked from Amazon receipts and card debits.",
    merchantPatterns: ["amazon\\s*prime", "prime\\s*video", "amazon\\s*pay.*prime"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "hotstar",
    name: "JioHotstar",
    category: "Streaming & music",
    rail: "merchant-watch",
    tagline: "Hotstar plan renewals tracked from receipts and UPI or card debits.",
    merchantPatterns: ["hotstar", "jiohotstar", "disney\\+?\\s*hotstar"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "youtube-premium",
    name: "YouTube Premium",
    category: "Streaming & music",
    rail: "merchant-watch",
    tagline: "Google charges for YouTube Premium tracked from receipts and bank rows.",
    merchantPatterns: ["youtube\\s*premium", "google\\s*youtube"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "chatgpt-plus",
    name: "ChatGPT Plus",
    category: "AI tools",
    rail: "merchant-watch",
    tagline: "Personal ChatGPT renewals tracked from OpenAI receipts and card debits.",
    merchantPatterns: ["openai", "chatgpt"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "claude",
    name: "Claude",
    category: "AI tools",
    rail: "merchant-watch",
    tagline: "Anthropic subscription renewals tracked from receipts and card debits.",
    merchantPatterns: ["anthropic", "claude\\.ai", "claude\\s*(pro|max|subscription)"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "kling",
    name: "Kling",
    category: "AI tools",
    rail: "merchant-watch",
    tagline: "Kling AI plan charges tracked from receipts and card debits.",
    merchantPatterns: ["kling", "kuaishou"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "apple-subscriptions",
    name: "Apple",
    category: "App stores & social",
    rail: "merchant-watch",
    tagline: "App Store and iCloud charges tracked from Apple receipts and card debits.",
    merchantPatterns: ["apple\\s*(services|com/bill|media)", "itunes", "icloud", "apple\\.com"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "google-play",
    name: "Google Play",
    category: "App stores & social",
    rail: "merchant-watch",
    tagline: "Play Store subscription charges tracked from Google receipts and bank rows.",
    merchantPatterns: ["google\\s*play", "google\\s*\\*"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "x-premium",
    name: "X Premium",
    category: "App stores & social",
    rail: "merchant-watch",
    tagline: "X subscription renewals tracked from receipts and card debits.",
    merchantPatterns: ["x\\s*premium", "twitter", "x\\s*corp"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "github",
    name: "GitHub",
    category: "Developer & cloud",
    rail: "merchant-watch",
    tagline: "Personal GitHub and Copilot charges tracked from receipts and card debits. Organization billing can be connected separately by an admin.",
    merchantPatterns: ["github"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "Developer & cloud",
    rail: "merchant-watch",
    tagline: "Vercel invoices tracked from receipts and card debits. Team billing can be connected separately by an admin.",
    merchantPatterns: ["vercel"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "aws",
    name: "AWS",
    category: "Developer & cloud",
    rail: "merchant-watch",
    tagline: "AWS invoices tracked from billing emails and card debits. Account billing can be connected separately by an admin.",
    merchantPatterns: ["aws", "amazon\\s*web\\s*services"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
  {
    id: "openai-platform",
    name: "OpenAI API",
    category: "Developer & cloud",
    rail: "merchant-watch",
    tagline: "OpenAI platform invoices tracked from billing emails and card debits. Organization billing can be connected separately by an admin.",
    merchantPatterns: ["openai"],
    feeds: ["gmail", "bank"],
    backingConnectorIds: ["gmail-readonly", "account-aggregator"],
  },
];

const allTiles = [...railTiles, ...merchantTiles];

export function getConnectTiles(): ConnectTile[] {
  return allTiles;
}

export function getConnectTileById(id: string): ConnectTile | null {
  return allTiles.find((tile) => tile.id === id) ?? null;
}

export function compileMerchantMatcher(tile: ConnectTile): RegExp | null {
  if (!tile.merchantPatterns.length) return null;
  return new RegExp(tile.merchantPatterns.join("|"), "i");
}

/**
 * Filter recurring items (or any merchant-bearing rows) down to the ones this
 * tile watches. Structural typing keeps the client's audit types out of lib/.
 */
export function matchTileItems<T extends { normalizedMerchant: string }>(tile: ConnectTile, items: T[]): T[] {
  const matcher = compileMerchantMatcher(tile);
  if (!matcher) return [];
  return items.filter((item) => matcher.test(item.normalizedMerchant));
}

export type ConnectRailPresence = {
  gmailConnected: boolean;
  bankConnected: boolean;
};

export type TileCoverage = {
  state: "fed" | "partially-fed" | "waiting-for-rail";
  message: string;
};

export function resolveConnectedConnectorIds(
  startResults: Record<string, { status?: string }>,
  accounts: Array<{ connectorId: string; status: string }>,
  disconnectedIds: string[],
) {
  const connected = new Set<string>();
  const durableConnectorIds = new Set(accounts.map((account) => account.connectorId));

  for (const [connectorId, result] of Object.entries(startResults)) {
    if (!durableConnectorIds.has(connectorId) && result.status?.startsWith("connected")) {
      connected.add(connectorId);
    }
  }
  for (const account of accounts) {
    if (account.status === "active") connected.add(account.connectorId);
  }
  for (const connectorId of disconnectedIds) connected.delete(connectorId);
  return connected;
}

/**
 * Honest coverage line for a merchant tile given which rails are live.
 * Copy here is a public surface — it must stay inside the claim taxonomy.
 */
export function describeTileCoverage(tile: ConnectTile, rails: ConnectRailPresence): TileCoverage {
  const feedsLive = tile.feeds.filter((feed) => (feed === "gmail" ? rails.gmailConnected : rails.bankConnected));
  if (!feedsLive.length) {
    return {
      state: "waiting-for-rail",
      message: "Watch saved. Connect the email or bank rail above so matching evidence can arrive.",
    };
  }
  if (feedsLive.length < tile.feeds.length) {
    const missing = tile.feeds.includes("gmail") && !rails.gmailConnected ? "email" : "bank";
    return {
      state: "partially-fed",
      message: `Watching evidence from one rail. Connect the ${missing} rail as well for broader coverage.`,
    };
  }
  return {
    state: "fed",
    message: "Watching for matching evidence from both connected rails on their scheduled sync.",
  };
}
