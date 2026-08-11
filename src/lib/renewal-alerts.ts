import { currentPrivacyNoticeVersion } from "./privacy-notice";
import type { MoneyDto } from "./recovery/contracts";

export const renewalAlertConsentPurpose = "renewal-alerts" as const;
export const renewalAlertNoticeVersion = currentPrivacyNoticeVersion;
export const renewalAlertWindows = ["7_day", "1_day"] as const;
export const renewalAlertFailureCodes = [
  "configuration",
  "timeout",
  "network",
  "provider_conflict",
  "provider_rate_limited",
  "provider_rejected",
  "provider_unavailable",
  "unknown",
] as const;

export type RenewalAlertWindow = typeof renewalAlertWindows[number];
export type RenewalAlertFailureCode = typeof renewalAlertFailureCodes[number];

export type RenewalAlertPreferenceInput = {
  enabled: boolean;
  weeklyDigestEnabled: boolean;
  sevenDayEnabled: boolean;
  oneDayEnabled: boolean;
  timeZone: string;
  sendHourLocal: number;
};

export type WeeklyDigestEmailInput = {
  weekStart: string;
  monthlyTotals: readonly MoneyDto[];
  renewalCountNext7Days: number;
  renewalTotalsNext7Days: readonly MoneyDto[];
  suggestion: null | { merchant: string; monthlyCost: MoneyDto };
  appBaseUrl: string;
};

export type RenewalAlertEmailInput = {
  merchant: string;
  renewalDate: string;
  alertWindow: RenewalAlertWindow;
  appBaseUrl: string;
};

const preferenceKeys = new Set(["enabled", "weeklyDigestEnabled", "sevenDayEnabled", "oneDayEnabled", "timeZone", "sendHourLocal"]);

export function normalizeRenewalAlertPreferenceInput(value: unknown): RenewalAlertPreferenceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Renewal alert preferences must be a JSON object.");
  }

  const input = value as Record<string, unknown>;
  const unknownKey = Object.keys(input).find((key) => !preferenceKeys.has(key));
  if (unknownKey) throw new Error(`Unknown renewal alert preference: ${unknownKey}.`);
  if (typeof input.enabled !== "boolean") throw new Error("enabled must be true or false.");

  const sevenDayEnabled = optionalBoolean(input.sevenDayEnabled, true, "sevenDayEnabled");
  const oneDayEnabled = optionalBoolean(input.oneDayEnabled, true, "oneDayEnabled");
  if (input.enabled && !sevenDayEnabled && !oneDayEnabled) {
    throw new Error("Enable at least one reminder window before turning renewal alerts on.");
  }

  return {
    enabled: input.enabled,
    weeklyDigestEnabled: optionalBoolean(input.weeklyDigestEnabled, false, "weeklyDigestEnabled"),
    sevenDayEnabled,
    oneDayEnabled,
    timeZone: normalizeTimeZone(input.timeZone),
    sendHourLocal: normalizeSendHour(input.sendHourLocal),
  };
}

