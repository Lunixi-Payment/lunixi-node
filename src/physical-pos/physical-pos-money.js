'use strict';

const { minor } = require('../money');
const FIELDS = new Set(["amountFromMinor", "amountMinor", "amountToMinor", "approvedAmountMinor", "baseMinor", "capturedMinor", "lineTotalMinor", "netBaseMinor", "netMinor", "netTaxMinor", "refundBaseMinor", "refundMinor", "refundTaxMinor", "refundedAmountMinor", "refundedMinor", "reservedAmountMinor", "reservedMinor", "reversalReservedMinor", "reversedMinor", "saleBaseMinor", "saleMinor", "saleTaxMinor", "unitAmountMinor", "unitPriceMinor", "voidBaseMinor", "voidMinor", "voidTaxMinor"]);
const CONTAINERS = new Set(["data", "payment", "payments", "items", "refundItems", "taxes", "rows", "transaction", "transactions", "root", "children", "itemSummary", "amountTotals", "reported", "system", "difference", "totals", "lines"]);
const NULLABLE = new Set(["approvedAmountMinor", "unitAmountMinor"]);

/** Validate declared physical POS response money; counts and opaque metadata stay untouched. */
function validateResponseMoney(value, difference = false) {
  if (Array.isArray(value)) { value.forEach(entry => validateResponseMoney(entry, difference)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FIELDS.has(key)) {
      if (entry === null && NULLABLE.has(key)) continue;
      minor(entry, key, { positive: false, signed: difference || key.startsWith('net') });
    } else if (CONTAINERS.has(key)) validateResponseMoney(entry, difference || key === 'difference');
  }
}
module.exports = { validateResponseMoney };
