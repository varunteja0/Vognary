"use client";

import "../ledger.css";

import Link from "next/link";
import { VognaryMark } from "../brand";
import {
  AccountSection,
  DangerZoneSection,
  NotificationsSection,
  PeopleSection,
  PrivacySection,
} from "./profile-sections";
import { useProfileSettings } from "./use-profile-settings";

export default function ProfileClient() {
  const settings = useProfileSettings();

  if (settings.deletionComplete) {
    return (
      <main id="ledger-main" className="grid min-h-screen place-items-center px-4 py-12 text-foreground">
        <section role="status" className="panel w-full max-w-2xl border border-verdict p-6 sm:p-8">
          <p className="eyebrow text-verdict">Deletion completed</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-(--ink)">Your Vognary account was deleted</h1>
          <p className="mt-4 text-sm leading-7 text-(--ink-soft)">{settings.statuses.danger}</p>
          <p className="mt-3 text-sm leading-7 text-(--muted)">
            Provider-held copies and backups follow the separate retention boundaries in the Privacy Notice.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/privacy" className="btn btn-ghost">Privacy</Link>
            <Link href="/" className="btn btn-primary">Return home</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main id="ledger-main" className="relative px-4 py-6 text-foreground sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 font-display text-lg font-semibold text-(--ink)">
            <VognaryMark size={22} />
            Vognary
          </Link>
          <nav aria-label="Account shortcuts" className="flex flex-wrap gap-2">
            <Link href="/app" className="btn btn-primary">Back to app</Link>
            <Link href="/security" className="btn btn-ghost">Security</Link>
          </nav>
        </header>

        <div className="mt-8 border-b border-line pb-6">
          <p className="eyebrow">Settings</p>
          <h1 className="mt-2 font-display text-4xl font-bold text-(--ink) sm:text-5xl">Account settings</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-(--muted)">Start with your account summary. Open notifications, privacy, or deletion only when you need them.</p>
        </div>

        <div className="mt-6 grid gap-3">
          <AccountSection settings={settings} />
          <PeopleSection settings={settings} />
          <NotificationsSection settings={settings} />
          <PrivacySection settings={settings} />
          <DangerZoneSection settings={settings} />
        </div>
      </div>
    </main>
  );
}
