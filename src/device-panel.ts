import {html, nothing} from 'lit';
import {live} from 'lit/directives/live.js';
import {available, humanize, numeric, type Hass} from './types';
export type DevicePanel = 'dock'|'map'|'settings'|'care'|'status';
const titles = {dock:'Dock',map:'Home map',settings:'Robot settings',care:'Care & maintenance',status:'Robot details'};
const labels:Record<string,string> = {selected_map:'Current map',off_peak:'Off-peak charging',off_peak_start:'Off-peak begins',off_peak_end:'Off-peak ends',mop_attached:'Mops attached',water_box_attached:'Water box attached',clean_water_empty:'Clean-water tank empty',dirty_water_full:'Dirty-water tank full',drying_remaining:'Drying remaining',last_clean_begin:'Last clean started',last_clean_end:'Last clean ended',total_cleaning_time:'Lifetime cleaning time',total_cleaning_area:'Lifetime cleaned area',total_cleaning_count:'Completed cleans',dust_emptying:'Empty dustbin',mop_washing:'Wash mops',mop_drying:'Dry mops',child_lock:'Child lock',dnd:'Do not disturb',dnd_start:'Quiet hours begin',dnd_end:'Quiet hours end',volume:'Voice volume',empty_mode:'Dust emptying mode',main_brush_time_left:'Main brush',side_brush_time_left:'Side brush',filter_time_left:'Filter',sensor_time_left:'Sensors',strainer_time_left:'Dock strainer',cleaning_brush_time_left:'Dock cleaning brush'};
export const PANEL_KEYS:Record<DevicePanel,string[]> = {dock:['dust_emptying','mop_washing','mop_drying'],map:[],settings:['volume','dnd','dnd_start','dnd_end','child_lock','empty_mode','selected_map','off_peak','off_peak_start','off_peak_end'],status:['mop_attached','water_box_attached','clean_water_empty','dirty_water_full','drying_remaining','last_clean_begin','last_clean_end','total_cleaning_time','total_cleaning_area','total_cleaning_count'],care:['main_brush_time_left','side_brush_time_left','filter_time_left','sensor_time_left','strainer_time_left','cleaning_brush_time_left']};
export function panelKeys(panel:DevicePanel, entities:Record<string,string>, hass:Hass) {
  return (panel==='map' ? Object.keys(entities).filter(key=>key.startsWith('map_')) : PANEL_KEYS[panel]).filter(key=>available(hass.states[entities[key]]) && (panel!=='care' || numeric(hass.states[entities[key]])!==undefined));
}
export function renderDevicePanel(model:{panel:DevicePanel;hass:Hass;entities:Record<string,string>;busy:boolean;motionBlocked?:boolean;motionReason?:string;robotDocked:boolean;waterEmpty:boolean;fault:boolean;error:string;pending:boolean;close():void;send(key:string,value:string|number):void}) {
  const {panel,hass,entities}=model;
  const keys=panelKeys(panel,entities,hass);
  return html`<div class="setup-sheet"><header class="setup-header"><div><div class="eyebrow">Robot controls</div><h2 id="device-title">${titles[panel]}</h2></div><button class="close-button" aria-label="Close controls" @click=${model.close}><ha-icon .icon=${'mdi:close'}></ha-icon></button></header>
    <div class="setup-body device-body">
    ${model.error ? html`<p class="error" role="alert">${model.error}</p>`:nothing}
    ${model.pending ? html`<p class="note" role="status">Waiting for the robot to confirm…</p>`:nothing}
    ${(panel==='dock' || panel==='settings' && keys.includes('selected_map')) && model.motionBlocked ? html`<p class="note" role="status">${model.motionReason || 'Waiting for the robot to be ready for this action.'}</p>`:nothing}
    ${panel==='dock' && model.waterEmpty ? html`<p class="note">Refill and reseat the clean-water tank to wash mops. Dust emptying and drying do not need water.</p>`:nothing}
    ${panel==='dock' && !model.robotDocked ? html`<p class="note">Dock actions can start when the robot is docked and its cleaning job has finished.</p>`:nothing}
    ${keys.map(key=>{
      const state=hass.states[entities[key]], value=state.state, label=labels[key]??humanize(key);
      if(panel==='map') {
        const picture=state.attributes.entity_picture;
        // Only HA image proxy paths; never fetch arbitrary URLs from attributes.
        const src=typeof picture==='string' && /^\/api\/image_proxy\//.test(picture) ? hass.hassUrl?.(picture)??picture : '';
        return html`<figure class="map-view">${src ? html`<img src=${src} alt=${state.attributes.friendly_name??'Robot home map'} />`:html`<p class="note">The map image is not available yet.</p>`}<figcaption>${state.attributes.friendly_name??'Map'} · View only</figcaption></figure>`;
      }
      if(panel==='status') return html`<div class="device-row"><span>${label}</span><strong>${entities[key].startsWith('binary_sensor.') ? value==='on'?'Yes':'No' : key.startsWith('last_clean_') ? new Date(value).toLocaleString() : `${value} ${state.attributes.unit_of_measurement??''}`}</strong></div>`;
      if(panel==='care') {
        const hours=numeric(state)!;
        return html`<div class="device-row care-row"><span>${label}</span><strong class=${hours<=0?'overdue':''}>${hours<=0 ? 'Maintenance due' : `${Math.round(hours)} ${state.attributes.unit_of_measurement??'h'} left`}</strong></div>`;
      }
      if(entities[key].startsWith('switch.')) {
        const on=value==='on', dock=panel==='dock';
        const disabled=model.busy || (dock && !!model.motionBlocked) || (dock && !on && (!model.robotDocked || model.fault || (key==='mop_washing' && model.waterEmpty)));
        return html`<div class="device-row"><div><span>${label}</span>${dock ? html`<small>${on?'Running':'Idle'}</small>`:nothing}</div><button class="setting-pill ${on?'chosen':''}" data-device=${key} aria-label=${`${label}: ${on?'on':'off'}`} aria-pressed=${on?'true':'false'} ?disabled=${disabled} @click=${()=>model.send(key,on?'off':'on')}>${dock ? on?'Stop':'Start' : on?'On':'Off'}</button></div>`;
      }
      if(key==='volume') return html`<label class="device-row volume-row"><span>${label}<strong>${value}%</strong></span><input data-device="volume" aria-label="Voice volume" type="range" min=${state.attributes.min??0} max=${state.attributes.max??100} step=${state.attributes.step??1} .value=${live(value)} ?disabled=${model.busy} @change=${(event:Event)=>model.send(key,Number((event.target as HTMLInputElement).value))}></label>`;
      if(entities[key].startsWith('time.')) return html`<label class="device-row"><span>${label}</span><input type="time" data-device=${key} .value=${live(value.slice(0,5))} ?disabled=${model.busy} @change=${(event:Event)=>model.send(key,(event.target as HTMLInputElement).value)}></label>`;
      const options=(state.attributes.options??[]).filter((v:string)=>!['unknown','unavailable'].includes(v));
      return options.length>1 ? html`<label class="device-row"><span>${label}</span><select data-device=${key} .value=${live(value)} ?disabled=${model.busy || key==='selected_map'&&(!model.robotDocked||!!model.motionBlocked)} @change=${(event:Event)=>model.send(key,(event.target as HTMLSelectElement).value)}>${options.map((option:string)=>html`<option .value=${option} .selected=${live(option===value)}>${humanize(option)}</option>`)}</select></label>`:nothing;
    })}
    ${!keys.length ? html`<p class="note">No available controls in this section.</p>`:nothing}
    ${panel==='care' ? html`<p class="hint">Usage-based reminders from the robot. Service the parts before resetting their counters in the Roborock app.</p>`:nothing}
    </div><footer class="setup-footer"><p>${panel==='settings'?'Changes apply to the robot immediately.':'Live state from Home Assistant'}</p></footer></div>`;
}
