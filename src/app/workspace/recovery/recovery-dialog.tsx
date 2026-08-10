"use client";

import { useEffect, useRef, type ReactNode } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// One accessible dialog for every Recovery modal: labelled, modal, focus-trapped,
// Escape-closable, and it puts focus back where the reader left it.
export function RecoveryDialog({
  title,
  description,
  onClose,
  returnFocusId,
  tone = "neutral",
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  returnFocusId: string | null;
  tone?: "neutral" | "destructive";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => [...panel.querySelectorAll<HTMLElement>(focusableSelector)];
    (focusables()[0] ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      const restoreTarget = (returnFocusId ? document.getElementById(returnFocusId) : null) ?? previouslyFocused;
      restoreTarget?.focus();
    };
  }, [returnFocusId]);

  const titleId = "recovery-dialog-title";
  const descriptionId = "recovery-dialog-description";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6">
      <div className="fixed inset-0 bg-(--paper)/80 backdrop-blur-sm" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`panel relative z-10 max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-b-none p-5 outline-none sm:rounded-(--radius) sm:p-6 ${tone === "destructive" ? "border-ember" : ""}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="font-display text-xl font-semibold text-(--ink)">{title}</h2>
            {description ? <p id={descriptionId} className="mt-2 max-w-xl text-sm leading-6 text-(--muted)">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="btn btn-sm btn-ghost shrink-0">Close</button>
        </div>
        <div className="mt-5">{children}</div>
        {footer ? <div className="mt-6 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">{footer}</div> : null}
      </div>
    </div>
  );
}
