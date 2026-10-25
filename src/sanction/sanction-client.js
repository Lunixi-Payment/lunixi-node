'use strict';

const { ConfigurationError, ApiError } = require('../errors');
const {
  SANCTION_ROUTES,
  SANCTION_NESTED_FIELDS,
  SANCTION_VALUE_SETS,
} = require('./sanction-values');

/**
 * Sanctions screening — `/api/v1/sanction/*`, `client.sanction`.
 *
 * Calls carry the access token minted from your API key (no per-request
 * signature). The key needs the `SANCTION_SERVICE` product and the
 * `sanction:view_results` permission (403 otherwise).
 *
 * Screening returns matches, not verdicts: the decision is yours. Read a
 * result with `isClearScreening(result)`: an empty match list is clear only
 * when `coverageStatus` is `COMPLETE`. When the screening cannot run (no list
 * publication can be pinned) the gateway answers 503 and the call throws a
 * `ServiceUnavailableError`; it never comes back as an empty result.
 *
 * Responses are the gateway envelope's `data`, unwrapped. The top-level
 * envelope `requestId` is the HTTP request's id; the screening's own id is
 * `screeningRequestId` (name screening). List calls return
 * `{ items, nextCursor, hasMore, totalCount, raw }`.
 */
class SanctionClient {
  constructor(api) {
    this.api = api;
  }

  // ── Screening ─────────────────────────────────────────────────────────────

  /** Person or organization: `{ name, subjectType?, country?, dateOfBirth?, identifiers?, riskDomains?, mode?, threshold?, customerReference? }`. */
  async screenName(request) {
    return unwrapScreening(await invoke(this.api, 'screenName', {}, request));
  }

  /** Crypto wallet address (exact match against the listed addresses). */
  async screenWallet(request) {
    return unwrapScreening(await invoke(this.api, 'screenWallet', {}, request));
  }

  /** Bank account / IBAN against your own deny list and account risk data (no list publication). */
  async screenAccount(request) {
    return unwrapScreening(await invoke(this.api, 'screenAccount', {}, request));
  }

  /** Every party and account of a transaction, against one list publication. */
  async screenTransaction(request) {
    return unwrapScreening(await invoke(this.api, 'screenTransaction', {}, request));
  }

  /**
   * Public procurement debarment lists, by name and TCKN/VKN. The Turkish KİK
   * list is not published, so `coverageStatus` is `PARTIAL` and
   * `uncoveredSources` names it: no match is not a clean result for it.
   */
  async screenPublicProcurementBan(request) {
    return unwrapScreening(await invoke(this.api, 'screenPublicProcurementBan', {}, request));
  }

  /** Adverse media. Runs only when your adverse-media policy is enabled. */
  async screenAdverseMedia(request) {
    return unwrapScreening(await invoke(this.api, 'screenAdverseMedia', {}, request));
  }

  /** Behavioural risk signal evaluation. */
  async evaluateBehavioralAlert(request) {
    return unwrapScreening(await invoke(this.api, 'evaluateBehavioralAlert', {}, request));
  }

  /** Earlier screenings (audit trail), newest first. */
  async listScreeningHistory(filters = {}) {
    return toPage(await invoke(this.api, 'listScreeningHistory', { query: filters }));
  }

  async *iterateScreeningHistory(filters = {}) {
    yield* paginate((pageFilters) => this.listScreeningHistory(pageFilters), filters);
  }

  // ── Ongoing monitoring ────────────────────────────────────────────────────

  /**
   * Registers a subject for ongoing monitoring; returns `{ monitoredEntityId }`.
   * `profile` (an object: name, dateOfBirth, country, identifiers…) is sent as
   * `profileJson`; pass one of the two.
   */
  async registerMonitoring(request = {}) {
    const { profile, ...rest } = request;
    if (profile !== undefined && rest.profileJson !== undefined) {
      throw new ConfigurationError('registerMonitoring takes profile or profileJson, not both.');
    }
    const body = profile === undefined ? rest : { ...rest, profileJson: JSON.stringify(profile) };
    return unwrap(await invoke(this.api, 'registerMonitoring', {}, body));
  }

  /** New-match alerts raised by monitoring; `status` narrows (e.g. `open`). */
  async listMonitoringAlerts(filters = {}) {
    return toPage(await invoke(this.api, 'listMonitoringAlerts', { query: filters }));
  }

