import LaunchLanding from "./launch-landing";
import { isReceiptInboxPubliclyAvailable } from "@/lib/server/recovery-inbound-store";

export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <LaunchLanding
      receiptInboxAvailable={await isReceiptInboxPubliclyAvailable()}
    />
  );
}
