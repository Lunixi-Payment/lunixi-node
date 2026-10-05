'use strict';

/**
 * Fraud webhook event types a merchant endpoint can subscribe to.
 *
 * These are the FRAUD_SERVICE keys of the platform webhook catalogue, delivered
 * in the same signed envelope as payment webhooks and verified with
 * `WebhookVerifier` (v2 signature).
 *
 * Fraud has no webhook system of its own — every merchant-facing fraud event
 * goes through the platform channel. Internal event-bus topic names (the `*.v1`
 * decision and shadow topics) are NOT webhook event types and are never
 * delivered to a merchant endpoint.
 */
const FraudEvents = Object.freeze({
  /** Async flow result is ready; correlate with `decisionRequestId`. Advisory — it does not change the synchronous decision. */
  FLOW_ASYNC_COMPLETED: 'fraud.flow.async_completed',

  /** A "Platform Event" node in your flow fired; `label` and `data` are the values you defined in the flow. */
  FLOW_ACTION_TRIGGERED: 'fraud.flow.action_triggered',

  /** Fraud API quota threshold reached, or a request was rejected with 429. Sent once per day and lane. */
  QUOTA_THRESHOLD_REACHED: 'fraud.quota.threshold_reached',

  /** One of your fraud alert rules fired. */
  ALERT_TRIGGERED: 'fraud.alert.triggered',

  /** An outage affecting fraud evaluation was detected or declared. */
  SERVICE_DEGRADED: 'fraud.service.degraded',

  /** The outage closed. Carries the duration and how many decisions could not be checked. */
  SERVICE_RECOVERED: 'fraud.service.recovered',

  /**
   * A scheduled report you configured finished its period and was produced.
   * Carries NO download link — download links are short-lived and are produced
   * from the console. Reports requested manually do not send this event.
   */
  REPORT_READY: 'fraud.report.ready',
});

/** Every fraud webhook event type, in catalogue order. */
const FRAUD_EVENT_TYPES = Object.freeze([
  FraudEvents.FLOW_ASYNC_COMPLETED,
  FraudEvents.FLOW_ACTION_TRIGGERED,
  FraudEvents.QUOTA_THRESHOLD_REACHED,
  FraudEvents.ALERT_TRIGGERED,
  FraudEvents.SERVICE_DEGRADED,
  FraudEvents.SERVICE_RECOVERED,
  FraudEvents.REPORT_READY,
]);

/** Decision outcomes returned by the decision endpoint. */
const FraudDecisionValue = Object.freeze({
  ALLOW: 'allow',
  REVIEW: 'review',
  BLOCK: 'block',
  FORCE_3D: 'force_3d',
});

const FRAUD_DECISION_VALUES = Object.freeze(Object.values(FraudDecisionValue));

module.exports = {
  FraudEvents,
  FRAUD_EVENT_TYPES,
  FraudDecisionValue,
  FRAUD_DECISION_VALUES,
};
