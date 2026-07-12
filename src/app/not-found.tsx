import Link from "next/link";
import { ErrorState } from "./error-state";

export default function NotFound() {
  return (
    <ErrorState
      eyebrow="Error 404"
      title="Page not found."
      description="The page you are looking for is not here. Go back to the app or open the brand page."
    >
      <Link href="/" className="btn btn-primary">Back home</Link>
      <Link href="/brand" className="btn btn-ghost">Brand</Link>
    </ErrorState>
  );
}
