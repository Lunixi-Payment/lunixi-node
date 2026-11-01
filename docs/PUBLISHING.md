# Publishing @lunixi/node-sdk

The manual `publish-npm.yml` workflow uses npm Trusted Publishing (GitHub OIDC),
not a stored npm token. Preparing this workflow does not configure a publisher
or establish that a version is already available on npm.

The workflow is maintained in the public-repository template and exported to
`.github/workflows/publish-npm.yml` in
[Lunixi-Payment/lunixi-node](https://github.com/Lunixi-Payment/lunixi-node).
It must be present on the default branch for manual dispatch and in the release
tag being published. A source-owned workflow at the same path takes precedence
over the template during export; keep exactly one canonical implementation.

## Account-owned grant

An already-authorized owner of **@lunixi/node-sdk** must review and add this
publisher in the package's npm settings. This is a new publishing permission;
it is not created by the workflow or by adding its source file.

| npm Trusted Publisher field | Exact value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `Lunixi-Payment` |
| Repository | `lunixi-node` |
| Workflow filename | `publish-npm.yml` (filename only) |
| Environment name | Leave blank; this workflow creates no environment |
| Package | `@lunixi/node-sdk` only |
| Allowed direct action | Allow `npm publish` |
| Distribution-tag administration | Do not enable `npm dist-tag`; this workflow does not need it |

Current npm publisher configurations allow staging by default. Staging alone
does not authorize the direct `npm publish` command used here. Grant only the
matching package/workflow direct-publish permission, without creating an
organization, accepting new legal terms, changing account security settings or
adding token-based/2FA-bypass access. Preserve existing owner/security policies.
If the owner session requires reauthentication or MFA, the owner completes it;
do not work around it with another account or credential. npm currently expires
a new publisher that has not completed its first publish within two days, so
configure it only when the reviewed release is ready.

## Manual release

1. Publish the reviewed numeric source version/tag and wait for successful
   `ci.yml` **push CI on that exact commit**. This workflow does not rerun the
   functional suite or accept successful CI from another revision.
2. On **Actions → Publish npm with Trusted Publishing → Run workflow**, choose
   the exact `v1.0.0` tag and enter `1.0.0` as the package version. If a later
   publication-only workflow correction is required, its `npm-publish-v<version>`
   tag must descend from the original immutable release and
   the complete comparison may modify only `.github/workflows/publish-npm.yml`;
   SDK, dependency, README and other changes are rejected. Its exact commit
   must also have successful push CI. Never dispatch from `main`: provenance
   identifies the invocation's `GITHUB_REF`/`GITHUB_SHA`.
3. The read-only builder resolves and peels the public tag, checks the full
   immutable commit against the dispatch SHA, checks exact package/repository
   identity, and refuses an existing npm version. It scans source with the
   reviewed narrow fixture exceptions and all default rules, including fresh
   negative controls. It syntax-checks, packs without lifecycle scripts, checks
   package paths/identity, and scans unpacked package content with **default
   rules and no fixture exceptions**.
4. A separate GitHub-hosted publish job downloads the same tarball and verifies
   its SHA256, manifest and release/source receipt without executing package
   code. Only this job has `id-token: write`. It uses checksum-pinned npm
   **12.2.1** on Node **24.22.2**, fresh npm configuration, no stored token and
   `npm publish "./package/lunixi-node-sdk-${VERSION}.tgz" --provenance --ignore-scripts`.
   The explicit `./` keeps the argument a local file; Git-package fetching stays
   disabled. No dependency install or package
   lifecycle runs in this job; only the pinned official npm client is installed.
5. Verify the exact npm version, tarball SHA/integrity and provenance after the
   job succeeds. A source tag, uploaded Actions artifact or configured publisher
   alone does not prove registry publication. Existing versions cannot be
   replaced; investigate an already-published version rather than rerun with a
   different package identity or remove a registry release.

Artifacts contain only the package tarball, `SHA256SUMS` and a public
`RELEASE.json` receipt, retained for seven days. The release workflow adds no
registry secrets, account changes, GitHub write permissions or deployment
environments. Repository/tag write access remains publishing authority; protect
release tags and review workflow changes through the project's normal controls.

## Verified 0.20.1 publication

[Release workflow 41244931843](https://github.com/Lunixi-Payment/lunixi-node/actions/runs/41244931843) passed from immutable publication source `8349b9c4de5405917a8440cde47fce1c90eb3066`. [npm 0.20.1](https://www.npmjs.com/package/@lunixi/node-sdk/v/0.20.1) is available. Its downloaded archive has SHA-256 `9290d3d3b2aafa35c85bdb7d70e722529847426b62c5b5345d673c457568473e`; all 38 package files match the reviewed release. Archive compression bytes can differ from the local prepared tarball; verify the actual registry integrity and file content. The same package provides Express/NestJS checkout examples in its source repository.

## References

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [npm 12.2.1 provenance implementation](https://github.com/npm/cli/blob/v12.2.1/workspaces/libnpmpublish/lib/provenance.js)
- [Reviewed fixture scanning](secret-scanning.md)
