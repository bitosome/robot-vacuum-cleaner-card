# Changelog

## 0.16.7 — 2026-10-25

- Adopt shared Space Hub header, action and dialog primitives without changing cleaning commands or the native HA sortable adapter.
- Give recovery confirmations the same MDI X and native focus behavior as other dialogs; protect pending opens during teardown or robot changes.
- Use compact device rows, 16px editing inputs and a bounded scroll body with fixed header/footer.
- Preserve shared plan autosave, live queue editing, suction capability restrictions and retained activity.
- Validate 299 frontend tests, including confirmation dismissal and modal lifecycle regressions.
