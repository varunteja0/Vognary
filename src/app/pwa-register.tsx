"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        await registration.update();
      } catch {
        // Installability is progressive enhancement; the private web app stays fully usable.
      }
    };
    window.addEventListener("load", register, { once: true });

    const updateWhenVisible = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };
    document.addEventListener("visibilitychange", updateWhenVisible);

    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", updateWhenVisible);
    };
  }, []);

  return null;
}
