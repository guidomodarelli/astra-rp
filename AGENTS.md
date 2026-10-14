# beez-rp

## Changelog governance

- Every change that alters behavior, terminal output, generated files (such as the release workflow), configuration options, or the public API (`package.json` `exports`) must update `CHANGELOG.md` in the same work item.
- Add entries only inside the `## [Unreleased]` block, never under an already released version. Never write the version or the date by hand: `beez-rp create-version` renames `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` in the release commit (the day in `releaseTimeZone` when configured, the local day otherwise) and leaves a new, empty `## [Unreleased]` block on top.
- Follow [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/): group entries only under these sections, in this order, omitting empty ones: `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`.
- Write one `- ` line per change, in Spanish, describing what changes for the projects that use beez-rp, without internal implementation details.
- Changes with no effect for those projects (tests, internal refactors that keep behavior and output identical, local tooling, agent instructions) do not need an entry.
- `beez-rp create-version` refuses to release while `CHANGELOG.md` has not changed since the last release or its `## [Unreleased]` block is missing or has no entries (`- ` lines), so a release without an entry is blocked.
