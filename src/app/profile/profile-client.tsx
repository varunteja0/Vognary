"use client";

import "../ledger.css";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import styles from "./profile.module.css";
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
    <main id="ledger-main" className={styles.page}>
      <div className={styles.measure}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>
            <VognaryMark size={22} />
            Vognary
          </Link>
          <nav aria-label="Account shortcuts" className="flex flex-wrap gap-2">
            <Link href="/app" className="btn btn-primary"><ArrowLeft size={16} aria-hidden />Back to app</Link>
            <Link href="/security" className="btn btn-ghost">Security</Link>
          </nav>
        </header>

        <div className={styles.title}>
          <p className="eyebrow">Settings</p>
          <h1>Account settings</h1>
        </div>

        <div className={styles.sections}>
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
