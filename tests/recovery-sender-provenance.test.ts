import assert from "node:assert/strict";
import test from "node:test";

import { extractForwardedReceiptTexts } from "../src/lib/recovery/inbound-email";
import { getReceiptInboxTrustedAuthorities } from "../src/lib/server/receipt-inbox-sender-trust";
import {
  assessSenderProvenance,
  senderTrustConfidenceCeiling,
  senderTrustTiers,
} from "../src/lib/recovery/sender-provenance";

const gmailAuthority = "mx.google.com";

function headers(...entries: readonly [string, string][]) {
  return entries.map(([key, value]) => ({ key, value }));
}

function netflixGmailAssertion(overrides: { dkim?: string; dmarc?: string; spf?: string } = {}) {
  return [
    `${gmailAuthority};`,
    `       dkim=${overrides.dkim ?? "pass"} header.i=@netflix.com header.s=s1 header.b=Ab1Cd2;`,
    `       spf=${overrides.spf ?? "pass"} (google.com: domain of bounce@netflix.com designates 2.2.2.2 as permitted sender; ok) smtp.mailfrom=bounce@netflix.com;`,
    `       dmarc=${overrides.dmarc ?? "pass"} (p=REJECT sp=REJECT dis=NONE) header.from=netflix.com`,
  ].join("\n");
}

test("every sender trust tier is exhaustive and ordered from strongest to weakest", () => {
  assert.deepEqual(senderTrustTiers, [
    "VERIFIED_SENDER",
    "KNOWN_SENDER",
    "UNVERIFIED_SENDER",
    "SUSPICIOUS_SENDER",
  ]);
});

test("a trusted authority asserting aligned DKIM and DMARC pass yields VERIFIED_SENDER", () => {
  const provenance = assessSenderProvenance({
    headers: headers(["Authentication-Results", netflixGmailAssertion()]),
    from: { address: "info@netflix.com", name: "Netflix" },
    trustedAuthorities: [gmailAuthority],
  });

  assert.equal(provenance.tier, "VERIFIED_SENDER");
  assert.equal(provenance.fromDomain, "netflix.com");
  assert.equal(provenance.trustedAuthority, gmailAuthority);
  assert.equal(provenance.assertions.length, 1);
  assert.deepEqual(provenance.assertions[0].dkimDomains, ["netflix.com"]);
  assert.equal(provenance.assertions[0].dmarc, "pass");
  assert.equal(provenance.assertions[0].spf, "pass");
  // The claim is always attributed to the asserting authority, never to Vognary.
  assert.ok(provenance.reasons.some((reason) => reason.includes(gmailAuthority)));
});

test("the same assertion from an authority this deployment does not trust never verifies", () => {
  const provenance = assessSenderProvenance({
    headers: headers(["Authentication-Results", netflixGmailAssertion()]),
    from: { address: "info@netflix.com", name: "Netflix" },
    trustedAuthorities: [],
  });

  assert.notEqual(provenance.tier, "VERIFIED_SENDER");
  assert.equal(provenance.trustedAuthority, null);
  // The metadata is still preserved even though it carries no authority.
  assert.equal(provenance.assertions.length, 1);
  assert.equal(provenance.assertions[0].authority, gmailAuthority);
});

test("a trusted DMARC failure is SUSPICIOUS_SENDER even when DKIM passes", () => {
  const provenance = assessSenderProvenance({
    headers: headers(["Authentication-Results", netflixGmailAssertion({ dmarc: "fail" })]),
    from: { address: "info@netflix.com", name: "Netflix" },
    trustedAuthorities: [gmailAuthority],
  });

  assert.equal(provenance.tier, "SUSPICIOUS_SENDER");
});

test("a trusted DKIM pass for an unaligned domain is SUSPICIOUS_SENDER", () => {
  const provenance = assessSenderProvenance({
    headers: headers([
      "Authentication-Results",
      `${gmailAuthority}; dkim=pass header.i=@mailer.evil.tld; dmarc=pass header.from=netflix.com`,
    ]),
    from: { address: "billing@netflix.com", name: "Netflix" },
    trustedAuthorities: [gmailAuthority],
  });

  assert.equal(provenance.tier, "SUSPICIOUS_SENDER");
});

