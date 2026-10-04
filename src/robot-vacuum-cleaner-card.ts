import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { designTokens } from './shared/design-tokens';
import { buildGlow, type PulseColors } from './shared/glow';
import { cardStyles } from './styles/card';
import { available, BAD, humanize, numeric, QUEUE_ACTIVE, validateConfig, type CardConfig, type EntityState, type Hass, type RoomConfig } from './types';

const BLUE: PulseColors = {weak:'rgba(66,165,245,.12)',strong:'rgba(66,165,245,.26)'};
const ACCENT: PulseColors = {weak:'color-mix(in srgb,var(--robot-accent) 10%,transparent)',strong:'color-mix(in srgb,var(--robot-accent) 22%,transparent)'};
const icon = (name: string) => html`<ha-icon .icon=${name}></ha-icon>`;
const quietError = (state?: string) => !state || ['none','ok','no_error','0','unknown','unavailable',''].includes(state.toLowerCase());

@customElement('robot-vacuum-cleaner-card')
export class RobotVacuumCleanerCard extends LitElement {
  static styles = [designTokens, cardStyles];
  @property({attribute:false}) hass?: Hass;
  @state() private config?: CardConfig;
  @state() private selected: string[] = [];
  @state() private request?: {kind:string; since:number};
  @state() private feedback = '';
  @state() private commandError = '';
  private requestTimer?: ReturnType<typeof setTimeout>;

