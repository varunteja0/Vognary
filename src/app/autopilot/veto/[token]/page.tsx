export const dynamic = "force-dynamic";

type PageContext = { params: Promise<{ token: string }> };

export default async function AutopilotVetoPage({ params }: PageContext) {
  const { token } = await params;
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="font-display text-2xl font-semibold text-(--ink)">Stop this Autopilot case</h1>
      <p className="mt-3 text-sm leading-6 text-(--muted)">
        This one-action veto withdraws the case. It does not claim that anything was cancelled, connected, saved, or paid.
      </p>
      <form method="post" action={`/api/autopilot/veto/${encodeURIComponent(token)}`} className="mt-6">
        <button type="submit" className="btn btn-primary">Veto this case</button>
      </form>
    </main>
  );
}
