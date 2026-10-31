# Reviewed synthetic secret fixtures

The release scanner extends every built-in Gitleaks rule. Only the
`generic-api-key` rule has two narrow allowlists: **exact extracted fixture value
AND exact test path**. No file, line, directory, commit, detector or production
value is globally ignored. A value moved outside its reviewed path remains a
finding; a new value in either fixture remains a finding.

Both files were fetched read-only from the already-public **v0.20.0** source and
compared byte for byte before adding these exceptions:

| Public fixture | SHA256 | Purpose |
| --- | --- | --- |
| [webhook-v2-vectors.json](https://github.com/Lunixi-Payment/lunixi-node/blob/v0.20.0/test/fixtures/webhook-v2-vectors.json) | `565c81e8397355ed5c64e36064d345a5617c233841be149ba7336b55b478c94d` | Three fixed-input, synthetic HMAC vectors; all expected signatures recomputed successfully. |
| [insurance-client.test.js](https://github.com/Lunixi-Payment/lunixi-node/blob/v0.20.0/test/insurance-client.test.js) | `da52e3f44f1a5aa59b001d0f00efd022b3f1b015d2a8a7a94ed1dbe4d5c1b9fe` | Fixed fake operation key used by isolated insurance transport tests. |

The reviewed values have no occurrences in production `src/`. Literal values
are intentionally omitted from this rationale and verification output. The
configuration contains only their exact anchored matches, scoped to their test
paths; temporary-export directory prefixes do not affect the path matching.

Run with Python 3.11+ and Gitleaks 8.21+:

```bash
python3 tools/check-secret-fixtures.py
gitleaks dir . --config .gitleaks.toml --redact=100 --no-banner
```

The guard verifies immutable fixture hashes, four original default findings,
zero configured fixture findings, fresh credential-shaped controls in each
allowed file, the exact reviewed value moved to another path and an unrelated
default GitHub-token detector. All probes use private temporary test copies;
no credentials are created at a service and no original fixture is modified.
Unredacted fixture-only reports are deleted with the temporary directory and
never printed. Changed fixture content requires a new provenance review.

The configuration follows Gitleaks' documented
[default-rule extension and AND allowlists](https://github.com/gitleaks/gitleaks#configuration).
