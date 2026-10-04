# Shared design provenance

- `design-tokens.ts`: exact copy of Space Hub Card `src/shared/design-tokens.ts` at commit `178d53064e6a64b0887da19735f5951bd0db6c97` (v2.0.83, verified 2026-10-04).
- `glow.ts`: scoped `buildGlow` extraction already used by SmartEVSE Card; canonical implementation is Space Hub Card `src/glow.ts` at `178d53064e6a64b0887da19735f5951bd0db6c97` (v2.0.83). No runtime sibling dependency.
- Tile stacking and glow masking in `../styles/card.ts` follow Space Hub `src/styles/base.styles.ts`; all glows resolve beneath every tile surface in a single isolated root.

Upstream: https://github.com/bitosome/space-hub-card (MIT). Check canonical diffs when synchronizing; do not hand-edit token copies.
