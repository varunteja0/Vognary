import Link from "next/link";
import { ErrorState } from "./error-state";

export default function NotFound() {
  return (
    <ErrorState
      eyebrow="Error 404"
      title="Page not found."
      description="The page you are looking for is not here. Return home or use a public index to find the current path."
    >
      <Link href="/" className="btn btn-primary">Back home</Link>
      <Link href="/llms.txt" className="btn btn-ghost">Agent guide</Link>
      <Link href="/sitemap.xml" className="btn btn-ghost">Sitemap</Link>
    </ErrorState>
  );
}
