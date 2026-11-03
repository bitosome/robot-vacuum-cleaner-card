# Robot Vacuum Cleaner Card

<!-- workspace-pointer -->
## Shared workspace rules

Part of the bitosome Home Assistant workspace. Shared rules, access (SSH, ha-mcp) and processes
are in `../AGENTS.md` (the workspace entry point) and `../home-assistant-knowledge/`; they take
precedence over this file. Build, test, release and known gotchas for this repo:
[repo catalog](../home-assistant-knowledge/docs/repo-catalog.md#robot-vacuum-cleaner-card).

- Edit and release from this checkout; never patch production directly.
- Push, tag/release, HACS install, production changes, reloads and restarts need the owner's explicit approval.
- Shared UI comes from `@bitosome/ha-card-ui` (exact release tarball pin). Build anything two or more cards use there first; follow `../home-assistant-knowledge/docs/card-style-guide.md`.
- After a release or install, update `docs/current-state.md` and `docs/changelog.md` in the knowledge repo.

This repository owns the standalone Lovelace card and its editor. The Home Assistant queue integration that executes ordered room cleaning lives in [ha-robot-cleaner-queue](https://github.com/bitosome/ha-robot-cleaner-queue); keep its Python code, services and backend traces there and do not duplicate them here. Use Space Hub Card as the canonical design reference (tokens, tile surfaces, typography and under-tile glows). The versioned `@bitosome/ha-card-ui` package owns shared tokens, glows, components and modal behavior. `src/shared/` contains compatibility exports; update the package and rebuild rather than creating local copies.

Keep physical robot actions out of tests. Use mock Home Assistant state/service fixtures. Queue execution belongs in Home Assistant, never in browser timers; commands, cleaning acknowledgement and completion are separate facts. Use native rooms/areas and explicit per-room settings; never reintroduce Roborock routine-button execution. Fail closed on errors, lost state or uncertain completion.

The remote is public. Never commit production dashboards, household identifiers, maps, credentials, raw registry/config entries, or API dumps. Examples use generic entities. Source changes alone do not authorize production installation or an actual cleaning run. Run npm run check before publishing changes. Backend queue tests run in the integration repository.

## Publishing

Commit and push every change. A change a user can see - card behaviour, integration
code, entity or service contracts - also gets a version bump and an annotated
`v<version>` tag, because HACS installs from releases: do not wait to be asked for a
release. Docs-only changes are pushed without a release. After pushing a tag, confirm
the release workflow succeeded and that the asset is attached.
