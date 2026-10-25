'use strict';

/**
 * Senetle Ödeme (promissory-note payment, `paymentMethod: PROMISSORY_NOTE`):
 * value sets and the plan rules the SDK checks before sending.
 *
 *   POST /api/v1/payments/direct/payment                         (`promissoryNote` block)
 *   POST /api/v1/payments/intents                                (`promissoryNote.schedule`)
 *   GET  /api/v1/payments/{paymentId}/promissory-notes           (notes and their status)
 *   POST /api/v1/payments/{paymentId}/promissory-notes/cancel    (cancel notes at the provider)
 *   GET  /api/v1/payments/{paymentId}/promissory-notes/document  (printable PDF)
 *
 * The plan is given either as a schedule (`[{ amount, dueDate }]`) or as a note
 * count (`noteCount`), never both. The SDK checks what can be checked without
 * the provider connection: integer minor-unit amounts that add up to the
 * payment amount, `YYYY-MM-DD` calendar dates in ascending order and at most 24
 * rows. That a due date lies in the future (Istanbul calendar) and that the
 * note count is within the limits of your provider connection is checked by
 * the gateway (`400 payment.method.block_invalid`).
 */

const { ConfigurationError } = require('../errors');

/** Most rows of a schedule (and most notes of a payment). */
const PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS = 24;

/** Status of one note (`notes[].status`). */
const PromissoryNoteStatus = Object.freeze({
  ISSUED: 'ISSUED',
  PAID: 'PAID',
  PROTESTED: 'PROTESTED',
  CANCELLED: 'CANCELLED',
});

/** Document type of the issued notes, from your provider connection settings. */
const PromissoryNoteDocumentType = Object.freeze({
  PROMISSORY_NOTE: 'PROMISSORY_NOTE',
  PAYMENT_ORDER: 'PAYMENT_ORDER',
});

/** Per-note result of `payments.cancelPromissoryNotes()` (`cancelResults[].result`). */
const PromissoryNoteCancelResult = Object.freeze({
  CANCELLED: 'CANCELLED',
  /** The note was already cancelled. */
  ALREADY_CLOSED: 'ALREADY_CLOSED',
  /** The note was collected or protested; it cannot be cancelled. */
  NOT_CANCELLABLE: 'NOT_CANCELLABLE',
  /** The provider did not cancel the note; `errorCode` tells whether to try again. */
  FAILED: 'FAILED',
});

/**
 * `cancelResults[].errorCode`: a Lunixi code, never the provider's; `null` for
 * `CANCELLED` and `ALREADY_CLOSED`.
 */
const PromissoryNoteCancelErrorCode = Object.freeze({
  /** The note was collected or the provider does not cancel it (`NOT_CANCELLABLE`). */
  NOT_CANCELLABLE: 'payment.promissory_note.not_cancellable',
  /** Temporary: the provider could not be reached; cancel again later (`FAILED`). */
  PROVIDER_UNAVAILABLE: 'payment.promissory_note.provider_unavailable',
  /** Permanent: the provider refused the cancellation (`FAILED`). */
  CANCEL_REJECTED: 'payment.promissory_note.cancel_rejected',
});

/** Language of the printable notes. */
const PromissoryNoteDocumentLocale = Object.freeze({
  TR: 'tr-TR',
  EN: 'en-GB',
});

/**
 * Webhook events of a note. The envelope is the one of every `payment.*` event;
 * the payload adds `promissoryNote: { serialNumber, sequence, amountMinor,
 * dueDate, status, occurredAt }`. Statuses are polled from the provider, so the
 * event arrives some time after the due date, not at once.
 */
const PromissoryNoteEvents = Object.freeze({
  PAID: 'payment.promissory_note.paid',
  PROTESTED: 'payment.promissory_note.protested',
  CANCELLED: 'payment.promissory_note.cancelled',
});

const DUE_DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const NOTE_COUNT_PATTERN = /^[1-9][0-9]?$/;
const SERIAL_NUMBER_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

