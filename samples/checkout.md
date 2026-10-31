# Native Express / NestJS checkout adapter

These are concrete framework route/rendering adapters, not a complete storefront or production database implementation. Import `createCheckoutApp({lunixi,nativeCheckout})` into an Express app after its existing session middleware, or bootstrap Nest with `createAppModule(options,nativeCheckout)`. Install your chosen framework separately. The SDK has no framework runtime dependencies.

Implement every method in [`_common/native-checkout.d.ts`](_common/native-checkout.d.ts):

| Method | Required native behavior |
| --- | --- |
| `authenticate(request)` | Verify the real session/customer identity; return no identity when anonymous. |
| `verifyCsrf(request,principal)` | Verify native CSRF/Origin policy for the cookie-authenticated financial POST; return boolean true only on success. |
| `reserveCheckout(principal,orderId)` | Lock/load the owned server order; enforce merchant/environment, unchanged integer totals and fulfillment holds; commit one immutable reservation before network I/O. Return its original request/key/time/mode and decrypted cached response only after ownership. |
| `bindCheckoutResponse(attempt,response)` | Atomically compare-and-bind the same attempt/payment, preserve concurrent identity, and encrypt the entire browser-capability response with an independent server key outside DB/web root. Never log token/URL. |
| `markCheckoutUncertain(attempt)` | Durably hold unknown outcomes, including uncertain commits; preserve original body/key/profile/history and require authenticated reconciliation before another attempt. |

New reservations default to `embedded`; an explicitly stored `redirect` choice remains unchanged. Build new request metadata `allowedOrigin` from configured HTTPS merchant origin, never Host/browser fields. Persist canonical request bytes/order/settings and stable ASCII 16–128-character key; do not regenerate them on every POST. The route accepts only the native order locator; request amounts/cards/status/mode are ignored. The helper blocks a cached token after 840 seconds and unconfirmed creates after 23 hours. Expiry is never permission for a new charge.

The helper renders the official SDK form with the original token. Optional redirect uses only strict backend paymentPageUrl and never constructs /payment/<embedded token>. Missing legacy URLs fail closed while existing embedded sessions may continue. No mode change may alter an active reservation's body/key or reset financial history.

Mount raw signed webhook handling before JSON middleware. Persist a unique event/body-hash inbox and reconcile authenticated GET evidence with merchant/payment/order/currency/base/fee and full settlement. Apply order/inbox/outbox in one native transaction and retain manual holds; partial or unknown/FAILED outcomes do not fulfill. Browser POST return handlers ignore all submitted fields and use a bounded fixed same-origin303 GET hop; browser return never proves capture. These application responsibilities are not implemented by the rendering adapter.

Offline helper tests cover ownership/CSRF ordering, XSS/CSP/object-token-mount schema, server totals, encrypted-cache interface, same-key retention, unknown outcomes, expired windows and strict hosted URLs. They are not native SQL/concurrency or live merchant acceptance evidence.