  setConfig(config: CardConfig) { this.config = validateConfig(config); this.selected = this.selected.filter(id => this.config!.rooms.some(room => room.id === id)); }
  getCardSize() { return 8; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 9, min_rows: 6 }; }
  static async getConfigElement() { await import('./editor'); return document.createElement('robot-vacuum-cleaner-card-editor'); }
  static getStubConfig(hass?: Hass) {
    return {type:'custom:robot-vacuum-cleaner-card',entity:Object.keys(hass?.states ?? {}).find(id => id.startsWith('vacuum.')) ?? 'vacuum.robot',rooms:[]};
  }
  disconnectedCallback() { super.disconnectedCallback(); clearTimeout(this.requestTimer); this.request = undefined; }
  private entity(id?: string) { return id ? this.hass?.states[id] : undefined; }
  private get vacuum() { return this.entity(this.config?.entity); }
  private get queue() { const q = this.entity(this.config?.queue_entity); return q?.attributes.vacuum && q.attributes.vacuum !== this.config?.entity ? undefined : q; }
  private get phase() { return this.queue?.state ?? 'unavailable'; }
  private get queueActive() { return QUEUE_ACTIVE.has(this.phase); }
  private get queuePresets(): string[] { return Array.isArray(this.queue?.attributes.presets) ? this.queue!.attributes.presets.filter((p:unknown) => typeof p === 'string') : []; }
  private get index() { return Math.max(0,Number(this.queue?.attributes.current_index) || 0); }
  private get completed() { return Math.max(0,Number(this.queue?.attributes.completed) || 0); }
  private get robotReady() { return available(this.vacuum); }
  private get jobActive() { return this.entity(this.config?.cleaning_entity)?.state === 'on' || ['cleaning','paused','returning'].includes(this.vacuum?.state ?? ''); }
  private get blocked() { return !!this.request || !!this.queue?.attributes.pending_command; }
  private get fault() {
    const err = this.entity(this.config?.error_entity)?.state;
    const dock = this.entity(this.config?.dock_error_entity)?.state;
    return !quietError(err) ? humanize(err) : !quietError(dock) ? humanize(dock) : this.vacuum?.state === 'error' ? 'Robot needs attention' : '';
  }
  private get canStart() { return this.phase !== 'attention' && this.robotReady && !this.jobActive && !this.queueActive && !this.blocked && !this.fault && ['docked','idle'].includes(this.vacuum?.state ?? ''); }
  private get queueReady() { return available(this.queue) && (!!this.hass?.services?.robot_cleaner_queue?.control || available(this.entity(this.config?.queue_script))); }
  private feature(bit: number) { return ((Number(this.vacuum?.attributes.supported_features) || 0) & bit) !== 0; }
  private get rooms() { return this.config?.rooms ?? []; }
  private get selectedRooms() { return this.selected.map(id => this.rooms.find(room => room.id === id)).filter((room):room is RoomConfig => !!room); }
  private get showCommitted() { return this.queuePresets.length > 0 && (this.queueActive || (!this.selected.length && ['attention','completed','cancelled'].includes(this.phase))); }

  protected updated(changed: PropertyValues) {
    if (!changed.has('hass') || !this.request) return;
    const kind = this.request.kind;
    const acknowledged = kind === 'cancel' ? this.phase === 'cancelled' : kind === 'start' ? this.queueActive || this.phase === 'attention'
      : kind === 'full' ? this.jobActive || this.queueActive || this.phase === 'attention'
      : kind === 'pause' ? this.vacuum?.state === 'paused' || this.phase === 'paused'
      : kind === 'resume' ? this.vacuum?.state === 'cleaning'
      : kind === 'return_to_dock' ? ['returning','docked'].includes(this.vacuum?.state ?? '')
      : false;
    if (acknowledged) {
      clearTimeout(this.requestTimer); this.request = undefined;
      if (kind === 'start' && this.queueActive) this.selected = [];
      this.feedback = '';
    }
  }

  private toggleRoom(room: RoomConfig) {
    if (this.queueActive || this.blocked || (!this.selected.includes(room.id) && !available(this.entity(room.preset),true))) return;
    this.selected = this.selected.includes(room.id) ? this.selected.filter(id => id !== room.id) : [...this.selected,room.id];
    this.feedback = this.selected.length ? `${this.selectedRooms.map((r,i)=>`${i+1}. ${r.name}`).join(', ')} selected.` : 'Selection cleared.';
    this.commandError = '';
  }
  private async command(kind: 'start'|'full'|'pause'|'resume'|'return_to_dock'|'cancel') {
    if (!this.hass || !this.config || this.blocked || (kind !== 'cancel' && !this.robotReady)) return;
    if ((kind === 'start' || kind === 'full') && !this.canStart) return;
    if (kind === 'start' && (!this.queueReady || !this.selected.length || this.selectedRooms.some(room => !available(this.entity(room.preset),true)))) return;
    this.commandError = ''; this.feedback = kind === 'start' || kind === 'full' ? 'Request sent. Waiting for the robot…' : 'Waiting for the robot…';
    this.request = {kind,since:Date.now()};
    this.requestTimer = setTimeout(() => {
      if (!this.request) return;
      this.request = undefined; this.feedback = '';
      this.commandError = 'The robot has not confirmed this command. Check its state before trying again.';
    },45000);
    try {
      if (kind === 'start' || this.queueActive || kind === 'cancel' || (kind === 'full' && this.queueReady && this.config.full_clean_entity)) {
        const variables: Record<string,unknown> = {command:kind === 'full' ? 'start' : kind,vacuum:this.config.entity};
        if (kind === 'start' || kind === 'full') Object.assign(variables,{presets:kind === 'full' ? [this.config.full_clean_entity] : this.selectedRooms.map(room => room.preset),cleaning_entity:this.config.cleaning_entity,status_entity:this.config.status_entity,error_entity:this.config.error_entity,last_clean_end_entity:this.config.last_clean_end_entity});
        for (const key of Object.keys(variables)) if (variables[key] === undefined) delete variables[key];
        if (this.hass.services?.robot_cleaner_queue?.control) await this.hass.callService('robot_cleaner_queue','control',variables);
        else await this.hass.callService('script','turn_on',{entity_id:this.config.queue_script,variables});
      } else if (kind === 'full' && this.config.full_clean_entity) {
        await this.hass.callService('button','press',{entity_id:this.config.full_clean_entity});
      } else {
        const action = {full:'start',pause:'pause',resume:'start',return_to_dock:'return_to_base',cancel:undefined}[kind];
        if (!action) throw new Error('Unsupported command.');
        await this.hass.callService('vacuum',action,{entity_id:this.config.entity});
      }
    } catch(error) {
      clearTimeout(this.requestTimer); this.request = undefined; this.feedback = '';
      this.commandError = error instanceof Error ? error.message : 'The command could not be sent.';
    }
  }

  private headline(): string {
    if (!this.robotReady) return 'Robot unavailable';
    if (this.fault) return 'Needs attention';
    if (this.phase === 'attention') return 'Sequence needs attention';
    if (this.request?.kind === 'start' || this.phase === 'starting') return 'Starting your sequence';
    if (this.request?.kind === 'full') return 'Starting cleaning';
    if (this.vacuum?.state === 'paused') return 'Cleaning paused';
    if (this.vacuum?.state === 'returning') return 'Returning to dock';
    const status = this.entity(this.config?.status_entity)?.state;
    if (status && /wash|dry|empty|charging_complete|charging|docking|going_to/.test(status)) {
      if (this.queueActive && /charg/.test(status)) return 'Recharging to continue';
      if (!['charging','charging_complete'].includes(status)) return humanize(status);
    }
    if (this.vacuum?.state === 'cleaning') {
      const room = this.rooms.find(room => room.preset === this.queuePresets[this.index]);
      if (this.queueActive && room) return `Cleaning ${room.name}`;
      const current = this.entity(this.config?.current_room_entity);
      return available(current) ? `Cleaning · ${humanize(current!.state)}` : 'Cleaning in progress';
    }
    if (this.queueActive) return 'Cleaning sequence in progress';
    if (this.phase === 'completed' && !this.selected.length) return 'Your rooms are clean';
    return 'Ready to clean';
  }
  private subline(): string {
    if (!this.robotReady) return 'Waiting for Home Assistant to reconnect.';
    if (this.fault) return this.fault;
    if (this.phase === 'attention') return this.queue?.attributes.error || 'The sequence stopped. Check the robot before starting a new plan.';
    if (this.queueActive && this.queue?.attributes.waiting_for_dock) return `Next: ${this.rooms.find(room => room.preset === this.queuePresets[this.index])?.name ?? 'next preset'} · Waiting for the dock`;
    if (this.queueActive) return `Room ${Math.min(this.index+1,this.queuePresets.length)} of ${this.queuePresets.length} · Runs in your selected order`;
    if (this.jobActive) return this.vacuum?.state === 'paused' ? 'Resume when you are ready, or send the robot home.' : 'Live robot status · No room sequence running';
    if (this.phase === 'completed' && !this.selected.length) return `${this.completed} ${this.completed === 1 ? 'preset' : 'presets'} completed${this.vacuum?.state === 'docked' ? ' · At the dock' : ''}`;
    if (this.selected.length) return `${this.selected.length} ${this.selected.length === 1 ? 'room' : 'rooms'} selected · Ready when you are`;
    return this.vacuum?.state === 'docked' ? 'At the dock · Choose rooms or clean the whole home' : 'Choose rooms in the order you want them cleaned';
  }
  private renderActions() {
    const busy = this.blocked || !this.robotReady || (this.queueActive && !this.queueReady);
    if (this.jobActive || this.queueActive) {
      const paused = this.vacuum?.state === 'paused' || this.phase === 'paused';
      const servicing = /wash|dry|empty|attaching|detaching/.test(this.entity(this.config?.status_entity)?.state ?? '');
      const canPause = paused ? this.feature(8192) : this.feature(4) && this.vacuum?.state === 'cleaning' && !servicing;
      return html`<div class="actions">
        ${canPause ? html`<button class="action primary" data-action=${paused ? 'resume':'pause'} ?disabled=${busy || (paused && !this.feature(8192))} @click=${()=>this.command(paused ? 'resume':'pause')}>${icon(paused ? 'mdi:play':'mdi:pause')}${paused ? 'Resume':'Pause'}</button>`:nothing}
        ${this.feature(16) && this.vacuum?.state !== 'returning' && !servicing ? html`<button class="action ${canPause?'secondary':'primary'}" data-action="dock" ?disabled=${busy} @click=${()=>this.command('return_to_dock')}>${icon('mdi:home-import-outline')}Return to dock</button>`:nothing}
      </div>`;
    }
    const selected = this.selected.length;
    const fullAvailable = this.config?.full_clean_entity ? available(this.entity(this.config.full_clean_entity),true) : this.feature(8192);
    const selectedAvailable = this.selectedRooms.every(room=>available(this.entity(room.preset),true));
    return html`<div class="actions"><button class="action primary" data-action="start" ?disabled=${!this.canStart || (selected ? !this.queueReady || !selectedAvailable : !fullAvailable)} @click=${()=>this.command(selected ? 'start':'full')}>${icon('mdi:play')}${this.blocked ? 'Starting…' : selected ? `Clean ${selected} ${selected===1?'room':'rooms'}` : 'Clean all rooms'}</button></div>`;
  }
  private renderRoom(room: RoomConfig) {
    const committed = this.showCommitted;
    const position = committed ? this.queuePresets.indexOf(room.preset) : this.selected.indexOf(room.id);
    const done = committed && position >= 0 && position < this.completed;
    const active = committed && position === this.index && this.queueActive && !this.queue?.attributes.waiting_for_dock;
    const moving = active && this.phase !== 'starting' && this.vacuum?.state === 'cleaning';
    const selected = position >= 0 && !done;
    const unavailable = !available(this.entity(room.preset),true);
    const roomActivity = this.entity(room.activity_entity)?.state;
    const externalActive = !this.queueActive && ['cleaning','active','on'].includes(roomActivity ?? '') && this.vacuum?.state === 'cleaning';
    const glow = buildGlow(moving || externalActive ? BLUE:ACCENT,moving || externalActive ? 'pulse':'static',selected || moving || externalActive);
    const text = unavailable ? 'Preset unavailable' : done ? 'Completed' : active ? (this.phase === 'starting' ? 'Starting…' : this.vacuum?.state === 'paused' ? 'Paused' : moving ? 'Cleaning':'In progress') : externalActive ? 'Cleaning' : selected ? (committed && ['cancelled','attention'].includes(this.phase) ? 'Not completed':committed?'Queued':'Selected') : this.queueActive ? 'Not in this clean' : 'Tap to select';
    const disabled = this.queueActive || this.blocked || (unavailable && !this.selected.includes(room.id));
    return html`<div class="tile-wrap"><div class="glow-under" style=${glow.style}>${glow.overlay}</div><button class="surface room ${selected?'selected':''} ${moving||externalActive?'active':''} ${done?'done':''}" data-room=${room.id} aria-pressed=${selected?'true':'false'} aria-label=${`${room.name}, ${text.toLowerCase()}${position>=0 ? `, position ${position+1}`:''}`} ?disabled=${disabled} @click=${()=>this.toggleRoom(room)}>
      <div class="room-top"><ha-icon class="room-icon" .icon=${room.icon ?? 'mdi:floor-plan'}></ha-icon>${position>=0 ? html`<span class="order">${position+1}</span>`:nothing}</div>
      <div><div class="room-name">${room.name}</div><div class="room-state">${text}</div></div>
    </button></div>`;
  }
  private metric(entityId: string | undefined, fallbackUnit: string) {
    const entity = this.entity(entityId); const value = numeric(entity);
    return value === undefined ? undefined : `${Math.round(value*10)/10} ${entity?.attributes.unit_of_measurement ?? fallbackUnit}`;
  }
  protected render() {
    if (!this.config || !this.hass) return nothing;
    const cleaning = this.vacuum?.state === 'cleaning';
    const rawBattery = this.config.battery_entity ? numeric(this.entity(this.config.battery_entity)) : Number(this.vacuum?.attributes.battery_level);
    const battery = Number.isFinite(rawBattery) && rawBattery! >= 0 && rawBattery! <= 100 ? Math.round(rawBattery!) : undefined;
    const rawProgress = numeric(this.entity(this.config.progress_entity));
    const progress = rawProgress === undefined ? undefined : Math.max(0,Math.min(100,rawProgress));
    const area = this.metric(this.config.area_entity,'m²'); const time = this.metric(this.config.time_entity,'min');
    const glow = buildGlow(BLUE,'pulse',cleaning);
    const plan = this.showCommitted ? this.queuePresets.map(preset=>this.rooms.find(room=>room.preset===preset)?.name ?? (preset===this.config?.full_clean_entity ? 'All rooms' : humanize(preset.split('.').slice(1).join('.')))) : this.selectedRooms.map(room=>room.name);
    return html`<div class="outer"><ha-card><div class="root">
      <div class="tile-wrap"><div class="glow-under" style=${glow.style}>${glow.overlay}</div><section class="surface hero" aria-label="Robot status">
        <div class="identity"><span class="robot-icon">${icon('mdi:robot-vacuum')}</span><div class="identity-text"><div class="eyebrow">Robot vacuum</div><div class="name">${this.config.name ?? this.vacuum?.attributes.friendly_name ?? 'Robot'}</div></div>${battery!==undefined ? html`<span class="battery" aria-label=${`Battery ${battery} percent`}>${icon(this.vacuum?.state==='docked'?'mdi:battery-charging':'mdi:battery')} ${battery}%</span>`:nothing}</div>
        <h2>${this.headline()}</h2><p class="subline">${this.subline()}</p>
        ${this.jobActive && (area || time || progress!==undefined) ? html`<div class="pills">${cleaning ? html`<span class="pill live">${icon('mdi:record-circle-outline')}Cleaning</span>`:nothing}${area?html`<span class="pill">${icon('mdi:ruler-square')}${area}</span>`:nothing}${time?html`<span class="pill">${icon('mdi:timer-outline')}${time}</span>`:nothing}${progress!==undefined?html`<span class="pill">${Math.round(progress)}%</span>`:nothing}</div>`:nothing}
        ${this.jobActive && progress!==undefined ? html`<div class="progress" role="progressbar" aria-label="Current preset progress" aria-valuenow=${Math.round(progress)} aria-valuemin="0" aria-valuemax="100"><span style=${`width:${progress}%`}></span></div>`:nothing}
        ${this.renderActions()}
      </section></div>
      ${this.phase === 'attention' ? html`<div class="note">Review the robot, then clear this sequence before choosing a new one.<button class="text-button" data-action="clear-queue" ?disabled=${this.blocked || !this.queueReady} @click=${()=>this.command('cancel')}>Clear sequence</button></div>`:nothing}
      ${this.commandError ? html`<div class="error" role="alert">${this.commandError}<button class="text-button" @click=${()=>this.commandError=''}>Dismiss</button></div>`:nothing}
      ${this.request ? html`<div class="note" role="status">${this.feedback}</div>`:nothing}
      ${!this.queueReady && this.rooms.length ? html`<div class="note">Install and configure the Home Assistant queue companion to clean rooms in order. Full-home cleaning remains available when the robot is ready.</div>`:nothing}
      <section class="room-section" aria-label="Rooms"><div class="section-heading"><h3>${this.queueActive?'Cleaning sequence':'Choose your rooms'}</h3>${this.selected.length && !this.queueActive?html`<button class="text-button" ?disabled=${this.blocked} @click=${()=>{this.selected=[];this.feedback='Selection cleared.';}}>Clear selection</button>`:nothing}</div>
        <p class="hint">${this.queueActive ? 'Your sequence continues even when you close this dashboard.' : 'Tap in order. Tap again to remove. Numbers show the cleaning sequence.'}</p>
        <div class="rooms">${repeat(this.rooms,room=>room.id,room=>this.renderRoom(room))}</div>
        ${!this.rooms.length ? html`<p class="note">Add room presets in the card editor to choose individual rooms.</p>`:nothing}
        ${plan.length ? html`<div class="queue-summary"><div class="eyebrow">${this.showCommitted?'Your sequence':'Selected order'}</div><div class="sequence">${plan.map((name,i)=>html`${i?icon('mdi:chevron-right'):nothing}<span>${i+1}. <b>${name}</b></span>`)}</div>${!this.queueActive && this.selected.length?this.renderActions():nothing}</div>`:nothing}
      </section>
      <div class="sr-only" role="status" aria-live="polite">${this.feedback}</div>
    </div></ha-card></div>`;
  }
}
const cardWindow = window as typeof window & {customCards?: Array<Record<string,unknown>>};
cardWindow.customCards = cardWindow.customCards || [];
cardWindow.customCards.push({type:'robot-vacuum-cleaner-card',name:'Robot Vacuum Cleaner Card',description:'Robot status, room presets and ordered cleaning with Space Hub styling.',preview:true});
console.info('ROBOT VACUUM CLEANER CARD 0.1.0');
