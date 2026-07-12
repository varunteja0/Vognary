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
  consentPurpose: string;
  consentNoticeVersion: string;
  consentGrantedAt: string;
};

export type WaitlistLeadInput = {
  source: string;
  createdAt: string;
  email: string;
  name: string;
  segment: string;
  message: string;
  consentPurpose: string;
  consentNoticeVersion: string;
  consentGrantedAt: string;
};

export function isLeadDatabaseConfigured() {
  return isDatabaseConfigured();
}

export async function persistAuditLead(input: AuditLeadInput) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const result = await client.query<{ id: string }>(
      `insert into private_audit_leads (
         source, created_at, name, email, contact, persona, spend_guess,
         payment_types, source_types, biggest_concern, message, score
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id`,
      [input.source, input.createdAt, input.name, input.email, input.contact, input.persona, input.spendGuess,
        input.paymentTypes, input.sourceTypes, input.biggestConcern, input.message, input.score],
    );
    await insertLeadConsent(client, input, ["contact", "private-audit-intake"]);
    await client.query("commit");
    return result.rows[0]?.id;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function persistWaitlistLead(input: WaitlistLeadInput) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const result = await client.query<{ id: string }>(
      `insert into waitlist_leads (source, created_at, email, name, segment, message)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [input.source, input.createdAt, input.email, input.name, input.segment, input.message],
    );
    await insertLeadConsent(client, input, ["contact", input.segment || "waitlist"]);
    await client.query("commit");
    return result.rows[0]?.id;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAuditLeadEmail(leadId: string) {
  const result = await getDatabasePool().query<{ email: string }>(
    `select email from private_audit_leads where id = $1`,
    [leadId],
  );
  return result.rows[0]?.email ?? null;
}

async function insertLeadConsent(
  client: import("pg").PoolClient,
  input: Pick<WaitlistLeadInput, "email" | "source" | "consentPurpose" | "consentNoticeVersion" | "consentGrantedAt">,
  scopes: string[],
) {
  await client.query(
    `insert into consent_grants (subject_email, purpose, notice_version, source, scopes, granted_at)
     values ($1, $2, $3, $4, $5::jsonb, $6)`,
    [input.email, input.consentPurpose, input.consentNoticeVersion, input.source, JSON.stringify(scopes), input.consentGrantedAt],
  );
}