export function buildWeeklyDigestEmail(input: WeeklyDigestEmailInput) {
  const weekStart = normalizeDateOnly(input.weekStart);
  const appBaseUrl = normalizeAppBaseUrl(input.appBaseUrl);
  const reviewUrl = new URL("/app", appBaseUrl).toString();
  const preferencesUrl = new URL("/profile", appBaseUrl).toString();
  const monthly = [...input.monthlyTotals].sort((left, right) => left.currency.localeCompare(right.currency));
  const primaryMonthly = monthly.find((total) => total.currency === "INR") ?? monthly[0] ?? null;
  const otherMonthly = monthly.filter((total) => total !== primaryMonthly);
  const burn = primaryMonthly?.display ?? "No supported total";
  const due = [...input.renewalTotalsNext7Days]
    .sort((left, right) => left.currency.localeCompare(right.currency))
    .map((total) => total.display)
    .join(" · ") || "No amount published";
  const suggestion = input.suggestion
    ? `Review ${normalizeMessageText(input.suggestion.merchant, 160) || "your largest commitment"} (${input.suggestion.monthlyCost.display}/month).`
    : "No primary-currency commitment needs a suggested review this week.";
  const subject = "Your weekly recurring-money review from Vognary";
  const text = [
    `Week of ${weekStart}`,
    "",
    `Monthly recurring burn: ${burn}`,
    ...(otherMonthly.length ? [`Other currencies, kept separate: ${otherMonthly.map((total) => total.display).join(" · ")}`] : []),
    `Next 7 days: ${input.renewalCountNext7Days} expected renewal(s), ${due}`,
    `One action: ${suggestion}`,
    "",
    "These figures come from the evidence currently synchronized to your workspace and may change when sources refresh.",
    `Review in Vognary: ${reviewUrl}`,
    `Manage or turn off the weekly digest: ${preferencesUrl}`,
  ].join("\n");
  const html = [
    `<p><strong>Week of ${escapeHtml(weekStart)}</strong></p>`,
    `<p><strong>Monthly recurring burn:</strong> ${escapeHtml(burn)}</p>`,
    ...(otherMonthly.length ? [`<p><strong>Other currencies, kept separate:</strong> ${escapeHtml(otherMonthly.map((total) => total.display).join(" · "))}</p>`] : []),
    `<p><strong>Next 7 days:</strong> ${input.renewalCountNext7Days} expected renewal(s), ${escapeHtml(due)}</p>`,
    `<p><strong>One action:</strong> ${escapeHtml(suggestion)}</p>`,
    "<p>These figures come from the evidence currently synchronized to your workspace and may change when sources refresh.</p>",
    `<p><a href="${escapeHtml(reviewUrl)}">Review in Vognary</a></p>`,
    `<p><small><a href="${escapeHtml(preferencesUrl)}">Manage or turn off the weekly digest</a></small></p>`,
  ].join("");
  return { subject, text, html };
}

export function buildRenewalAlertEmail(input: RenewalAlertEmailInput) {
  const merchant = normalizeMessageText(input.merchant, 160) || "Recurring payment";
  const renewalDate = normalizeDateOnly(input.renewalDate);
  const appBaseUrl = normalizeAppBaseUrl(input.appBaseUrl);
  const reviewUrl = new URL("/app", appBaseUrl).toString();
  const preferencesUrl = new URL("/profile", appBaseUrl).toString();
  const days = input.alertWindow === "7_day" ? 7 : 1;
  const windowLabel = days === 1 ? "about 1 day" : "about 7 days";
  const dateLabel = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${renewalDate}T00:00:00.000Z`));

  const subject = "Upcoming renewal reminder from Vognary";
  const text = [
    `A recurring payment is expected in ${windowLabel}.`,
    "",
    `Merchant: ${merchant}`,
    `Expected renewal date: ${dateLabel}`,
    "",
    "This reminder is based on synchronized evidence and the date may change. Confirm details with the provider before acting.",
    `Review in Vognary: ${reviewUrl}`,
    `Manage or turn off renewal alerts: ${preferencesUrl}`,
  ].join("\n");
  const html = [
    `<p>A recurring payment is expected in <strong>${escapeHtml(windowLabel)}</strong>.</p>`,
    `<p><strong>Merchant:</strong> ${escapeHtml(merchant)}<br><strong>Expected renewal date:</strong> ${escapeHtml(dateLabel)}</p>`,
    "<p>This reminder is based on synchronized evidence and the date may change. Confirm details with the provider before acting.</p>",
    `<p><a href="${escapeHtml(reviewUrl)}">Review in Vognary</a></p>`,
    `<p><small><a href="${escapeHtml(preferencesUrl)}">Manage or turn off renewal alerts</a></small></p>`,
  ].join("");

  return { subject, text, html };
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function optionalBoolean(value: unknown, fallback: boolean, label: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}

function normalizeTimeZone(value: unknown) {
  if (value === undefined) return "UTC";
  if (typeof value !== "string" || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(value.trim())) {
    throw new Error("timeZone must be a valid IANA time-zone name.");
  }
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    throw new Error("timeZone must be a valid IANA time-zone name.");
  }
}

function normalizeSendHour(value: unknown) {
  if (value === undefined) return 9;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 23) {
    throw new Error("sendHourLocal must be an integer from 0 through 23.");
  }
  return value;
}

function normalizeMessageText(value: string, maxLength: number) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Renewal date must use YYYY-MM-DD.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Renewal date is invalid.");
  }
  return value;
}

function normalizeAppBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Application URL is invalid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Application URL must use HTTP or HTTPS.");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}
