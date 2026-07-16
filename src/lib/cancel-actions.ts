/**
 * Cancellation guidance registry: for a detected recurring item, return the
 * provider's own manage/cancel page plus exact steps. Vognary never cancels on
 * the user's behalf and never claims to — the action always lands on the
 * provider's or bank's own surface. URLs must be stable account/billing hubs
 * on the provider's canonical domain; when a deep link is not stable, ship
 * steps only.
 */

export type CancelActionKind = "direct" | "platform" | "rail-guide";

export type CancelAction = {
  merchantLabel: string;
  kind: CancelActionKind;
  manageUrl?: string;
  steps: string[];
  caveat?: string;
};

type RegistryEntry = CancelAction & {
  /** Normalized substrings (lowercase alphanumeric). First entry that matches wins. */
  patterns: string[];
};

export function normalizeMerchantKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const merchantRegistry: RegistryEntry[] = [
  {
    patterns: ["netflix"],
    merchantLabel: "Netflix",
    kind: "direct",
    manageUrl: "https://www.netflix.com/cancelplan",
    steps: ["Sign in to Netflix", "Confirm the cancellation on the plan page", "Access continues until the end of the billing period"],
    caveat: "If the charge shows Apple or Google Play in the evidence, cancel there instead — Netflix cannot cancel store-billed plans.",
  },
  {
    patterns: ["spotify"],
    merchantLabel: "Spotify",
    kind: "direct",
    manageUrl: "https://www.spotify.com/account/",
    steps: ["Open your Spotify account page", "Manage your plan", "Cancel Premium"],
  },
  {
    patterns: ["youtubepremium", "youtube"],
    merchantLabel: "YouTube Premium",
    kind: "direct",
    manageUrl: "https://www.youtube.com/paid_memberships",
    steps: ["Open YouTube paid memberships", "Manage membership", "Deactivate"],
  },
  {
    patterns: ["amazonprime", "primevideo"],
    merchantLabel: "Amazon Prime",
    kind: "direct",
    manageUrl: "https://www.amazon.in/gp/primecentral",
    steps: ["Open Prime membership settings", "Manage membership", "End membership"],
  },
  {
    patterns: ["hotstar", "jiohotstar"],
    merchantLabel: "JioHotstar",
    kind: "direct",
    manageUrl: "https://www.hotstar.com/in",
    steps: ["Sign in on the Hotstar site or app", "My Account → Subscriptions", "Cancel auto-renew"],
    caveat: "If billed through a telecom bundle (Jio/Airtel pack), manage it in the telecom app instead.",
  },
  {
    patterns: ["applecom", "appleservices", "itunes", "applemedia", "icloud", "appstore"],
    merchantLabel: "Apple subscriptions",
    kind: "platform",
    manageUrl: "https://apps.apple.com/account/subscriptions",
    steps: ["On iPhone/iPad: Settings → your name → Subscriptions", "Pick the subscription", "Cancel subscription"],
    caveat: "One Apple charge can bundle several app subscriptions — check every line on the subscriptions page.",
  },
  {
    patterns: ["googleplay", "googleone", "googlestorage"],
    merchantLabel: "Google Play subscriptions",
    kind: "platform",
    manageUrl: "https://play.google.com/store/account/subscriptions",
    steps: ["Open Play Store subscriptions", "Pick the subscription", "Cancel subscription"],
  },
  {
    patterns: ["openai", "chatgpt"],
    merchantLabel: "OpenAI / ChatGPT",
    kind: "direct",
    manageUrl: "https://chatgpt.com/",
    steps: ["Sign in to ChatGPT", "Settings → Subscription", "Manage → Cancel plan"],
    caveat: "API usage is billed separately at platform.openai.com — set hard usage limits there; cancelling Plus does not stop API spend.",
  },
  {
    patterns: ["anthropic", "claude"],
    merchantLabel: "Anthropic / Claude",
    kind: "direct",
    manageUrl: "https://claude.ai/settings/billing",
    steps: ["Open Claude billing settings", "Manage subscription", "Cancel or downgrade"],
    caveat: "API usage is billed separately in the Anthropic Console.",
  },
  {
    patterns: ["githubcopilot", "github"],
    merchantLabel: "GitHub",
    kind: "direct",
    manageUrl: "https://github.com/settings/billing/summary",
    steps: ["Open GitHub billing", "Review plan and Copilot seats", "Downgrade or cancel unused seats"],
  },
  {
    patterns: ["amazonwebservices", "awscloud", "aws"],
    merchantLabel: "AWS",
    kind: "direct",
    manageUrl: "https://console.aws.amazon.com/billing/home",
    steps: ["Open the AWS billing console", "Billing → Bills: identify the services charging you", "Stop or terminate unused resources; remove unused Elastic IPs, volumes, and snapshots"],
    caveat: "AWS has no single cancel button — spend stops when resources stop. Check every region.",
  },
  {
    patterns: ["vercel"],
    merchantLabel: "Vercel",
    kind: "direct",
    manageUrl: "https://vercel.com/dashboard",
    steps: ["Open the team dashboard", "Settings → Billing", "Change or cancel the plan"],
  },
  {
    patterns: ["render"],
    merchantLabel: "Render",
    kind: "direct",
    manageUrl: "https://dashboard.render.com/billing",
    steps: ["Open Render billing", "Review services and plans", "Suspend or delete unused services"],
  },
  {
    patterns: ["cloudflare"],
    merchantLabel: "Cloudflare",
    kind: "direct",
    manageUrl: "https://dash.cloudflare.com/",
    steps: ["Open the Cloudflare dashboard", "Account → Billing → Subscriptions", "Cancel unused add-ons or downgrade the plan"],
  },
  {
    patterns: ["digitalocean"],
    merchantLabel: "DigitalOcean",
    kind: "direct",
    manageUrl: "https://cloud.digitalocean.com/account/billing",
    steps: ["Open DigitalOcean billing", "Review droplets and volumes", "Destroy unused resources"],
  },
  {
    patterns: ["adobe"],
    merchantLabel: "Adobe",
    kind: "direct",
    manageUrl: "https://account.adobe.com/plans",
    steps: ["Open Adobe plans", "Manage plan", "Cancel plan"],
    caveat: "Annual plans billed monthly can carry an early-termination fee — cancelling within the renewal window avoids it.",
  },
  {
    patterns: ["canva"],
    merchantLabel: "Canva",
    kind: "direct",
    manageUrl: "https://www.canva.com/settings/",
    steps: ["Open Canva settings", "Billing & plans", "Change or cancel plan"],
  },
  {
    patterns: ["notion"],
    merchantLabel: "Notion",
    kind: "direct",
    manageUrl: "https://www.notion.so/",
    steps: ["Open your workspace", "Settings & members → Billing", "Change plan or remove unused members"],
  },
  {
    patterns: ["figma"],
    merchantLabel: "Figma",
    kind: "direct",
    manageUrl: "https://www.figma.com/",
    steps: ["Open the admin console for your team", "Billing", "Reduce editor seats or downgrade"],
    caveat: "Figma bills per editor seat — viewers are free; check who actually edits.",
  },
  {
    patterns: ["slack"],
    merchantLabel: "Slack",
    kind: "direct",
    steps: ["Open your workspace admin settings", "Billing", "Switch to the free plan or reduce active members"],
  },
  {
    patterns: ["zoom"],
    merchantLabel: "Zoom",
    kind: "direct",
    manageUrl: "https://zoom.us/billing",
    steps: ["Open Zoom billing", "Current plans", "Cancel or downgrade"],
  },
  {
    patterns: ["linkedinpremium", "linkedin"],
    merchantLabel: "LinkedIn Premium",
    kind: "direct",
    manageUrl: "https://www.linkedin.com/",
    steps: ["Open LinkedIn → Me → Premium features", "Manage subscription", "Cancel subscription"],
  },
  {
    patterns: ["xpremium", "twitterblue", "xcorp"],
    merchantLabel: "X Premium",
    kind: "direct",
    manageUrl: "https://x.com/settings",
    steps: ["Open X settings", "Premium", "Manage subscription → Cancel"],
    caveat: "If subscribed through the iOS/Android app, cancel in the app store instead.",
  },
  {
    patterns: ["godaddy"],
    merchantLabel: "GoDaddy",
    kind: "direct",
    manageUrl: "https://account.godaddy.com/subscriptions",
    steps: ["Open GoDaddy subscriptions", "Pick the product or domain", "Turn off auto-renew"],
  },
  {
    patterns: ["namecheap"],
    merchantLabel: "Namecheap",
    kind: "direct",
    manageUrl: "https://ap.www.namecheap.com/",
    steps: ["Open the Namecheap dashboard", "Domain List / Products", "Toggle auto-renew off per item"],
  },
  {
    patterns: ["hostinger"],
    merchantLabel: "Hostinger",
    kind: "direct",
    manageUrl: "https://hpanel.hostinger.com/",
    steps: ["Open hPanel", "Billing → Subscriptions", "Disable auto-renewal"],
  },
  {
    patterns: ["microsoft365", "office365", "microsoft"],
    merchantLabel: "Microsoft 365",
    kind: "direct",
    manageUrl: "https://account.microsoft.com/services",
    steps: ["Open Microsoft services & subscriptions", "Manage", "Cancel subscription or turn off recurring billing"],
  },
  {
    patterns: ["dropbox"],
    merchantLabel: "Dropbox",
    kind: "direct",
    manageUrl: "https://www.dropbox.com/account/plan",
    steps: ["Open Dropbox plan settings", "Manage plan", "Cancel plan"],
  },
  {
    patterns: ["grammarly"],
    merchantLabel: "Grammarly",
    kind: "direct",
    manageUrl: "https://account.grammarly.com/subscription",
    steps: ["Open Grammarly subscription settings", "Cancel subscription"],
  },
  {
    patterns: ["cursor"],
    merchantLabel: "Cursor",
    kind: "direct",
    manageUrl: "https://cursor.com/",
    steps: ["Sign in on cursor.com", "Settings → Billing", "Manage subscription → Cancel"],
  },
  {
    patterns: ["perplexity"],
    merchantLabel: "Perplexity",
    kind: "direct",
    manageUrl: "https://www.perplexity.ai/",
    steps: ["Sign in", "Settings → Subscription", "Manage → Cancel"],
  },
  {
    patterns: ["airtel"],
    merchantLabel: "Airtel",
    kind: "direct",
    manageUrl: "https://www.airtel.in/",
    steps: ["Open the Airtel Thanks app", "Manage → active packs and add-ons", "Deactivate unused packs"],
  },
  {
    patterns: ["jiorecharge", "reliancejio", "jio"],
    merchantLabel: "Jio",
    kind: "direct",
    manageUrl: "https://www.jio.com/",
    steps: ["Open the MyJio app", "Mobile → active plans and subscriptions", "Deactivate unused add-ons"],
  },
];

