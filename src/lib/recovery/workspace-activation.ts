export const workspaceActivationOutcomes = [
  "recorded",
  "already-recorded",
  "deferred-no-consent",
  "deferred-no-picture",
  "deferred-auth",
  "retry-exhausted",
] as const;

export type WorkspaceActivationOutcome = (typeof workspaceActivationOutcomes)[number];

export type WorkspaceActivationWrite = {
  recorded: boolean;
  id: string | null;
  outcome: Extract<WorkspaceActivationOutcome, "recorded" | "already-recorded" | "deferred-no-consent" | "deferred-no-picture">;
};
