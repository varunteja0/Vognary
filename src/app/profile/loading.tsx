export default function ProfileLoading() {
  return (
    <main className="relative px-4 py-8 text-foreground sm:px-6 lg:px-8" aria-busy="true">
      <div className="mx-auto w-full max-w-4xl">
        <p className="sr-only" role="status">Loading account settings</p>
        <div className="panel p-6 sm:p-8">
          <div className="nakul-pulse h-3.5 w-36 rounded-full bg-(--card-2)" />
          <div className="nakul-pulse mt-5 h-8 w-2/3 max-w-sm rounded-lg bg-(--card-2)" />
          <div className="mt-8 grid gap-3">
            <div className="inset nakul-pulse h-24" />
            <div className="inset nakul-pulse h-24" />
          </div>
        </div>
      </div>
    </main>
  );
}
