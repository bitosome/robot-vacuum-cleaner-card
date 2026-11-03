# Changelog

## 0.19.0 — 2026-11-03

- Adopt `@bitosome/ha-card-ui` 1.4.0. Pending Start, Pause, Resume, Stop, Return to dock, Continue, Clear and Save actions keep their place with the shared busy indicator, a named pending label and `aria-busy`; the polite live region still announces the wait.
- Recovery confirmations and the queue-edit Apply/Cancel footer split the width equally; Cancel keeps first focus in recovery prompts.
- Use the shared notices for command errors, water-tank warnings, unavailable controllers, stale selections and queue-edit problems, each with a severity icon, tone and status or alert role. Empty map and room states use the shared empty state.
- Status colours, focus rings and selection use the family `--family-*` aliases and the theme primary colour, so completion, active work and warnings no longer show two greens or a separate accent.
- Settings, metrics, Room defaults and activity stages use the shared chips; on/off device settings use the shared toggle with a visible check; text actions use the shared quiet button at 13px.
- Last clean, activity and dock-care times follow the Home Assistant profile language, 12/24-hour clock and time zone instead of the browser.
- Unavailable rooms now show their unavailable colour; activity times are no smaller than 11px.

## 0.18.3 — 2026-11-03

- Use the shared button style for every card action. Return to dock and Clear stopped sequence no longer use a separate 46px accent style next to Pause and Stop, and toolbar actions keep the shared 13px labels.
- The two recovery confirmation buttons are no longer stretched to unequal widths.

## 0.18.2 — 2026-11-01

- Keep confirmed rooms visibly **Cleaned** when a sequence is interrupted, cancelled into dock care or waiting for attention. Retain its assigned order and settings across a dashboard reload.
- Distinguish the interrupted sequence from an unrelated native robot job, and show a partial room’s confirmed passes without claiming the whole room is clean.
- Keep historical progress separate from the next plan: clearing, recovery or a fresh sequence cannot copy earlier completion into new room tiles.
- Add mobile release-bundle regressions for retained floor progress, dock transitions, missing map rooms, partial passes and stale-run isolation.

## 0.18.0 — 2026-10-26

- Give Dock a compact shared modal with explicit Wash mops, Empty bin and Dry mops controls, native running state and Start/Stop actions. Supported unavailable controls remain visible with an explanation.
- Keep an allowed Stop available while the queue owns dock care; every action still goes through the companion's live validation.
- Show the companion's persisted dock-care checkpoint, per-action confirmation times and a guarded Resume dock care action. Returning to the dock alone never claims a wash or emptying completed.
- Retain partial room outcomes after cancellation. Cleanup obligations recorded during active floor work do not hide Pause, Stop, Return to dock or water-error recovery.
- Add reusable synthetic dock scenarios to the preview and release-bundle regression coverage for native controls, cancellation, interrupted care and truthful history.

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
