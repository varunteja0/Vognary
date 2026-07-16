"use client";

import Link from "next/link";
import { VognaryMark } from "../brand";
import {
  AccountSection,
  DangerZoneSection,
  DeveloperSection,
  NotificationsSection,
  PrivacySection,
} from "./profile-sections";
import { useProfileSettings } from "./use-profile-settings";

export default function ProfileClient() {
  const settings = useProfileSettings();

  return (
    <main id="ledger-main" className="relative px-4 py-6 text-foreground sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <nav aria-label="Account shortcuts" className="flex flex-wrap gap-2">
            <Link href="/app" className="btn btn-primary">Audit workspace</Link>
            <Link href="/private-audit" className="btn btn-ghost">Private audit</Link>
          </nav>
        </header>

        <div className="mt-8 border-b border-line pb-6">
          <p className="eyebrow">Settings</p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-[-0.03em] text-(--ink) sm:text-5xl">Account settings</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-(--muted)">Start with your account summary. Open notifications, privacy, developer access, or deletion only when you need them.</p>
        </div>

        <div className="mt-6 grid gap-3">
          <AccountSection settings={settings} />
          <NotificationsSection settings={settings} />
          <PrivacySection settings={settings} />
          <DeveloperSection settings={settings} />
          <DangerZoneSection settings={settings} />
        </div>
      </div>
    </main>
  );
}
