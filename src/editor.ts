import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { CardConfig, Hass, RoomConfig } from './types';

@customElement('robot-vacuum-cleaner-card-editor')
export class RobotVacuumCleanerCardEditor extends LitElement {
  @property({attribute:false}) hass?: Hass;
  @state() private config?: CardConfig;
  static styles = css`
    :host{display:block;color:var(--primary-text-color);font-family:inherit}*{box-sizing:border-box}label{display:grid;gap:6px;font-size:13px;margin:12px 0}input,select,button{font:inherit;color:inherit;min-height:44px;border:1px solid var(--divider-color,#777);border-radius:10px;padding:10px;background:var(--card-background-color,#fff)}input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.room{border:1px solid var(--divider-color,#aaa);border-radius:12px;padding:12px;margin:12px 0}.room header{display:flex;justify-content:space-between;align-items:center;gap:8px}.room header button{font-size:12px}h3{font-size:15px;margin:20px 0 8px}p{color:var(--secondary-text-color);font-size:12px;line-height:1.5}details{margin-top:16px}summary{cursor:pointer;min-height:44px;padding:12px 0}.add{width:100%;color:var(--primary-color)}@media(max-width:420px){.row{grid-template-columns:1fr}}
  `;
  setConfig(config: CardConfig) { this.config = {...config,rooms:(config.rooms??[]).map(room=>({...room}))}; }
  private emit() { this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this.config},bubbles:true,composed:true})); }
  private updateConfig(key: keyof CardConfig,value: string) { if(!this.config)return; this.config={...this.config,[key]:value||undefined};this.emit(); }
  private field(key: keyof CardConfig,label: string,domain?:string) {
    if(!this.config)return nothing;
    return html`<label>${label}${domain?html`<select aria-label=${label} @change=${(event:Event)=>this.updateConfig(key,(event.target as HTMLSelectElement).value)}><option value="" ?selected=${!this.config[key]}>Not configured</option>${Object.keys(this.hass?.states??{}).filter(id=>id.startsWith(`${domain}.`)).sort().map(id=>html`<option value=${id} ?selected=${this.config![key]===id}>${this.hass!.states[id].attributes.friendly_name??id} (${id})</option>`)}</select>`:html`<input aria-label=${label} .value=${String(this.config[key]??'')} @change=${(event:Event)=>this.updateConfig(key,(event.target as HTMLInputElement).value)}>`}</label>`;
  }
  private changeRoom(index:number,key:keyof RoomConfig,value:string) {
    if(!this.config)return;const rooms=this.config.rooms.map(room=>({...room}));rooms[index][key]=value;
    if(key==='preset' && !rooms[index].name)rooms[index].name=this.hass?.states[value]?.attributes.friendly_name??'Room';
    this.config={...this.config,rooms};this.emit();
  }
  protected render() {
    if(!this.config)return nothing;
    return html`<p>Choose your robot and its room preset buttons. Ordered cleaning requires the Robot Cleaner Queue companion; the queue runs in Home Assistant.</p>
      ${this.field('entity','Robot','vacuum')}${this.field('name','Display name')}${this.field('full_clean_entity','Full-home preset (optional)','button')}
      <h3>Room tiles</h3><p>Each tile runs an existing Roborock routine. Room order here controls the grid; tap order controls each cleaning sequence.</p>
      ${this.config.rooms.map((room,index)=>html`<div class="room"><header><strong>Room ${index+1}</strong><button @click=${()=>{this.config={...this.config!,rooms:this.config!.rooms.filter((_,i)=>i!==index)};this.emit();}}>Remove room ${index+1}</button></header><div class="row"><label>Room name<input aria-label=${`Room ${index+1} name`} .value=${room.name} @change=${(e:Event)=>this.changeRoom(index,'name',(e.target as HTMLInputElement).value)}></label><label>Icon<input aria-label=${`Room ${index+1} icon`} .value=${room.icon??'mdi:floor-plan'} @change=${(e:Event)=>this.changeRoom(index,'icon',(e.target as HTMLInputElement).value)}></label></div><label>Preset button<select aria-label=${`Room ${index+1} preset`} @change=${(e:Event)=>this.changeRoom(index,'preset',(e.target as HTMLSelectElement).value)}><option value="">Choose a preset</option>${Object.keys(this.hass?.states??{}).filter(id=>id.startsWith('button.')).sort().map(id=>html`<option value=${id} ?selected=${room.preset===id}>${this.hass!.states[id].attributes.friendly_name??id} (${id})</option>`)}</select></label></div>`)}
      <button class="add" @click=${()=>{this.config={...this.config!,rooms:[...this.config!.rooms,{id:`room_${Date.now()}`,name:'',preset:'',icon:'mdi:floor-plan'}]};this.requestUpdate();}}>Add room</button>
      <details><summary>Telemetry and queue entities</summary>
        ${this.field('battery_entity','Battery','sensor')}${this.field('status_entity','Detailed status','sensor')}${this.field('cleaning_entity','Cleaning job active','binary_sensor')}${this.field('current_room_entity','Current room','sensor')}${this.field('progress_entity','Cleaning progress','sensor')}${this.field('area_entity','Cleaning area','sensor')}${this.field('time_entity','Cleaning time','sensor')}${this.field('error_entity','Vacuum error','sensor')}${this.field('dock_error_entity','Dock error','sensor')}${this.field('last_clean_end_entity','Last clean end','sensor')}${this.field('queue_entity','Queue status','sensor')}${this.field('queue_script','Queue control','script')}
      </details>`;
  }
}
