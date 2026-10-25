# Shared design provenance

- `design-tokens.ts` and `card-primitives.ts`: canonical controlled-vendor copies; [DESIGN_PROVENANCE.json](DESIGN_PROVENANCE.json) records their current source revision, shared design version and SHA-256 hashes. Synchronize with Space Hub `scripts/sync-card-design.mjs`.
- `glow.ts`: scoped `buildGlow` extraction already used by SmartEVSE Card; canonical implementation is Space Hub Card `src/glow.ts` at `178d53064e6a64b0887da19735f5951bd0db6c97` (v2.0.83). No runtime sibling dependency.
- Tile stacking and glow masking in `../styles/card.ts` follow Space Hub `src/styles/base.styles.ts`; all glows resolve beneath every tile surface in a single isolated root.

Upstream: https://github.com/bitosome/space-hub-card (MIT). Check canonical diffs when synchronizing; do not hand-edit token copies.
