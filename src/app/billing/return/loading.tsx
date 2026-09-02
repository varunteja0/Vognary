import "../../public.css";
import "../../ledger.css";

export default function BillingReturnLoading() {
  return (
    <main className="relative px-4 pb-12 text-foreground sm:px-6 lg:px-8" aria-busy="true">
      <div className="mx-auto w-full max-w-6xl">
        <p className="sr-only" role="status">Loading payment status</p>
        <div className="min-h-16 border-b border-line" />
        <div className="public-ledger">
          <div className="public-ledger-rail">
            <div className="h-3.5 w-32 animate-pulse rounded-full bg-(--card-2)" />
            <div className="mt-5 h-24 w-full max-w-sm animate-pulse rounded bg-(--card-2)" />
            <div className="mt-5 h-16 w-full animate-pulse rounded bg-(--card-2)" />
          </div>
          <div className="public-ledger-body">
            <div className="public-band public-band-lead">
              <div className="h-36 w-full animate-pulse rounded bg-(--card-2)" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
