/**
 * Sender provenance for forwarded receipt mail.
 *
 * Mail authentication is always an assertion made by some *other* party. This
 * module records who asserted what, and refuses to upgrade transport
 * authenticity into merchant authenticity. Nothing here performs cryptography:
 * a DKIM-Signature header proves only that a signature was attached, never that
 * it validated. Verification is therefore attributed to a named authority that
 * the deployment has explicitly chosen to trust.
 */

import {
  senderTrustTiers,
  type SenderAuthenticationAssertionDto,
  type SenderAuthenticationResult,
  type SenderProvenanceDto,
  type SenderTrustTier,
} from "@/lib/recovery/contracts";

export {
  senderTrustTiers,
  type SenderAuthenticationResult,
  type SenderTrustTier,
};

export type SenderAuthenticationAssertion = SenderAuthenticationAssertionDto;
export type SenderProvenance = SenderProvenanceDto;

export type SenderProvenanceInput = {
  headers: readonly { key: string; value: string }[];
  from?: { address?: string | null; name?: string | null } | null;
  /** Authorities whose Authentication-Results this deployment accepts. Empty means none. */
  trustedAuthorities?: readonly string[];
  /** Sending domains that already produced accepted evidence in this workspace. */
  knownSenderDomains?: readonly string[];
};

const maxHeadersScanned = 64;
const maxAssertions = 12;
const maxHeaderValueChars = 8 * 1024;
const maxDomainsPerAssertion = 8;
const maxSigningDomains = 8;
const maxDomainChars = 253;
const maxLabelChars = 63;

const authenticationResults: Record<string, SenderAuthenticationResult> = {
  pass: "pass",
  fail: "fail",
  softfail: "softfail",
  neutral: "neutral",
  none: "none",
  temperror: "temperror",
  permerror: "permerror",
  policy: "policy",
};

/**
 * Upper bound on the confidence any single forwarded receipt may assert, given
 * how well its sender is established. Unknown senders stay visible but can
 * never independently carry a recurring-money claim.
 */
export function senderTrustConfidenceCeiling(tier: SenderTrustTier) {
  switch (tier) {
    case "VERIFIED_SENDER": return 100;
    case "KNOWN_SENDER": return 80;
    case "UNVERIFIED_SENDER": return 60;
    case "SUSPICIOUS_SENDER": return 40;
  }
}

