# Shared design provenance

Presentation and modal behavior are supplied by [`@bitosome/ha-card-ui`](https://github.com/bitosome/ha-card-ui), derived from Space Hub Card's design language and activation glows. The small files in this directory are compatibility exports, not vendored implementations.

The package is resolved at build time and bundled into the shipped card. There is no runtime network request, shared global custom element, or dependency on another installed card. `package-lock.json` pins the immutable release artifact and integrity. Update the shared package and rebuild this card to adopt changes; do not create local copies of its tokens, glow CSS or dialog controller.

Domain commands, capability checks, drafts, persistence and error policies remain owned by this card. Shared UI must never actuate a device itself. Upstream MIT notices are retained in the repository.
