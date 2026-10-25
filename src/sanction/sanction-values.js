'use strict';

/**
 * Sanctions screening — the merchant API surface, `/api/v1/sanction/*`.
 *
 * `SANCTION_ROUTES` is the single description of every route the SDK calls:
 * the HTTP method, the path template, the body fields the gateway forwards to
 * the sanction service and the query parameters it reads. The client checks a
 * call against it before sending, the PHP SDK's `Sanction\SanctionRoutes` is
 * the same table, and the Postman collection test reads it, so the three
 * cannot drift.
 *
 * Only routes an API key can reach are listed. Every route is behind
 * `BearerAuthGuard → PermissionsGuard → ProductGuard(SANCTION_SERVICE)`; a
 * key's permissions are capped by the sanction plan (`sanction:view_results`,
 * `sanction:override`, `sanction:view_reports`), so the routes below need
 * `sanction:view_results`. Not listed, on purpose:
 *   - `GET /screening/:requestId/report` (PDF): panel session only;
 *   - `POST /blacklist`, the analyst decision, approval and assignment routes
 *     and `POST /intelligence/entity-resolution/run`: they need
 *     `sanction:add_list_entry`, `sanction:adjudicate` or `sanction:assign_case`,
 *     which an API key does not carry;
 *   - the list-source syncs and the adverse-media policy write: compliance
 *     operator routes, not a merchant integration.
 *
 * Source of truth: nest-payment-gateway
 *   apps/api-gateway/src/sanction/sanction.controller.ts (routes, permissions)
 *   apps/api-gateway/src/sanction/sanction.service.ts    (response shapes)
 *   libs/proto/sanction/sanction.proto                   (request fields)
 */

const freeze = (value) => Object.freeze(value);

/** Risk domains a screening can be narrowed to (`riskDomains`). Omitted: every domain. */
const SanctionRiskDomain = freeze({
  SANCTIONS: 'sanctions',
  PEP: 'pep',
  RCA: 'rca',
  WANTED: 'wanted',
  REGULATORY: 'regulatory',
  DEBARMENT: 'debarment',
  OWNERSHIP: 'ownership',
  VESSEL: 'vessel',
  SECURITIES: 'securities',
});

/** Name-screening presets. Sent with `riskDomains`, their intersection is screened. */
const SanctionScreenMode = freeze({
  SANCTIONS_ONLY: 'sanctions_only',
  SANCTIONS_PEP: 'sanctions_pep',
  FULL_RISK: 'full_risk',
});

/** Wallet-screening depth; the wider modes add exposure and crypto-intelligence hits. */
const SanctionWalletScreenMode = freeze({
  WALLET_SANCTIONS: 'wallet_sanctions',
  WALLET_RISK: 'wallet_risk',
  WALLET_FULL_AML: 'wallet_full_aml',
});

const SanctionSubjectType = freeze({ PERSON: 'person', ORGANIZATION: 'organization' });

/**
 * How much of the requested scope a screening covered.
 *   COMPLETE: every requested risk domain was screened.
 *   PARTIAL:  some requested domain has no list (`uncoveredRiskDomains`,
 *             `uncoveredSources`); no match is clear only for what was screened.
 *   DEGRADED: the candidate search was limited; run the screening again.
 */
const SanctionCoverageStatus = freeze({ COMPLETE: 'COMPLETE', PARTIAL: 'PARTIAL', DEGRADED: 'DEGRADED' });

const SanctionHitType = freeze({ EXACT: 'exact', PROBABLE: 'probable', POSSIBLE: 'possible' });

const PAGE_QUERY = ['limit', 'cursor'];

/**
 * @typedef {object} SanctionRoute
 * @property {'GET'|'POST'} method
 * @property {string} path         path template; `:name` segments are filled from arguments
 * @property {boolean} screening   a screening: the answer must be `status: "success"` to be read
 * @property {string[]} [required] body fields the call cannot do without
 * @property {string[]} [optional] other body fields the gateway forwards
 * @property {string[]} [anyOf]    at least one of these body fields must be present (a list: non-empty)
 * @property {string[]} [query]    accepted query parameters
 */

