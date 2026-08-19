"use client";

import { useState } from "react";
import type { ReceiptInboxStatusDto } from "@/lib/recovery/contracts";
import {
  defaultGmailBillingFilterQuery,
  gmailAttachmentHelpUrl,
  gmailFilterHelpUrl,
  gmailForwardingHelpUrl,
  outlookForwardingHelpUrl,
} from "@/lib/recovery/billing-forwarding-rule";
import { GmailForwardingConfirmation } from "./recovery-gmail-confirmation";
import { WizardFrame } from "./ui/wizard";

export function ReceiptBillingSetup({
  receiptInbox,
  localStep,
  onAdvance,
}: {
  receiptInbox: ReceiptInboxStatusDto;
  localStep: 1 | 2 | 3;
  onAdvance: () => void;
}) {
  const [query, setQuery] = useState(defaultGmailBillingFilterQuery);
  const [copyStatus, setCopyStatus] = useState("");
  const address = receiptInbox.alias?.address ?? "";

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus("Address copied.");
    } catch {
      setCopyStatus("Could not copy automatically. Select the address and copy it.");
    }
  }

  async function copyQuery() {
    try {
      await navigator.clipboard.writeText(query);
      setCopyStatus("Search copied.");
    } catch {
      setCopyStatus("Could not copy automatically. Select the search and copy it.");
    }
  }

  if (localStep === 1) {
    return (
      <WizardFrame
        step={1}
        total={3}
        title="Verify your private Vognary address"
        actions={
          <>
            <button type="button" onClick={() => void copyAddress()} className="btn btn-primary">Copy address</button>
            <button type="button" onClick={onAdvance} className="btn btn-ghost">{"I've done this"}</button>
          </>
        }
      >
        <p>In Gmail on a computer: Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address. Paste this address.</p>
        <input className="field field-mono" value={address} readOnly aria-label="Private Vognary address" />
        <p className="font-medium text-(--ink)">Leave &quot;Forward a copy of incoming mail to&quot; off.</p>
        <a href={gmailForwardingHelpUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-(--accent-strong) underline underline-offset-4">
          {"Google's forwarding instructions"}
        </a>
        <p role="status" aria-live="polite" className="min-h-5 text-xs">{copyStatus}</p>
      </WizardFrame>
    );
  }

  if (localStep === 2) {
    return (
      <WizardFrame
        step={2}
        total={3}
        title="Confirm Google's request"
        actions={
          receiptInbox.gmailVerification ? null : (
            <button type="button" onClick={onAdvance} className="btn btn-ghost">{"I've confirmed it"}</button>
          )
        }
      >
        {receiptInbox.gmailVerification ? (
          <>
            <p>Gmail sent a confirmation request to your Vognary address. Confirm it before creating the filter.</p>
            <GmailForwardingConfirmation verification={receiptInbox.gmailVerification} />
          </>
        ) : (
          <p>{"We'll show Google's confirmation here when it arrives. You can keep this page open."}</p>
        )}
      </WizardFrame>
    );
  }

  return (
    <WizardFrame
      step={3}
      total={3}
      title="Create a billing-only filter"
      actions={
        <>
          <button type="button" onClick={() => void copyQuery()} className="btn btn-primary">Copy Gmail search</button>
          <button type="button" onClick={() => setQuery(defaultGmailBillingFilterQuery())} className="btn btn-ghost">Reset</button>
        </>
      }
    >
      <p>Keep global forwarding disabled. Paste this search in Gmail, review the results, then create a filter that forwards matching mail to your Vognary address.</p>
      <label htmlFor="gmail-billing-filter-query" className="field-label">Gmail search</label>
      <textarea
        id="gmail-billing-filter-query"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="field field-mono min-h-28 resize-y text-sm leading-6"
        spellCheck={false}
      />
      <p role="status" aria-live="polite" className="min-h-5 text-xs">{copyStatus}</p>
      <a href={gmailFilterHelpUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-(--accent-strong) underline underline-offset-4">
        {"Google's filter instructions"}
      </a>
    </WizardFrame>
  );
}

export function SourcesAdvancedHelp({ receiptInbox }: { receiptInbox: ReceiptInboxStatusDto }) {
  return (
    <div className="grid gap-4 text-sm leading-6 text-(--muted)">
      <div>
        <p className="font-medium text-(--ink)">Older bills</p>
        <p className="mt-1">
          Gmail cannot use this filter to import old mail. Select old software billing emails in batches of up to 20, choose More, Forward as attachment, and send them to your Vognary address.
        </p>
        <a href={gmailForwardingHelpUrl} target="_blank" rel="noreferrer noopener" className="mt-2 mr-3 inline-block font-medium text-(--accent-strong) underline underline-offset-4">
          {"Google's forwarding instructions"}
        </a>
        <a href={gmailFilterHelpUrl} target="_blank" rel="noreferrer noopener" className="mt-2 mr-3 inline-block font-medium text-(--accent-strong) underline underline-offset-4">
          {"Google's filter instructions"}
        </a>
        <a href={gmailAttachmentHelpUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block font-medium text-(--accent-strong) underline underline-offset-4">
          {"Google's attachment instructions"}
        </a>
      </div>
      <details>
        <summary className="cursor-pointer font-medium text-(--ink-soft)">Using Outlook?</summary>
        <p className="mt-2">
          Outlook can use a server-side rule that forwards messages whose subject includes receipt or invoice. Do not forward the whole mailbox. Vognary does not connect to Outlook.
        </p>
        <a href={outlookForwardingHelpUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block font-medium text-(--accent-strong) underline underline-offset-4">
          {"Microsoft's forwarding-rule instructions"}
        </a>
      </details>
      {receiptInbox.backfillCompletedAt ? <p>A historical batch was accepted.</p> : null}
    </div>
  );
}
