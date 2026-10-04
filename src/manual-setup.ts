import { html, nothing } from 'lit';
import { humanize } from './types';

export type CleaningMode = 'vacuum'|'mop'|'vacuum_mop'|'vacuum_then_mop';
export type CleaningSource = 'preset'|'manual';
export interface ManualSetup { mode: CleaningMode; suction?: string; water?: string; route?: string; repeat: number; }
export interface ManualCapabilities {
  supported: boolean; modes: Array<{value: CleaningMode; label: string}>;
  suction: string[]; water: string[]; routes: string[]; routes_by_mode?: Partial<Record<CleaningMode,string[]>>;
  repeats: number[]; room_targets: Array<{id:string; name:string; icon?:string}>; defaults?: Partial<ManualSetup>; error?: string;
}
export interface ManualStage { target: string; mode: CleaningMode; room_index: number; pass_index: number; repeat_index: number; }
export const MODE_LABELS: Record<CleaningMode,string> = {vacuum:'Vacuum',mop:'Mop',vacuum_mop:'Vacuum & mop',vacuum_then_mop:'Vacuum then mop'};
export const MODE_ICONS: Record<CleaningMode,string> = {vacuum:'mdi:vacuum',mop:'mdi:water-outline',vacuum_mop:'mdi:vacuum-outline',vacuum_then_mop:'mdi:swap-horizontal'};
export function optionLabel(value: string) { return ({max_plus:'Max+',deep_plus:'Deep+',custom_water_flow:'Custom from app'} as Record<string,string>)[value] ?? humanize(value); }
export function modeRoutes(caps: ManualCapabilities, mode: CleaningMode) { return caps.routes_by_mode?.[mode] ?? caps.routes; }
export function normalizeSetup(caps: ManualCapabilities, input: Partial<ManualSetup> = {}): ManualSetup {
  const mode = caps.modes.some(item=>item.value===input.mode) ? input.mode! : caps.modes[0]?.value ?? 'vacuum';
  const choose = (values:string[], value?:string, fallback?:string) => value && values.includes(value) ? value : fallback && values.includes(fallback) ? fallback : values[0];
  const setup: ManualSetup = {mode,repeat:caps.repeats.includes(input.repeat ?? 1) ? input.repeat ?? 1 : caps.repeats[0] ?? 1};
  if (mode !== 'mop') setup.suction = choose(caps.suction,input.suction,caps.defaults?.suction);
  if (mode !== 'vacuum') { setup.water = choose(caps.water,input.water,caps.defaults?.water); setup.route = choose(modeRoutes(caps,mode),input.route,caps.defaults?.route); }
  return setup;
}
export function setupSummary(setup: ManualSetup) {
  return [MODE_LABELS[setup.mode],setup.repeat > 1 ? `×${setup.repeat}` : ''].filter(Boolean).join(' · ');
}
interface SetupSheet {
  source: CleaningSource; setup: ManualSetup; caps?: ManualCapabilities; loading: boolean; error: string;
  changeSource(source:CleaningSource):void; changeSetup(setup:Partial<ManualSetup>):void; close():void; apply():void; retry():void;
}
export function renderSetupSheet(model: SetupSheet) {
  const {source,setup,caps} = model;
  const choice = (key:'suction'|'water'|'route'|'repeat',label:string,values:Array<string|number>) => values.length ? html`<fieldset class="setting-group" aria-label=${label}><legend>${label}</legend><div class="setting-choices">${values.map(value=>html`<button class="setting-pill ${setup[key]===value?'chosen':''}" data-setting=${key} data-value=${value} aria-pressed=${setup[key]===value?'true':'false'} @click=${()=>model.changeSetup({[key]:value})}>${key==='repeat' ? `×${value}`:optionLabel(String(value))}</button>`)}</div></fieldset>`:nothing;
  return html`<div class="setup-sheet"><div class="setup-header"><div><div class="eyebrow">Your next clean</div><h2 id="setup-title">Cleaning setup</h2></div><button class="close-button" data-action="close-setup" aria-label="Close cleaning setup" @click=${model.close}><ha-icon .icon=${'mdi:close'}></ha-icon></button></div>
    <div class="setup-body"><div class="source-tabs" role="group" aria-label="Cleaning setup source"><button data-action="presets" class=${source==='preset'?'chosen':''} aria-pressed=${source==='preset'?'true':'false'} @click=${()=>model.changeSource('preset')}>Saved presets</button><button data-action="manual" class=${source==='manual'?'chosen':''} aria-pressed=${source==='manual'?'true':'false'} @click=${()=>model.changeSource('manual')}>Manual setup</button></div>
    ${source==='preset' ? html`<div class="setup-description"><ha-icon .icon=${'mdi:bookmark-outline'}></ha-icon><h3>Your Roborock routines</h3><p>Each room uses the settings saved in its Roborock preset. Select the tiles in the order you want them cleaned.</p></div>` : html`
      ${model.loading ? html`<p class="setup-message" role="status">Reading robot capabilities…</p>` : model.error || !caps?.supported ? html`<div class="setup-message" role="alert">${model.error || caps?.error || 'Manual cleaning needs the updated Home Assistant queue companion.'}<button class="text-button" data-action="retry-capabilities" @click=${model.retry}>Try again</button></div>`:html`
        <div class="mode-grid" role="group" aria-label="Cleaning mode">${caps.modes.map(mode=>html`<button class="mode-choice ${setup.mode===mode.value?'chosen':''}" data-mode=${mode.value} aria-pressed=${setup.mode===mode.value?'true':'false'} @click=${()=>model.changeSetup({mode:mode.value})}><ha-icon .icon=${MODE_ICONS[mode.value]}></ha-icon><span>${MODE_LABELS[mode.value] ?? mode.label}</span>${setup.mode===mode.value ? html`<ha-icon class="choice-check" .icon=${'mdi:check-circle'}></ha-icon>`:nothing}</button>`)}</div>
        <p class="mode-description">${setup.mode==='vacuum_then_mop' ? 'Vacuum every selected area first, then mop them in the same order.' : setup.mode==='vacuum_mop' ? 'Vacuum and mop together in one run.' : setup.mode==='mop' ? 'Mop with suction switched off.' : 'Vacuum with water flow switched off.'}</p>
        ${setup.mode!=='mop' ? choice('suction','Suction power',caps.suction):nothing}
        ${setup.mode!=='vacuum' ? choice('water','Water flow',caps.water):nothing}
        ${setup.mode!=='vacuum' ? choice('route','Mop route',modeRoutes(caps,setup.mode)):nothing}
        ${choice('repeat','Cleaning count',caps.repeats)}
        <p class="setup-footnote">${setup.repeat > 1 ? '×2 cleans each area twice per pass, as separate runs. ' : ''}Manual cleaning uses Home Assistant’s mapped areas. With no area selected, the whole home is cleaned.</p>
      `}
    `}
    </div><div class="setup-footer"><p>Settings apply when you start cleaning.</p><button class="action primary" data-action="apply-setup" ?disabled=${source==='manual' && (model.loading || !caps?.supported || !caps.modes.length || !!model.error)} @click=${model.apply}>Use ${source==='preset'?'presets':'settings'}</button></div></div>`;
}