/** @type {Readonly<Record<string, SanctionRoute>>} */
const SANCTION_ROUTES = freeze({
  // Screening
  screenName: {
    method: 'POST', path: '/api/v1/sanction/screening/name', screening: true,
    required: ['name'],
    optional: ['subjectType', 'country', 'dateOfBirth', 'identifiers', 'riskDomains', 'mode', 'threshold', 'customerReference'],
  },
  screenWallet: {
    method: 'POST', path: '/api/v1/sanction/screening/wallet', screening: true,
    required: ['walletAddress'],
    optional: ['chain', 'mode', 'customerReference'],
  },
  screenAccount: {
    method: 'POST', path: '/api/v1/sanction/screening/account', screening: true,
    required: ['accountValue', 'accountScheme'],
    optional: ['providerCode', 'productChannel', 'customerReference'],
  },
  screenTransaction: {
    method: 'POST', path: '/api/v1/sanction/screening/transaction', screening: true,
    required: [],
    optional: ['transactionType', 'direction', 'amount', 'currency', 'channel', 'occurredAt', 'parties', 'accounts', 'metadataJson'],
    // Neither: the sanction service holds the transaction as not screenable.
    anyOf: ['parties', 'accounts'],
  },
  screenPublicProcurementBan: {
    method: 'POST', path: '/api/v1/sanction/intelligence/public-procurement-ban', screening: true,
    required: [],
    optional: ['entityName', 'tckn', 'vkn', 'entityType', 'onlyActive', 'limit', 'customerReference', 'productChannel'],
    anyOf: ['entityName', 'tckn', 'vkn'],
  },
  screenAdverseMedia: {
    method: 'POST', path: '/api/v1/sanction/intelligence/adverse-media', screening: true,
    required: [],
    optional: ['entityName', 'entityType', 'tckn', 'vkn', 'countryCode', 'limit', 'onlyActive', 'customerReference', 'productChannel'],
  },
  evaluateBehavioralAlert: {
    method: 'POST', path: '/api/v1/sanction/intelligence/behavioral-alert', screening: true,
    required: [],
    optional: ['subjectReference', 'customerReference', 'productChannel', 'velocityScore', 'unusualPattern', 'countryRiskLevel', 'metadataJson'],
  },
  listScreeningHistory: {
    method: 'GET', path: '/api/v1/sanction/screening/history', screening: false,
    query: [...PAGE_QUERY],
  },

  // Ongoing monitoring
  registerMonitoring: {
    method: 'POST', path: '/api/v1/sanction/monitoring/register', screening: false,
    required: ['externalCustomerId'],
    optional: ['subjectType', 'profileJson', 'frequency', 'riskDomainScope'],
  },
  listMonitoringAlerts: {
    method: 'GET', path: '/api/v1/sanction/monitoring/alerts', screening: false,
    query: ['status', ...PAGE_QUERY, 'includeTotal'],
  },
  listMonitoredEntities: {
    method: 'GET', path: '/api/v1/sanction/monitoring/entities', screening: false,
    query: ['activeOnly', ...PAGE_QUERY, 'includeTotal'],
  },
  listMonitoringMatches: {
    method: 'GET', path: '/api/v1/sanction/monitoring/matches', screening: false,
    query: ['status', ...PAGE_QUERY],
  },
  getDatasetFreshness: {
    method: 'GET', path: '/api/v1/sanction/monitoring/dataset-freshness', screening: false,
  },

  // Entity intelligence
  searchEntities: {
    method: 'GET', path: '/api/v1/sanction/intelligence/entity-search', screening: false,
    query: ['q', 'limit'],
  },
  getEntityProfile: {
    method: 'GET', path: '/api/v1/sanction/intelligence/entity-profiles/:entityId', screening: false,
    query: ['screeningRequestId'],
  },
  getEntityGraph: {
    method: 'GET', path: '/api/v1/sanction/intelligence/entity-graph/:entityId', screening: false,
    query: ['depth'],
  },
  getIndirectExposure: {
    method: 'GET', path: '/api/v1/sanction/intelligence/indirect-exposure/:entityId', screening: false,
    query: ['maxDepth', 'entityIds'],
  },
  getOwnershipAggregation: {
    method: 'GET', path: '/api/v1/sanction/intelligence/ownership-aggregation/:entityId', screening: false,
    query: ['depth', 'entityIds'],
  },

  // Your own deny list (read; adding an entry is not an API-key route)
  listBlacklistEntries: {
    method: 'GET', path: '/api/v1/sanction/blacklist', screening: false,
    query: [...PAGE_QUERY],
  },
});

