import { css } from 'lit';
export const cardStyles = css`
  :host { --robot-accent: var(--accent-color, #bba3f2); --robot-surface: var(--ha-card-background, var(--card-background-color, #292b3e)); color: var(--primary-text-color, #dedff5); font-family: var(--paper-font-body1_-_font-family, inherit); }
  * { box-sizing: border-box; }
  ha-card { display: block; padding: var(--tile-padding-large); border-radius: var(--ha-card-border-radius, 24px); background: var(--robot-surface); border: 1px solid var(--divider-color, rgba(255,255,255,.05)); overflow: visible; }
  .root { display: grid; gap: var(--large-gap); isolation: isolate; }
  .tile-wrap { position: relative; min-width: 0; }
  .surface { position: relative; z-index: 1; border-radius: var(--tile-border-radius); background: color-mix(in srgb,var(--robot-surface) 94%,var(--primary-text-color) 6%); box-shadow: var(--tile-shadow-default); }
  .glow-under { position: absolute; inset: 0; pointer-events: none; z-index: 0; border-radius: var(--tile-border-radius); }
  .glow-overlay { position: absolute; inset: -10px -14px -18px; border-radius: inherit; pointer-events: none; mix-blend-mode: screen; opacity: .9; mask-image: linear-gradient(180deg, transparent 0%,rgba(0,0,0,.25) 18px,rgba(0,0,0,.9) 44px,#000 100%); }
  @keyframes glowPulse { 0%,100% { box-shadow: 0 12px 28px var(--pulse-weak),0 4px 14px var(--pulse-weak); } 50% { box-shadow: 0 18px 40px var(--pulse-strong),0 6px 18px var(--pulse-weak); } }
  button { font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  button:disabled { cursor: default; opacity: .46; }
  button:focus-visible, summary:focus-visible { outline: 3px solid var(--robot-accent); outline-offset: 3px; }
  ha-icon { width: 22px; height: 22px; --mdc-icon-size: 22px; flex: 0 0 22px; display: inline-flex; }
  .hero { padding: clamp(18px,4.7cqw,26px); overflow: hidden; }
  .identity { display: flex; align-items: center; gap: 12px; }
  .robot-icon { display:grid; place-items:center; width:52px; height:52px; border-radius:50%; background: color-mix(in srgb,var(--robot-accent) 12%,transparent); color:var(--robot-accent); flex:0 0 52px; }
  .robot-icon ha-icon { width:32px; height:32px; --mdc-icon-size:32px; }
  .identity-text { flex:1; min-width:0; }
  .eyebrow { font-size:10px; font-weight:750; letter-spacing:.12em; text-transform:uppercase; color:var(--secondary-text-color,#acb1cc); }
  .name { font-size:17px; font-weight:700; margin-top:3px; overflow-wrap:anywhere; }
  .battery { display:flex; align-items:center; gap:4px; font-size:13px; font-weight:700; white-space:nowrap; }
  h2 { font-size:clamp(24px,6.5cqw,32px); letter-spacing:-.035em; line-height:1.13; font-weight:750; margin:22px 0 8px; overflow-wrap:anywhere; }
  p { margin:0; }
  .subline { color:var(--secondary-text-color,#acb1cc); font-size:14px; line-height:1.5; overflow-wrap:anywhere; }
  .pills { display:flex; flex-wrap:wrap; gap:7px; margin-top:15px; }
  .pill { display:inline-flex; align-items:center; gap:5px; padding:6px 10px; border-radius:999px; font-size:12px; font-weight:650; background:color-mix(in srgb,var(--primary-text-color,#ddd) 8%,transparent); }
  .pill ha-icon { width:16px; height:16px; --mdc-icon-size:16px; flex-basis:16px; }
  .pill.live { color:color-mix(in srgb,var(--status-active-color) 65%,var(--primary-text-color) 35%); background:color-mix(in srgb,var(--status-active-color) 12%,transparent); }
  .progress { height:5px; border-radius:999px; overflow:hidden; background:color-mix(in srgb,var(--primary-text-color) 12%,transparent); margin-top:18px; }
  .progress > span { display:block; height:100%; background:var(--status-active-color); border-radius:inherit; transition:width .3s; }
  .actions { display:flex; gap:8px; margin-top:20px; }
  .action { border:0; border-radius:999px; min-height:46px; display:flex; justify-content:center; align-items:center; gap:8px; padding:10px 16px; font-size:14px; font-weight:700; line-height:1.2; background:color-mix(in srgb,var(--primary-text-color) 8%,transparent); }
  .primary { flex:1; color:var(--primary-background-color,#181a27); background:var(--robot-accent); }
  .secondary { color:var(--secondary-text-color); }
  .room-section { padding:6px 4px 3px; }
  .section-heading { display:flex; align-items:center; justify-content:space-between; min-height:40px; margin-bottom:4px; gap:8px; }
  .preset-heading { flex-wrap:wrap; }
  .preset-buttons { margin-top:0; }
  .section-heading h3 { font-size:14px; font-weight:700; margin:0; }
  .text-button { border:0; padding:10px; min-height:44px; background:transparent; color:var(--robot-accent); font-size:12px; font-weight:650; }
  .hint { font-size:12px; line-height:1.4; color:var(--secondary-text-color); margin-bottom:14px; }
  .rooms { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--large-gap); }
  .room { width:100%; min-height:116px; border:1px solid transparent; text-align:left; padding:15px; display:flex; flex-direction:column; align-items:flex-start; gap:14px; transition:border-color .15s,background .15s; }
  .room-top { display:flex; justify-content:space-between; align-items:center; width:100%; min-height:28px; gap:8px; }
  .room-icon { color:var(--secondary-text-color); width:26px; height:26px; --mdc-icon-size:26px; }
  .room:disabled { opacity: 1; cursor: default; }
  .room[aria-label*="unavailable"] { opacity: .5; }
  .room.selected { border-color:color-mix(in srgb,var(--robot-accent) 50%,transparent); }
  .room.selected .room-icon { color:var(--robot-accent); }
  .room.active { border-color:var(--status-active-color); }
  .room.active .room-icon, .room.active .room-state { color:color-mix(in srgb,var(--status-active-color) 65%,var(--primary-text-color) 35%); }
  .room.done .room-state { color:color-mix(in srgb,var(--status-success-color) 65%,var(--primary-text-color) 35%); }
  .order { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; font-size:12px; font-weight:750; background:var(--robot-accent); color:var(--primary-background-color,#181a27); }
  .order ha-icon { width:16px;height:16px;--mdc-icon-size:16px; }
  .room.active .order { background:var(--status-active-color); color:var(--status-icon-on-color); }
  .room.done .order { background:color-mix(in srgb,var(--status-success-color) 16%,transparent); color:var(--status-success-color); }
  .room-name { font-size:14px; font-weight:650; line-height:1.25; overflow-wrap:anywhere; }
  .room-state { font-size:11px; color:var(--secondary-text-color); margin-top:4px; line-height:1.35; }
  .queue-summary { margin-top:16px; border-top:1px solid var(--divider-color,rgba(255,255,255,.1)); padding-top:14px; }
  .sequence { display:flex; flex-wrap:wrap; align-items:center; gap:5px; color:var(--secondary-text-color); font-size:12px; line-height:1.6; margin:5px 0; }
  .sequence b { color:var(--primary-text-color); font-weight:600; }
  .sequence ha-icon { width:14px; height:14px; --mdc-icon-size:14px; flex-basis:14px; }
  .note,.error { font-size:12px; line-height:1.5; padding:12px 14px; border-radius:var(--tile-border-radius); background:color-mix(in srgb,var(--primary-text-color) 5%,transparent); overflow-wrap:anywhere; }
  .error { color:var(--error-color,var(--status-alert-color)); background:color-mix(in srgb,var(--status-alert-color) 8%,transparent); }
  .error button { min-height:44px; color:inherit; }
  .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }
  .outer { container-type:inline-size; }
  @container (min-width:540px) { .rooms { grid-template-columns:repeat(3,minmax(0,1fr)); } }
  .setup-launch { width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:18px; padding:9px 12px; min-height:44px; border-radius:999px; border:1px solid color-mix(in srgb,var(--robot-accent) 24%,transparent); background:color-mix(in srgb,var(--robot-accent) 8%,transparent); color:var(--robot-accent); font-size:12px; font-weight:650; text-align:left; }
  .setup-launch > span { display:flex; align-items:center; gap:7px; }
  .setup-launch:disabled { opacity:1; }
  .setup-launch:disabled .setup-edit { visibility:hidden; }
  .setup-launch ha-icon { width:18px;height:18px;--mdc-icon-size:18px;flex-basis:18px; }
  .setup-dialog { background:var(--robot-surface); color:var(--primary-text-color,#dedff5); border:1px solid var(--divider-color,rgba(255,255,255,.05)); border-radius:28px; padding:0; width:calc(100vw - 24px); max-width:460px; max-height:calc(100dvh - 32px); overflow:hidden; box-shadow:0 24px 90px #0005; overscroll-behavior:contain; }
  .setup-dialog::backdrop { background:rgba(7,10,20,.64); backdrop-filter:blur(7px); }
  .setup-sheet { display:flex; flex-direction:column; max-height:calc(100dvh - 34px); }
  .setup-body { overflow-y:auto; overscroll-behavior:contain; padding:0 24px; min-height:0; }
  .setup-header { flex-shrink:0; padding:24px 24px 0; display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:22px; }
  .setup-header h2 { font-size:25px; margin:5px 0 0; }
  .close-button { display:grid;place-items:center;border:0;border-radius:50%;background:color-mix(in srgb,var(--primary-text-color) 5%,transparent);padding:10px;min-width:44px;min-height:44px; }
  .source-tabs { display:flex; border-radius:999px; padding:4px; background:color-mix(in srgb,var(--primary-text-color) 6%,transparent); margin-bottom:22px; }
  .source-tabs button { flex:1; border:0; padding:11px 9px; border-radius:999px; background:transparent; font-size:13px; font-weight:650; min-height:44px; }
  .source-tabs button.chosen { background:var(--robot-accent); color:var(--primary-background-color,#181a27); }
  .mode-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
  .mode-choice { position:relative; display:flex;flex-direction:column;align-items:flex-start;gap:12px;border:1px solid transparent;background:color-mix(in srgb,var(--primary-text-color) 6%,transparent);border-radius:var(--tile-border-radius);padding:16px;text-align:left;font-size:13px;line-height:1.3;font-weight:650;min-height:100px; }
  .mode-choice.chosen { border-color:color-mix(in srgb,var(--robot-accent) 55%,transparent);color:var(--robot-accent);box-shadow:0 7px 20px color-mix(in srgb,var(--robot-accent) 10%,transparent); }
  .mode-choice .choice-check { position:absolute;top:13px;right:13px;width:16px;height:16px;--mdc-icon-size:16px; }
  .mode-description,.setup-footnote,.setup-footer p,.setup-description p,.setup-message { font-size:12px;line-height:1.5;color:var(--secondary-text-color,#acb1cc); }
  .mode-description { margin:13px 2px 22px;min-height:36px; }
  .setting-group { border:0;padding:0;margin:0 0 20px;min-width:0; }
  .setting-group legend { font-size:13px;font-weight:650;padding:0;margin-bottom:10px; }
  .setting-choices { display:flex;flex-wrap:wrap;gap:7px; }
  .setting-pill { border:1px solid transparent;border-radius:999px;background:color-mix(in srgb,var(--primary-text-color) 6%,transparent);min-height:44px;padding:10px 14px;font-size:12px;font-weight:650; }
  .setting-pill.chosen { color:var(--robot-accent);background:color-mix(in srgb,var(--robot-accent) 14%,transparent);border-color:color-mix(in srgb,var(--robot-accent) 45%,transparent); }
  .setup-description { padding:8px 2px 22px; }
  .setup-description > ha-icon { color:var(--robot-accent);width:32px;height:32px;--mdc-icon-size:32px; }
  .setup-description h3 { font-size:17px;margin:14px 0 8px; }
  .setup-message { padding:14px 0 24px; }
  .setup-footnote { padding-top:2px; }
  .setup-footer { flex-shrink:0; padding:14px 24px 20px; display:grid;gap:12px;border-top:1px solid var(--divider-color,rgba(255,255,255,.1));margin-top:16px; }
  .setup-footer p { text-align:center;font-size:11px; }
  @media (max-width:360px) { .setup-body { padding:0 18px; } .setup-header { padding:18px 18px 0; } .setup-footer { padding:12px 18px 16px; } .mode-choice { padding:13px; } .setting-pill { padding:10px 12px; } }
  .actions { flex-wrap:wrap; }
  .utilities { display:flex;flex-wrap:wrap;gap:8px; }
  .utilities button { display:flex;align-items:center;justify-content:center;gap:6px;flex:1; }
  .utilities ha-icon { width:18px;height:18px;--mdc-icon-size:18px;flex-basis:18px; }
  .water-warning { display:flex;gap:10px;align-items:flex-start;color:var(--secondary-text-color); }
  .water-warning ha-icon { color:var(--robot-accent); }
  .device-body { display:grid;gap:12px;padding-bottom:8px; }
  .device-row { display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border-radius:var(--tile-border-radius);background:color-mix(in srgb,var(--primary-text-color) 5%,transparent);font-size:13px;min-height:44px; }
  .device-row small { display:block;margin-top:5px;color:var(--secondary-text-color); }
  .device-row .setting-pill { min-width:68px; }
  .device-row input,.device-row select { font:inherit;color:inherit;background:var(--robot-surface);border:1px solid var(--divider-color);border-radius:12px;min-height:44px;max-width:55%;padding:5px;box-sizing:border-box; }
  .device-row input:focus-visible,.device-row select:focus-visible { outline:2px solid var(--robot-accent); }
  .volume-row { display:block; }
  .volume-row > span { display:flex;justify-content:space-between; }
  .volume-row input { width:100%;max-width:100%;accent-color:var(--robot-accent);padding:0; }
  .care-row strong { font-size:12px;text-align:right;color:var(--secondary-text-color); }
  .care-row .overdue { color:var(--warning-color,#efb76a); }
  .map-view { margin:0; }
  .map-view img { display:block;width:100%;height:auto;border-radius:var(--tile-border-radius); }
  .map-view figcaption { font-size:12px;color:var(--secondary-text-color);margin-top:10px; }
  @media (prefers-reduced-motion:reduce) { *, .glow-under { animation:none!important;transition:none!important; } }
`;
