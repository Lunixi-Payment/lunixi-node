'use strict';

/**
 * Envelope and paging helpers shared by the bank-connect clients
 * (`BankConnectClient`, `BankTransferClient`, `BankFxClient`).
 */

/** Follows `nextCursor` until the last page; yields the rows one by one. */
async function* paginate(fetchPage, filters) {
  let cursor = filters.cursor ?? undefined;
  for (;;) {
    const page = await fetchPage({ ...filters, cursor });
    for (const item of page.items) yield item;
    if (!page.hasMore || !page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

function unwrap(response) {
  return response && typeof response === 'object' && 'data' in response ? response.data : response;
}

/**
 * Reads a list envelope: rows are `data.items`; paging is the envelope's
 * top-level `pageInfo` (a copy inside `data` is read only as a fallback).
 * These lists do not count rows (`pageInfo.totalCount` is always null).
 */
function toPage(response) {
  const payload = unwrap(response);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const pageInfo = response?.pageInfo || payload?.pageInfo || {};
  const nextCursor = typeof pageInfo.nextCursor === 'string' && pageInfo.nextCursor !== '' ? pageInfo.nextCursor : null;
  return { items, hasMore: pageInfo.hasMore === true && nextCursor !== null, nextCursor };
}

module.exports = { paginate, unwrap, toPage };
