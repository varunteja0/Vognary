"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ErrorState } from "./error-state";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      eyebrow="Something went wrong"
      title="This view could not be loaded."
      description="Your source files stay on this device. Retry the view, or return home and start again."
    >
      <button type="button" onClick={reset} className="btn btn-primary">Retry</button>
      <Link href="/" className="btn btn-ghost">Back home</Link>
    </ErrorState>
  );
}
