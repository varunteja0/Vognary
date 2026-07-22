"use client";

import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (online) return null;

  return (
    <div role="status" aria-live="polite" className="fixed inset-x-4 top-4 z-50 mx-auto w-fit max-w-full rounded-full border border-line-strong bg-(--card-3)/95 px-4 py-2 shadow-2xl backdrop-blur">
      <p className="text-sm leading-6 text-ochre">Offline: you can keep reading this workspace. Saving and syncing need a connection.</p>
    </div>
  );
}
