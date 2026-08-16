export const autopilotExecutionEnvName = "AUTOPILOT_EXECUTION_ENABLED";
export const autopilotNoticeEnvName = "AUTOPILOT_NOTICE_ENABLED";
export const autopilotNoticeChannelEnvName = "AUTOPILOT_NOTICE_CHANNEL_READY";

/** Founder switches are literal `true` only. `1` / `yes` / blank stay off. */
export function envFlagEnabled(name: string): boolean {
  return process.env[name] === "true";
}

/** Global execution kill switch. Default off until legal/ops and the shadow gate pass. */
export function isAutopilotExecutionEnabled(): boolean {
  return envFlagEnabled(autopilotExecutionEnvName);
}

/** Notice delivery is separate from execution and also defaults off. */
export function isAutopilotNoticeEnabled(): boolean {
  return envFlagEnabled(autopilotNoticeEnvName);
}

/** A real mailer must prove it can deliver before eligibility treats notice as possible. */
export function isAutopilotNoticeChannelReady(): boolean {
  return envFlagEnabled(autopilotNoticeChannelEnvName);
}

export function canDeliverAutopilotNotice(): boolean {
  return isAutopilotNoticeEnabled() && isAutopilotNoticeChannelReady();
}
