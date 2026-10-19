# @golfo/rp

## Changelog governance

- Every change that alters behavior, terminal output, generated files (such as the release workflow), configuration options, or the public API (`package.json` `exports`) must update `CHANGELOG.md` in the same work item.
- Add entries only inside the `## [Unreleased]` block, never under an already released version. Never write the version or the date by hand: `golfo-rp create-version` renames `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` in the release commit (the day in `releaseTimeZone` when configured, the local day otherwise) and leaves a new, empty `## [Unreleased]` block on top.
- Follow [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/): group entries only under these sections, in this order, omitting empty ones: `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`.
- Write one `- ` line per change, in Spanish, describing what changes for the projects that use golfo-rp, without internal implementation details.
- Changes with no effect for those projects (tests, internal refactors that keep behavior and output identical, local tooling, agent instructions) do not need an entry.
- `golfo-rp create-version` refuses to release while `CHANGELOG.md` has not changed since the last release or its `## [Unreleased]` block is missing or has no entries (`- ` lines), so a release without an entry is blocked.

## Consumers

Projects that depend on `@golfo/rp` today (keep this list current when a project adopts or drops it):

| Project | Repository | Local checkout | Dependency | Configuration |
| --- | --- | --- | --- | --- |
| golfo-ui | [guidomodarelli/golfo-ui](https://github.com/guidomodarelli/golfo-ui) | `~/ghq/projects/golfo-ui` | `devDependencies` | `golfo-rp.config.js` |
| TuTribu | [guidomodarelli/TuTribu](https://github.com/guidomodarelli/TuTribu) | `~/ghq/projects/TuTribu` | `devDependencies` | `golfo-rp.config.mjs` |
| agenda-mensual | [guidomodarelli/agenda-mensual](https://github.com/guidomodarelli/agenda-mensual) | `~/ghq/projects/agenda-mensual` | `devDependencies` | `golfo-rp.config.mjs` |
| golfo-cleaner (`@golfo/cleaner`) | [guidomodarelli/golfo-cleaner](https://github.com/guidomodarelli/golfo-cleaner) | `~/ghq/projects/golfo-cleaner` | `devDependencies` (npm) | `golfo-rp.config.js` |

Every time an `@golfo/rp` version is published, update every consumer in the same work item, one pull request per consumer:

- Wait until the version is available on npm (`npm view @golfo/rp version`; the release workflow may finish a few minutes before the registry shows it), then run `pnpm add -D @golfo/rp@^X.Y.Z` in the consumer (`npm install -D @golfo/rp@^X.Y.Z` in golfo-cleaner).
- Adopt what the release adds or changes when it applies to the consumer: new configuration options (for example `changelogDraft` in 0.10.0), renamed or removed options, and changes to the release workflow that `--setup-ci` generates.
- Update the consumer's `AGENTS.md` wherever it names the golfo-rp version or describes its release behavior.
- Follow the consumer's own changelog rules: add an `## [Unreleased]` entry only when its rules require one for the change (golfo-ui lists release-process changes; TuTribu only lists changes users notice).
- Validate with `pnpm create-version --dry-run` (`npm run create-version -- --dry-run` in golfo-cleaner) in the consumer before opening the pull request.