export function assessSenderProvenance(input: SenderProvenanceInput): SenderProvenance {
  const fromAddress = normalizeAddress(input.from?.address);
  const fromDomain = fromAddress ? normalizeDomain(fromAddress.slice(fromAddress.lastIndexOf("@") + 1)) : null;
  const displayName = normalizeDisplayName(input.from?.name);
  const trustedAuthorities = new Set((input.trustedAuthorities ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
  const knownSenderDomains = new Set(
    (input.knownSenderDomains ?? []).map((value) => normalizeDomain(value)).filter((value): value is string => Boolean(value)),
  );

  const assertions: SenderAuthenticationAssertion[] = [];
  const signingDomains = new Set<string>();
  for (const header of input.headers.slice(0, maxHeadersScanned)) {
    const key = header.key?.trim().toLowerCase() ?? "";
    const value = typeof header.value === "string" ? header.value.slice(0, maxHeaderValueChars) : "";
    if (!value) continue;
    if (key === "dkim-signature") {
      if (signingDomains.size < maxSigningDomains) {
        const domain = normalizeDomain(readTagValue(value, "d"));
        if (domain) signingDomains.add(domain);
      }
      continue;
    }
    if (key !== "authentication-results" && key !== "arc-authentication-results") continue;
    if (assertions.length >= maxAssertions) continue;
    const assertion = parseAuthenticationResults(value, key === "arc-authentication-results" ? "ARC" : "AUTHENTICATION_RESULTS");
    if (assertion) assertions.push(assertion);
  }

  const reasons: string[] = [];
  if (!fromDomain) {
    reasons.push("No usable sender domain was present on the forwarded message.");
    return {
      tier: "UNVERIFIED_SENDER",
      fromAddress,
      fromDomain: null,
      displayName,
      assertions,
      signingDomains: [...signingDomains],
      trustedAuthority: null,
      reasons,
    };
  }

  const trusted = assertions.filter(
    (assertion) => assertion.chain === "AUTHENTICATION_RESULTS" && trustedAuthorities.has(assertion.authority),
  );
  const trustedAuthority = trusted[0]?.authority ?? null;
  for (const assertion of assertions) {
    if (assertion.chain === "ARC") {
      reasons.push(`${safe(assertion.authority)} relayed an ARC assertion, which is recorded but never treated as proof.`);
    } else if (!trustedAuthorities.has(assertion.authority)) {
      reasons.push(`${safe(assertion.authority)} asserted authentication results, but this deployment does not trust that authority.`);
    }
  }

  const spoofedDisplayDomain = displayNameImpersonationDomain(displayName, fromDomain);
  if (spoofedDisplayDomain) {
    reasons.push(`The display name presents ${safe(spoofedDisplayDomain)} while the message was sent from ${safe(fromDomain)}.`);
    return finish("SUSPICIOUS_SENDER");
  }

  // Every trusted hop is checked for contradiction before any of them is
  // allowed to verify, so a later failure can never be masked by an earlier pass.
  for (const assertion of trusted) {
    if (assertion.dmarc === "fail" || assertion.dkim === "fail" || assertion.spf === "fail") {
      const failed = [
        assertion.dmarc === "fail" ? "DMARC" : null,
        assertion.dkim === "fail" ? "DKIM" : null,
        assertion.spf === "fail" ? "SPF" : null,
      ].filter(Boolean).join(", ");
      reasons.push(`${safe(assertion.authority)} reported ${failed} failure for ${safe(fromDomain)}.`);
      return finish("SUSPICIOUS_SENDER");
    }
    if (assertion.dkim === "pass" && !assertion.dkimDomains.some((domain) => domainsAlign(domain, fromDomain))) {
      reasons.push(
        `${safe(assertion.authority)} reported a DKIM pass signed by a domain that does not align with ${safe(fromDomain)}.`,
      );
      return finish("SUSPICIOUS_SENDER");
    }
    if (assertion.dmarc === "pass" && assertion.dmarcDomain && !domainsAlign(assertion.dmarcDomain, fromDomain)) {
      reasons.push(
        `${safe(assertion.authority)} evaluated DMARC for ${safe(assertion.dmarcDomain)}, which does not align with ${safe(fromDomain)}.`,
      );
      return finish("SUSPICIOUS_SENDER");
    }
  }

  const verifying = trusted.find((assertion) => assertion.dmarc === "pass"
    && assertion.dkim === "pass"
    && assertion.dkimDomains.some((domain) => domainsAlign(domain, fromDomain)));
  if (verifying) {
    reasons.push(
      `${safe(verifying.authority)} reported an aligned DKIM pass and DMARC pass for ${safe(fromDomain)}. `
      + "That is the mail provider's verdict, not proof that the merchant authorised this charge.",
    );
    return finish("VERIFIED_SENDER");
  }

  if (knownSenderDomains.has(fromDomain)) {
    reasons.push(`${safe(fromDomain)} has produced accepted evidence in this workspace before.`);
    return finish("KNOWN_SENDER");
  }
  const alignedSigningDomain = [...signingDomains].find((domain) => domainsAlign(domain, fromDomain));
  if (alignedSigningDomain) {
    reasons.push(
      `The message carries a DKIM signature from ${safe(alignedSigningDomain)}. The signature is present but not verified here.`,
    );
    return finish("KNOWN_SENDER");
  }

  reasons.push(`Nothing establishes ${safe(fromDomain)} as the sender beyond the forwarded message itself.`);
  return finish("UNVERIFIED_SENDER");

  function finish(tier: SenderTrustTier): SenderProvenance {
    return {
      tier,
      fromAddress,
      fromDomain,
      displayName,
      assertions,
      signingDomains: [...signingDomains],
      trustedAuthority,
      reasons,
    };
  }
}

function parseAuthenticationResults(value: string, chain: SenderAuthenticationAssertion["chain"]) {
  const segments = splitTopLevel(value);
  if (!segments.length) return null;
  let cursor = 0;
  // RFC 8617 prefixes the relayed results with the ARC instance number.
  if (chain === "ARC" && /^\s*i\s*=\s*\d+\s*$/.test(segments[0] ?? "")) cursor = 1;
  const authorityToken = stripComments(segments[cursor] ?? "").trim().split(/\s+/)[0] ?? "";
  if (!authorityToken) return null;

  const assertion: SenderAuthenticationAssertion = {
    chain,
    authority: authorityToken.toLowerCase().slice(0, maxDomainChars),
    spf: null,
    dkim: null,
    dmarc: null,
    dkimDomains: [],
    dmarcDomain: null,
  };
  const dkimDomains: string[] = [];

  for (const segment of segments.slice(cursor + 1)) {
    const tokens = stripComments(segment).trim().split(/\s+/).filter(Boolean);
    const [methodSpec, ...properties] = tokens;
    if (!methodSpec) continue;
    const separator = methodSpec.indexOf("=");
    if (separator <= 0) continue;
    // A method may carry an RFC 8601 method-version, e.g. `dkim/1=pass`.
    const method = methodSpec.slice(0, separator).trim().toLowerCase().split("/")[0];
    const result = authenticationResults[methodSpec.slice(separator + 1).trim().toLowerCase()];
    if (!result) continue;

    if (method === "spf") assertion.spf = strongerResult(assertion.spf, result);
    if (method === "dmarc") {
      assertion.dmarc = strongerResult(assertion.dmarc, result);
      const domain = normalizeDomain(readProperty(properties, "header.from"));
      if (domain) assertion.dmarcDomain = domain;
    }
    if (method === "dkim") {
      assertion.dkim = strongerResult(assertion.dkim, result);
      if (result !== "pass") continue;
      const domain = normalizeDomain(readProperty(properties, "header.d"))
        ?? normalizeDomain(addressDomain(readProperty(properties, "header.i")));
      if (domain && dkimDomains.length < maxDomainsPerAssertion && !dkimDomains.includes(domain)) dkimDomains.push(domain);
    }
  }

  return { ...assertion, dkimDomains };
}

/** A hop may report several DKIM signatures; a failure must never be hidden by a later pass. */
function strongerResult(current: SenderAuthenticationResult | null, next: SenderAuthenticationResult) {
  if (current === "fail" || next === "fail") return "fail";
  return current === "pass" ? current : next;
}

function readProperty(properties: readonly string[], name: string) {
  for (const property of properties) {
    const separator = property.indexOf("=");
    if (separator <= 0) continue;
    if (property.slice(0, separator).trim().toLowerCase() !== name) continue;
    return unquote(property.slice(separator + 1).trim());
  }
  return null;
}

function readTagValue(value: string, tag: string) {
  for (const segment of splitTopLevel(value)) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    if (segment.slice(0, separator).trim().toLowerCase() !== tag) continue;
    return segment.slice(separator + 1).replace(/\s+/g, "");
  }
  return null;
}

function splitTopLevel(value: string) {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === "\\") {
        current += character + (value[index + 1] ?? "");
        index += 1;
        continue;
      }
      if (character === "\"") quoted = false;
      current += character;
      continue;
    }
    if (character === "\"") {
      quoted = true;
      current += character;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === ";" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

function stripComments(value: string) {
  let result = "";
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === "\\") {
        result += character + (value[index + 1] ?? "");
        index += 1;
        continue;
      }
      if (character === "\"") quoted = false;
      result += character;
      continue;
    }
    if (character === "\"" && depth === 0) {
      quoted = true;
      result += character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      result += " ";
      continue;
    }
    if (depth === 0) result += character;
  }
  return result;
}

