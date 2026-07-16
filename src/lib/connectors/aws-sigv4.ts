import { createHash, createHmac } from "node:crypto";

/**
 * Minimal AWS Signature Version 4 signer for JSON POST APIs (Cost Explorer).
 * No SDK dependency. Correctness is proven in tests against the worked
 * example AWS publishes in its SigV4 documentation (the AKIDEXAMPLE vector):
 * an implementation that reproduces that documented signature byte-for-byte
 * implements the algorithm correctly.
 */

export type SigV4Request = {
  method: "GET" | "POST";
  host: string;
  path: string;
  /** Already-encoded canonical query string ("" for none, no leading ?). */
  query: string;
  /** Header names lowercase; values trimmed. host and x-amz-date are required. */
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function sigV4AmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function signAwsRequest(request: SigV4Request): { authorization: string; canonicalRequestHash: string; signature: string } {
  const amzDate = request.headers["x-amz-date"];
  if (!amzDate) throw new Error("SigV4 request requires an x-amz-date header.");
  const dateStamp = amzDate.slice(0, 8);

  const sortedHeaderNames = Object.keys(request.headers).map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = sortedHeaderNames.map((name) => `${name}:${request.headers[name].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = sortedHeaderNames.join(";");

  const canonicalRequest = [
    request.method,
    request.path,
    request.query,
    canonicalHeaders,
    signedHeaders,
    hexSha256(request.body),
  ].join("\n");
  const canonicalRequestHash = hexSha256(canonicalRequest);

  const credentialScope = `${dateStamp}/${request.region}/${request.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, canonicalRequestHash].join("\n");

  const kDate = hmac(`AWS4${request.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, request.region);
  const kService = hmac(kRegion, request.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequestHash,
    signature,
  };
}

function hexSha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}
