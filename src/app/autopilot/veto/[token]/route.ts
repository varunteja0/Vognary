export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return new Response(publicVetoPageHtml(), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function publicVetoPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stop this Autopilot case</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; color: #24221f; background: #f8f5ef; }
    body { margin: 0; }
    main { box-sizing: border-box; width: min(100%, 34rem); margin: 0 auto; padding: 4rem 1rem; }
    h1 { margin: 0; font-family: Georgia, serif; font-size: 1.75rem; line-height: 1.2; }
    p { margin: 0.75rem 0 0; color: #625e56; font-size: 0.95rem; line-height: 1.6; }
    button { margin-top: 1.5rem; min-height: 2.75rem; border: 1px solid #8a6817; border-radius: 0.35rem; padding: 0.65rem 1rem; color: #fff; background: #76570f; font: inherit; font-weight: 700; cursor: pointer; }
    button:disabled { cursor: wait; opacity: 0.65; }
    [role="alert"] { min-height: 1.5rem; color: #9a3412; font-size: 0.875rem; }
  </style>
</head>
<body>
  <main>
    <h1>Stop this Autopilot case</h1>
    <p>This one-action veto withdraws the case. It does not claim that anything was cancelled, connected, saved, or paid.</p>
    <button id="veto-action" type="button">Veto this case</button>
    <p id="veto-status" role="alert" aria-live="assertive"></p>
  </main>
  <script>
    const button = document.getElementById("veto-action");
    const status = document.getElementById("veto-status");
    async function submitVeto() {
      const path = window.location.pathname;
      if (!/^\\/autopilot\\/veto\\/[^/]+$/.test(path)) {
        status.textContent = "This veto link is invalid.";
        return;
      }
      button.disabled = true;
      button.textContent = "Sending veto...";
      status.textContent = "";
      try {
        const response = await fetch(\`/api\${path}\`, { method: "POST", credentials: "omit" });
        if (response.status === 429 || response.status >= 500) {
          button.disabled = false;
          button.textContent = "Try again";
          status.textContent = response.status === 429
            ? "Too many veto attempts. No new attempt was accepted; wait and try again."
            : "The veto result could not be confirmed. Retrying is safe; an already-recorded veto will not be applied twice.";
          return;
        }
        const html = await response.text();
        document.open();
        document.write(html);
        document.close();
      } catch {
        button.disabled = false;
        button.textContent = "Try again";
        status.textContent = "The veto result could not be confirmed. Retrying is safe; an already-recorded veto will not be applied twice.";
      }
    }
    button.addEventListener("click", submitVeto);
  </script>
</body>
</html>`;
}