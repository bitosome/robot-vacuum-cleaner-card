/** Shared inline controls. Editing a draft never sends a Home Assistant service. */
import {html,nothing} from 'lit';
import {live} from 'lit/directives/live.js';
import {MODE_LABELS,optionLabel,modeRoutes,type ManualCapabilities,type ManualSetup} from './manual-setup';
export function settingsSummary(setup:ManualSetup): string {
  return [MODE_LABELS[setup.mode], setup.mode!=='mop'&&setup.suction?`Suction ${optionLabel(setup.suction)}`:'',
    setup.mode!=='vacuum'&&setup.water?`Water ${optionLabel(setup.water)}`:'',
    setup.mode!=='vacuum'&&setup.route?`Route ${optionLabel(setup.route)}`:'',`×${setup.repeat}`].filter(Boolean).join(' · ');
}
export function renderRoomSettings(model:{id:string;name:string;setup:ManualSetup;caps:ManualCapabilities;disabled:boolean;change(patch:Partial<ManualSetup>):void}) {
  const {setup,caps}=model;
  const choice=(key:keyof ManualSetup,label:string,values:Array<string|number>)=>values.length?html`<label class="inline-setting"><span>${label}</span><select aria-label=${`${label} for ${model.name}`} data-room-setting=${key} data-room-id=${model.id} .value=${live(String(setup[key]??''))} ?disabled=${model.disabled} @change=${(event:Event)=>model.change({[key]:key==='repeat'?Number((event.target as HTMLSelectElement).value):(event.target as HTMLSelectElement).value})}>${values.map(value=>html`<option .value=${String(value)} .selected=${live(setup[key]===value)}>${key==='mode'?MODE_LABELS[value as ManualSetup['mode']]:key==='repeat'?`×${value}`:optionLabel(String(value))}</option>`)}</select></label>`:nothing;
  return html`<div class="inline-settings">${choice('mode','Mode',caps.modes.map(mode=>mode.value))}${setup.mode!=='mop'?choice('suction','Suction',caps.suction):nothing}${setup.mode!=='vacuum'?choice('water','Water',caps.water):nothing}${setup.mode!=='vacuum'?choice('route','Route',modeRoutes(caps,setup.mode)):nothing}${choice('repeat','Passes',caps.repeats)}</div>`;
}
