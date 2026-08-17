import { hashBillingPayload, parseRazorpayBillingEvent, verifyRazorpayWebhookSignature } from "@/lib/billing";
import { applyRazorpayBillingEvent } from "@/lib/server/billing-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { assertContentType, readLimitedText, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxWebhookBytes = 512 * 1024;

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501 });
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret) return Response.json({ status: "not-configured", requiredEnv: ["RAZORPAY_WEBHOOK_SECRET"] }, { status: 501 });

  let rawBody: string;
  try {
    assertContentType(request, "application/json");
    rawBody = await readLimitedText(request, maxWebhookBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Webhook is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "Webhook body could not be read." }, { status: 400 });
  }

  const signature = request.headers.get("x-razorpay-signature")?.trim() ?? "";
  const oldSecret = process.env.RAZORPAY_WEBHOOK_OLD_SECRET?.trim();
  if (!verifyRazorpayWebhookSignature(rawBody, signature, secret)
    && (!oldSecret || !verifyRazorpayWebhookSignature(rawBody, signature, oldSecret))) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  const payloadHash = hashBillingPayload(rawBody);
  let event;
  try {
    event = parseRazorpayBillingEvent(JSON.parse(rawBody), `razorpay:${payloadHash}`);
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? "Webhook JSON is invalid." : "Webhook payload is invalid." }, { status: 400 });
  }
  try {
    const result = await applyRazorpayBillingEvent(event, payloadHash);
    return Response.json(result, { status: result.status === "rejected" ? 422 : 200 });
  } catch {
    return Response.json({ error: "Webhook processing failed and should be retried." }, { status: 500 });
  }
}