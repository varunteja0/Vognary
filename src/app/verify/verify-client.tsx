"use client";

import { useState } from "react";
import {
  verifyAuditPack,
  type PackIssuerSignatureStatus,
  type PackVerification,
} from "@/lib/audit-pack";

type SigningKeysResponse = {
  keys?: Array<{ keyId?: string; publicKeySpki?: string }>;
};

const signatureLabels: Record<PackIssuerSignatureStatus, { label: string; className: string }> = {
  "not-present": { label: "Self-checksum only", className: "pill pill-partial" },
  valid: { label: "Vognary signature valid", className: "pill pill-ready" },
  invalid: { label: "Vognary signature invalid", className: "pill pill-blocked" },
  "unknown-key": { label: "Signing key untrusted", className: "pill pill-partial" },
  "verification-unavailable": { label: "Signature not verified", className: "pill pill-partial" },
};

export default function VerifyClient() {
  const [packText, setPackText] = useState("");
  const [result, setResult] = useState<PackVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function verifyText(text: string) {
    setChecking(true);
    setError(null);
    setResult(null);

    try {
      const parsed = JSON.parse(text);
      const trustedIssuerKeys = await loadTrustedIssuerKeys();
      setResult(await verifyAuditPack(parsed, { trustedIssuerKeys }));
    } catch (caught) {
      setError(caught instanceof SyntaxError ? "That is not valid JSON. Paste the complete audit pack file." : caught instanceof Error ? caught.message : "Could not verify this pack.");
    } finally {
      setChecking(false);
    }
  }

  async function onFileSelected(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setPackText(text);
    await verifyText(text);
  }

  return (
    <div className="mt-6">
      <label className="block">
        <span className="field-label">Audit pack JSON</span>
        <textarea
          value={packText}
          onChange={(event) => setPackText(event.target.value)}
          className="field min-h-40 font-data text-xs"
          placeholder='Paste the full contents of a vognary-audit-pack JSON file, or choose the file below.'
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => verifyText(packText)}
          disabled={!packText.trim() || checking}
          className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {checking ? "Verifying…" : "Verify pack"}
        </button>
        <label className="btn btn-ghost cursor-pointer">
          Choose file
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void onFileSelected(file);
            }}
          />
        </label>
      </div>

      {error ? (
        <p role="status" className="mt-4 rounded-md border border-ember bg-(--ember-tint) px-3 py-2 text-sm text-ember">{error}</p>
      ) : null}

      {result ? (
        <div
          role="status"
          className={`mt-4 rounded-xl border p-4 ${result.checksumValid && result.issuerSignature.status === "valid" ? "border-verdict bg-(--verdict-tint)" : !result.checksumValid || result.issuerSignature.status === "invalid" ? "border-ember bg-(--ember-tint)" : "border-(--line) bg-white/2"}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={result.checksumValid ? "pill pill-ready" : "pill pill-blocked"}>
              {result.checksumValid ? "Self-checksum intact" : "Self-checksum broken"}
            </span>
            <span className={signatureLabels[result.issuerSignature.status].className}>
              {signatureLabels[result.issuerSignature.status].label}
            </span>
            {result.integrity ? (
              <span className="font-data text-xs text-(--muted)">
                Export #{result.integrity.chainIndex} · checksummed {result.integrity.sealedAt?.slice(0, 10) ?? "unknown"}
              </span>
            ) : null}
          </div>
          <ul className="mt-3 grid gap-1 text-sm leading-6 text-(--ink-soft)">
            {result.reasons.map((reason) => <li key={reason}>— {reason}</li>)}
          </ul>
          {result.contentHash ? (
            <p className="mt-3 break-all font-data text-xs text-(--muted)">Content hash: {result.contentHash}</p>
          ) : null}
          {result.integrity?.prevHash ? (
            <p className="mt-1 break-all font-data text-xs text-(--muted)">Self-declared previous export hash: {result.integrity.prevHash}</p>
          ) : result.integrity ? (
            <p className="mt-1 font-data text-xs text-(--muted)">Claims to be the first export in this workspace&apos;s local chain.</p>
          ) : null}
          {result.issuerSignature.keyId ? (
            <p className="mt-1 break-all font-data text-xs text-(--muted)">
              Issuer key: {result.issuerSignature.keyId} · issued {result.issuerSignature.issuedAt?.slice(0, 10) ?? "unknown"}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

async function loadTrustedIssuerKeys(): Promise<Record<string, string>> {
  try {
    const response = await fetch("/api/audit-packs/sign", { cache: "no-store" });
    if (!response.ok) return {};
    const payload = await response.json() as SigningKeysResponse;
    const entries = (payload.keys ?? [])
      .filter((key): key is { keyId: string; publicKeySpki: string } =>
        typeof key.keyId === "string" && typeof key.publicKeySpki === "string")
      .map((key) => [key.keyId, key.publicKeySpki] as const);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}
