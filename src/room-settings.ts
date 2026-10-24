/** Shared inline controls. Editing a draft never sends a Home Assistant service. */
import {html,nothing} from 'lit';
import {live} from 'lit/directives/live.js';
import {MODE_LABELS,MODE_ICONS,optionLabel,modeRoutes,modeSuction,restrictedMaxPlus,type ManualCapabilities,type ManualSetup} from './manual-setup';
export function settingsSummary(setup:ManualSetup): string {
  return [MODE_LABELS[setup.mode], setup.mode!=='mop'&&setup.suction?`Suction ${optionLabel(setup.suction)}`:'',
    setup.mode!=='vacuum'&&setup.water?`Water flow ${optionLabel(setup.water)}`:'',
    setup.mode!=='vacuum'&&setup.route?`Route ${optionLabel(setup.route)}`:'',`×${setup.repeat}`].filter(Boolean).join(' · ');
}
/** Compact, readable values; icon labels remain available to assistive technology. */
export function renderSettingPills(setup:ManualSetup) {
  const chip=(key:string,label:string,value:string,mdi:string)=>html`<span class="setting-chip ${key==='mode'?'mode-chip':''}" data-setting-chip=${key} title=${`${label}: ${value}`}><ha-icon .icon=${mdi} aria-hidden="true"></ha-icon>${key!=='mode'?html`<span class="sr-only">${label} </span>`:nothing}<span>${value}</span></span>`;
  return html`<span class="setting-chips">
    ${chip('mode','Mode',MODE_LABELS[setup.mode]??setup.mode,MODE_ICONS[setup.mode]??'mdi:robot-vacuum')}
    ${setup.mode!=='mop'&&setup.suction?chip('suction','Suction',optionLabel(setup.suction),'mdi:fan'):nothing}
    ${setup.mode!=='vacuum'&&setup.water?chip('water','Water flow',optionLabel(setup.water),'mdi:water-outline'):nothing}
    ${setup.mode!=='vacuum'&&setup.route?chip('route','Route',optionLabel(setup.route),'mdi:map-marker-path'):nothing}
    ${chip('repeat','Passes',`×${setup.repeat}`,'mdi:repeat')}
  </span>`;
}
export function renderRoomSettings(model:{id:string;name:string;setup:ManualSetup;caps:ManualCapabilities;disabled:boolean;change(patch:Partial<ManualSetup>):void}) {
  const {setup,caps}=model;
  const choice=(key:keyof ManualSetup,label:string,values:Array<string|number>)=>values.length?html`<label class="inline-setting"><span>${label}</span><select aria-label=${`${label} for ${model.name}`} data-room-setting=${key} data-room-id=${model.id} .value=${live(String(setup[key]??''))} ?disabled=${model.disabled} @change=${(event:Event)=>model.change({[key]:key==='repeat'?Number((event.target as HTMLSelectElement).value):(event.target as HTMLSelectElement).value})}>${setup[key]!==undefined&&!values.includes(setup[key]!)?html`<option .value=${String(setup[key])} selected disabled>${optionLabel(String(setup[key]))} · unavailable in this mode</option>`:nothing}${values.map(value=>html`<option .value=${String(value)} .selected=${live(setup[key]===value)}>${key==='mode'?MODE_LABELS[value as ManualSetup['mode']]:key==='repeat'?`×${value}`:optionLabel(String(value))}</option>`)}</select></label>`:nothing;
  return html`<div class="inline-settings">${choice('mode','Mode',caps.modes.map(mode=>mode.value))}${setup.mode!=='mop'?choice('suction','Suction',modeSuction(caps,setup.mode)):nothing}${setup.mode!=='vacuum'?choice('water','Water flow',caps.water):nothing}${setup.mode!=='vacuum'?choice('route','Route',modeRoutes(caps,setup.mode)):nothing}${choice('repeat','Passes',caps.repeats)}</div>${restrictedMaxPlus(setup)?html`<p class="hint" role="status">Max+ is available only in Vacuum mode. Choose another suction level or switch to Vacuum.</p>`:nothing}`;
}
