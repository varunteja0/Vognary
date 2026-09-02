import "../ledger.css";
export default function ProfileLoading() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8" aria-busy="true">
      <div className="mx-auto w-full max-w-4xl">
        <p className="sr-only" role="status">Loading account settings</p>
        <div className="panel p-6 sm:p-8">
          <div className="h-3.5 w-36 animate-pulse rounded-full bg-(--card-2)" />
          <div className="mt-5 h-8 w-2/3 max-w-sm animate-pulse rounded-lg bg-(--card-2)" />
          <div className="mt-8 grid gap-3">
            <div className="inset h-24 animate-pulse" />
            <div className="inset h-24 animate-pulse" />
          </div>
        </div>
      </div>
    </main>
  );
}
