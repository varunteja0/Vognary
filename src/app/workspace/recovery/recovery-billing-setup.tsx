"use client";

import { useState } from "react";
import type { ReceiptInboxStatusDto } from "@/lib/recovery/contracts";
import {
  billingSetupProgress,
  billingSetupStepLabels,
  billingSetupStepOrder,
  defaultGmailBillingFilterQuery,
  gmailAttachmentHelpUrl,
  gmailFilterHelpUrl,
  gmailForwardingHelpUrl,
  gmailSearchHelpUrl,
  outlookForwardingHelpUrl,
} from "@/lib/recovery/billing-forwarding-rule";
import { formatMoment } from "./labels";
import { GmailForwardingConfirmation } from "./recovery-gmail-confirmation";

export function ReceiptBillingSetup({ receiptInbox }: { receiptInbox: ReceiptInboxStatusDto }) {
  const [query, setQuery] = useState(defaultGmailBillingFilterQuery);
  const [copyStatus, setCopyStatus] = useState("");
  const progress = billingSetupProgress(receiptInbox);

  async function copyQuery() {
    try {
      await navigator.clipboard.writeText(query);
      setCopyStatus("Gmail search copied. Paste it into Gmail on a computer, review the results, then create the filter.");
    } catch {
      setCopyStatus("Could not copy automatically. Select the search and copy it.");
    }
  }

  return (
    <section aria-labelledby="receipt-forwarding-setup" className="border-t border-line pt-5">
      <h4 id="receipt-forwarding-setup" className="font-display text-lg font-semibold text-(--ink)">Set up billing forwarding once</h4>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">
        Vognary does not read the mailbox. Only messages that match the forwarding rule you create are sent to this address. Gmail filters apply to new matching messages, not old ones. Coverage depends on this source. This is not one-click setup and it is not complete company spend.
      </p>

      <ol className="mt-4 grid gap-2 text-sm leading-6">
        {billingSetupStepOrder.map((step) => {
          const done = progress.completed.includes(step);
          const current = progress.current === step;
          return (
            <li key={step} className={current ? "font-medium text-(--ink)" : "text-(--muted)"}>
              {done ? "Done" : current ? "Now" : "Later"}
              {" — "}
              {billingSetupStepLabels[step]}
            </li>
          );
        })}
      </ol>

      <ol className="mt-5 border-t border-line">
        <li className="border-b border-line py-4">
          <p className="text-sm font-semibold text-(--ink)">1. Address ready</p>
          <p className="mt-1 text-sm leading-6 text-(--muted)">Use the private address above only for software billing mail you choose to route here.</p>
        </li>
        <li className="border-b border-line py-4">
          <p className="text-sm font-semibold text-(--ink)">
            2. {receiptInbox.forwardingVerifiedAt ? "Gmail address verified" : "Verify the forwarding address"}
          </p>
          {receiptInbox.forwardingVerifiedAt ? (
            <p className="mt-1 text-sm leading-6 text-(--muted)">Verified {formatMoment(receiptInbox.forwardingVerifiedAt)} after a matching billing email arrived following Google&apos;s confirmation request.</p>
          ) : receiptInbox.gmailVerification ? (
            <div className="mt-3 grid gap-3">
              <p className="text-sm leading-6 text-(--muted)">
                Gmail sent a confirmation request to this private address. Confirm it below. Leave &quot;Forward a copy of incoming mail to&quot; off. Do not create the billing filter until Google shows the address as confirmed.
              </p>
              <GmailForwardingConfirmation verification={receiptInbox.gmailVerification} />
            </div>
          ) : (
            <p className="mt-1 text-sm leading-6 text-(--muted)">
              On a computer, open Gmail Settings, then See all settings, Forwarding and POP/IMAP, and Add a forwarding address. Paste the private address, choose Next and Proceed, then return here for Google&apos;s confirmation link or code. Leave &quot;Forward a copy of incoming mail to&quot; off. Do not turn on automatic forwarding for every new message. Gmail forwards nothing until you confirm. Vognary marks this step done only after a matching billing email arrives following that confirmation.
            </p>
          )}
          <a href={gmailForwardingHelpUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-sm font-medium text-(--accent-strong) underline underline-offset-4">
            Google&apos;s forwarding instructions
          </a>
        </li>
        <li className="border-b border-line py-4">
          <p className="text-sm font-semibold text-(--ink)">
            3. {receiptInbox.setupCompletedAt ? "First matching billing email received" : "Create one billing-only Gmail filter"}
          </p>
          <p className="mt-1 text-sm leading-6 text-(--muted)">
            Keep global forwarding disabled. On a computer, paste the search below into Gmail, review the results, and edit it if it would forward confidential mail. Then Create filter, choose Forward it to this private address, and Create filter. Filters affect new matching mail only. Related conversation mail can still appear in the search; you decide what the filter covers. After this rule is on, you should not need to forward each new matching receipt by hand. Gmail may show a forwarding notice for about a week; that is expected.
          </p>
          <label htmlFor="gmail-billing-filter-query" className="field-label mt-3 block">Gmail search for the billing-only filter</label>
          <textarea
            id="gmail-billing-filter-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="field field-mono mt-1 min-h-28 resize-y text-sm leading-6"
            spellCheck={false}
          />
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" onClick={() => void copyQuery()} className="btn btn-sm btn-primary justify-self-start">
              Copy Gmail search
            </button>
            <button type="button" onClick={() => setQuery(defaultGmailBillingFilterQuery())} className="btn btn-sm btn-ghost">
              Reset to the starting rule
            </button>
          </div>
          <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs text-(--muted)">{copyStatus}</p>
          <p className="mt-2 text-xs leading-5 text-(--muted)">
            The starting rule matches subject lines that look like receipts or invoices and skips common payout, shipping, and order-confirmation subjects. It is not a guarantee that every bill is captured. Unrelated mail that still matches can be rejected after it arrives. Preview in Gmail before you save the filter.
          </p>
          {receiptInbox.setupCompletedAt ? (
            <p className="mt-2 text-xs leading-5 text-(--muted)">A billing email was accepted {formatMoment(receiptInbox.setupCompletedAt)}.</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            <a href={gmailSearchHelpUrl} target="_blank" rel="noreferrer noopener" className="text-sm font-medium text-(--accent-strong) underline underline-offset-4">
              Google&apos;s search operators
            </a>
            <a href={gmailFilterHelpUrl} target="_blank" rel="noreferrer noopener" className="text-sm font-medium text-(--accent-strong) underline underline-offset-4">
              Google&apos;s filter instructions
            </a>
          </div>
        </li>
        <li className="py-4">
          <p className="text-sm font-semibold text-(--ink)">
            4. {receiptInbox.backfillCompletedAt ? "Historical backfill complete" : "One-time historical backfill"}
          </p>
          {receiptInbox.backfillCompletedAt ? (
            <p className="mt-1 text-sm leading-6 text-(--muted)">A historical receipt batch was accepted {formatMoment(receiptInbox.backfillCompletedAt)}.</p>
          ) : (
            <p className="mt-1 text-sm leading-6 text-(--muted)">
              Gmail cannot use this filter to import old mail. In Gmail on a computer, select old software billing emails in batches of up to 20, choose More, Forward as attachment, address the message to your private address, and send. Do this once. Vognary marks this complete only after an attached receipt is accepted.
            </p>
          )}
          <a href={gmailAttachmentHelpUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-sm font-medium text-(--accent-strong) underline underline-offset-4">
            Google&apos;s attachment instructions
          </a>
        </li>
      </ol>

      <details className="mt-4 border-t border-line pt-4">
        <summary className="cursor-pointer text-sm font-medium text-(--ink-soft)">Outlook guidance</summary>
        <p className="mt-3 text-sm leading-6 text-(--muted)">
          Outlook can use a server-side inbox rule that forwards messages whose subject includes receipt or invoice to this address. Do not forward the whole mailbox. Some Microsoft 365 tenants block external forwarding; if the rule never delivers, that block is why. Vognary does not connect to Outlook.
        </p>
        <a href={outlookForwardingHelpUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-sm font-medium text-(--accent-strong) underline underline-offset-4">
          Microsoft&apos;s forwarding-rule instructions
        </a>
      </details>
    </section>
  );
}
