'use strict';

const { ConfigurationError } = require('../errors');

const BASE = '/api/v1/reference/tr-address';
const PROVINCE_CODE_PATTERN = /^(0[1-9]|[1-7][0-9]|8[01])$/;
const DISTRICT_CODE_PATTERN = /^[0-9]{1,12}$/;

/**
 * Lunixi address dictionary for Türkiye (province → district → neighborhood).
 * The codes fill an `ADDRESS` input field, e.g. the debtor address of a
 * Senetle Ödeme payment: `{ provinceCode, districtCode, neighborhoodCode, line }`.
 *
 *   GET /api/v1/reference/tr-address/provinces
 *   GET /api/v1/reference/tr-address/districts?provinceCode=06
 *   GET /api/v1/reference/tr-address/neighborhoods?districtCode=…
 *
 * The endpoints are public reference data (no personal data); the answer is the
 * gateway envelope with `data.items: [{ code, name }]`. An empty list means the
 * data for that level is not published yet; show that state instead of
 * inventing codes.
 */
class ReferenceClient {
  constructor(api) {
    this.api = api;
  }

  /** Provinces with their Lunixi code (`01`–`81`). */
  async listProvinces() {
    return this.api.request('GET', `${BASE}/provinces`);
  }

  /** Districts of a province (`provinceCode` `01`–`81`). */
  async listDistricts(provinceCode) {
    if (typeof provinceCode !== 'string' || !PROVINCE_CODE_PATTERN.test(provinceCode)) {
      throw new ConfigurationError(`provinceCode must be a two-digit province code from 01 to 81; got ${JSON.stringify(provinceCode)}.`);
    }
    return this.api.request('GET', `${BASE}/districts`, null, { query: { provinceCode } });
  }

  /** Neighborhoods of a district (`districtCode` from `listDistricts()`). */
  async listNeighborhoods(districtCode) {
    if (typeof districtCode !== 'string' || !DISTRICT_CODE_PATTERN.test(districtCode)) {
      throw new ConfigurationError(`districtCode must be a district code (digits) from listDistricts(); got ${JSON.stringify(districtCode)}.`);
    }
    return this.api.request('GET', `${BASE}/neighborhoods`, null, { query: { districtCode } });
  }
}

module.exports = { ReferenceClient };