const railGuides: Record<string, CancelAction> = {
  upiAutopay: {
    merchantLabel: "UPI AutoPay mandate",
    kind: "rail-guide",
    steps: [
      "Open the UPI app where the mandate was created (Google Pay: Profile → Autopay; PhonePe: Profile → Payment settings → AutoPay; Paytm: Profile → Automatic payments)",
      "Select the mandate for this merchant",
      "Pause or remove the mandate — it can also be revoked from your bank's app",
    ],
    caveat: "Banks must send a pre-debit notification before each AutoPay charge — keep those messages; they are the evidence trail.",
  },
  cardMandate: {
    merchantLabel: "Card standing instruction",
    kind: "rail-guide",
    steps: [
      "Open your bank's net-banking or card app",
      "Find e-Mandates / Standing Instructions (often under card controls or 'SI Hub')",
      "Cancel the instruction for this merchant",
    ],
    caveat: "Also cancel with the merchant directly, or they may request a fresh mandate.",
  },
  emi: {
    merchantLabel: "EMI",
    kind: "rail-guide",
    steps: [
      "An EMI is a loan repayment, not a subscription — stopping payment damages your credit record",
      "To close early, request foreclosure in the lender's app or branch",
      "Compare the foreclosure charges against the remaining interest before deciding",
    ],
  },
  sip: {
    merchantLabel: "SIP",
    kind: "rail-guide",
    steps: [
      "Open the platform where the SIP runs (Groww, Coin, Kuvera, or the fund house / CAMS / KFintech portal)",
      "Select the SIP → pause or stop future instalments",
      "Existing units stay invested; stopping the SIP only halts new purchases",
    ],
  },
  insurance: {
    merchantLabel: "Insurance policy",
    kind: "rail-guide",
    steps: [
      "Do not simply stop paying — lapsing a policy can forfeit cover and value",
      "Ask the insurer for the surrender/paid-up terms in writing",
      "Compare surrender value against continuing before any decision",
    ],
    caveat: "Life policies can lose significant value on surrender. The safe first step is a review, not a cancellation.",
  },
  appStore: {
    merchantLabel: "App-store subscription",
    kind: "platform",
    steps: [
      "Apple: Settings → your name → Subscriptions (or apps.apple.com/account/subscriptions)",
      "Android: Play Store → profile → Payments & subscriptions → Subscriptions",
      "Pick the app and cancel — the app's own website usually cannot cancel store billing",
    ],
  },
};

const categoryFallbacks: Record<string, keyof typeof railGuides> = {
  "Mandates": "upiAutopay",
  "EMIs": "emi",
  "SIPs": "sip",
  "Insurance": "insurance",
  "App store": "appStore",
};

/**
 * Find cancellation guidance for a detected recurring item. Merchant match
 * wins over the category fallback; unknown merchant + unknown category
 * returns null so the UI shows nothing rather than a made-up action.
 */
export function findCancelAction(merchant: string, category?: string): CancelAction | null {
  const key = normalizeMerchantKey(merchant);
  if (key) {
    for (const entry of merchantRegistry) {
      if (entry.patterns.some((pattern) => key.includes(pattern))) {
        const { patterns: _patterns, ...action } = entry;
        void _patterns;
        return action;
      }
    }
  }
  const fallback = category ? categoryFallbacks[category] : undefined;
  return fallback ? railGuides[fallback] : null;
}

export function manageUrlHostname(action: CancelAction): string | null {
  if (!action.manageUrl) return null;
  try {
    return new URL(action.manageUrl).hostname;
  } catch {
    return null;
  }
}
