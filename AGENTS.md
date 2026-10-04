# Robot Vacuum Cleaner Card

This repository owns the standalone Lovelace card and its optional Home Assistant queue package. Use Space Hub Card as the canonical design reference (tokens, tile surfaces, typography and under-tile glows). Shared vendored files must retain provenance; update from the canonical source rather than creating a competing design system.

Keep physical robot actions out of tests. Use mock Home Assistant state/service fixtures. Queue execution belongs in Home Assistant, never in browser timers; commands, cleaning acknowledgement and completion are separate facts. Preserve Roborock routine settings by invoking configured preset button entities. Fail closed on errors, lost state or uncertain completion.

The remote is public. Never commit production dashboards, household identifiers, maps, credentials, raw registry/config entries, or API dumps. Examples use generic entities. Source changes alone do not authorize production installation or an actual cleaning run. Run npm run check and backend queue tests before publishing changes.
