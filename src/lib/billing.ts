import { createHash, createHmac, timingSafeEqual } from "node:crypto";
export { publicOffer } from "./public-offer";

export const billingPlans = ["personal", "founder", "team", "annual", "assisted-audit"] as const;
export type BillingPlan = (typeof billingPlans)[number];
export type BillingEntitlementKey = "monitoring" | "annual-audit";
export type AssistedAuditOrderStatus = "review_required" | "pending" | "in_progress" | "delivered" | "cancelled" | "refunded";
export type AssistedAuditOrderAction = "start" | "deliver" | "cancel";

export function transitionAssistedAuditOrder(current: AssistedAuditOrderStatus, action: AssistedAuditOrderAction): AssistedAuditOrderStatus | null {
  if (action === "start" && (current === "pending" || current === "review_required")) return "in_progress";
  if (action === "deliver" && current === "in_progress") return "delivered";
  if (action === "cancel" && (current === "pending" || current === "review_required" || current === "in_progress")) return "cancelled";
  return null;
}

export function isAssistedAuditPlan(plan: BillingPlan) {
  return plan === "assisted-audit" || plan === "annual";
}

export type RazorpayBillingEvent =
  | { kind: "paid"; eventId: string; eventType: "payment_link.paid"; checkoutId: string; providerCheckoutId: string; providerPaymentId: string; amountMinor: number; currency: string }
  | { kind: "cancelled" | "expired"; eventId: string; eventType: "payment_link.cancelled" | "payment_link.expired"; checkoutId: string; providerCheckoutId: string }
  | { kind: "refund-processed"; eventId: string; eventType: "refund.processed"; providerPaymentId: string; providerRefundId: string; amountMinor: number; currency: string }
  | { kind: "ignored"; eventId: string; eventType: string };

export function normalizeBillingPlan(value: unknown): BillingPlan | null {
  return typeof value === "string" && billingPlans.includes(value as BillingPlan) ? value as BillingPlan : null;
}

export function billingEntitlementForPlan(plan: BillingPlan): { key: BillingEntitlementKey; durationDays: number } | null {
  return isAssistedAuditPlan(plan) ? null : { key: "monitoring", durationDays: 31 };
}

export function verifyRazorpayWebhookSignature(rawBody: string, suppliedSignature: string, secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(suppliedSignature) || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(suppliedSignature, "hex");
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function hashBillingPayload(rawBody: string) {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function parseRazorpayBillingEvent(payload: unknown, eventId: string): RazorpayBillingEvent {
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(eventId)) throw new Error("Razorpay event id is invalid.");
  if (!isRecord(payload) || typeof payload.event !== "string") throw new Error("Razorpay event payload is invalid.");
  const eventType = payload.event;

  if (eventType === "payment_link.paid") {
    const paymentLink = nestedEntity(payload, "payment_link");
    const payment = nestedEntity(payload, "payment");
    const checkoutId = readUuid(paymentLink.reference_id);
    const providerCheckoutId = readProviderId(paymentLink.id, "plink_");
    const providerPaymentId = readProviderId(payment.id, "pay_");
    const amountMinor = readPositiveInteger(paymentLink.amount_paid ?? payment.amount);
    const currency = readCurrency(paymentLink.currency ?? payment.currency);
    if (paymentLink.status !== "paid" || payment.captured !== true) throw new Error("Razorpay paid event is not captured.");
    return { kind: "paid", eventId, eventType, checkoutId, providerCheckoutId, providerPaymentId, amountMinor, currency };
  }

  if (eventType === "payment_link.cancelled" || eventType === "payment_link.expired") {
    const paymentLink = nestedEntity(payload, "payment_link");
    return {
      kind: eventType === "payment_link.cancelled" ? "cancelled" : "expired",
      eventId,
      eventType,
      checkoutId: readUuid(paymentLink.reference_id),
      providerCheckoutId: readProviderId(paymentLink.id, "plink_"),
    };
  }

  if (eventType === "refund.processed") {
    const refund = nestedEntity(payload, "refund");
    if (refund.status !== "processed") throw new Error("Razorpay refund is not processed.");
    return {
      kind: "refund-processed",
      eventId,
      eventType,
      providerPaymentId: readProviderId(refund.payment_id, "pay_"),
      providerRefundId: readProviderId(refund.id, "rfnd_"),
      amountMinor: readPositiveInteger(refund.amount),
      currency: readCurrency(refund.currency),
    };
  }

  return { kind: "ignored", eventId, eventType };
}

function nestedEntity(payload: Record<string, unknown>, name: string) {
  const outerPayload = payload.payload;
  if (!isRecord(outerPayload) || !isRecord(outerPayload[name]) || !isRecord((outerPayload[name] as Record<string, unknown>).entity)) {
    throw new Error(`Razorpay ${name} entity is missing.`);
  }
  return (outerPayload[name] as { entity: Record<string, unknown> }).entity;
}

function readUuid(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Razorpay checkout reference is invalid.");
  }
  return value.toLowerCase();
}

function readProviderId(value: unknown, prefix: string) {
  if (typeof value !== "string" || !value.startsWith(prefix) || !/^[A-Za-z0-9_]{8,80}$/.test(value)) throw new Error("Razorpay provider id is invalid.");
  return value;
}

function readPositiveInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("Razorpay amount is invalid.");
  return value;
}

function readCurrency(value: unknown) {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) throw new Error("Razorpay currency is invalid.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
