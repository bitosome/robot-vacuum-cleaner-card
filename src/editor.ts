import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { CardConfig, Hass, RoomConfig } from './types';

interface AreaAppearanceRow { id: string; name: string; icon: string; }

@customElement('robot-vacuum-cleaner-card-editor')
export class RobotVacuumCleanerCardEditor extends LitElement {
  @property({attribute:false}) hass?: Hass;
  @state() private config?: CardConfig;
  @state() private areaRows: AreaAppearanceRow[] = [];
  @state() private areaError = '';
  static styles = css`
    :host{display:block;color:var(--primary-text-color);font-family:inherit}*{box-sizing:border-box}label{display:grid;gap:6px;font-size:13px;margin:12px 0}input,select,button{font:inherit;color:inherit;min-height:44px;border:1px solid var(--divider-color,#777);border-radius:10px;padding:10px;background:var(--card-background-color,#fff)}input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.room{border:1px solid var(--divider-color,#aaa);border-radius:12px;padding:12px;margin:12px 0}.room header{display:flex;justify-content:space-between;align-items:center;gap:8px}.room header button{font-size:12px}h3{font-size:15px;margin:20px 0 8px}p{color:var(--secondary-text-color);font-size:12px;line-height:1.5}details{margin-top:16px}summary{cursor:pointer;min-height:44px;padding:12px 0}.add{width:100%;color:var(--primary-color)}@media(max-width:420px){.row{grid-template-columns:1fr}}
  `;
  setConfig(config: CardConfig) {
    this.config = {...config,rooms:(config.rooms??[]).map(room=>({...room})), ...(config.area_overrides ? {area_overrides:Object.fromEntries(Object.entries(config.area_overrides).map(([id,value])=>[id,{...value}]))} : {})};
    this.areaRows = Object.entries(this.config.area_overrides ?? {}).map(([id,value])=>({id,name:value.name ?? '',icon:value.icon ?? ''}));
    this.areaError = '';
  }
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
  private syncAreas() {
    if (!this.config) return;
    const ids = this.areaRows.map(row=>row.id.trim());
    if (ids.some(id=>!id) || new Set(ids).size !== ids.length) {
      this.areaError = 'Enter a unique Home Assistant area ID for every override.';
      return;
    }
    this.areaError = '';
    const area_overrides = Object.fromEntries(this.areaRows.map(row=>[row.id.trim(),{...(row.name.trim() ? {name:row.name.trim()} : {}),...(row.icon.trim() ? {icon:row.icon.trim()} : {})}]));
    this.config = {...this.config,area_overrides};
    this.emit();
  }
  private changeArea(index: number, key: keyof AreaAppearanceRow, value: string) {
    this.areaRows = this.areaRows.map((row,i)=>i===index ? {...row,[key]:value} : row);
    this.syncAreas();
  }
  protected render() {
    if(!this.config)return nothing;
    return html`<p>Choose your robot and its room preset buttons. Ordered cleaning requires the Robot Cleaner Queue companion; the queue runs in Home Assistant.</p>
      ${this.field('entity','Robot','vacuum')}${this.field('name','Display name')}${this.field('full_clean_entity','Full-home preset (optional)','button')}
      <h3>Room tiles</h3><p>Each tile runs an existing Roborock routine. Room order here controls the grid; tap order controls each cleaning sequence.</p>
      ${this.config.rooms.map((room,index)=>html`<div class="room"><header><strong>Room ${index+1}</strong><button @click=${()=>{this.config={...this.config!,rooms:this.config!.rooms.filter((_,i)=>i!==index)};this.emit();}}>Remove room ${index+1}</button></header><div class="row"><label>Room name<input aria-label=${`Room ${index+1} name`} .value=${room.name} @change=${(e:Event)=>this.changeRoom(index,'name',(e.target as HTMLInputElement).value)}></label><label>Icon<input aria-label=${`Room ${index+1} icon`} .value=${room.icon??'mdi:floor-plan'} @change=${(e:Event)=>this.changeRoom(index,'icon',(e.target as HTMLInputElement).value)}></label></div><label>Preset button<select aria-label=${`Room ${index+1} preset`} @change=${(e:Event)=>this.changeRoom(index,'preset',(e.target as HTMLSelectElement).value)}><option value="">Choose a preset</option>${Object.keys(this.hass?.states??{}).filter(id=>id.startsWith('button.')).sort().map(id=>html`<option value=${id} ?selected=${room.preset===id}>${this.hass!.states[id].attributes.friendly_name??id} (${id})</option>`)}</select></label></div>`)}
      <button class="add" @click=${()=>{this.config={...this.config!,rooms:[...this.config!.rooms,{id:`room_${Date.now()}`,name:'',preset:'',icon:'mdi:floor-plan'}]};this.requestUpdate();}}>Add room</button>
      <details><summary>Manual area appearance</summary>
        <p>Use the same room names and icons as your Space Hub cards. Match each override to an existing Home Assistant area ID from the robot's Cleaning by area mapping. These settings only change the tile appearance; they do not add areas or change what gets cleaned. Leave name or icon blank to use the area default.</p>
        ${this.areaRows.map((area,index)=>html`<div class="room"><header><strong>Area ${index+1}</strong><button data-action="remove-area-override" @click=${()=>{this.areaRows=this.areaRows.filter((_,i)=>i!==index);this.syncAreas();}}>Remove area ${index+1}</button></header><label>Home Assistant area ID<input aria-label=${`Area ${index+1} ID`} .value=${area.id} placeholder="living_room" @change=${(event:Event)=>this.changeArea(index,'id',(event.target as HTMLInputElement).value)}></label><div class="row"><label>Display name<input aria-label=${`Area ${index+1} name`} .value=${area.name} placeholder="Use area name" @change=${(event:Event)=>this.changeArea(index,'name',(event.target as HTMLInputElement).value)}></label><label>Icon<input aria-label=${`Area ${index+1} icon`} .value=${area.icon} placeholder="mdi:sofa-outline" @change=${(event:Event)=>this.changeArea(index,'icon',(event.target as HTMLInputElement).value)}></label></div></div>`)}
        ${this.areaError ? html`<p role="alert">${this.areaError}</p>` : nothing}
        <button class="add" data-action="add-area-override" @click=${()=>{this.areaRows=[...this.areaRows,{id:'',name:'',icon:''}];}}>Add area appearance</button>
      </details>
      <details><summary>Telemetry and queue entities</summary>
        <label>Require shared cleaning controller<select aria-label="Require shared cleaning controller" @change=${(event:Event)=>{this.config={...this.config!,require_queue:(event.target as HTMLSelectElement).value==='true'};this.emit();}}><option value="false" ?selected=${!this.config.require_queue}>No — standalone controls allowed</option><option value="true" ?selected=${!!this.config.require_queue}>Yes — all controls use the companion</option></select></label>
        ${this.field('battery_entity','Battery','sensor')}${this.field('status_entity','Detailed status','sensor')}${this.field('cleaning_entity','Cleaning job active','binary_sensor')}${this.field('current_room_entity','Current room','sensor')}${this.field('progress_entity','Cleaning progress','sensor')}${this.field('area_entity','Cleaning area','sensor')}${this.field('time_entity','Cleaning time','sensor')}${this.field('error_entity','Vacuum error','sensor')}${this.field('dock_error_entity','Dock error','sensor')}${this.field('last_clean_end_entity','Last clean end','sensor')}${this.field('queue_entity','Queue status','sensor')}${this.field('queue_script','Queue control','script')}
      </details>`;
  }
}