test("DKIM alignment accepts organizational subdomains in either direction but never a suffix lookalike", () => {
  const subdomainSigner = assessSenderProvenance({
    headers: headers([
      "Authentication-Results",
      `${gmailAuthority}; dkim=pass header.i=@email.netflix.com; dmarc=pass header.from=netflix.com`,
    ]),
    from: { address: "billing@netflix.com" },
    trustedAuthorities: [gmailAuthority],
  });
  assert.equal(subdomainSigner.tier, "VERIFIED_SENDER");

  const subdomainSender = assessSenderProvenance({
    headers: headers([
      "Authentication-Results",
      `${gmailAuthority}; dkim=pass header.i=@netflix.com; dmarc=pass header.from=billing.netflix.com`,
    ]),
    from: { address: "no-reply@billing.netflix.com" },
    trustedAuthorities: [gmailAuthority],
  });
  assert.equal(subdomainSender.tier, "VERIFIED_SENDER");

  const lookalike = assessSenderProvenance({
    headers: headers([
      "Authentication-Results",
      `${gmailAuthority}; dkim=pass header.i=@netflix.com; dmarc=pass header.from=netflix.com.evil.tld`,
    ]),
    from: { address: "billing@netflix.com.evil.tld" },
    trustedAuthorities: [gmailAuthority],
  });
  assert.equal(lookalike.tier, "SUSPICIOUS_SENDER");
});

test("a display name that embeds a different domain is SUSPICIOUS_SENDER", () => {
  const provenance = assessSenderProvenance({
    headers: [],
    from: { address: "payments@evil.tld", name: "billing@netflix.com" },
    trustedAuthorities: [gmailAuthority],
  });

  assert.equal(provenance.tier, "SUSPICIOUS_SENDER");
  assert.equal(provenance.displayName, "billing@netflix.com");
});

test("a display name that repeats its own sending domain is not suspicious", () => {
  const provenance = assessSenderProvenance({
    headers: [],
    from: { address: "billing@netflix.com", name: "Netflix (billing@netflix.com)" },
    knownSenderDomains: ["netflix.com"],
  });

  assert.equal(provenance.tier, "KNOWN_SENDER");
});

test("a repeat sender domain with no usable assertion is KNOWN_SENDER, never verified", () => {
  const provenance = assessSenderProvenance({
    headers: [],
    from: { address: "receipts@spotify.com", name: "Spotify" },
    knownSenderDomains: ["spotify.com"],
  });

  assert.equal(provenance.tier, "KNOWN_SENDER");
  assert.equal(provenance.trustedAuthority, null);
});

test("an unsigned first-contact sender is UNVERIFIED_SENDER", () => {
  const provenance = assessSenderProvenance({
    headers: [],
    from: { address: "receipts@unknown-merchant.tld" },
  });

  assert.equal(provenance.tier, "UNVERIFIED_SENDER");
  assert.equal(provenance.signingDomains.length, 0);
});

test("a bare DKIM-Signature is structural evidence only and can never exceed KNOWN_SENDER", () => {
  const provenance = assessSenderProvenance({
    headers: headers([
      "DKIM-Signature",
      "v=1; a=rsa-sha256; c=relaxed/relaxed; d=netflix.com; s=s1; h=from:to:subject; b=Zm9v",
    ]),
    from: { address: "info@netflix.com" },
    trustedAuthorities: [gmailAuthority],
  });

  assert.equal(provenance.tier, "KNOWN_SENDER");
  assert.deepEqual(provenance.signingDomains, ["netflix.com"]);
  assert.ok(provenance.reasons.some((reason) => /not verified/i.test(reason)));
});

test("a DKIM-Signature for an unaligned domain does not raise trust on its own", () => {
  const provenance = assessSenderProvenance({
    headers: headers([
      "DKIM-Signature",
      "v=1; a=rsa-sha256; d=mailer.evil.tld; s=s1; b=Zm9v",
    ]),
    from: { address: "info@netflix.com" },
  });

  assert.equal(provenance.tier, "UNVERIFIED_SENDER");
  assert.deepEqual(provenance.signingDomains, ["mailer.evil.tld"]);
});

