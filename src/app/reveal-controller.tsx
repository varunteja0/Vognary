"use client";

import { useEffect } from "react";

/**
 * Progressive scroll-reveal. Elements marked with `data-reveal` fade/rise in
 * as they enter the viewport. Content is only ever hidden once JS has run
 * (the `reveal-ready` class is added on mount), so without JS — or with
 * reduced motion — everything stays fully visible.
 */
export default function RevealController() {
  useEffect(() => {
    const root = document.documentElement;
    const seen = new WeakSet<Element>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    const register = (el: Element) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (document.visibilityState !== "visible") {
        el.classList.add("is-visible");
        return;
      }
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (rect.top < vh * 0.92) {
        // Already in view on load — reveal immediately to avoid a flash.
        el.classList.add("is-visible");
      } else {
        observer.observe(el);
      }
    };

    document.querySelectorAll("[data-reveal]").forEach(register);
    root.classList.add("reveal-ready");

    const revealAll = () => {
      document.querySelectorAll("[data-reveal]").forEach((element) => element.classList.add("is-visible"));
    };
    const visibilityChanged = () => {
      if (document.visibilityState !== "visible") revealAll();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    const fallback = window.setTimeout(revealAll, 2_000);

    // Catch elements added by client-side navigation.
    const mutation = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const el = node as Element;
          if (el.matches?.("[data-reveal]")) register(el);
          el.querySelectorAll?.("[data-reveal]").forEach(register);
        });
      }
    });
    mutation.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutation.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.clearTimeout(fallback);
    };
  }, []);

  return null;
}