function isCalendarDate(value) {
  const match = DUE_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * A schedule: 1–24 rows `{ amount, dueDate }`, `amount` a positive integer in
 * minor units, `dueDate` a `YYYY-MM-DD` calendar date, rows in ascending date
 * order (the same day twice is fine). Returns a copy of the rows.
 */
function requirePromissoryNoteSchedule(value, path = 'promissoryNote.schedule') {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigurationError(`${path} must be a non-empty list of { amount, dueDate } rows.`);
  }
  if (value.length > PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS) {
    throw new ConfigurationError(`${path} can have at most ${PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS} rows; got ${value.length}.`);
  }
  let previousDueDate = null;
  return value.map((row, index) => {
    const rowPath = `${path}[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new ConfigurationError(`${rowPath} must be an object { amount, dueDate }.`);
    }
    const unknown = Object.keys(row).filter((key) => key !== 'amount' && key !== 'dueDate');
    if (unknown.length > 0) {
      throw new ConfigurationError(`${rowPath} has unknown field(s): ${unknown.join(', ')}. A row is { amount, dueDate }.`);
    }
    if (!Number.isSafeInteger(row.amount) || row.amount < 1) {
      throw new ConfigurationError(`${rowPath}.amount must be a positive integer in minor units (e.g. 100000 for 1,000.00 TRY); got ${JSON.stringify(row.amount)}.`);
    }
    if (typeof row.dueDate !== 'string' || !isCalendarDate(row.dueDate)) {
      throw new ConfigurationError(`${rowPath}.dueDate must be a calendar date in YYYY-MM-DD form; got ${JSON.stringify(row.dueDate)}.`);
    }
    if (previousDueDate !== null && row.dueDate < previousDueDate) {
      throw new ConfigurationError(`${rowPath}.dueDate must not be earlier than the previous row (${previousDueDate}); list the notes in due-date order.`);
    }
    previousDueDate = row.dueDate;
    return { amount: row.amount, dueDate: row.dueDate };
  });
}

/** The rows of a schedule must add up to the payment amount. */
function assertScheduleMatchesAmount(schedule, amount, path = 'promissoryNote.schedule') {
  const total = schedule.reduce((sum, row) => sum + row.amount, 0);
  if (total !== amount) {
    throw new ConfigurationError(`${path} adds up to ${total}; it must equal amount (${amount}).`);
  }
}

/**
 * Number of notes when no schedule is given: an integer 1–24 or its digit
 * string. It is sent as a string, the value of the `noteCount` option in
 * `inputFields` (`"1"` … `"N"`, N from your provider connection).
 */
function requireNoteCount(value, path = 'promissoryNote.noteCount') {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !NOTE_COUNT_PATTERN.test(text) || Number(text) > PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS) {
    throw new ConfigurationError(`${path} must be a number of notes from 1 to ${PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS}; got ${JSON.stringify(value)}.`);
  }
  return text;
}

function given(value) {
  return value !== undefined && value !== null;
}

/**
 * The plan of a `promissoryNote` block of `direct/payment`: exactly one of
 * `schedule` or `noteCount`; a schedule must add up to `amount`.
 */
function assertPromissoryNotePlan(block, amount, path = 'promissoryNote') {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    throw new ConfigurationError(`${path} must be an object.`);
  }
  const hasSchedule = given(block.schedule);
  const hasNoteCount = given(block.noteCount);
  if (hasSchedule && hasNoteCount) {
    throw new ConfigurationError(`${path}: send either schedule or noteCount, not both.`);
  }
  if (!hasSchedule && !hasNoteCount) {
    throw new ConfigurationError(`${path} needs the plan: a schedule ([{ amount, dueDate }]) or a noteCount.`);
  }
  if (hasNoteCount) {
    requireNoteCount(block.noteCount, `${path}.noteCount`);
    return;
  }
  const schedule = requirePromissoryNoteSchedule(block.schedule, `${path}.schedule`);
  if (Number.isSafeInteger(amount)) assertScheduleMatchesAmount(schedule, amount, `${path}.schedule`);
}

/**
 * `promissoryNote` of an intent body: `{ schedule }` only (the buyer chooses a
 * note count on the hosted form when no schedule is given).
 */
function assertIntentPromissoryNote(value, amount, path = 'promissoryNote') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigurationError(`${path} must be an object { schedule }.`);
  }
  const unknown = Object.keys(value).filter((key) => key !== 'schedule');
  if (unknown.length > 0) {
    throw new ConfigurationError(`${path} of an intent carries only schedule; unknown field(s): ${unknown.join(', ')}.`);
  }
  const schedule = requirePromissoryNoteSchedule(value.schedule, `${path}.schedule`);
  if (Number.isSafeInteger(amount)) assertScheduleMatchesAmount(schedule, amount, `${path}.schedule`);
}

/** Serial numbers to cancel: 1–24 note serial numbers. */
function requireSerialNumbers(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS) {
    throw new ConfigurationError(`serialNumbers must be a list of 1 to ${PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS} note serial numbers (from payments.getPromissoryNotes()); leave it out to cancel every open note.`);
  }
  for (const value of values) {
    if (typeof value !== 'string' || !SERIAL_NUMBER_PATTERN.test(value)) {
      throw new ConfigurationError(`serialNumbers contains an invalid serial number ${JSON.stringify(value)} (letters, digits and -, 4 to 64 characters).`);
    }
  }
  return [...values];
}

function requireDocumentLocale(value) {
  const allowed = Object.values(PromissoryNoteDocumentLocale);
  if (!allowed.includes(value)) {
    throw new ConfigurationError(`locale must be one of ${allowed.join(', ')}; got ${JSON.stringify(value)}.`);
  }
  return value;
}

module.exports = {
  PROMISSORY_NOTE_MAX_SCHEDULE_ITEMS,
  PromissoryNoteStatus,
  PromissoryNoteDocumentType,
  PromissoryNoteCancelResult,
  PromissoryNoteCancelErrorCode,
  PromissoryNoteDocumentLocale,
  PromissoryNoteEvents,
  requirePromissoryNoteSchedule,
  assertScheduleMatchesAmount,
  requireNoteCount,
  assertPromissoryNotePlan,
  assertIntentPromissoryNote,
  requireSerialNumbers,
  requireDocumentLocale,
};
