"use client";

import { useState } from "react";
import { Copy, Mail } from "lucide-react";

const invoiceEmail = "support@vognary.com";

export default function InvoiceRequest() {
  const [status, setStatus] = useState<string | null>(null);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(invoiceEmail);
      setStatus("Email address copied. No request has been sent.");
    } catch {
      setStatus("Copy unavailable. Email support@vognary.com. No request has been sent.");
    }
  }

  return <div className="mt-6">
    <a className="btn btn-primary btn-lg w-full" href="mailto:support@vognary.com?subject=Commitment%20Control%20pilot%20invoice">
      <Mail size={18} aria-hidden />Request the one-time invoice
    </a>
    <div className="mt-3 flex items-center justify-between gap-2">
      <a className="link-quiet break-all text-sm" href={`mailto:${invoiceEmail}`}>{invoiceEmail}</a>
      <button type="button" className="btn btn-sm btn-ghost shrink-0" aria-label="Copy invoice email address" title="Copy invoice email address" onClick={() => void copyAddress()}><Copy size={18} aria-hidden /></button>
    </div>
    {status ? <p role="status" className="mt-2 text-xs leading-5 text-(--muted)">{status}</p> : null}
  </div>;
}
