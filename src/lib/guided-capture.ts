import type { Frequency, ManualRecurringInput } from "./recurring-audit";

export type CaptureAppId = "gpay" | "phonepe" | "paytm" | "playstore" | "appstore" | "netbanking";

export type CaptureApp = {
  id: CaptureAppId;
  name: string;
  /** Where the user read the values from — becomes the evidence source label. */
  sourceLabel: string;
  category: string;
  defaultFrequency: Frequency;
  steps: string[];
};

export type CaptureEntry = {
  merchant: string;
  amount: number;
  frequency: Frequency;
  nextDate?: string;
};

// Guided Proof Capture: no provider exposes a consumer mandate API, so the
// most honest coverage available today is the user reading their own official
// screens, step by step. Each entry carries a user-confirmed source label —
// stronger than a guess, clearly weaker than a direct API, and labeled as such.
export const captureApps: CaptureApp[] = [
  {
    id: "gpay",
    name: "Google Pay",
    sourceLabel: "Google Pay AutoPay screen",
    category: "Mandates",
    defaultFrequency: "monthly",
    steps: [
      "Open Google Pay and tap your profile photo.",
      "Tap 'Autopay' (or 'Payments & subscriptions', then 'Autopay').",
      "Open the 'Live' tab to see every active mandate.",
      "For each mandate, copy the merchant name, amount, and next payment date into the fields below.",
    ],
  },
  {
    id: "phonepe",
    name: "PhonePe",
    sourceLabel: "PhonePe AutoPay screen",
    category: "Mandates",
    defaultFrequency: "monthly",
    steps: [
      "Open PhonePe and tap your profile photo.",
      "Tap 'Payment Management', then 'AutoPay'.",
      "Review the list of active AutoPays.",
      "Copy each merchant, amount, and next debit date into the fields below.",
    ],
  },
  {
    id: "paytm",
    name: "Paytm",
    sourceLabel: "Paytm UPI AutoPay screen",
    category: "Mandates",
    defaultFrequency: "monthly",
    steps: [
      "Open Paytm and tap the profile icon.",
      "Tap 'UPI & Payment Settings', then 'UPI Automatic Payments'.",
      "Open each active mandate.",
      "Copy merchant, amount, and next date into the fields below.",
    ],
  },
  {
    id: "playstore",
    name: "Google Play",
    sourceLabel: "Google Play subscriptions screen",
    category: "App store",
    defaultFrequency: "monthly",
    steps: [
      "Open play.google.com/store/account/subscriptions (or Play Store → profile → 'Payments & subscriptions' → 'Subscriptions').",
      "For each active subscription, note the plan price and the renewal date.",
      "Enter them below exactly as shown on the screen.",
    ],
  },
  {
    id: "appstore",
    name: "Apple App Store",
    sourceLabel: "Apple subscriptions screen",
    category: "App store",
    defaultFrequency: "monthly",
    steps: [
      "Open iPhone Settings and tap your name at the top.",
      "Tap 'Subscriptions'.",
      "Open each active subscription to see its price and renewal date.",
      "Enter them below exactly as shown on the screen.",
    ],
  },
  {
    id: "netbanking",
    name: "Bank e-mandates",
    sourceLabel: "Bank e-mandate list",
    category: "Mandates",
    defaultFrequency: "monthly",
    steps: [
      "Log in to your bank's net banking.",
      "Find 'e-Mandates', 'Standing Instructions', or 'Biller / SI registrations'.",
      "List every active mandate with its amount and frequency.",
      "Enter them below; use the frequency shown by the bank.",
    ],
  },
];

export function getCaptureApp(id: CaptureAppId): CaptureApp {
  return captureApps.find((app) => app.id === id) ?? captureApps[0];
}

export function captureEntriesToManualInputs(
  appId: CaptureAppId,
  entries: CaptureEntry[],
  now = Date.now(),
): ManualRecurringInput[] {
  const app = getCaptureApp(appId);

  return entries
    .filter((entry) => entry.merchant.trim().length > 0 && Number.isFinite(entry.amount) && entry.amount > 0)
    .map((entry, index) => ({
      id: `capture-${app.id}-${now}-${index}`,
      merchant: entry.merchant.trim(),
      amount: entry.amount,
      frequency: entry.frequency,
      nextExpectedDate: entry.nextDate?.trim() || defaultNextDate(),
      category: app.category,
      sourceName: `${app.sourceLabel} (user-confirmed)`,
    }));
}

function defaultNextDate(): string {
  const next = new Date();
  next.setMonth(next.getMonth() + 1);
  return next.toISOString().slice(0, 10);
}