test("ARC assertions are preserved but never grant verification", () => {
  const provenance = assessSenderProvenance({
    headers: headers([
      "ARC-Authentication-Results",
      `i=1; ${gmailAuthority}; dkim=pass header.i=@netflix.com; dmarc=pass header.from=netflix.com`,
    ]),
    from: { address: "info@netflix.com" },
    trustedAuthorities: [gmailAuthority],
  });

  assert.notEqual(provenance.tier, "VERIFIED_SENDER");
  assert.equal(provenance.assertions.length, 1);
  assert.equal(provenance.assertions[0].chain, "ARC");
});

test("Authentication-Results comments containing semicolons do not split method specs", () => {
  const provenance = assessSenderProvenance({
    headers: headers([
      "Authentication-Results",
      `${gmailAuthority}; spf=pass (google.com: domain of a@b.tld designates 1.1.1.1; permitted) smtp.mailfrom=a@b.tld; dkim=pass header.i=@netflix.com; dmarc=pass header.from=netflix.com`,
    ]),
    from: { address: "info@netflix.com" },
    trustedAuthorities: [gmailAuthority],
  });

  assert.equal(provenance.tier, "VERIFIED_SENDER");
  assert.equal(provenance.assertions[0].spf, "pass");
  assert.equal(provenance.assertions[0].dkim, "pass");
  assert.equal(provenance.assertions[0].dmarc, "pass");
});

test("an authserv-id carrying an RFC 8601 version token still matches the trusted authority", () => {
  const provenance = assessSenderProvenance({
    headers: headers([
      "Authentication-Results",
      `${gmailAuthority} 1; dkim=pass header.i=@netflix.com; dmarc=pass header.from=netflix.com`,
    ]),
    from: { address: "info@netflix.com" },
    trustedAuthorities: [gmailAuthority],
  });

  assert.equal(provenance.tier, "VERIFIED_SENDER");
  assert.equal(provenance.assertions[0].authority, gmailAuthority);
});

test("only the trusted authority decides the tier when several hops disagree", () => {
  const provenance = assessSenderProvenance({
    headers: headers(
      ["Authentication-Results", "relay.attacker.tld; dkim=pass header.i=@netflix.com; dmarc=pass header.from=netflix.com"],
      ["Authentication-Results", `${gmailAuthority}; dkim=fail header.i=@netflix.com; dmarc=fail header.from=netflix.com`],
    ),
    from: { address: "info@netflix.com" },
    trustedAuthorities: [gmailAuthority],
  });

  assert.equal(provenance.tier, "SUSPICIOUS_SENDER");
  assert.equal(provenance.assertions.length, 2);
});

test("a later trusted failure is never masked by an earlier trusted pass", () => {
  const provenance = assessSenderProvenance({
    headers: headers(
      ["Authentication-Results", `${gmailAuthority}; dkim=pass header.i=@netflix.com; dmarc=pass header.from=netflix.com`],
      ["Authentication-Results", `${gmailAuthority}; dmarc=fail header.from=netflix.com`],
    ),
    from: { address: "info@netflix.com" },
    trustedAuthorities: [gmailAuthority],
  });

  assert.equal(provenance.tier, "SUSPICIOUS_SENDER");
});

test("a missing or unparseable sender address is UNVERIFIED_SENDER and never throws", () => {
  for (const from of [null, undefined, {}, { address: "" }, { address: "not-an-address" }] as const) {
    const provenance = assessSenderProvenance({ headers: [], from });
    assert.equal(provenance.tier, "UNVERIFIED_SENDER");
    assert.equal(provenance.fromDomain, null);
  }
});

test("assessment is bounded so a hostile header cannot exhaust memory or leak newlines", () => {
  const provenance = assessSenderProvenance({
    headers: Array.from({ length: 500 }, () => ({
      key: "Authentication-Results",
      value: `${"a".repeat(20_000)}; dkim=pass header.i=@${"b".repeat(5_000)}.tld`,
    })),
    from: { address: `x@${"c".repeat(5_000)}.tld` },
  });

  assert.ok(provenance.assertions.length <= 12);
  assert.ok((provenance.fromDomain?.length ?? 0) <= 253);
  for (const assertion of provenance.assertions) {
    assert.ok(assertion.authority.length <= 253);
    for (const domain of assertion.dkimDomains) assert.ok(domain.length <= 253);
  }
  for (const reason of provenance.reasons) assert.doesNotMatch(reason, /[\r\n]/);
});

