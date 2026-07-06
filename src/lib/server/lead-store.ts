import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";

export type AuditLeadInput = {
  source: string;
  createdAt: string;
  name: string;
  email: string;
  contact: string;
  persona: string;
  spendGuess: string;
  paymentTypes: string[];
  sourceTypes: string[];
  biggestConcern: string;
  message: string;
  score: number;
};

export type WaitlistLeadInput = {
  source: string;
  createdAt: string;
  email: string;
  name: string;
  segment: string;
  message: string;
};

export function isLeadDatabaseConfigured() {
  return isDatabaseConfigured();
}

export async function persistAuditLead(input: AuditLeadInput) {
  await ensureLeadTables();

  const result = await getDatabasePool().query<{ id: string }>(
    `insert into private_audit_leads (
       source, created_at, name, email, contact, persona, spend_guess,
       payment_types, source_types, biggest_concern, message, score
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning id`,
    [
      input.source,
      input.createdAt,
      input.name,
      input.email,
      input.contact,
      input.persona,
      input.spendGuess,
      input.paymentTypes,
      input.sourceTypes,
      input.biggestConcern,
      input.message,
      input.score,
    ],
  );

  return result.rows[0]?.id;
}

export async function persistWaitlistLead(input: WaitlistLeadInput) {
  await ensureLeadTables();

  const result = await getDatabasePool().query<{ id: string }>(
    `insert into waitlist_leads (source, created_at, email, name, segment, message)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [input.source, input.createdAt, input.email, input.name, input.segment, input.message],
  );

  return result.rows[0]?.id;
}

async function ensureLeadTables() {
  const pool = getDatabasePool();

  await pool.query("create extension if not exists pgcrypto");
  await pool.query(
    `create table if not exists private_audit_leads (
       id uuid primary key default gen_random_uuid(),
       source text not null,
       name text not null,
       email text not null,
       contact text,
       persona text not null,
       spend_guess text,
       payment_types text[] not null default '{}',
       source_types text[] not null default '{}',
       biggest_concern text,
       message text,
       score integer not null default 0,
       created_at timestamptz not null default now()
     )`,
  );
  await pool.query("create index if not exists private_audit_leads_created_idx on private_audit_leads(created_at desc)");
  await pool.query("create index if not exists private_audit_leads_email_idx on private_audit_leads(email)");

  await pool.query(
    `create table if not exists waitlist_leads (
       id uuid primary key default gen_random_uuid(),
       source text not null,
       email text not null,
       name text,
       segment text,
       message text,
       created_at timestamptz not null default now()
     )`,
  );
  await pool.query("create index if not exists waitlist_leads_created_idx on waitlist_leads(created_at desc)");
  await pool.query("create index if not exists waitlist_leads_email_idx on waitlist_leads(email)");
}