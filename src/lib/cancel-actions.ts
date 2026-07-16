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
    patterns: ["googleplay"],
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
    patterns: ["xboxgamepass", "pcgamepass", "xbox"],
    merchantLabel: "Xbox Game Pass",
    kind: "direct",
    manageUrl: "https://account.microsoft.com/services",
    steps: ["Sign in to Microsoft Services & subscriptions", "Find Xbox Game Pass and select Manage", "Cancel subscription or turn off recurring billing"],
  },
  {
    patterns: ["playstationplus", "playstationnetwork", "playstation", "psplus", "sonyinteractive"],
    merchantLabel: "PlayStation Plus",
    kind: "direct",
    manageUrl: "https://www.playstation.com/en-in/support/store/cancel-ps-store-subscription/",
    steps: ["Sign in to PlayStation Account Management", "Select Subscription", "Select PlayStation Plus and cancel the subscription"],
    caveat: "Cancellation takes effect from the next payment date; access continues through the paid period.",
  },
  {
    patterns: ["onedrive"],
    merchantLabel: "OneDrive",
    kind: "direct",
    manageUrl: "https://account.microsoft.com/services",
    steps: ["Sign in to Microsoft Services & subscriptions", "Find the OneDrive or Microsoft 365 product", "Cancel subscription or turn off recurring billing"],
    caveat: "OneDrive storage is often part of a Microsoft 365 bundle — cancelling the bundle also removes the other bundled apps.",
  },
  {
    patterns: ["copilotpro", "msftcopilot", "microsoftcopilot", "copilot"],
    merchantLabel: "Microsoft Copilot Pro",
    kind: "direct",
    manageUrl: "https://account.microsoft.com/services",
    steps: ["Sign in to Microsoft Services & subscriptions", "Find the product containing Copilot and select Manage", "Cancel subscription or turn off recurring billing"],
    caveat: "Copilot entitlement may sit inside a Microsoft 365 product — confirm which product actually bills before cancelling.",
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
    patterns: ["swiggyone", "bundltechnologies", "swiggy"],
    merchantLabel: "Swiggy One",
    kind: "direct",
    steps: ["Open the Swiggy app and tap Account", "Open Swiggy One", "Turn off Auto-renew if that control is shown"],
    caveat: "A current prepaid membership usually cannot be cancelled or refunded mid-term; if Auto-renew is absent there may be no future charge to stop.",
  },
  {
    patterns: ["zomatogold", "eternallimited", "zomato"],
    merchantLabel: "Zomato Gold",
    kind: "direct",
    steps: ["Open the Zomato app and tap Profile", "Open your Gold membership", "Open Manage membership and turn off auto-renew if offered"],
    caveat: "Gold is generally prepaid and non-refundable after activation; only a future renewal can be stopped.",
  },
  {
    patterns: ["uberone"],
    merchantLabel: "Uber One",
    kind: "direct",
    steps: ["Open the Uber app", "Account → Uber One → Manage membership", "Cancel the renewable membership"],
    caveat: "Uber states a charge within 48 hours of renewal is refunded automatically after cancellation — keep the confirmation.",
  },
  {
    patterns: ["sonyliv", "sonypicturesnetworks"],
    merchantLabel: "SonyLIV",
    kind: "direct",
    steps: ["Sign in to SonyLIV", "My Account → My Purchases", "Select the subscription and cancel auto-renewal"],
    caveat: "Cancel through Apple, Google Play, Amazon, or the telecom provider when that party issued the receipt.",
  },
  {
    patterns: ["zee5", "zeeentertainment"],
    merchantLabel: "ZEE5",
    kind: "direct",
    steps: ["Sign in to ZEE5", "My Account → My Subscriptions", "Cancel renewal for the active plan"],
    caveat: "Store-billed and telecom-bundled plans must be cancelled with that billing platform.",
  },
  {
    patterns: ["jiosaavn", "saavn"],
    merchantLabel: "JioSaavn Pro",
    kind: "direct",
    steps: ["Open JioSaavn and go to Settings", "Open Manage Subscription", "Cancel through the billing method shown"],
    caveat: "Apple, Google Play, and telecom-billed plans must be cancelled with that billing provider.",
  },
  {
    patterns: ["audible"],
    merchantLabel: "Audible",
    kind: "direct",
    manageUrl: "https://www.audible.in/account",
    steps: ["Sign in with the Amazon account used for Audible", "Open Account Details", "Select Cancel membership and complete the prompts"],
    caveat: "Unused member credits can expire when the membership ends — use or check them first.",
  },
  {
    patterns: ["kindleunlimited", "kindle"],
    merchantLabel: "Kindle Unlimited",
    kind: "direct",
    manageUrl: "https://www.amazon.in/hz5/yourmembershipsandsubscriptions",
    steps: ["Sign in to Amazon India", "Open Memberships & Subscriptions → Kindle Unlimited Settings", "Cancel Kindle Unlimited Membership and confirm"],
  },
  {
    patterns: ["sunnxt", "suntvnetwork"],
    merchantLabel: "Sun NXT",
    kind: "direct",
    steps: ["Sign in to Sun NXT", "Profile → My Account → Subscription", "Turn off auto-renewal or cancel through the billing platform shown"],
    caveat: "Apple, Google Play, DTH, and partner-billed plans must be cancelled through that provider.",
  },
  {
    patterns: ["ahavideo", "ahaott", "arhamedia"],
    merchantLabel: "aha",
    kind: "direct",
    steps: ["Open aha and sign in", "Profile → My Account → Subscription", "Cancel the plan or follow the displayed billing-platform link"],
    caveat: "App-store and telecom-bundled subscriptions cannot be cancelled by aha directly.",
  },
  {
    patterns: ["hoichoi", "svfentertainment"],
    merchantLabel: "hoichoi",
    kind: "direct",
    steps: ["Sign in to hoichoi", "Profile → My hoichoi → Subscription", "Cancel the subscription or disable renewal"],
    caveat: "App-store receipts must be cancelled in Apple or Google Play subscriptions.",
  },
  {
    patterns: ["discoveryplus"],
    merchantLabel: "discovery+",
    kind: "direct",
    steps: ["Sign in to discovery+", "Account → Manage Subscription", "Cancel the subscription and confirm"],
    caveat: "Partner, app-store, or telecom billing must be cancelled through the billing partner.",
  },
  {
    patterns: ["lionsgateplay", "lionsgate"],
    merchantLabel: "Lionsgate Play",
    kind: "direct",
    steps: ["Open the Lionsgate Play app and sign in", "Profile → My Subscription", "Turn off auto-renewal or cancel through the listed billing provider"],
    caveat: "Many India subscriptions are sold through telecom or OTT bundles and must be managed there.",
  },
  {
    patterns: ["mubi"],
    merchantLabel: "MUBI",
    kind: "direct",
    steps: ["Sign in to MUBI", "Settings → Subscription", "Cancel the subscription and confirm"],
    caveat: "Cancel through Apple or Google Play when that store billed the plan.",
  },
  {
    patterns: ["crunchyroll"],
    merchantLabel: "Crunchyroll",
    kind: "direct",
    manageUrl: "https://www.crunchyroll.com/account/membership",
    steps: ["Log in to Crunchyroll", "Account → Membership Info", "Cancel Membership and confirm"],
    caveat: "App-store, Roku, or partner-billed memberships must be cancelled through that platform.",
  },
  {
    patterns: ["gaana"],
    merchantLabel: "Gaana Plus",
    kind: "direct",
    steps: ["Log in to Gaana", "Profile → Subscription", "Cancel the plan through the billing method displayed"],
    caveat: "Apple or Google Play purchases must be cancelled in that store's subscriptions page.",
  },
  {
    patterns: ["storytel"],
    merchantLabel: "Storytel",
    kind: "direct",
    steps: ["Sign in to Storytel", "My Account → Manage Subscription", "Cancel the subscription and confirm"],
    caveat: "App-store purchases must be cancelled through Apple or Google Play.",
  },
  {
    patterns: ["googleone", "googlestorage", "googleaipro", "geminiadvanced", "geminipro"],
    merchantLabel: "Google One",
    kind: "direct",
    manageUrl: "https://one.google.com/settings",
    steps: ["Sign in to Google One", "Settings → Cancel membership", "Confirm the cancellation"],
    caveat: "Google AI plans are administered as Google One memberships — cancelling removes bundled storage too; accounts above the free limit may be unable to add files or receive email.",
  },
  {
    patterns: ["1password"],
    merchantLabel: "1Password",
    kind: "direct",
    steps: ["Sign in to 1Password.com as the account owner", "Open Billing", "Billing Settings → Cancel Subscription"],
    caveat: "Apple and Google Play purchases must be cancelled through the relevant store; team accounts require an owner.",
  },
  {
    patterns: ["nordvpn", "nordsec"],
    merchantLabel: "NordVPN",
    kind: "direct",
    manageUrl: "https://my.nordaccount.com/billing/",
    steps: ["Sign in to Nord Account", "Billing → Subscriptions", "Manage → Cancel auto-renewal and confirm"],
    caveat: "App-store purchases must be cancelled through Apple or Google Play.",
  },
  {
    patterns: ["expressvpn"],
    merchantLabel: "ExpressVPN",
    kind: "direct",
    manageUrl: "https://portal.expressvpn.com/",
    steps: ["Sign in to the ExpressVPN customer portal", "My Subscription → Edit subscription settings", "Turn off automatic renewal and confirm"],
    caveat: "App-store purchases must be cancelled in that store.",
  },
  {
    patterns: ["surfshark"],
    merchantLabel: "Surfshark",
    kind: "direct",
    manageUrl: "https://my.surfshark.com/",
    steps: ["Log in to the Surfshark account", "Open Subscription or Payments", "Cancel auto-renewal and complete the confirmation flow"],
    caveat: "Apple, Google Play, and third-party purchases must be cancelled through the seller.",
  },
  {
    patterns: ["nortonlifelock", "norton"],
    merchantLabel: "Norton 360",
    kind: "direct",
    manageUrl: "https://my.norton.com/",
    steps: ["Sign in to My Norton", "Open My Subscriptions", "Cancel Subscription Renewal and confirm"],
    caveat: "Partner and app-store subscriptions must be cancelled with the billing partner.",
  },
  {
    patterns: ["mcafee"],
    merchantLabel: "McAfee",
    kind: "direct",
    manageUrl: "https://home.mcafee.com/",
    steps: ["Sign in to the McAfee account", "Open Auto-Renewal Settings", "Turn off auto-renewal and confirm"],
    caveat: "Store- or partner-billed plans must be cancelled with that provider.",
  },
  {
    patterns: ["evernote"],
    merchantLabel: "Evernote",
    kind: "direct",
    steps: ["Sign in to Evernote account settings", "Open Billing", "Manage subscription → Cancel subscription"],
    caveat: "Apple and Google Play purchases must be cancelled through the relevant store.",
  },
  {
    patterns: ["todoist"],
    merchantLabel: "Todoist",
    kind: "direct",
    manageUrl: "https://app.todoist.com/app/settings/subscription",
    steps: ["Log in to Todoist", "Settings → Subscription", "Cancel plan and confirm"],
    caveat: "App-store subscriptions must be cancelled in Apple or Google Play.",
  },
  {
    patterns: ["protonmail", "protonvpn", "protonag", "protonch", "protonme"],
    merchantLabel: "Proton",
    kind: "direct",
    manageUrl: "https://account.proton.me/",
    steps: ["Sign in to the Proton Account dashboard", "Dashboard → Subscription", "Downgrade to the Free plan and confirm"],
    caveat: "Downgrading can remove paid storage, addresses, and VPN entitlements — reduce usage below free-plan limits first.",
  },
  {
    patterns: ["midjourney"],
    merchantLabel: "Midjourney",
    kind: "direct",
    manageUrl: "https://www.midjourney.com/account",
    steps: ["Sign in to Midjourney", "Open Manage Subscription", "Cancel Plan and confirm whether it ends immediately or at period end"],
  },
  {
    patterns: ["elevenlabs"],
    merchantLabel: "ElevenLabs",
    kind: "direct",
    manageUrl: "https://elevenlabs.io/app/subscription",
    steps: ["Sign in to ElevenLabs", "Subscription → Manage subscription", "Cancel subscription and confirm"],
    caveat: "Usage-based API charges and prepaid credits can continue separately from the recurring plan.",
  },
  {
    patterns: ["runwayml", "runwayai"],
    merchantLabel: "Runway",
    kind: "direct",
    steps: ["Sign in to Runway", "Workspace Settings → Plans & Billing", "Manage Plan → Cancel Plan and confirm"],
    caveat: "Credits and workspace billing can be separate — check every paid workspace.",
  },
  {
    patterns: ["shopify"],
    merchantLabel: "Shopify",
    kind: "direct",
    steps: ["Open the Shopify admin as the store owner", "Settings → Plan", "Deactivate the store or change the plan"],
    caveat: "Third-party app subscriptions, domains, and outstanding charges can continue separately from the store plan.",
  },
  {
    patterns: ["webflow"],
    merchantLabel: "Webflow",
    kind: "direct",
    manageUrl: "https://webflow.com/dashboard",
    steps: ["Log in to Webflow", "Workspace settings → Billing", "Cancel the Workspace plan and separately cancel each unneeded Site plan"],
    caveat: "Workspace plans and per-site plans are separate recurring charges.",
  },
  {
    patterns: ["zohoone", "zohocorp", "zoho"],
    merchantLabel: "Zoho",
    kind: "direct",
    steps: ["Sign in to the Zoho Store with the admin account", "Open Subscriptions", "Manage Subscription → cancel or downgrade after checking user counts and app dependencies"],
  },
  {
    patterns: ["mailchimp"],
    merchantLabel: "Mailchimp",
    kind: "direct",
    manageUrl: "https://admin.mailchimp.com/account/billing/",
    steps: ["Log in to Mailchimp", "Account & billing → Billing", "Open Monthly plans or credits and pause or cancel the plan"],
    caveat: "Export required audience data before closing the account.",
  },
  {
    patterns: ["semrush"],
    merchantLabel: "Semrush",
    kind: "direct",
    steps: ["Sign in to Semrush", "Open Subscription Info", "Cancel the subscription or contact account support"],
  },
  {
    patterns: ["wixcom", "wix"],
    merchantLabel: "Wix",
    kind: "direct",
    manageUrl: "https://manage.wix.com/account/account-settings",
    steps: ["Sign in to Wix", "Open Premium Subscriptions", "More Actions → Cancel Plan for the site plan"],
    caveat: "Domains, mailboxes, and third-party apps renew separately from the website plan.",
  },
  {
    patterns: ["squarespace"],
    merchantLabel: "Squarespace",
    kind: "direct",
    manageUrl: "https://account.squarespace.com/",
    steps: ["Log in to Squarespace", "Settings → Billing → Subscriptions", "Website → Cancel Subscription"],
    caveat: "Domains, Google Workspace, Email Campaigns, and Scheduling can renew separately.",
  },
  {
    patterns: ["cultfit", "curefit", "cultpass"],
    merchantLabel: "Cult.fit",
    kind: "direct",
    steps: ["Open the Cult.fit app and tap Profile", "Open Active Packs or Memberships", "Use Contact Us for the cancellation, freeze, or transfer options shown for the pack"],
    caveat: "Cultpass plans are generally fixed-term and non-refundable; freeze and transfer rights depend on the purchased plan.",
  },
  {
    patterns: ["healthifyme"],
    merchantLabel: "HealthifyMe",
    kind: "direct",
    steps: ["Open HealthifyMe", "Profile → Settings → Subscription or Manage Plan", "Cancel there or in the app store named on the receipt"],
    caveat: "Coaching and medical programmes can have separate fixed-term or refund conditions.",
  },
  {
    patterns: ["headspace"],
    merchantLabel: "Headspace",
    kind: "direct",
    steps: ["Sign in to Headspace", "Profile → Settings → Account & Subscription", "Manage → Cancel Subscription"],
    caveat: "Apple and Google Play purchases must be cancelled in the respective store.",
  },
  {
    patterns: ["calmcom", "calmpremium", "calmapp"],
    merchantLabel: "Calm",
    kind: "direct",
    steps: ["Identify whether Calm, Apple, or Google issued the receipt", "For a direct plan: Calm Settings → Manage Subscription", "For a store plan: cancel in Apple or Google Play subscriptions"],
    caveat: "Deleting the app or the Calm account does not cancel an app-store subscription.",
  },
  {
    patterns: ["strava"],
    merchantLabel: "Strava",
    kind: "direct",
    manageUrl: "https://www.strava.com/account",
    steps: ["Log in to Strava", "Settings → My Account", "Cancel Subscription or downgrade to the free plan"],
    caveat: "App-store purchases must be cancelled through Apple or Google Play.",
  },
  {
    patterns: ["myfitnesspal"],
    merchantLabel: "MyFitnessPal",
    kind: "direct",
    steps: ["Open MyFitnessPal", "Settings → Subscription or Premium", "Manage Subscription and cancel through the displayed billing provider"],
    caveat: "Most mobile purchases are controlled by Apple or Google Play.",
  },
  {
    patterns: ["flohealth", "flopremium"],
    merchantLabel: "Flo Premium",
    kind: "direct",
    steps: ["Open Flo", "Menu → Subscriptions → Manage Subscription", "Cancel through the billing provider shown on the receipt"],
    caveat: "Deleting health data or the app does not cancel an app-store subscription.",
  },
  {
    patterns: ["etprime", "economictimes"],
    merchantLabel: "ET Prime",
    kind: "direct",
    steps: ["Sign in to The Economic Times", "Profile menu → My Subscriptions", "Disable renewal or contact subscription support"],
    caveat: "Bundled Times subscriptions can renew as a combined product rather than ET Prime alone.",
  },
  {
    patterns: ["toiplus", "timesofindia"],
    merchantLabel: "TOI+",
    kind: "direct",
    steps: ["Sign in to The Times of India", "Account menu → My Subscriptions", "Manage renewal for TOI+ or the combined ePaper plan"],
    caveat: "TOI+, ePaper, and partner benefits may be sold as one bundle.",
  },
  {
    patterns: ["businessstandard"],
    merchantLabel: "Business Standard Digital",
    kind: "direct",
    steps: ["Email assist@bsmail.in from the subscribed address with the subscriber's name, email, and contact number", "State that the future renewal must be cancelled", "Retain the written confirmation"],
    caveat: "Per provider terms, cancellation takes effect at period end and the current period is not refunded.",
  },
  {
    patterns: ["moneycontrol"],
    merchantLabel: "Moneycontrol Pro",
    kind: "direct",
    steps: ["Sign in to Moneycontrol", "Profile menu → My Subscription", "Use the cancellation option shown or contact Moneycontrol support"],
    caveat: "Refund and cancellation rights vary by PRO, Super PRO, Ad Lite, and fixed-term offer.",
  },
  {
    patterns: ["theken", "kenrise"],
    merchantLabel: "The Ken",
    kind: "direct",
    steps: ["Sign in to The Ken", "Open account or subscription settings and turn off automatic renewal", "Email support@the-ken.com if the renewal control is unavailable"],
    caveat: "Stopping renewal does not refund the active subscription period.",
  },
  {
    patterns: ["morningcontext", "slowform"],
    merchantLabel: "The Morning Context",
    kind: "direct",
    steps: ["Email support@slowform.com from the subscribed address", "Request that renewal be stopped and identify the account", "Retain the written confirmation"],
    caveat: "Provider terms state fees are generally non-refundable, subject to discretionary exceptions.",
  },
  {
    patterns: ["thehindu", "kasturiandsons"],
    merchantLabel: "The Hindu Digital",
    kind: "direct",
    steps: ["Sign in to The Hindu", "My Account → Subscription", "Manage renewal or contact subscription support if no cancellation control appears"],
    caveat: "Digital, ePaper, print, and institutional products can have separate contracts.",
  },
  {
    patterns: ["indianexpress", "expressedge"],
    merchantLabel: "The Indian Express Digital",
    kind: "direct",
    steps: ["Sign in to The Indian Express", "My Account → My Subscription", "Stop renewal or email subscriptions@indianexpress.com with the account details"],
    caveat: "Express Edge and UPSC packs can have different renewal and refund terms.",
  },
  {
    patterns: ["livemint", "mintpremium", "htdigital"],
    merchantLabel: "Mint Premium",
    kind: "direct",
    steps: ["Sign in to Mint", "MyMint → My Subscription", "Manage or stop renewal for the active product"],
    caveat: "Mint, WSJ, Economist, Barron's, and ePaper access may be bundled — check what the plan includes.",
  },
  {
    patterns: ["tinder"],
    merchantLabel: "Tinder",
    kind: "platform",
    steps: ["Apple: Settings → your name → Subscriptions → Tinder", "Google Play: Payments & subscriptions → Subscriptions → Tinder", "Cancel the subscription"],
    caveat: "For a direct web purchase, cancel in Tinder's own account settings instead.",
  },
  {
    patterns: ["bumble"],
    merchantLabel: "Bumble",
    kind: "platform",
    steps: ["Apple: Settings → your name → Subscriptions → Bumble", "Google Play: Payments & subscriptions → Subscriptions → Bumble", "Cancel the subscription"],
    caveat: "For a direct card purchase, use Bumble's account support instead.",
  },
  {
    patterns: ["jiofiber", "jiofibre", "jioairfiber"],
    merchantLabel: "JioFiber",
    kind: "direct",
    manageUrl: "https://www.jio.com/selfcare/",
    steps: ["Sign in to MyJio and select the Fiber service", "Open JioCare → Help & support", "Request permanent disconnection and follow the equipment-return instructions"],
    caveat: "Stopping payment is not account closure — settle final dues and return provider-owned equipment; bundled OTT benefits end with the plan.",
  },
  {
    patterns: ["airtelxstream", "xstreamfiber", "airtelbroadband"],
    merchantLabel: "Airtel Xstream Fiber",
    kind: "direct",
    steps: ["Open the Airtel Thanks app and select the Wi-Fi service", "Open Help & Support", "Request disconnection and retain the service-request number"],
    caveat: "Settle final dues and arrange return of provider-owned equipment; bundled OTT benefits end with the broadband plan.",
  },
  {
    patterns: ["actfibernet", "atriaconvergence"],
    merchantLabel: "ACT Fibernet",
    kind: "direct",
    steps: ["Sign in to the ACT Fibernet app or self-care portal", "Support → Raise a request", "Choose disconnection or account closure and retain the ticket number"],
    caveat: "Advance-plan refunds and router recovery depend on the service agreement and city.",
  },
  {
    patterns: ["tataplaybinge", "tataskybinge"],
    merchantLabel: "Tata Play Binge",
    kind: "direct",
    steps: ["Open the Tata Play Binge app and sign in", "Profile → My Plan", "Manage Plan → Cancel Subscription"],
    caveat: "A Binge plan bundled with Tata Play Fiber must be changed through the Fiber bundle workflow.",
  },
  {
    patterns: ["tataplay", "tatasky"],
    merchantLabel: "Tata Play",
    kind: "direct",
    steps: ["Open Tata Play My Account", "Use Manage Packs to remove paid add-ons", "Use Get Help to request deactivation when closing the full account"],
    caveat: "A prepaid balance reaching zero is not formal account closure.",
  },
  {
    patterns: ["dishtv"],
    merchantLabel: "Dish TV",
    kind: "direct",
    steps: ["Sign in to Dish TV My Account", "Open Modify My Pack or Add/Delete Channel", "Remove paid services or contact support to close the account"],
    caveat: "Not recharging stops viewing but may not formally close the subscriber account.",
  },
  {
    patterns: ["videocond2h", "d2hinfinity", "d2h"],
    merchantLabel: "d2h",
    kind: "direct",
    steps: ["Sign in to Subscriber Corner or the d2h Infinity app", "Open Subscription Plans and modify paid packs or add-ons", "Contact Customer Care to close the full account"],
    caveat: "A lapsed prepaid balance is not formal closure.",
  },
  {
    patterns: ["excitel"],
    merchantLabel: "Excitel",
    kind: "direct",
    steps: ["Sign in to the Excitel app or Customer Login", "Open Support and raise a disconnection request", "Retain the ticket and complete any router return"],
    caveat: "Long-duration prepaid plans may be non-refundable after activation.",
  },
  {
    patterns: ["hathway"],
    merchantLabel: "Hathway",
    kind: "direct",
    steps: ["Sign in to Hathway Account Login", "Open Customer Care or Quick Support", "Request disconnection and retain the complaint number"],
    caveat: "Settle final dues and confirm whether the router must be returned.",
  },
  {
    patterns: ["bsnl", "bharatsanchar"],
    merchantLabel: "BSNL Bharat Fiber",
    kind: "direct",
    manageUrl: "https://selfcare.bsnl.co.in/",
    steps: ["Sign in to the BSNL Selfcare portal", "Open the service-request area for the broadband account", "Submit a closure request or call 1800-4444 when closure is unavailable online"],
    caveat: "Return rented equipment and obtain a final-bill or no-dues confirmation.",
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
  {
    patterns: ["paypal"],
    merchantLabel: "PayPal automatic payments",
    kind: "direct",
    manageUrl: "https://www.paypal.com/myaccount/autopay/",
    steps: ["Open PayPal automatic payments", "Pick the merchant", "Cancel the automatic payment"],
    caveat: "This stops PayPal billing; the merchant may still expect payment another way — cancel with them too.",
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

/** Recommendations where showing a cancellation path is honest and helpful. */
export const actionableRecommendations: ReadonlySet<string> = new Set(["cancel", "downgrade", "investigate"]);

/** Gate + lookup in one step: no cancel path is ever shown under keep/watch. */
export function findActionableCancelAction(merchant: string, category: string | undefined, action: string): CancelAction | null {
  return actionableRecommendations.has(action) ? findCancelAction(merchant, category) : null;
}

export function manageUrlHostname(action: CancelAction): string | null {
  if (!action.manageUrl) return null;
  try {
    return new URL(action.manageUrl).hostname;
  } catch {
    return null;
  }
}
