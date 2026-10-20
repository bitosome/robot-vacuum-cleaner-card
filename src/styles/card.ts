import { css } from 'lit';
export const cardStyles = css`
  :host { --robot-accent: var(--accent-color, #bba3f2); --robot-surface: var(--ha-card-background, var(--card-background-color, #292b3e)); --robot-muted: var(--secondary-text-color, #acb1cc); color: var(--primary-text-color, #dedff5); font-family: var(--paper-font-body1_-_font-family, inherit); }
  * { box-sizing: border-box; }
  ha-card { display: block; padding: var(--tile-padding-large); border-radius: var(--ha-card-border-radius, 24px); background: var(--robot-surface); border: 1px solid var(--divider-color, rgba(255,255,255,.05)); overflow: visible; }
  .root { display: grid; gap: var(--large-gap); isolation: isolate; }
  .tile-wrap { position: relative; min-width: 0; }
  .surface { position: relative; z-index: 1; border-radius: var(--tile-border-radius); background: color-mix(in srgb,var(--robot-surface) 96%,var(--primary-text-color) 4%); box-shadow: var(--tile-shadow-default); }
  .glow-under { position: absolute; inset: 0; pointer-events: none; z-index: 0; border-radius: var(--tile-border-radius); }
  .glow-overlay { position: absolute; inset: -10px -14px -18px; border-radius: inherit; pointer-events: none; mix-blend-mode: screen; opacity: .9; mask-image: linear-gradient(180deg, transparent 0%,rgba(0,0,0,.25) 18px,rgba(0,0,0,.9) 44px,#000 100%); }
  @keyframes glowPulse { 0%,100% { box-shadow: 0 12px 28px var(--pulse-weak),0 4px 14px var(--pulse-weak); } 50% { box-shadow: 0 18px 40px var(--pulse-strong),0 6px 18px var(--pulse-weak); } }
  button { font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  button:disabled { cursor: default; opacity: .46; }
  button:focus-visible, summary:focus-visible { outline: 3px solid var(--robot-accent); outline-offset: 3px; }
  ha-icon { width: 22px; height: 22px; --mdc-icon-size: 22px; flex: 0 0 22px; display: inline-flex; }
  .hero { padding: clamp(18px,4cqw,24px); overflow: hidden; }
  .identity { display: flex; align-items: center; gap: 12px; }
  .robot-icon { display:grid; place-items:center; width:44px; height:44px; border-radius:50%; background:color-mix(in srgb,var(--robot-accent) 10%,transparent); color:var(--robot-accent); flex:0 0 44px; }
  .robot-icon ha-icon { width:26px; height:26px; --mdc-icon-size:26px; flex-basis:26px; }
  .identity-text { flex:1; min-width:0; }
  .eyebrow { font-size:11px; font-weight:600; color:var(--robot-muted); }
  .name { font-size:17px; font-weight:650; letter-spacing:-.015em; margin-top:0; overflow-wrap:anywhere; }
  .battery { display:flex; align-items:center; gap:3px; color:var(--robot-muted); font-size:12px; font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap; }
  h2 { font-size:clamp(23px,5.5cqw,30px); letter-spacing:-.03em; line-height:1.2; font-weight:650; margin:18px 0 6px; overflow-wrap:anywhere; }
  p { margin:0; }
  .subline { color:var(--robot-muted); font-size:13px; line-height:1.5; overflow-wrap:anywhere; }
  .metric-caption { align-self:center; font-size:11px; color:var(--robot-muted); }
  .pills { display:flex; flex-wrap:wrap; gap:var(--medium-gap); margin-top:14px; }
  .pill { display:inline-flex; align-items:center; gap:5px; max-width:100%; padding:6px 10px; border-radius:var(--chip-border-radius); font-size:12px; font-weight:550; line-height:1.35; color:var(--robot-muted); background:color-mix(in srgb,var(--primary-text-color,#ddd) 6%,transparent); font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
  .pill ha-icon { width:16px; height:16px; --mdc-icon-size:16px; flex-basis:16px; }
  .pill.live { color:color-mix(in srgb,var(--status-active-color) 65%,var(--primary-text-color) 35%); background:color-mix(in srgb,var(--status-active-color) 12%,transparent); }
  .progress-summary { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-top:18px; font-size:12px; color:var(--robot-muted); }
  .progress-summary strong { color:var(--primary-text-color); font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .progress-summary + .progress { margin-top:8px; }
  .progress { height:5px; border-radius:999px; overflow:hidden; background:color-mix(in srgb,var(--primary-text-color) 12%,transparent); margin-top:18px; }
  .progress > span { display:block; height:100%; background:var(--status-active-color); border-radius:inherit; transition:width .3s; }
  .recovery-note { margin-top:18px; padding:14px; border-radius:var(--tile-border-radius); background:color-mix(in srgb,var(--primary-text-color) 5%,transparent); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
  .recovery-heading { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 12px; margin-bottom:6px; }
  .recovery-heading span,.recovery-hint { color:var(--secondary-text-color); }
  .recovery-note button { display:flex; align-items:center; gap:7px; margin:8px 0 4px; }
  .recovery-note .primary { width:100%; }
  .recovery-note ha-icon { width:18px; height:18px; --mdc-icon-size:18px; flex-basis:18px; }
  .recovery-details { margin-top:8px; color:var(--secondary-text-color); }
  .recovery-details summary { min-height:44px; display:flex; align-items:center; cursor:pointer; }
  .recovery-dialog-body { padding:24px; font-size:14px; line-height:1.5; }
  .recovery-dialog-body h3 { font-size:20px; letter-spacing:-.02em; margin:0 0 12px; }
  .recovery-dialog-body p { color:var(--secondary-text-color); }
  .actions:not(:has(button)) { display:none; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:18px; }
  .action { border:0; border-radius:999px; min-height:46px; display:flex; justify-content:center; align-items:center; gap:8px; padding:10px 16px; font-size:14px; font-weight:650; line-height:1.3; background:color-mix(in srgb,var(--primary-text-color) 8%,transparent); }
  .primary { flex:1; color:var(--primary-background-color,#181a27); background:var(--robot-accent); }
  .secondary { color:var(--secondary-text-color); }
  .room-section { padding:0 4px 3px; min-width:0; }
  .section-heading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; min-height:44px; margin-bottom:4px; gap:4px 8px; }
  .plan-bar { padding:0 4px; }
  .plan-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; min-height:44px; }
  .plan-label { flex:1; min-width:72px; color:var(--robot-muted); font-size:12px; line-height:1.4; }
  .plan-toolbar .action { min-height:44px; padding:9px 12px; font-size:12px; }
  .plan-toolbar .text-button { padding:8px; }
  .plan-bar .hint { margin:4px 0 0; }
  .section-heading h3 { font-size:14px; font-weight:700; margin:0; }
  .text-button { border:0; border-radius:12px; padding:10px; min-height:44px; background:transparent; color:color-mix(in srgb,var(--robot-accent) 65%,var(--primary-text-color)); font-size:12px; font-weight:600; line-height:1.4; }
  .hint { font-size:12px; line-height:1.4; color:var(--secondary-text-color); margin-bottom:14px; }
  .rooms { display:grid; grid-template-columns:1fr; gap:var(--large-gap); }
  .room { display:block; width:100%; min-width:0; border:1px solid transparent; text-align:left; padding:0; transition:border-color .15s,background .15s; }
  .room-header { display:flex; align-items:center; min-width:0; }
  .room-header .room-select { flex:1; min-width:0; }
  .room-drag { flex:0 0 44px; width:44px; min-height:52px; border:0; background:transparent; color:var(--robot-muted); cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none; }
  .room-drag:active { cursor:grabbing; }
  .room-drag:disabled { opacity:.3; cursor:default; }
  .room-item.dragging .surface { border-color:var(--robot-accent); box-shadow:0 8px 24px #0004; }
  .room-toggle { display:flex; align-items:center; flex:0 0 36px; width:36px; height:22px; padding:3px; border-radius:999px; background:color-mix(in srgb,var(--robot-muted) 25%,transparent); }
  .room-toggle > span { width:16px; height:16px; border-radius:50%; background:var(--robot-muted); transition:transform .15s; }
  .room-toggle.on { background:var(--robot-accent); }
  .room-toggle.on > span { transform:translateX(14px); background:var(--primary-background-color,#181a27); }
  .room-header .room-select:disabled { opacity:1; }
  .room-header:has(.room-drag) .room-select { padding-left:0; }
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
  .room-name { font-size:14px; font-weight:600; line-height:1.25; overflow-wrap:anywhere; }
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

  .setup-launch { width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:18px; padding:9px 12px; min-height:44px; border-radius:999px; border:1px solid color-mix(in srgb,var(--robot-accent) 24%,transparent); background:color-mix(in srgb,var(--robot-accent) 8%,transparent); color:var(--robot-accent); font-size:12px; font-weight:650; text-align:left; }
  .setup-launch > span { display:flex; align-items:center; gap:7px; }
  .setup-launch:disabled { opacity:1; }
  .setup-launch:disabled .setup-edit { visibility:hidden; }
  .setup-launch ha-icon { width:18px;height:18px;--mdc-icon-size:18px;flex-basis:18px; }
  .setup-dialog,.recovery-dialog { background:var(--robot-surface); color:var(--primary-text-color,#dedff5); border:1px solid var(--divider-color,rgba(255,255,255,.05)); border-radius:28px; padding:0; width:calc(100vw - 24px); max-width:460px; max-height:calc(100dvh - 32px); overflow:hidden; box-shadow:0 24px 90px #0005; overscroll-behavior:contain; }
  .setup-dialog::backdrop,.recovery-dialog::backdrop { background:rgba(7,10,20,.64); backdrop-filter:blur(7px); }
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
  .room-setups { display:grid;gap:8px;margin:14px 0 4px; }
  .room-setups h3 { font-size:14px;margin:0 0 2px; }
  .room-setup { border:1px solid var(--divider-color,rgba(255,255,255,.1));border-radius:12px;padding:10px 12px; }
  .room-setup > summary { display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;cursor:pointer;font-size:13px;min-height:34px; }
  .room-setup-state { font-size:11px;color:var(--secondary-text-color,#acb1cc); }
  .room-setup .setting-group { margin-top:10px; }
  .room-setup .text-button { margin-top:10px; }
  .zone-report { margin:14px 0 4px; border:1px solid var(--divider-color,rgba(255,255,255,.1)); border-radius:14px; padding:12px 14px; }
  .zone-report > summary { display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between;cursor:pointer;font-size:13px;font-weight:500; }
  .zone-count { font-size:11px;font-weight:400;color:var(--secondary-text-color,#acb1cc); }
  .zone-groups { list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px; }
  .zone-groups li { display:flex;gap:10px;align-items:baseline;justify-content:space-between;font-size:12px; }
  .zone-area { font-weight:500; }
  .zone-rooms { color:var(--secondary-text-color,#acb1cc);text-align:right; }
  .zone-note { margin:10px 0 0;font-size:12px;line-height:1.5;color:var(--secondary-text-color,#acb1cc); }
  .setup-footer { flex-shrink:0; padding:14px 24px 20px; display:grid;gap:12px;border-top:1px solid var(--divider-color,rgba(255,255,255,.1));margin-top:16px; }
  .setup-footer p { text-align:center;font-size:11px; }
  @media (max-width:360px) { .setup-body { padding:0 18px; } .setup-header { padding:18px 18px 0; } .setup-footer { padding:12px 18px 16px; } .mode-choice { padding:13px; } .setting-pill { padding:10px 12px; } }
  /* One robot surface: tools are a quiet, always-visible toolbar, not six competing tiles. */
  .hero .utilities { display:grid;grid-template-columns:repeat(var(--utility-columns,3),minmax(0,1fr));gap:4px;margin-top:18px;padding-top:10px;border-top:1px solid color-mix(in srgb,var(--primary-text-color) 8%,transparent); }
  .utilities button { display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;min-height:44px;padding:8px 4px;border:0;border-radius:14px;font-size:11px;font-weight:550;line-height:1.35;color:var(--robot-muted);background:transparent;transition:background .15s,color .15s; }
  .utilities button > span { min-width:0;overflow-wrap:anywhere; }
  .utilities button[aria-expanded="true"],.utilities button:not(:disabled):active { color:var(--robot-accent);background:color-mix(in srgb,var(--robot-accent) 12%,transparent); }
  .utilities ha-icon { width:20px;height:20px;--mdc-icon-size:20px;flex:0 0 20px; }
  @container (min-width:420px) { .hero .utilities { grid-template-columns:repeat(var(--utility-wide-columns,6),minmax(0,1fr)); } .utilities button { flex-direction:column;gap:5px;min-height:56px; } }
  @media (hover:hover) { .utilities button:not(:disabled):hover { color:var(--primary-text-color);background:color-mix(in srgb,var(--primary-text-color) 6%,transparent); } }
  .hero .sequence-activity { margin-top:10px;padding:0;background:transparent;box-shadow:none;border-radius:0;border-top:1px solid color-mix(in srgb,var(--primary-text-color) 8%,transparent); }
  .hero .sequence-activity > summary { min-height:54px;padding:8px 0; }
  .hero .activity-heading { display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:3px 12px; }
  .hero .activity-heading strong { font-size:12px; }
  .hero .activity-heading > span { font-size:11px; }
  .hero .activity-body { border-top:0; }
  .hero > .note { margin-top:10px; }
  .plan-section { padding:0 16px; }
  .plan-section .plan-bar { padding:4px 0; }
  .plan-section .preferences-panel { padding:0;background:transparent;box-shadow:none;border-radius:0; }
  .plan-section .plan-bar + .preferences-panel { border-top:1px solid color-mix(in srgb,var(--primary-text-color) 7%,transparent); }
  .plan-section .default-settings > summary { padding:10px 0;min-height:48px; }
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
  .room-select { display:flex;align-items:center;gap:10px;border:0;background:transparent;width:100%;text-align:left;padding:14px 16px;min-height:64px;border-radius:inherit; }
  .room-title { display:grid;gap:4px;flex:1;min-width:0; }
  .room-add { color:var(--secondary-text-color);font-size:22px;padding:0 6px; }
  .room-inline { border-top:1px solid color-mix(in srgb,var(--primary-text-color) 6%,transparent);padding:0 14px; }
  .room-inline > summary { cursor:pointer;display:flex;align-items:center;gap:8px;min-height:52px;padding:10px 0;list-style:none; }
  summary::-webkit-details-marker { display:none; }
  .room-inline > summary::marker,.default-settings > summary::marker { content:""; }
  .room-settings-summary { flex:1;min-width:0;color:var(--robot-muted); }
  .setting-chips { display:flex;align-items:center;flex-wrap:wrap;gap:5px;min-width:0; }
  .setting-chip { display:inline-flex;align-items:center;gap:4px;max-width:100%;min-height:26px;padding:5px 8px;border-radius:var(--chip-border-radius);background:color-mix(in srgb,var(--primary-text-color) 6%,transparent);font-size:11px;font-weight:550;line-height:1.35;color:var(--robot-muted);overflow-wrap:anywhere; }
  .setting-chip ha-icon { width:14px;height:14px;--mdc-icon-size:14px;flex:0 0 14px;color:inherit; }
  .setting-chip.mode-chip { background:color-mix(in srgb,var(--robot-accent) 11%,transparent);color:color-mix(in srgb,var(--robot-accent) 45%,var(--primary-text-color)); }
  .room-inline .settings-edit-icon { width:18px;height:18px;--mdc-icon-size:18px;flex:0 0 18px;color:var(--robot-muted); }
  .room-inline[open] .settings-edit-icon { color:var(--robot-accent); }
  .inline-settings { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:10px 0 16px; }
  .inline-setting { display:grid;gap:6px;min-width:0;font-size:12px;color:var(--secondary-text-color); }
  .inline-setting select { width:100%;min-width:0;min-height:44px;border-radius:14px;border:1px solid var(--divider-color);background:var(--robot-surface);color:var(--primary-text-color);font:inherit;padding:8px; }
  .inline-setting select:focus-visible { outline:2px solid var(--robot-accent); }
  .preferences-panel { padding:0 16px; }
  .default-settings { min-width:0; }
  .default-settings > summary { display:grid;gap:8px;cursor:pointer;list-style:none;min-height:44px;padding:14px 0; }
  .defaults-heading { display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;line-height:1.4; }
  .defaults-heading .defaults-title,.defaults-heading > span:first-of-type { flex:1;min-width:0; }
  .defaults-mode { flex:0 1 auto;max-width:45%;padding:4px 7px;border-radius:var(--chip-border-radius);background:color-mix(in srgb,var(--primary-text-color) 6%,transparent);color:var(--robot-muted);font-size:11px;font-weight:500;line-height:1.35;overflow-wrap:anywhere; }
  .defaults-heading > ha-icon { width:18px;height:18px;--mdc-icon-size:18px;flex:0 0 18px;color:var(--robot-muted); }
  .defaults-heading > ha-icon:last-child { margin-left:auto;transition:transform .15s; }
  .default-settings[open] .defaults-heading > ha-icon:last-child { transform:rotate(180deg); }
  .default-settings > .setting-chips { margin:0 0 4px; }
  .default-settings > .inline-settings { border-top:1px solid color-mix(in srgb,var(--primary-text-color) 7%,transparent);padding-top:14px; }
  .defaults-actions { display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding-bottom:8px; }
  .defaults-actions .action { font-size:12px;min-height:44px;padding:10px 12px; }
  .defaults-actions .text-button { display:inline-flex;align-items:center;justify-content:center;gap:6px; }
  .defaults-actions ha-icon { width:18px;height:18px;--mdc-icon-size:18px;flex:0 0 18px; }
  .default-settings .hint { margin:0 0 12px; }
  .default-settings .zone-report { margin:4px 0 14px;background:transparent; }
  .zone-report > summary { min-height:44px;align-items:center; }
  .preferences-toolbar { display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;min-height:52px;padding:4px 0;border-top:1px solid color-mix(in srgb,var(--primary-text-color) 7%,transparent); }
  .preferences-label { flex:1;min-width:100px;color:var(--robot-muted);font-size:12px;line-height:1.4; }
  .preferences-actions { display:flex;flex-wrap:wrap;align-items:center;gap:4px; }
  .preferences-actions .action { min-height:44px;font-size:12px;padding:9px 12px; }
  .preferences-actions .text-button { padding:8px; }
  .preferences-panel > .hint { margin:0;padding:0 0 12px; }
  .sequence-activity { padding:0 14px;min-width:0; }
  .sequence-activity > summary { display:flex;align-items:center;gap:10px;min-height:64px;list-style:none;cursor:pointer; }
  .activity-heading { display:grid;gap:4px;flex:1;min-width:0; }
  .activity-heading strong { font-size:13px;font-weight:650; }
  .activity-heading > span { font-size:12px;line-height:1.35;color:var(--robot-muted); }
  .sequence-activity > summary > ha-icon { width:20px;height:20px;--mdc-icon-size:20px;flex-basis:20px;color:var(--robot-muted); }
  .activity-chevron { transition:transform .15s; }
  .sequence-activity[open] > summary .activity-chevron { transform:rotate(180deg); }
  .activity-body { border-top:1px solid color-mix(in srgb,var(--primary-text-color) 7%,transparent);padding-bottom:12px; }
  .activity-run-select { display:block;margin-top:12px; }
  .activity-run-select select { width:100%;min-height:44px;min-width:0;padding:8px 10px;border-radius:12px;border:1px solid var(--divider-color);font:inherit;font-size:12px;background:var(--robot-surface);color:inherit; }
  .activity-run-select select:focus-visible { outline:3px solid var(--robot-accent);outline-offset:2px; }
  .activity-meta { display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;padding:12px 0;font-size:11px;color:var(--robot-muted);font-variant-numeric:tabular-nums; }
  .activity-rooms { display:grid;gap:14px;list-style:none;margin:0;padding:0; }
  .activity-room { min-width:0; }
  .activity-room-heading { display:flex;align-items:center;gap:7px;margin-bottom:7px;font-size:12px; }
  .activity-room-heading strong { flex:1;min-width:0;overflow-wrap:anywhere;font-weight:600; }
  .activity-room-heading ha-icon { width:16px;height:16px;--mdc-icon-size:16px;flex-basis:16px;color:var(--robot-muted); }
  .activity-room-heading .activity-room-done { color:var(--status-success-color); }
  .activity-order { display:grid;place-items:center;width:20px;height:20px;border-radius:50%;flex:0 0 20px;background:color-mix(in srgb,var(--robot-accent) 10%,transparent);color:var(--robot-muted);font-size:10px;font-weight:650; }
  .activity-stages { display:flex;flex-wrap:wrap;gap:6px; }
  .activity-stage { display:inline-flex;align-items:center;gap:6px;padding:7px 9px;max-width:100%;min-width:0;border-radius:16px;background:color-mix(in srgb,var(--primary-text-color) 6%,transparent);color:var(--robot-muted);font-size:11px;line-height:1.4; }
  .activity-stage ha-icon { width:15px;height:15px;--mdc-icon-size:15px;flex:0 0 15px; }
  .activity-stage-text { display:grid;gap:2px;min-width:0;overflow-wrap:anywhere; }
  .activity-stage time,.activity-time-unknown { font-size:10px;opacity:.85;font-variant-numeric:tabular-nums; }
  .activity-stage.completed { color:color-mix(in srgb,var(--status-success-color) 60%,var(--primary-text-color));background:color-mix(in srgb,var(--status-success-color) 9%,transparent); }
  .activity-stage.attention,.activity-stage.paused { color:color-mix(in srgb,var(--warning-color,#efb76a) 70%,var(--primary-text-color));background:color-mix(in srgb,var(--warning-color,#efb76a) 8%,transparent); }
  .activity-stage.running { color:var(--robot-accent);background:color-mix(in srgb,var(--robot-accent) 10%,transparent); }
  .activity-interruptions { margin-top:12px;font-size:11px;color:var(--robot-muted); }
  .activity-interruptions > summary { display:flex;align-items:center;gap:7px;min-height:44px;cursor:pointer;list-style:none; }
  .activity-interruptions ha-icon { width:16px;height:16px;--mdc-icon-size:16px;flex-basis:16px; }
  .activity-interruptions > summary > ha-icon:last-child { margin-left:auto; }
  .activity-interruptions ol { list-style:none;margin:0;padding:0;display:grid;gap:10px; }
  .activity-interruptions li { display:grid;gap:4px;line-height:1.5;overflow-wrap:anywhere; }
  .activity-note { margin-top:12px;font-size:11px;color:var(--robot-muted);line-height:1.45; }
  @container (max-width:340px) {
    .hero { padding:18px 14px; }
    .identity { gap:9px; }
    .robot-icon { width:40px;height:40px;flex-basis:40px; }
    .name { font-size:16px; }
    .room-select { padding:13px 14px; }
    .room-inline { padding:0 12px; }
    .preferences-panel { padding:0 14px; }
    .action { padding:10px 12px; }
  }
  @media (prefers-reduced-motion:reduce) { *, .glow-under { animation:none!important;transition:none!important; } }
`;
