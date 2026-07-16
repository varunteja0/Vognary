"use client";

import { useMemo, useState } from "react";

export type SourceSetupOption = {
  id: string;
  name: string;
  authType: string;
  honestyLabel: string;
  honestyMeaning: string;
  evidenceBoundary: string;
  requirements: string[];
  accountLabel: string;
  accountRequired: boolean;
};

type Notice = { tone: "info" | "error" | "success"; text: string } | null;

export default function SourceSetupClient({ options }: { options: SourceSetupOption[] }) {
  const gmail = options.find((option) => option.id === "gmail-readonly");
  const apiKeyOptions = useMemo(() => options.filter((option) => option.authType === "api-key"), [options]);
  const [selectedId, setSelectedId] = useState(apiKeyOptions[0]?.id ?? "");
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState<"gmail" | "api-key" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const selected = apiKeyOptions.find((option) => option.id === selectedId);

  async function connectGmail() {
    setBusy("gmail");
    setNotice({ tone: "info", text: "Checking the Gmail connection path…" });
    try {
      const response = await fetch("/api/integrations/gmail/start?mode=json", { cache: "no-store" });
      const payload = await readJson(response);
      if (response.status === 401 || payload.status === "unauthenticated") {
        window.location.assign("/login?next=%2Fsources");
        return;
      }
      if (typeof payload.authUrl === "string" && payload.authUrl) {
        window.location.assign(payload.authUrl);
        return;
      }
      setNotice({ tone: "error", text: "Gmail authorization is not available in this deployment. No mailbox access was granted." });
    } catch {
      setNotice({ tone: "error", text: "Could not reach the Gmail authorization service. Try again later." });
    } finally {
      setBusy(null);
    }
  }

  async function connectApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !apiKey.trim()) return;
    if (selected.accountRequired && !accountId.trim()) {
      setNotice({ tone: "error", text: `${selected.accountLabel} is required for this source.` });
      return;
    }

    setBusy("api-key");
    setNotice({ tone: "info", text: `Authorizing ${selected.name} and running its first bounded sync…` });
    try {
      const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
      const sessionPayload = await readJson(sessionResponse);
      const session = readRecord(sessionPayload.session);
      const workspaceId = typeof session?.workspaceId === "string" ? session.workspaceId : null;
      if (!sessionPayload.authenticated || !workspaceId) {
        window.location.assign("/login?next=%2Fsources");
        return;
      }

      const response = await fetch(`/api/connectors/${selected.id}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          apiKey: apiKey.trim(),
          providerAccountId: accountId.trim() || undefined,
          displayName: `${selected.name} source`,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        setNotice({ tone: "error", text: readMessage(payload, `${selected.name} could not be connected. No successful setup is being claimed.`) });
        return;
      }
      const initialSync = readRecord(payload.initialSync);
      const succeeded = initialSync?.status === "succeeded";
      setAccountId("");
      setNotice({
        tone: succeeded ? "success" : "error",
        text: succeeded
          ? `${selected.name} is connected and its first sync completed.`
          : `${selected.name} is connected, but its first sync needs attention. Use Retry sync in the source card.`,
      });
      window.dispatchEvent(new Event("vognary:sources-changed"));
    } catch {
      setNotice({ tone: "error", text: "Could not reach the source setup service. No connection is being claimed." });
    } finally {
      setApiKey("");
      setBusy(null);
    }
  }

  return (
    <details id="add-source" className="panel mt-5 p-5 sm:p-6">
      <summary className="cursor-pointer font-display text-lg font-semibold text-(--ink)">Add or reconnect a source</summary>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-(--muted)">Connections are optional. Use one only when its stated evidence boundary is useful enough to reduce repeat uploads.</p>

      {gmail ? (
        <section className="inset mt-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-data text-[0.64rem] text-(--muted)">Receipt discovery</p>
              <h2 className="mt-1 font-display text-lg font-semibold text-(--ink)">{gmail.name}</h2>
            </div>
            <span className="pill pill-partial">{gmail.honestyLabel}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-(--muted)">{gmail.honestyMeaning}</p>
          <p className="mt-2 text-sm leading-6 text-(--muted)"><strong className="text-(--ink-soft)">Coverage boundary:</strong> {gmail.evidenceBoundary}</p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => void connectGmail()} disabled={busy !== null}>{busy === "gmail" ? "Checking availability…" : "Continue to Google"}</button>
        </section>
      ) : null}

      <details className="inset mt-4 p-4 sm:p-5">
        <summary className="cursor-pointer font-display text-base font-semibold text-(--ink)">Developer account sources</summary>
        <p className="mt-3 text-sm leading-6 text-(--muted)">For an account you administer, Vognary can store a scoped API key in its encrypted workspace vault. These sources do not imply consumer subscription or bank access.</p>
        <form onSubmit={connectApiKey} className="mt-4 grid gap-3">
          <label htmlFor="source-kind" className="field-label">Source</label>
          <select id="source-kind" className="field" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setAccountId(""); setNotice(null); }}>
            {apiKeyOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
          {selected ? (
            <>
              <div className="rounded-[10px] border border-line bg-(--card) p-3 text-xs leading-5 text-(--muted)">
                <p><strong className="text-(--ink-soft)">{selected.honestyLabel}:</strong> {selected.honestyMeaning}</p>
                <p className="mt-2"><strong className="text-(--ink-soft)">Coverage boundary:</strong> {selected.evidenceBoundary}</p>
                <p className="mt-2"><strong className="text-(--ink-soft)">Required provider access:</strong> {selected.requirements.join(" · ")}</p>
              </div>
              <label htmlFor="source-account" className="field-label">{selected.accountLabel}</label>
              <input id="source-account" className="field" value={accountId} onChange={(event) => setAccountId(event.target.value)} required={selected.accountRequired} autoComplete="off" spellCheck={false} />
              <label htmlFor="source-api-key" className="field-label">Scoped provider API key</label>
              <input id="source-api-key" type="password" className="field" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required autoComplete="new-password" spellCheck={false} />
            </>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={!selected || !apiKey.trim() || busy !== null}>{busy === "api-key" ? "Connecting and syncing…" : "Connect and test source"}</button>
        </form>
      </details>

      {notice ? <p role={notice.tone === "error" ? "alert" : "status"} aria-live="polite" className={`mt-4 rounded-md border px-3 py-2 text-sm ${noticeClass(notice.tone)}`}>{notice.text}</p> : null}
    </details>
  );
}

function readMessage(payload: Record<string, unknown>, fallback: string) {
  for (const value of [payload.message, payload.error]) {
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
