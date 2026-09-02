"use client";

import Link from "next/link";
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

type PrimaryCommand = { href: string; label: string };

const DESTINATIONS: readonly { href: string; label: string; note: string }[] = [
  { href: "/demo", label: "Walk a decision", note: "A synthetic request from asked to answered" },
  { href: "/start", label: "Bring your own bill", note: "Cite one charge you already hold" },
  { href: "/pay", label: "The pilot", note: "Scope, price and what activation means" },
  { href: "/security", label: "Security", note: "Boundaries, data flow and open questions" },
  { href: "/about", label: "About", note: "Why this product refuses to decide for you" },
  { href: "/contact", label: "Contact", note: "Pilot, support, security or privacy" },
];

/** The one command that is worth interrupting for, per route. */
function primaryFor(pathname: string): PrimaryCommand {
  if (pathname === "/demo") return { href: "/start", label: "Use your own bill" };
  if (pathname === "/start") return { href: "/demo", label: "Walk a decision" };
  if (pathname === "/pay") return { href: "/demo", label: "Walk a decision" };
  if (pathname.startsWith("/security") || pathname.startsWith("/about") || pathname.startsWith("/contact")) {
    return { href: "/demo", label: "Walk a decision" };
  }
  return { href: "/demo", label: "Walk a decision" };
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

        <div className="pshell-commands">
          <Link href={primary.href} className="btn btn-primary btn-sm pshell-primary">
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
            <MenuGlyph />
            Menu
          </button>
        </div>
      </div>

      <dialog ref={dialog} className="pshell-menu" onClose={() => setOpen(false)} aria-label="Site menu">
        <div className="pshell-menu-head">
          <p className="pshell-menu-title font-display">Where would you like to go?</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={close} autoFocus>
            Close
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
          <Link href="/demo">Walk a decision</Link>
          <Link href="/start">Bring your own bill</Link>
          <Link href="/pay" prefetch={false}>The pilot</Link>
        </div>
        <div>
          <p className="pfoot-label">Company</p>
          <Link href="/about">About</Link>
          <Link href="/security">Security</Link>
          <Link href="/contact">Contact</Link>
        </div>
        <div>
          <p className="pfoot-label">Record</p>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/brand">Brand</Link>
        </div>
      </div>
      <p className="pfoot-floor">
        Human authorization only. Vognary never auto-approves, purchases, provisions or moves money.
      </p>
    </footer>
  );
}

function MenuGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
