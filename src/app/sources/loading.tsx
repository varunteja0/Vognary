export default function SourcesLoading() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8" aria-busy="true">
      <div className="mx-auto w-full max-w-5xl">
        <p className="sr-only" role="status">Loading sources</p>
        <div className="panel p-6 sm:p-8">
          <div className="nakul-pulse h-3.5 w-32 rounded-full bg-(--card-2)" />
          <div className="nakul-pulse mt-5 h-8 w-3/4 max-w-md rounded-lg bg-(--card-2)" />
          <div className="nakul-pulse mt-3 h-4 w-2/3 max-w-sm rounded bg-(--card-2)" />
          <div className="mt-8 grid gap-3">
            <div className="inset nakul-pulse h-20" />
            <div className="inset nakul-pulse h-20" />
            <div className="inset nakul-pulse h-20" />
          </div>
        </div>
      </div>
    </main>
  );
}
