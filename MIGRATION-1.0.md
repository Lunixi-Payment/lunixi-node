# 1.0.0 migration

All public monetary request and response fields now use canonical base-10 **strings in minor units**. For example, `amount: "1990"` represents TRY 19.90. This includes basket `price`, split and note amounts, capture/refund, balances and fixed fees on supported endpoints. Numeric JSON money is rejected; convert trusted native exact integers explicitly at your application boundary. Rates, basis points, quantities, counts and timestamps remain numeric.

Use the package’s decimal-text conversion helper with the actual currency. JPY has exponent 0, TRY/USD 2, KWD 3. Do not parse decimal text through float/double or assume a factor of 100. `"9007199254740993"` remains exact. Fiat amounts must fit signed 64-bit storage (maximum `"9223372036854775807"`); provider/platform limits may be lower. Crypto is a separate domain.

Canonical strings reject whitespace, signs on nonnegative values, leading zeros, decimals, exponents, `NaN`, `Infinity`, and negative zero. Payments are positive. Settlement totals may be zero; balances may be signed. Only omission retains remaining-amount semantics. Explicit JSON `null` and `"0"` are invalid. Split-refund amount remains required where the existing API requires it.

Update call sites, persisted outbound request schemas and gateway response fixtures together. Preserve an existing attempt’s exact body, idempotency key, environment and credential profile; reconcile historical attempts before creating new ones. The SDK does not silently rewrite historical payment bytes or accept both numeric and string wire money. Native internal exact integer storage may remain unchanged.

Raw webhook verification, signatures, authentication and replay/idempotency protections are unchanged. Upgrade the gateway and integrations as one coordinated breaking cut. Install version 1.0.0 after it is available in this package’s distribution channel.

Use `new CreateIntentRequest('1990', 'TRY', orderId)` and `decimalToMinor('19.90', 'TRY')`. Capture/refund accept string or omitted/`undefined`; balance typings are strings. Compare/sum validated values with `BigInt`, then serialize with `.toString()`.

## Optional capture/refund amounts

Omit the amount argument (or pass `undefined` to reach later positional arguments): `payments.capture(id, undefined, key)` and `payments.refund(id, undefined, reason, key)`. Explicit `null` is rejected before transport; TypeScript amount types no longer include `null`.

The advanced/raw request boundary also rejects a present `amount: null` on capture/refund routes. Unrelated nullable response fields and merchant metadata keep their existing meaning.

## Physical POS money contract

Physical POS uses the same canonical minor-unit string contract in HTTP requests, responses and verified webhooks. This includes `amountMinor`, `unitPriceMinor`, `lineTotalMinor`, refund-item confirmation amounts, transaction amount filters, tax bases/amounts and settlement totals. Numeric counters (`quantityMilli`, `lineNo`, `installmentCount`, `rowVersion`, tax rates and counts) keep their numeric types.

Use a positive string for a payment or an explicitly supplied refund/pre-authorisation-close amount. `unitPriceMinor` may be `"0"`. Omit the amount for VOID/PREAUTH_CANCEL; an item-based refund may omit its amount so the gateway derives it. An explicit JSON null, number, blank string or noncanonical string is rejected before transport, including nested item amounts. The response's `approvedAmountMinor: null` still means approval is not available. There is no numeric compatibility path.

Values such as `"9007199254740993"` remain exact up to the signed64 limit. This is a transport guarantee, not a promise that every device/provider accepts that amount. A 2xx payment response with malformed monetary fields has an unknown outcome: retain the same idempotency key and reconcile; do not create a new payment key. Query/verified-webhook money is validated without changing the signed raw body.
