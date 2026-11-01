# Reviewed synthetic secret fixtures

The release scanner extends every built-in Gitleaks rule. Only the
`generic-api-key` rule has three narrow allowlists: **exact extracted fixture value
AND exact test path**. No file, line, directory, commit, detector or production
value is globally ignored. A value moved outside its reviewed path remains a
finding; a new value in any reviewed fixture remains a finding.

The webhook and insurance exceptions originated in a byte-for-byte review of
the public **v0.20.0** source. For **v1.0.0**, the insurance test was reviewed
again: its changes convert monetary test inputs and expectations to strings;
its synthetic idempotency value and isolated transport remain unchanged. The
Physical POS fixture is shared byte for byte with the PHP, Java and Python
SDKs. Its flagged UUID is an accepted `idempotencyKeyCases` input, not an
authentication credential. The guard pins the currently reviewed contents:

| Public fixture | SHA256 | Purpose |
| --- | --- | --- |
| [webhook-v2-vectors.json](https://github.com/Lunixi-Payment/lunixi-node/blob/v0.20.0/test/fixtures/webhook-v2-vectors.json) | `565c81e8397355ed5c64e36064d345a5617c233841be149ba7336b55b478c94d` | Three fixed-input, synthetic HMAC vectors; all expected signatures recomputed successfully. |
| [insurance-client.test.js](../test/insurance-client.test.js) | `a09a65d068451248643a95bad369cebae204af94a041839a03ee4327b75f101e` | Fixed fake operation key used by isolated insurance transport tests; reviewed again for the string money contract. |
| [physical-pos-parity.json](../test/fixtures/physical-pos-parity.json) | `701ef57d5523516d2af74818456f0926f243e6b65e19ce38f23353d7d22a4b40` | Synthetic idempotency-key validation cases shared by four SDKs. |

The reviewed values have no occurrences in production `src/`. Literal values
are intentionally omitted from this rationale and verification output. The
configuration contains only their exact anchored matches, scoped to their test
paths; temporary-export directory prefixes do not affect the path matching.

Run with Python 3.11+ and Gitleaks 8.21+:

```bash
python3 tools/check-secret-fixtures.py
gitleaks dir . --config .gitleaks.toml --redact=100 --no-banner
```

The guard verifies immutable fixture hashes, five original default findings,
zero configured fixture findings, fresh credential-shaped controls in each
allowed file, an exact reviewed value from every fixture moved to another path and an unrelated
default GitHub-token detector. All probes use private temporary test copies;
no credentials are created at a service and no original fixture is modified.
Unredacted fixture-only reports are deleted with the temporary directory and
never printed. Changed fixture content requires a new provenance review.

The configuration follows Gitleaks' documented
[default-rule extension and AND allowlists](https://github.com/gitleaks/gitleaks#configuration).