test("evidence trust ceilings keep untrusted transport from asserting a trusted claim", () => {
  const ceilings = senderTrustTiers.map((tier) => senderTrustConfidenceCeiling(tier));
  assert.deepEqual(ceilings, [100, 80, 60, 40]);
});

test("an unconfigured deployment trusts no authority, so nothing can reach VERIFIED_SENDER", () => {
  const restore = setTrustedAuthorityEnvironment(undefined);
  try {
    assert.deepEqual(getReceiptInboxTrustedAuthorities(), []);
  } finally {
    restore();
  }
});

test("configured authorities are normalised, de-duplicated, bounded, and reject malformed entries", () => {
  const restore = setTrustedAuthorityEnvironment(
    ` MX.Google.com , mx.google.com ,, mx protocol.tld , https://evil.tld , ${"a".repeat(300)} , mx.zoho.com `,
  );
  try {
    assert.deepEqual(getReceiptInboxTrustedAuthorities(), ["mx.google.com", "mx.zoho.com"]);
  } finally {
    restore();
  }
});

test("each forwarded message carries the provenance of the headers it came from", async () => {
  const merchantMessage = [
    "From: Netflix <info@netflix.com>",
    "To: founder@example.test",
    "Subject: Your Netflix receipt",
    `Authentication-Results: ${gmailAuthority}; dkim=pass header.i=@netflix.com; spf=pass smtp.mailfrom=bounce@netflix.com; dmarc=pass header.from=netflix.com`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Netflix charged INR 649 on 6 July 2026. Renews monthly on 6 August 2026.",
  ].join("\r\n");
  const forwarded = [
    "From: founder@example.test",
    "To: rcpt_example@receipts.vognary.test",
    "Subject: receipts",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=outer",
    "",
    "--outer",
    "Content-Type: message/rfc822",
    "Content-Disposition: attachment; filename=netflix.eml",
    "",
    merchantMessage,
    "--outer--",
    "",
  ].join("\r\n");

  const { texts } = await extractForwardedReceiptTexts(forwarded, { trustedAuthorities: [gmailAuthority] });
  const receipt = texts.find((item) => /Netflix charged INR 649/.test(item.text));
  assert.ok(receipt, "the nested merchant receipt should be extracted");
  assert.equal(receipt.provenance.tier, "VERIFIED_SENDER");
  assert.equal(receipt.provenance.fromDomain, "netflix.com");
  assert.equal(receipt.provenance.trustedAuthority, gmailAuthority);

  // The forwarding wrapper itself is a different message and carries no merchant claim.
  const wrapper = texts.find((item) => item !== receipt);
  if (wrapper) assert.notEqual(wrapper.provenance.tier, "VERIFIED_SENDER");
});

test("the same forward reaches only KNOWN_SENDER when no authority is trusted", async () => {
  const merchantMessage = [
    "From: Netflix <info@netflix.com>",
    "To: founder@example.test",
    `Authentication-Results: ${gmailAuthority}; dkim=pass header.i=@netflix.com; dmarc=pass header.from=netflix.com`,
    "DKIM-Signature: v=1; a=rsa-sha256; d=netflix.com; s=s1; b=Zm9v",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Netflix charged INR 649 on 6 July 2026. Renews monthly on 6 August 2026.",
  ].join("\r\n");

  const { texts } = await extractForwardedReceiptTexts(merchantMessage, { trustedAuthorities: [] });
  const receipt = texts.find((item) => /Netflix charged INR 649/.test(item.text));
  assert.ok(receipt);
  assert.equal(receipt.provenance.tier, "KNOWN_SENDER");
});

function setTrustedAuthorityEnvironment(value: string | undefined) {
  const previous = process.env.RECEIPT_INBOX_TRUSTED_AUTH_AUTHORITIES;
  if (value === undefined) delete process.env.RECEIPT_INBOX_TRUSTED_AUTH_AUTHORITIES;
  else process.env.RECEIPT_INBOX_TRUSTED_AUTH_AUTHORITIES = value;
  return () => {
    if (previous === undefined) delete process.env.RECEIPT_INBOX_TRUSTED_AUTH_AUTHORITIES;
    else process.env.RECEIPT_INBOX_TRUSTED_AUTH_AUTHORITIES = previous;
  };
}
