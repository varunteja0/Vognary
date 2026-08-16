export const autopilotSlo = {
  noticeQueueAgeSeconds: 15 * 60,
  deliveryFailureRateBps: 500,
  authorizationWithoutDeliveredNotice: 0,
  attemptLatencySeconds: 120,
  protectedLeakage: 0,
  verificationPendingDays: 7,
} as const;

export type AutopilotOpsMetrics = {
  oldestQueuedNoticeSeconds: number | null;
  noticesFailed24h: number;
  noticesDelivered24h: number;
  pendingVerifications: number;
  deadLetters: number;
  protectedLeakage: number;
};

export function autopilotSloBreaches(metrics: AutopilotOpsMetrics): readonly string[] {
  const breaches: string[] = [];
  if (metrics.oldestQueuedNoticeSeconds !== null && metrics.oldestQueuedNoticeSeconds > autopilotSlo.noticeQueueAgeSeconds) {
    breaches.push("NOTICE_QUEUE_AGE");
  }
  const delivered = metrics.noticesDelivered24h;
  const failed = metrics.noticesFailed24h;
  if (delivered + failed > 0 && (failed * 10_000) / (delivered + failed) > autopilotSlo.deliveryFailureRateBps) {
    breaches.push("NOTICE_DELIVERY_FAILURE_RATE");
  }
  if (metrics.protectedLeakage > autopilotSlo.protectedLeakage) breaches.push("PROTECTED_LEAKAGE");
  if (metrics.deadLetters > 0) breaches.push("DEAD_LETTERS");
  return breaches;
}
