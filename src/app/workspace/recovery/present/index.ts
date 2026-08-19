export { customerPhrases, cadenceShortLabels } from "./customer-copy";
export {
  customerStatuses,
  customerStatusLabels,
  toCustomerStatus,
  customerStatusForCommitment,
  commitmentNeedsAttention,
  type CustomerStatus,
  type CustomerStatusInput,
} from "./commitment-status";
export {
  homeAttentionItems,
  homeHasAttention,
  homeAttentionCount,
  shouldShowRecentChange,
  shouldShowComingUp,
  shouldOfferKeepCurrent,
  firstResultBrief,
  overlapIdsForWorkspace,
} from "./home-brief";
export { presentExpectedObservation, type ExpectedObservationCopy } from "./expected-observation";
export {
  commitmentDecisionState,
  commitmentDecisionStateLabel,
  decisionOutcomeTone,
  type DecisionStateTone,
} from "./decision-state";
export { customerErrorCopy, inboxFailureCopy, rejectedSubmissionCopy } from "./errors";
export {
  customerInboxStatus,
  customerInboxStatusLabel,
  gmailWizardStep,
  type CustomerInboxStatus,
} from "./inbox-status";