  async *iterateMonitoringAlerts(filters = {}) {
    yield* paginate((pageFilters) => this.listMonitoringAlerts(pageFilters), filters);
  }

  /** Monitored subjects; `activeOnly` defaults to `true` on the gateway. */
  async listMonitoredEntities(filters = {}) {
    return toPage(await invoke(this.api, 'listMonitoredEntities', { query: filters }));
  }

  async *iterateMonitoredEntities(filters = {}) {
    yield* paginate((pageFilters) => this.listMonitoredEntities(pageFilters), filters);
  }

  /** Matches raised by monitoring. */
  async listMonitoringMatches(filters = {}) {
    return toPage(await invoke(this.api, 'listMonitoringMatches', { query: filters }));
  }

  async *iterateMonitoringMatches(filters = {}) {
    yield* paginate((pageFilters) => this.listMonitoringMatches(pageFilters), filters);
  }

  /**
   * Freshness of the source lists: `{ manifest }`. A manifest that could not be
   * produced comes back as `status: "failure"` and throws.
   */
  async getDatasetFreshness() {
    return unwrapScreening(await invoke(this.api, 'getDatasetFreshness'));
  }

  // ── Entity intelligence ───────────────────────────────────────────────────

  /** `{ q, limit? }` — entity search by name. */
  async searchEntities(filters = {}) {
    return unwrap(await invoke(this.api, 'searchEntities', { query: filters }));
  }

  /** Entity risk profile; pass `screeningRequestId` to read it on that screening's publication. */
  async getEntityProfile(entityId, { screeningRequestId } = {}) {
    return unwrap(await invoke(this.api, 'getEntityProfile', { entityId, query: compact({ screeningRequestId }) }));
  }

  /** Relationship graph, `depth` 1–3. */
  async getEntityGraph(entityId, { depth } = {}) {
    return unwrap(await invoke(this.api, 'getEntityGraph', { entityId, query: compact({ depth }) }));
  }

  /** Indirect exposure paths; `entityIds` are the records of a merged match. */
  async getIndirectExposure(entityId, { maxDepth, entityIds } = {}) {
    return unwrap(await invoke(this.api, 'getIndirectExposure', { entityId, query: compact({ maxDepth, entityIds: idList(entityIds) }) }));
  }

  /** Ownership aggregation (50% rule); `entityIds` are the records of a merged match. */
  async getOwnershipAggregation(entityId, { depth, entityIds } = {}) {
    return unwrap(await invoke(this.api, 'getOwnershipAggregation', { entityId, query: compact({ depth, entityIds: idList(entityIds) }) }));
  }

  // ── Deny list ─────────────────────────────────────────────────────────────

  /** Your own deny-list entries (read only with an API key). */
  async listBlacklistEntries(filters = {}) {
    return toPage(await invoke(this.api, 'listBlacklistEntries', { query: filters }));
  }

  async *iterateBlacklistEntries(filters = {}) {
    yield* paginate((pageFilters) => this.listBlacklistEntries(pageFilters), filters);
  }
}

/**
 * Sends one route of `SANCTION_ROUTES`. The body and query are checked against
 * the route before anything leaves the process: an unknown field, a missing
 * required field, a value outside its set or an unknown filter is a
 * `ConfigurationError`, not a silently dropped field.
 */
async function invoke(api, routeName, params = {}, body = undefined) {
  const route = SANCTION_ROUTES[routeName];
  const path = fillPath(route.path, params);
  const query = params.query ? pickQuery(routeName, route, params.query) : undefined;
  const payload = route.method === 'GET' ? null : checkBody(routeName, route, body ?? {});
  const options = {};
  if (query && Object.keys(query).length > 0) options.query = query;
  return api.request(route.method, path, payload, options);
}

function fillPath(template, params) {
  return template.replace(/:([A-Za-z]+)/g, (_, name) => {
    const value = params[name];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ConfigurationError(`${name} is required.`);
    }
    return encodeURIComponent(value.trim());
  });
}

