import Link from "next/link";
import { VognaryMark } from "./brand";

export default function NotFound() {
  return (
    <main className="relative flex min-h-[78vh] items-center justify-center px-4 py-16 text-foreground">
      <div className="panel mx-auto w-full max-w-md p-8 text-center rise">
        <div className="mx-auto flex w-fit items-center gap-2.5">
          <VognaryMark size={30} className="text-(--ink)" animated />
          <span className="font-display text-lg font-semibold text-(--ink)">Vognary</span>
        </div>
        <p className="eyebrow mt-7">Error 404</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-(--ink)">
          Page not found.
        </h1>
        <p className="mt-3 text-sm leading-6 text-(--muted)">
          The page you&rsquo;re looking for is not here. Go back to the app or open the brand page.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          <Link href="/" className="btn btn-primary">Back to app</Link>
          <Link href="/brand" className="btn btn-ghost">Brand</Link>
        </div>
      </div>
    </main>
  );
}
