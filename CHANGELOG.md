# Changelog

## 0.17.1 — 2026-10-26

- Open Room defaults and each room’s settings from the common cog into the shared modal, while retaining visible settings pills, native sorting and room toggles on the card.
- Preserve automatic shared preferences and plan saving, plus explicit Apply/Cancel for edits to a running queue. Opening an editor alone does not begin a queue transaction.
- Keep started or unavailable rooms inspectable with an accurate read-only explanation; protect against room removal, queue advancement and delayed save failures while editing.
- Use a full-width mode selector on small screens, restore focus to the clicked opener, and distinguish modal launchers from inline disclosures.

## 0.17.0 — 2026-10-25

- Bundle `@bitosome/ha-card-ui` for canonical Space Hub glows, reusable notices and the shared modal controller/shell.
- Unify Dock, Map, Settings, Care, Details and recovery confirmations under the same X, Escape, backdrop and focus lifecycle.
- Keep room settings and native draggable planning inline, including shared autosave, active queue Apply/Cancel and retained sequence activity.
- Keep dispatched settings requests independent of dialog navigation; late responses cannot close a reopened view or enable duplicate commands.

## 0.16.7 — 2026-10-25

- Adopt shared Space Hub header, action and dialog primitives without changing cleaning commands or the native HA sortable adapter.
- Give recovery confirmations the same MDI X and native focus behavior as other dialogs; protect pending opens during teardown or robot changes.
- Use compact device rows, 16px editing inputs and a bounded scroll body with fixed header/footer.
- Preserve shared plan autosave, live queue editing, suction capability restrictions and retained activity.
- Validate 299 frontend tests, including confirmation dismissal and modal lifecycle regressions.
