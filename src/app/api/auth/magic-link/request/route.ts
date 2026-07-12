import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { checkMagicLinkConfiguration, createMagicLinkChallenge, maskEmail, sendMagicLinkEmail } from "@/lib/server/magic-link-auth";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MagicLinkRequest = {
  email?: string;
  name?: string;
  workspaceName?: string;
  redirectPath?: string;
};

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "magic-link-request", limit: 5, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const configuration = checkMagicLinkConfiguration();
  if (configuration.status !== "ready") {
    return NextResponse.json({
      status: "not-configured",
      requiredEnv: configuration.missing,
      message: "Magic-link login needs database, signed sessions, Resend API credentials, and a verified sender.",
    }, { status: 501 });
  }

  const body = await readMagicLinkJson(request);
  if (body instanceof Response) return body;
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }

  const challenge = await createMagicLinkChallenge({
    email,
    displayName: body.name,
    workspaceName: body.workspaceName,
    redirectPath: body.redirectPath,
  });
  const verifyUrl = new URL("/api/auth/magic-link/verify", getAppOrigin(request));
  verifyUrl.searchParams.set("token", challenge.token);

  try {
    await sendMagicLinkEmail({ email, link: verifyUrl.toString(), expiresAt: challenge.expiresAt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Magic link email failed." }, { status: 502 });
  }

  return NextResponse.json({ status: "sent", email: maskEmail(email), expiresAt: challenge.expiresAt });
}

async function readMagicLinkJson(request: Request): Promise<MagicLinkRequest | Response> {
  try {
    return await readLimitedJson<MagicLinkRequest>(request, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Magic-link request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return NextResponse.json({ error: "Magic-link request must be valid JSON." }, { status: 400 });
  }
}

function getAppOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || request.nextUrl.origin;
}
