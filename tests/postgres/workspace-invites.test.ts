import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { GET as getMembers } from "../../src/app/api/workspaces/current/members/route";
import { POST as postInvite } from "../../src/app/api/workspaces/current/members/invites/route";
import { POST as postRevoke } from "../../src/app/api/workspaces/current/members/invites/[inviteId]/revoke/route";
import type { ApiSuccess } from "../../src/lib/recovery/contracts";
import {
  createCommitmentControlProposal,
  decideCommitmentControlProposal,
  putCommitmentControlPolicy,
} from "../../src/lib/server/commitment-control-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { RecoveryServiceError } from "../../src/lib/server/recovery-api";
import { createSessionCookie } from "../../src/lib/server/session";
import {
  acceptOpenWorkspaceInvitesForUser,
  createWorkspaceInvite,
  listWorkspacePeople,
  revokeWorkspaceInvite,
} from "../../src/lib/server/workspace-invite-store";
import { completeControlPolicyRequest, futureControlTestDate, testControlOutcome } from "../commitment-control-policy-fixture";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const baseUrl = "https://vognary.test";
const futureFirstChargeDate = futureControlTestDate();
process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";

async function seedDesk(label: string) {
  const pool = getDatabasePool();
  const suffix = randomUUID().slice(0, 8);
  const ownerUserId = randomUUID();
  const memberUserId = randomUUID();
  const otherOwnerUserId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  await pool.query(
    `insert into users (id, email, display_name) values
       ($1, $2, 'Invite owner'),
       ($3, $4, 'Invite member'),
       ($5, $6, 'Other owner')`,
    [
      ownerUserId, `${label}-owner-${suffix}@example.test`,
      memberUserId, `${label}-member-${suffix}@example.test`,
      otherOwnerUserId, `${label}-other-${suffix}@example.test`,
    ],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values
       ($1, $2, 'Invite workspace'),
       ($3, $4, 'Other workspace')`,
    [workspaceId, ownerUserId, otherWorkspaceId, otherOwnerUserId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values
       ($1, $2, 'owner'),
       ($1, $3, 'member'),
       ($4, $5, 'owner')`,
    [workspaceId, ownerUserId, memberUserId, otherWorkspaceId, otherOwnerUserId],
  );
  return { pool, suffix, ownerUserId, memberUserId, otherOwnerUserId, workspaceId, otherWorkspaceId };
}

