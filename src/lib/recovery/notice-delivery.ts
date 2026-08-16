export const noticeDeliveryStatuses = [
  "QUEUED",
  "ACCEPTED",
  "DELIVERED",
  "DELAYED",
  "BOUNCED",
  "FAILED",
  "COMPLAINED",
] as const;
export type NoticeDeliveryStatus = (typeof noticeDeliveryStatuses)[number];

export const noticeProviderEventTypes = [
  "email.sent",
  "email.delivered",
  "email.delayed",
  "email.delivery_delayed",
  "email.bounced",
  "email.failed",
  "email.complained",
] as const;
export type NoticeProviderEventType = (typeof noticeProviderEventTypes)[number];

export type NoticeDeliveryState = {
  status: NoticeDeliveryStatus;
  providerMessageId: string | null;
  deliveredAt: string | null;
  vetoDeadlineAt: string | null;
  lastEventOccurredAt?: string | null;
};

export type NoticeProviderEvent = {
  type: NoticeProviderEventType;
  providerMessageId: string;
  occurredAt: string;
};

export const productionNoticeVetoHours = 48 as const;

export function productionVetoHours(): typeof productionNoticeVetoHours {
  return productionNoticeVetoHours;
}

export function vetoDeadlineFromDelivery(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + productionNoticeVetoHours * 60 * 60 * 1000);
}

export function isNoticeProviderEventType(type: string): type is NoticeProviderEventType {
  return noticeProviderEventTypes.includes(type as NoticeProviderEventType);
}

function eventOccurredAtMs(iso: string): number | null {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

function withOccurredAt(state: NoticeDeliveryState, occurredAt: string): NoticeDeliveryState {
  return { ...state, lastEventOccurredAt: occurredAt };
}

const terminalFailureStatuses: readonly NoticeDeliveryStatus[] = ["BOUNCED", "FAILED", "COMPLAINED"];
const delayTypes: readonly NoticeProviderEventType[] = ["email.delayed", "email.delivery_delayed"];

export function applyNoticeDeliveryEvent(
  current: NoticeDeliveryState,
  event: NoticeProviderEvent,
): NoticeDeliveryState {
  const providerMessageId = event.providerMessageId.trim();
  if (providerMessageId.length < 8) return current;
  if (current.providerMessageId && current.providerMessageId !== providerMessageId) return current;

  const incomingAt = eventOccurredAtMs(event.occurredAt);
  if (incomingAt === null) return current;
  const previousAt = current.lastEventOccurredAt ? eventOccurredAtMs(current.lastEventOccurredAt) : null;
  if (previousAt !== null && incomingAt < previousAt) return current;
  const incomingIsTerminal = event.type === "email.bounced"
    || event.type === "email.failed"
    || event.type === "email.complained";
  if (previousAt !== null && incomingAt === previousAt) {
    if (!incomingIsTerminal) return current;
    if (terminalFailureStatuses.includes(current.status)) return current;
  }

  if (event.type === "email.delivered") {
    if (terminalFailureStatuses.includes(current.status)) {
      return withOccurredAt(current, event.occurredAt);
    }
    if (current.status === "DELIVERED" && current.deliveredAt && current.vetoDeadlineAt) {
      return withOccurredAt(current, event.occurredAt);
    }
    const deliveredAt = new Date(event.occurredAt);
    return {
      status: "DELIVERED",
      providerMessageId,
      deliveredAt: deliveredAt.toISOString(),
      vetoDeadlineAt: vetoDeadlineFromDelivery(deliveredAt).toISOString(),
      lastEventOccurredAt: event.occurredAt,
    };
  }
  if (event.type === "email.bounced") {
    return {
      status: "BOUNCED",
      providerMessageId,
      deliveredAt: null,
      vetoDeadlineAt: null,
      lastEventOccurredAt: event.occurredAt,
    };
  }
  if (event.type === "email.failed") {
    return {
      status: "FAILED",
      providerMessageId,
      deliveredAt: null,
      vetoDeadlineAt: null,
      lastEventOccurredAt: event.occurredAt,
    };
  }
  if (event.type === "email.complained") {
    return {
      status: "COMPLAINED",
      providerMessageId,
      deliveredAt: null,
      vetoDeadlineAt: null,
      lastEventOccurredAt: event.occurredAt,
    };
  }
  if (delayTypes.includes(event.type)) {
    if (current.status === "DELIVERED" || terminalFailureStatuses.includes(current.status)) {
      return withOccurredAt(current, event.occurredAt);
    }
    return {
      ...current,
      status: "DELAYED",
      providerMessageId,
      lastEventOccurredAt: event.occurredAt,
    };
  }
  if (event.type === "email.sent") {
    if (current.status === "DELIVERED" || terminalFailureStatuses.includes(current.status)) {
      return withOccurredAt(current, event.occurredAt);
    }
    return {
      ...current,
      status: "ACCEPTED",
      providerMessageId,
      lastEventOccurredAt: event.occurredAt,
    };
  }
  return current;
}

export function noticeAuthorizesClock(state: NoticeDeliveryState): boolean {
  return state.status === "DELIVERED" && Boolean(state.providerMessageId) && Boolean(state.deliveredAt) && Boolean(state.vetoDeadlineAt);
}
