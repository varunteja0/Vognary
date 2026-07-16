"use client";

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <title>Vognary could not load</title>
      </head>
      <body style={{ margin: 0, background: "#0a0c10", color: "#f3ead6", fontFamily: "sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
          <section aria-labelledby="global-error-title" style={{ width: "min(100%, 560px)", border: "1px solid #343842", padding: "28px", background: "#11141a" }}>
            <p style={{ margin: 0, color: "#b5b0a6", fontSize: "12px", textTransform: "uppercase" }}>Something went wrong</p>
            <h1 id="global-error-title" style={{ margin: "12px 0 0", fontSize: "30px", lineHeight: 1.15 }}>Vognary could not load this page.</h1>
            <p style={{ margin: "14px 0 0", color: "#b5b0a6", lineHeight: 1.6 }}>Retry the page. Evidence staged in this browser is not being claimed as saved until encrypted workspace sync succeeds.</p>
            <button type="button" onClick={() => unstable_retry()} style={{ marginTop: "20px", minHeight: "44px", border: 0, padding: "0 18px", background: "#f3ead6", color: "#0a0c10", fontWeight: 700, cursor: "pointer" }}>Retry</button>
          </section>
        </main>
      </body>
    </html>
  );
}