test("workspace invites accept into the invited workspace, refuse foreign revoke, and keep owner out of invite roles", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedDesk("invite");
  const inviteeUserId = randomUUID();
  const inviteeEmail = `invitee-${desk.suffix}@example.test`;

  try {
    await assert.rejects(
      () => createWorkspaceInvite({
        workspaceId: desk.workspaceId,
        actorUserId: desk.memberUserId,
        email: inviteeEmail,
        role: "member",
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => createWorkspaceInvite({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        email: inviteeEmail,
        role: "owner",
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "INVALID_EVIDENCE",
    );
    await assert.rejects(
      () => createWorkspaceInvite({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        email: inviteeEmail,
        role: "viewer",
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "INVALID_EVIDENCE",
    );

    const invite = await createWorkspaceInvite({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      email: inviteeEmail,
      role: "admin",
    });
    assert.equal(invite.status, "PENDING");
    assert.equal(invite.role, "admin");

    await assert.rejects(
      () => revokeWorkspaceInvite({
        workspaceId: desk.otherWorkspaceId,
        actorUserId: desk.otherOwnerUserId,
        inviteId: invite.id,
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "NOT_FOUND",
    );

    await desk.pool.query(
      `insert into users (id, email, display_name) values ($1, $2, 'Invitee')`,
      [inviteeUserId, inviteeEmail],
    );
    const accepted = await acceptOpenWorkspaceInvitesForUser({
      userId: inviteeUserId,
      email: inviteeEmail,
    });
    assert.equal(accepted?.workspaceId, desk.workspaceId);
    assert.equal(accepted?.role, "admin");

    const people = await listWorkspacePeople({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
    });
    assert.ok(people.members.some((member) => member.userId === inviteeUserId && member.role === "admin"));
    assert.equal(people.invites.find((row) => row.id === invite.id)?.status, "ACCEPTED");

    const membership = await desk.pool.query<{ workspace_id: string }>(
      `select workspace_id from workspace_members where user_id = $1 order by created_at`,
      [inviteeUserId],
    );
    assert.deepEqual(membership.rows.map((row) => row.workspace_id), [desk.workspaceId]);
  } finally {
    await desk.pool.query(`delete from workspaces where id = any($1::uuid[])`, [[desk.workspaceId, desk.otherWorkspaceId]]).catch(() => undefined);
    await desk.pool.query(`delete from users where id = any($1::uuid[])`, [[desk.ownerUserId, desk.memberUserId, desk.otherOwnerUserId, inviteeUserId]]).catch(() => undefined);
  }
});

test("a second owner or admin must record the decision when the desk is not solo", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedDesk("checker");
  const adminUserId = randomUUID();
  const adminEmail = `checker-admin-${desk.suffix}@example.test`;

  try {
    await createWorkspaceInvite({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      email: adminEmail,
      role: "admin",
    });
    await desk.pool.query(
      `insert into users (id, email, display_name) values ($1, $2, 'Second admin')`,
      [adminUserId, adminEmail],
    );
    await acceptOpenWorkspaceInvitesForUser({ userId: adminUserId, email: adminEmail });

    const policy = await putCommitmentControlPolicy({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `invite-policy-${desk.suffix}`,
      request: completeControlPolicyRequest(),
    });
    const proposal = await createCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      expectedVersion: policy.workspaceVersion,
      idempotencyKey: `invite-proposal-${desk.suffix}`,
      request: {
        merchant: "OpenAI",
        purpose: "Production model capacity",
        category: "AI_MODEL",
        amountMinor: "199900",
        currency: "INR",
        firstChargeDate: futureFirstChargeDate,
        cadence: "MONTHLY",
        existingCommitmentIds: [],
        intendedOutcome: testControlOutcome(),
      },
    });

    await assert.rejects(
      () => decideCommitmentControlProposal({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        proposalId: proposal.data.proposal.id,
        expectedVersion: proposal.workspaceVersion,
        idempotencyKey: `invite-self-decision-${desk.suffix}`,
        request: { action: "APPROVE", authorizationExpiresOn: "2099-12-30" },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "FORBIDDEN",
    );

    const decided = await decideCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: adminUserId,
      proposalId: proposal.data.proposal.id,
      expectedVersion: proposal.workspaceVersion,
      idempotencyKey: `invite-second-decision-${desk.suffix}`,
      request: { action: "APPROVE", authorizationExpiresOn: "2099-12-30" },
    });
    assert.equal(decided.data.decision.decidedByUserId, adminUserId);
    assert.equal(decided.data.decision.decidedByDisplayName, "Second admin");
  } finally {
    await desk.pool.query(`delete from workspaces where id = any($1::uuid[])`, [[desk.workspaceId, desk.otherWorkspaceId]]).catch(() => undefined);
    await desk.pool.query(`delete from users where id = any($1::uuid[])`, [[desk.ownerUserId, desk.memberUserId, desk.otherOwnerUserId, adminUserId]]).catch(() => undefined);
  }
});

test("workspace people HTTP routes keep CSRF, RBAC, and revoke inside the current workspace", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedDesk("people-http");
  const inviteEmail = `http-invitee-${desk.suffix}@example.test`;

  try {
    const ownerCookie = await createSessionCookie({ userId: desk.ownerUserId, workspaceId: desk.workspaceId });
    const memberCookie = await createSessionCookie({ userId: desk.memberUserId, workspaceId: desk.workspaceId });
    const otherCookie = await createSessionCookie({ userId: desk.otherOwnerUserId, workspaceId: desk.otherWorkspaceId });
    const ownerHeader = `${ownerCookie.name}=${encodeURIComponent(ownerCookie.value)}`;
    const memberHeader = `${memberCookie.name}=${encodeURIComponent(memberCookie.value)}`;
    const otherHeader = `${otherCookie.name}=${encodeURIComponent(otherCookie.value)}`;
    const headers = (cookie: string) => ({
      cookie,
      origin: baseUrl,
      "content-type": "application/json",
    });

    const unauthenticated = await getMembers(new Request(`${baseUrl}/api/workspaces/current/members`));
    assert.equal(unauthenticated.status, 401);

    const memberList = await getMembers(new Request(`${baseUrl}/api/workspaces/current/members`, {
      headers: { cookie: memberHeader },
    }));
    assert.equal(memberList.status, 403);

    const crossSite = await postInvite(new Request(`${baseUrl}/api/workspaces/current/members/invites`, {
      method: "POST",
      headers: { ...headers(ownerHeader), origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ email: inviteEmail, role: "member" }),
    }));
    assert.equal(crossSite.status, 403);

    const created = await postInvite(new Request(`${baseUrl}/api/workspaces/current/members/invites`, {
      method: "POST",
      headers: headers(ownerHeader),
      body: JSON.stringify({ email: inviteEmail, role: "member" }),
    }));
    assert.equal(created.status, 201);
    const createdPayload = await created.json() as ApiSuccess<{ invite: { id: string } }>;
    const inviteId = createdPayload.data.invite.id;

    const foreignRevoke = await postRevoke(new Request(`${baseUrl}/api/workspaces/current/members/invites/${inviteId}/revoke`, {
      method: "POST",
      headers: headers(otherHeader),
    }), { params: Promise.resolve({ inviteId }) });
    assert.equal(foreignRevoke.status, 404);

    const listed = await getMembers(new Request(`${baseUrl}/api/workspaces/current/members`, {
      headers: { cookie: ownerHeader },
    }));
    assert.equal(listed.status, 200);
    const listedPayload = await listed.json() as ApiSuccess<{ members: unknown[]; invites: Array<{ id: string; status: string }> }>;
    assert.equal(listedPayload.data.invites.some((invite) => invite.id === inviteId && invite.status === "PENDING"), true);

    const revoked = await postRevoke(new Request(`${baseUrl}/api/workspaces/current/members/invites/${inviteId}/revoke`, {
      method: "POST",
      headers: headers(ownerHeader),
    }), { params: Promise.resolve({ inviteId }) });
    assert.equal(revoked.status, 200);
  } finally {
    await desk.pool.query(`delete from workspaces where id = any($1::uuid[])`, [[desk.workspaceId, desk.otherWorkspaceId]]).catch(() => undefined);
    await desk.pool.query(`delete from users where id = any($1::uuid[])`, [[desk.ownerUserId, desk.memberUserId, desk.otherOwnerUserId]]).catch(() => undefined);
  }
});
