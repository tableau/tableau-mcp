# Releasing `@tableau/mcp-server`

## Normal release

A merge to `main` that bumps `package.json` version triggers `.github/workflows/tag.yml`, which tags `v<version>`. Cutting a GitHub release from that tag triggers `.github/workflows/publish.yml`, which runs `npm publish` — publishing the new version and moving the npm `latest` dist-tag to it. This is the common path; nothing about it changes.

> **The Release publish is the trigger.** Both `publish.yml` and `docker-publish.yml` fire on `release: published` — pushing a tag alone publishes **nothing**. And both preflight that the release tag equals `v<package.json version>` at the tagged commit; a mismatch fails the run before anything publishes (npm keys prerelease-vs-stable off `package.json`, Docker off the tag name — the preflight keeps them agreeing).

## Hotfix release

Use this when a livesite issue needs a code fix shipped against an **already-deployed** version, without pulling in unrelated changes that have landed on `main` since, and **without moving the `latest` dist-tag** off the current release line.

The publish pipeline is **prerelease-aware**: any version with a SemVer prerelease identifier (a `-`, e.g. `2.18.0-hotfix.1`) is published under a dedicated `hotfix-v<version>` npm dist-tag, never `latest`. (The dist-tag can't be the bare version — npm rejects a dist-tag that parses as a valid SemVer version — so it's `hotfix-v2.18.0-hotfix.1`; you still install by exact version.) The Docker image (`docker-publish.yml`) is guarded the same way: a prerelease tag gets its exact-version Docker tag but does not move Docker's `latest`. So a hotfix never disturbs `latest` on either registry.

Say Hyperforce consumes `2.18.0`:

1. **Branch off the deployed tag.** Create `hotfix/2.18.0` with HEAD at the `v2.18.0` tag:
   ```
   git fetch --tags
   git checkout -b hotfix/2.18.0 v2.18.0
   ```
2. **Fix on `main` first, then cherry-pick.** Land the bug fix on `main` as usual, then cherry-pick it onto the hotfix branch:
   ```
   git checkout hotfix/2.18.0
   git cherry-pick <fix-commit-sha>
   ```
   (main → hotfix ordering, so you can never forget to get the fix back onto `main`.)
3. **Bump to a hotfix prerelease version** on the hotfix branch — `2.18.0-hotfix.1` (increment `.N` for subsequent hotfixes on the same line):
   ```
   npm version 2.18.0-hotfix.1 --no-git-tag-version
   git commit -am "@W-XXXXXXXX hotfix: <summary> (2.18.0-hotfix.1)"
   git push origin hotfix/2.18.0
   ```
4. **Tag + release from the hotfix branch.** Create tag `v2.18.0-hotfix.1` on the hotfix branch, push it, and cut a GitHub release from that tag:
   ```
   git tag v2.18.0-hotfix.1
   git push origin v2.18.0-hotfix.1
   ```
   Then on GitHub, create a Release from tag `v2.18.0-hotfix.1` and **mark it as a pre-release** in the UI (`gh release create v2.18.0-hotfix.1 --prerelease`). Publishing the Release — not the tag push — is what triggers the workflows. The release "target" branch doesn't matter — `publish.yml` checks out the tag's exact commit — but selecting the hotfix branch keeps it unambiguous. The workflow detects the prerelease version and runs `npm publish --tag hotfix-v2.18.0-hotfix.1`, publishing the hotfix **without moving `latest`**.
5. **Consume in Hyperforce.** Pin `@tableau/mcp-server@2.18.0-hotfix.1` (by exact version) in the Hyperforce repo.

Verify `latest` was not disturbed:
```
npm dist-tag ls @tableau/mcp-server
# latest: 2.18.0                          <- the deployed line, unchanged
# hotfix-v2.18.0-hotfix.1: 2.18.0-hotfix.1 <- the hotfix, on its own tag
```
(If `main` has already advanced past the deployed line, `latest` will point at that newer version — the point is only that the hotfix did **not** move it.)

### If a publish run fails partway

npm versions are **immutable** — once `npm publish` for a version succeeds, re-running the whole workflow will fail on the npm step with a "cannot publish over existing version" error. If a later job failed (mcpb upload, Docker), use **"Re-run failed jobs"** on the workflow run, not "Re-run all jobs". If the npm publish itself was the failure, fix the cause and re-run; nothing was published, so the full rerun is safe.

### Why this shape
- **No `main` drift:** the fix ships off the exact deployed tag, not the moving `main`.
- **No `latest` move:** `npm publish` reassigns `latest` on every bare publish; the prerelease guard in `publish.yml` publishes hotfixes under their own dist-tag so the normal release line keeps `latest`.
- **main → hotfix cherry-pick order:** guarantees the fix is on `main` before it ships, so the next normal release already contains it.