function checkBody(routeName, route, body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ConfigurationError(`${routeName} body must be an object.`);
  }
  const plain = fields(routeName, typeof body.toJSON === 'function' ? body.toJSON() : body, route.required || [], route.optional || []);
  if (route.anyOf && !route.anyOf.some((key) => present(plain[key]))) {
    throw new ConfigurationError(`${routeName} requires at least one of ${route.anyOf.join(', ')}.`);
  }
  for (const [key, value] of Object.entries(plain)) {
    const nested = SANCTION_NESTED_FIELDS[`${routeName}.${key}`];
    if (nested) plain[key] = checkRows(`${routeName}.${key}`, nested, value);
    const allowed = SANCTION_VALUE_SETS[`${routeName}.${key}`];
    if (allowed) checkValues(`${routeName}.${key}`, allowed, value);
  }
  return plain;
}

function fields(label, object, required, optional) {
  const plain = compact(object);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(plain).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ConfigurationError(`${label} does not accept ${unknown.join(', ')}.`);
  }
  const missing = required.filter((key) => !present(plain[key]));
  if (missing.length > 0) throw new ConfigurationError(`${label} requires ${missing.join(', ')}.`);
  return plain;
}

function checkRows(label, spec, rows) {
  if (!Array.isArray(rows)) throw new ConfigurationError(`${label} must be an array.`);
  return rows.map((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new ConfigurationError(`${label}[${index}] must be an object.`);
    }
    return fields(`${label}[${index}]`, row, spec.required, spec.optional);
  });
}

function checkValues(label, allowed, value) {
  const values = Array.isArray(value) ? value : [value];
  const outside = values.filter((entry) => !allowed.includes(entry));
  if (outside.length > 0) {
    throw new ConfigurationError(`${label} must be one of ${allowed.join(', ')}; got ${outside.map((entry) => JSON.stringify(entry)).join(', ')}.`);
  }
}

function pickQuery(routeName, route, filters) {
  const allowed = route.query || [];
  const unknown = Object.keys(filters).filter((key) => !allowed.includes(key) && filters[key] !== undefined);
  if (unknown.length > 0) {
    throw new ConfigurationError(`${routeName} does not accept the filter(s) ${unknown.join(', ')}.`);
  }
  return compact(Object.fromEntries(allowed.map((key) => [key, filters[key]])));
}

/** Member ids of a merged match, sent comma-separated (the gateway accepts both forms). */
function idList(entityIds) {
  if (entityIds === undefined || entityIds === null) return undefined;
  const values = (Array.isArray(entityIds) ? entityIds : [entityIds]).map((id) => String(id).trim()).filter(Boolean);
  return values.length > 0 ? values.join(',') : undefined;
}

function present(value) {
  if (value === undefined || value === null || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null));
}

function unwrap(response) {
  return response && Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response;
}

/**
 * A 2xx answer that is not `status: "success"` is refused rather than read: a
 * screening that did not run must never look like an empty result.
 */
function unwrapScreening(response) {
  if (response && typeof response.status === 'string' && response.status !== 'success') {
    throw new ApiError(response.message || 'The screening did not complete.', {
      statusCode: response.statusCode,
      code: response.code,
      response,
      requestId: response.requestId,
    });
  }
  return unwrap(response);
}

/**
 * Sanction lists answer `{ items, nextCursor }` (history, alerts, entities) or
 * `{ items }` with the envelope's `pageInfo` beside `data` (matches, deny list).
 */
function toPage(response) {
  const data = unwrap(response) ?? {};
  const pageInfo = response?.pageInfo ?? data.pageInfo ?? {};
  const items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
  const cursor = data.nextCursor ?? pageInfo.nextCursor ?? null;
  const nextCursor = typeof cursor === 'string' && cursor !== '' ? cursor : null;
  const total = data.totalCount ?? pageInfo.totalCount ?? null;
  return {
    items,
    nextCursor,
    hasMore: typeof pageInfo.hasMore === 'boolean' ? pageInfo.hasMore : nextCursor !== null,
    totalCount: typeof total === 'number' ? total : null,
    raw: data,
  };
}

async function* paginate(fetchPage, filters) {
  let cursor = filters.cursor;
  do {
    const page = await fetchPage(cursor ? { ...filters, cursor } : filters);
    for (const item of page.items) yield item;
    cursor = page.nextCursor;
  } while (cursor);
}

module.exports = { SanctionClient };
