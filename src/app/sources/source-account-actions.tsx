"use client";

import { useState } from "react";

type AccountActionProps = {
  account: { id: string; connectorId: string; displayName: string; status: string };
  retry: boolean;
};

type ActionState = "idle" | "syncing" | "confirming" | "disconnecting";

export default function SourceAccountActions({ account, retry }: AccountActionProps) {
  const [action, setAction] = useState<ActionState>("idle");
  const [notice, setNotice] = useState<{ tone: "info" | "error" | "success"; text: string } | null>(null);

  async function syncNow() {
    setAction("syncing");
    setNotice({ tone: "info", text: retry ? "Retrying source sync…" : "Refreshing source evidence…" });
    try {
      const response = await fetch(`/api/workspaces/current/connectors/${account.id}/sync`, { method: "POST" });
      const payload = await readJson(response);
      if (!response.ok) {
        setNotice({ tone: "error", text: readMessage(payload, response.status === 409 ? "Reconnect this source before retrying sync." : "Source sync failed. Try again.") });
        return;
      }
      const result = readRecord(payload.result);
      if (payload.status !== "synced" || result?.status === "skipped") {
        setNotice({ tone: "error", text: readMessage(payload, "No source sync ran. Refresh the source status before retrying.") });
        return;
      }
      const written = readEvidenceCount(payload);
      const message = `Sync finished${written === null ? "." : ` with ${written} evidence signal${written === 1 ? "" : "s"} written.`}`;
      announceChange(message, "success");
    } catch {
      setNotice({ tone: "error", text: "Could not reach the sync service. The existing source remains connected." });
    } finally {
      setAction("idle");
    }
  }

  async function disconnect() {
    setAction("disconnecting");
    setNotice({ tone: "info", text: "Removing local credentials and stopping scheduled sync…" });
    try {
      const response = await fetch(`/api/workspaces/current/connectors/${account.id}`, { method: "DELETE" });
      const payload = await readJson(response);
      if (!response.ok) {
        setNotice({ tone: "error", text: readMessage(payload, "This source could not be disconnected.") });
        return;
      }
      const provider = readRecord(payload.providerRevocation);
      const remoteMayRemain = provider?.remoteCredentialMayRemainActive === true;
      const message = remoteMayRemain
        ? "Local credentials were deleted and sync stopped. The provider could not confirm remote revocation; revoke or rotate access in the provider account."
        : "Local credentials were deleted, scheduled sync stopped, and provider revocation was completed or was not required.";
      announceChange(message, remoteMayRemain ? "warning" : "success");
    } catch {
      setNotice({ tone: "error", text: "Could not reach the disconnect service. No local deletion is being claimed." });
    } finally {
      setAction("idle");
    }
  }

  if (action === "confirming") {
    return (
      <div className="mt-4 rounded-[10px] border border-ember/30 bg-(--ember-tint) p-3">
        <p className="text-sm font-semibold text-(--ink)">Disconnect {account.displayName}?</p>
        <p className="mt-1 text-xs leading-5 text-(--muted)">This deletes Vognary&apos;s encrypted local credentials and stops scheduled sync. Provider revocation is attempted first; API keys may still need rotation in the provider account.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm btn-ember" onClick={() => void disconnect()}>Disconnect and delete</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAction("idle")}>Keep connected</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void syncNow()} disabled={action !== "idle" || account.status === "needs_reauth"}>{action === "syncing" ? "Syncing…" : retry ? "Retry sync" : "Sync now"}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAction("confirming")} disabled={action !== "idle"}>Disconnect</button>
      </div>
      {account.status === "needs_reauth" ? <a href="#add-source" className="mt-3 inline-flex text-sm font-semibold text-indigo">Reconnect this source</a> : null}
      {notice ? <p role={notice.tone === "error" ? "alert" : "status"} aria-live="polite" className={`mt-3 rounded-md border px-3 py-2 text-xs leading-5 ${noticeClass(notice.tone)}`}>{notice.text}</p> : null}
    </div>
  );
}

function announceChange(message: string, tone: "success" | "warning") {
  window.dispatchEvent(new CustomEvent("vognary:sources-changed", { detail: { message, tone } }));
}

function readEvidenceCount(payload: Record<string, unknown>) {
  const result = readRecord(payload.result);
  return typeof result?.evidenceWritten === "number" ? result.evidenceWritten : null;
}

function readMessage(payload: Record<string, unknown>, fallback: string) {
  const result = readRecord(payload.result);
  for (const value of [result?.error, payload.message, payload.error]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try { return await response.json() as Record<string, unknown>; } catch { return {}; }
}

function noticeClass(tone: "info" | "error" | "success") {
  if (tone === "error") return "border-ember/30 bg-(--ember-tint) text-ember";
  if (tone === "success") return "border-verdict/30 bg-(--verdict-tint) text-verdict";
  return "border-indigo/30 bg-(--indigo-tint) text-indigo";
}
