import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { assertContentType, readLimitedBytes, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { proposeReceiptLineFromImageFile } from "@/lib/server/receipt-image-propose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const maxFileBytes = 8 * 1024 * 1024;
const maxMultipartBytes = maxFileBytes + 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "receipt-image-propose", limit: 20, windowMs: 5 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  let formData: FormData;
  try {
    assertContentType(request, "multipart/form-data");
    const body = await readLimitedBytes(request, maxMultipartBytes);
    formData = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: Buffer.from(body),
    }).formData();
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "That photo is too large." }, { status: 413 });
    }
    if (error instanceof UnsupportedContentTypeError) {
      return NextResponse.json({ error: "Content-Type must be multipart/form-data." }, { status: 415 });
    }
    return NextResponse.json({ error: "Could not read the photo." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach one photo as file." }, { status: 400 });
  }

  const result = await proposeReceiptLineFromImageFile(file);
  if (result.reason === "too-large") {
    return NextResponse.json({ error: "That photo is too large. Keep files below 8 MB." }, { status: 413 });
  }
  if (result.reason === "not-image") {
    return NextResponse.json({ proposal: null, reason: "not-image" });
  }
  return NextResponse.json({
    proposal: result.proposal,
    reason: result.proposal ? "cited" : "unreadable",
  });
}