function unquote(value: string) {
  return value.startsWith("\"") && value.endsWith("\"") && value.length >= 2 ? value.slice(1, -1) : value;
}

function addressDomain(value: string | null) {
  if (!value) return null;
  const separator = value.lastIndexOf("@");
  return separator >= 0 ? value.slice(separator + 1) : value;
}

function normalizeAddress(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized || normalized.length > 320 || /[\s<>,;"]/.test(normalized)) return null;
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || separator === normalized.length - 1) return null;
  return normalizeDomain(normalized.slice(separator + 1)) ? normalized : null;
}

function normalizeDisplayName(value: string | null | undefined) {
  const normalized = (value ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 240) : null;
}

function normalizeDomain(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  if (!normalized || normalized.length > maxDomainChars) return null;
  const labels = normalized.split(".");
  if (labels.length < 2) return null;
  if (labels.some((label) => !new RegExp(`^[a-z0-9](?:[a-z0-9-]{0,${maxLabelChars - 2}}[a-z0-9])?$`).test(label))) return null;
  // A registry-shaped final label keeps ordinary prose such as "24.7" or "Ltd." out of the domain space.
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return null;
  return normalized;
}

/**
 * Conservative organisational alignment: an exact match, or one domain sitting
 * under the other at a label boundary. No public-suffix guessing, so a
 * lookalike such as `netflix.com.evil.tld` never aligns with `netflix.com`.
 */
function domainsAlign(left: string, right: string) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

/**
 * Only a full email address embedded in the display name is treated as
 * impersonation. Bare brand or domain mentions are too common in legitimate
 * display names to carry a penalty.
 */
function displayNameImpersonationDomain(displayName: string | null, fromDomain: string) {
  if (!displayName) return null;
  for (const match of displayName.matchAll(/[^\s<>()@,;:"]+@([a-z0-9.-]+)/gi)) {
    const domain = normalizeDomain(match[1]);
    if (domain && !domainsAlign(domain, fromDomain)) return domain;
  }
  return null;
}

function safe(value: string) {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 253);
}
