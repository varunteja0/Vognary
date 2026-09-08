"use client";

import { useEffect } from "react";

const channelName = "vognary-session";
const eventKey = "vognary.auth-event";

function clearTransientData() {
  for (const storeName of ["sessionStorage", "localStorage"] as const) {
    try {
      const store = window[storeName];
      for (const key of Object.keys(store)) if (key.startsWith("vognary.") && key !== eventKey) store.removeItem(key);
    } catch {}
  }
}

export function finishLocalSignOut() {
  clearTransientData();
  try { localStorage.setItem(eventKey, crypto.randomUUID()); } catch {}
  try {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage("signed-out");
    channel.close();
  } catch {}
  window.location.replace("/login");
}

export default function SessionPrivacy() {
  useEffect(() => {
    const signedOut = () => {
      try { const marker = localStorage.getItem(eventKey); if (marker) sessionStorage.setItem(eventKey, marker); } catch {}
      clearTransientData();
      if (/^\/(app|profile)(?:\/|$)/.test(location.pathname)) location.replace("/login");
    };
    const reconcileSignOut = () => {
      try {
        const marker = localStorage.getItem(eventKey);
        if (marker && marker !== sessionStorage.getItem(eventKey)) signedOut();
      } catch {}
    };
    const onStorage = (event: StorageEvent) => { if (event.key === eventKey && event.newValue) signedOut(); };
    const onVisible = () => { if (document.visibilityState === "visible") reconcileSignOut(); };
    const checkRestoredPage = async (event: PageTransitionEvent) => {
      reconcileSignOut();
      if (!event.persisted || !/^\/(app|profile)(?:\/|$)/.test(location.pathname)) return;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (response.ok && !(await response.json()).authenticated) signedOut();
      } catch {}
    };
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel(channelName); channel.onmessage = event => { if (event.data === "signed-out") signedOut(); }; } catch {}
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", checkRestoredPage);
    window.addEventListener("focus", reconcileSignOut);
    document.addEventListener("visibilitychange", onVisible);
    reconcileSignOut();
    return () => { channel?.close(); window.removeEventListener("storage", onStorage); window.removeEventListener("pageshow", checkRestoredPage); window.removeEventListener("focus", reconcileSignOut); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return null;
}
