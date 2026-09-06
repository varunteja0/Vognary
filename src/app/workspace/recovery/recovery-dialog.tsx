"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./recovery-dialog.module.css";
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
  const panelRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const dialogId = useId();

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.showModal();
    const focusable = () => [...panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']")]
      .filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = focusable();
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    panel.addEventListener("keydown", keepFocusInside);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      panel.removeEventListener("keydown", keepFocusInside);
      panel.close();
      document.body.style.overflow = previousOverflow;
      const restoreTarget = (returnFocusId ? document.getElementById(returnFocusId) : null) ?? previouslyFocused;
      restoreTarget?.focus();
    };
  }, [returnFocusId]);

  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  return (
      <dialog
        ref={panelRef}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={styles.dialog}
        data-tone={tone}
        onCancel={event => { event.preventDefault(); closeRef.current(); }}
      >
        <header className={styles.header}>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className={styles.close} aria-label="Close" title="Close"><X size={20} aria-hidden /></button>
        </header>
        <div className={styles.body} tabIndex={0} role="region" aria-label={`${title} content`}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </dialog>
  );
}
