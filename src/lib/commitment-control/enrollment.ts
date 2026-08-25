const workspaceUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCommitmentControlWorkspaceEnrolled(
  workspaceId: string,
  options: { value?: string; nodeEnv?: string } = {},
) {
  const value = options.value ?? process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (!workspaceUuid.test(workspaceId) || !value?.trim()) return false;
  if (value.trim() === "*") return nodeEnv !== "production";
  const enrolled = new Set(value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => workspaceUuid.test(entry)));
  return enrolled.has(workspaceId.toLowerCase());
}