/** Fields of the nested lists, checked element by element (the proto drops anything else). */
const SANCTION_NESTED_FIELDS = freeze({
  'screenName.identifiers': freeze({ required: ['type', 'value'], optional: [] }),
  'screenTransaction.parties': freeze({
    required: ['name'],
    optional: ['role', 'subjectType', 'countryCode', 'customerId', 'dateOfBirth', 'nationalId'],
  }),
  'screenTransaction.accounts': freeze({ required: ['accountType', 'value'], optional: ['role', 'providerCode', 'chain'] }),
});

/** Value sets checked before sending; the sanction service refuses anything else with 400. */
const SANCTION_VALUE_SETS = freeze({
  'screenName.riskDomains': Object.values(SanctionRiskDomain),
  'screenName.mode': Object.values(SanctionScreenMode),
  'screenName.subjectType': Object.values(SanctionSubjectType),
  'screenWallet.mode': Object.values(SanctionWalletScreenMode),
  'registerMonitoring.subjectType': Object.values(SanctionSubjectType),
  'registerMonitoring.riskDomainScope': Object.values(SanctionRiskDomain),
});

/**
 * Whether a screening answer can be read as "nothing found".
 *
 * True only when the answer has no match or hit of any kind and, when it
 * reports coverage, its `coverageStatus` is `COMPLETE`. A `PARTIAL` or
 * `DEGRADED` screening, a replay without coverage (`null`), a wallet held by
 * a listed party, a matched procurement ban, a transaction that needs a case
 * or a blocking decision is never clear. A failed screening (HTTP 503,
 * `status: "failure"`) never reaches this function: the client throws.
 *
 * Account and adverse-media screening do not report coverage; for them the
 * hits and flags decide.
 *
 * @param {object} result the `data` a screening method returned
 * @returns {boolean}
 */
function isClearScreening(result) {
  if (!result || typeof result !== 'object') return false;
  for (const key of ['matches', 'hits', 'publicationHits']) {
    if (Array.isArray(result[key]) && result[key].length > 0) return false;
  }
  if (result.isSanctioned === true || result.isBlacklisted === true || result.matched === true || result.caseRequired === true) {
    return false;
  }
  const decision = typeof result.decision === 'string' ? result.decision.toLowerCase() : '';
  if (['block', 'blocked', 'reject', 'rejected', 'review', 'hit', 'escalate'].includes(decision)) return false;
  if (Object.prototype.hasOwnProperty.call(result, 'coverageStatus')) {
    return result.coverageStatus === SanctionCoverageStatus.COMPLETE;
  }
  return true;
}

module.exports = {
  SanctionRiskDomain,
  SanctionScreenMode,
  SanctionWalletScreenMode,
  SanctionSubjectType,
  SanctionCoverageStatus,
  SanctionHitType,
  SANCTION_ROUTES,
  SANCTION_NESTED_FIELDS,
  SANCTION_VALUE_SETS,
  isClearScreening,
};
