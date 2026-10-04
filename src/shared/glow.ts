// VENDORED from space-hub-card/src/glow.ts.
// Keep buildGlow aligned with the canonical bitosome tile-glow helper.
import { html, nothing, type TemplateResult } from "lit";

export interface PulseColors {
  weak: string;
  strong: string;
}

export type GlowMode = "static" | "pulse" | "none";

/** Build the canonical bitosome tile glow used by space-hub-card. */
export function buildGlow(
  pulse: PulseColors | undefined,
  mode: GlowMode = "static",
  active = false,
): { style: string; overlay: TemplateResult | typeof nothing } {
  if (!pulse || mode === "none" || !active) {
    return { style: "", overlay: nothing };
  }

  const vars = `--pulse-weak: ${pulse.weak}; --pulse-strong: ${pulse.strong};`;
  const box = `box-shadow: 0 18px 40px var(--pulse-strong, ${pulse.strong}), 0 6px 18px var(--pulse-weak, ${pulse.weak});`;
  const animation = mode === "pulse" ? "animation: glowPulse 2.4s ease-in-out infinite;" : "";

  return {
    style: `${vars} ${animation} ${box}`,
    overlay: html`<div class="glow-overlay" aria-hidden="true"></div>`,
  };
}
