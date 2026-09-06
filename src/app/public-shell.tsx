"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { VognaryMark } from "./brand";
import "./public-shell.css";

/**
 * The public shell.
 *
 * Two commands, never three: one that matters on the page you are on, and one
 * that opens everything else. The menu is a native <dialog>, so focus trapping,
 * Escape, background inertness and restoration are the platform's job rather
 * than a hand-rolled approximation of them.
 */

type PrimaryCommand = { href: string; label: string; quiet?: boolean };

const DESTINATIONS: readonly { href: string; label: string; note: string }[] = [
  { href: "/demo", label: "Review the synthetic request", note: "A synthetic request from asked to answered" },
  { href: "/start", label: "Use your own evidence", note: "Cite one charge you already hold" },
  { href: "/pay", label: "The pilot", note: "Scope, price and what activation means" },
  { href: "/security", label: "Security", note: "Boundaries, data flow and open questions" },
  { href: "/about", label: "About", note: "Why this product refuses to decide for you" },
  { href: "/contact", label: "Contact", note: "Pilot, support, security or privacy" },
];

/** The one command that is worth interrupting for, per route. */
function primaryFor(pathname: string): PrimaryCommand {
  if (pathname === "/demo") return { href: "/start", label: "Use your own evidence" };
  // Home's hero already owns this exact command. A second filled button for the
  // same destination gives the first screen two primaries and no hierarchy, so
  // here the header keeps the shortcut but yields the emphasis.
  if (pathname === "/") return { href: "/demo", label: "Review the request", quiet: true };
  return { href: "/demo", label: "Review the request" };
}

export function PublicHeader() {
  const pathname = usePathname() ?? "/";
  const primary = primaryFor(pathname);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    dialog.current?.close();
    setOpen(false);
  }, []);

  return (
    <header className="pshell">
      <div className="pshell-bar">
        <Link href="/" className="pshell-brand" aria-label="Vognary home">
          <VognaryMark size={24} />
          <span>Vognary</span>
        </Link>

        <nav aria-label="Main site" className="pshell-links">
          <Link href="/demo" aria-current={pathname === "/demo" ? "page" : undefined}>The product</Link>
          <Link href="/pay" prefetch={false} aria-current={pathname === "/pay" ? "page" : undefined}>Pilot</Link>
          <Link href="/security" aria-current={pathname === "/security" ? "page" : undefined}>Security</Link>
        </nav>
        <div className="pshell-commands">
          <Link href="/login?next=/app" className="pshell-signin">Sign in</Link>
          <Link
            href={primary.href}
            className={`btn ${primary.quiet ? "btn-ghost" : "btn-primary"} btn-sm pshell-primary`}
          >
            {primary.label}
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm pshell-menu-button"
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => {
              dialog.current?.showModal();
              setOpen(true);
            }}
          >
            <Menu size={18} aria-hidden />
            <span className="sr-only">Menu</span>
          </button>
        </div>
      </div>

      <dialog ref={dialog} className="pshell-menu" onClose={() => setOpen(false)} aria-label="Site menu">
        <div className="pshell-menu-head">
          <p className="pshell-menu-title font-display">Where would you like to go?</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={close} aria-label="Close" title="Close" autoFocus>
            <X size={18} aria-hidden />
          </button>
        </div>
        <nav aria-label="Public destinations">
          <ul className="pshell-menu-list">
            {DESTINATIONS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={item.href === "/pay" ? false : undefined}
                  aria-current={pathname === item.href ? "page" : undefined}
                  onClick={close}
                >
                  <span className="pshell-menu-label">{item.label}</span>
                  <span className="pshell-menu-note">{item.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="pshell-menu-foot">
          <Link href="/login?next=/app" className="btn btn-ghost btn-block" onClick={close}>
            Sign in
          </Link>
        </div>
      </dialog>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="pfoot">
      <div className="pfoot-inner">
        <div className="pfoot-brand">
          <VognaryMark size={28} />
          <p className="font-display">Vognary</p>
          <span>Commitment Control. India-first.</span>
        </div>
        <div>
          <p className="pfoot-label">Experience</p>
          <Link href="/demo">Review the synthetic request</Link>
          <Link href="/start">Use your own evidence</Link>
          <Link href="/pay" prefetch={false}>The pilot</Link>
        </div>
        <div>
          <p className="pfoot-label">Company</p>
          <Link href="/about">About</Link>
          <Link href="/security">Security</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </div>
      <div className="pfoot-floor">
        {/* Kept on one line: this boundary sentence is asserted verbatim. */}
        <p>Human authorization only. Vognary never auto-approves, purchases, provisions or moves money.</p>
        {/* Legal and brand sit on one row rather than a fourth stacked column:
            same destinations, one tap-target row instead of three. */}
        <nav className="pfoot-fine" aria-label="Record">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/brand">Brand</Link>
        </nav>
      </div>
    </footer>
  );
}

