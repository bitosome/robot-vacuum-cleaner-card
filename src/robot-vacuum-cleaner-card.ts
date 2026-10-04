import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { MODE_LABELS, normalizeSetup, renderSetupSheet, setupSummary, type CleaningSource, type ManualCapabilities, type ManualSetup, type ManualStage } from './manual-setup';
import { panelKeys, renderDevicePanel, type DevicePanel } from './device-panel';
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
  @state() private source: CleaningSource = 'preset';
  @state() private manualSelected: string[] = [];
  @state() private setup: ManualSetup = {mode:'vacuum_mop',repeat:1};
  @state() private caps?: ManualCapabilities;
  @state() private capsLoading = false;
  @state() private capsError = '';
  @state() private sheetOpen = false;
  @state() private draftSource: CleaningSource = 'preset';
  @state() private draftSetup: ManualSetup = {mode:'vacuum_mop',repeat:1};
  @state() private planEdited = false;
  @state() private panel?: DevicePanel;
  @state() private deviceSending = false;
  private capsFor = '';
  private capsRequest = 0;
  private requestTimer?: ReturnType<typeof setTimeout>;

  setConfig(config: CardConfig) { if (this.config?.entity !== config.entity) { this.capsRequest++; this.capsFor=''; this.caps=undefined; this.manualSelected=[]; this.source='preset'; } this.config = validateConfig(config); this.selected = this.selected.filter(id => this.config!.rooms.some(room => room.id === id)); }
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
  private get blocked() { return this.deviceSending || this.phase === 'controlling' || !!this.request || !!this.queue?.attributes.pending_command; }
  private get waterEmpty() { return this.entity(this.config?.dock_error_entity)?.state === 'water_empty'; }
  private get modernController() { return Number(this.queue?.attributes.control_version) >= 3; }
  private get waterAllowed() { return this.waterEmpty && this.modernController && this.manual && this.activeSetup.mode==='vacuum'; }
  private get fault() {
    const err = this.entity(this.config?.error_entity)?.state;
    const dock = this.entity(this.config?.dock_error_entity)?.state;
    return !quietError(err) ? humanize(err) : !quietError(dock) && !(dock==='water_empty' && this.waterAllowed) ? humanize(dock) : this.vacuum?.state === 'error' ? 'Robot needs attention' : '';
  }
  private get canStart() { return this.phase !== 'attention' && (!this.config?.require_queue || this.queueReady) && this.robotReady && !this.jobActive && !this.queueActive && !this.blocked && !this.fault && ['docked','idle'].includes(this.vacuum?.state ?? ''); }
  private get queueReady() { return available(this.queue) && (!!this.hass?.services?.robot_cleaner_queue?.control || available(this.entity(this.config?.queue_script))); }
  private feature(bit: number) { return ((Number(this.vacuum?.attributes.supported_features) || 0) & bit) !== 0; }
  private get queueManual() { return this.queue?.attributes.mode === 'manual'; }
  private get queueTargets(): string[] { return Array.isArray(this.queue?.attributes.targets) ? this.queue!.attributes.targets : []; }
  private get stages(): ManualStage[] { return Array.isArray(this.queue?.attributes.stages) ? this.queue!.attributes.stages : []; }
  private get manual() { return this.queueActive ? this.queueManual : this.source === 'manual'; }
  private get selection() { return this.manual ? this.manualSelected : this.selected; }
  private get rooms(): RoomConfig[] {
    if (!this.manual) return this.config?.rooms ?? [];
    if (!this.caps) return this.queueTargets.map(id=>({id,name:humanize(id),preset:id,icon:'mdi:floor-plan'}));
    return this.caps.room_targets.map(target=>{
      const overrides = this.config?.area_overrides;
      const appearance = overrides && Object.prototype.hasOwnProperty.call(overrides,target.id) ? overrides[target.id] : undefined;
      return {id:target.id,name:appearance?.name ?? target.name,preset:target.id,icon:appearance?.icon ?? target.icon ?? 'mdi:floor-plan'};
    });
  }
  private roomAvailable(room: RoomConfig) { return this.manual ? !!this.caps?.room_targets.some(target=>target.id===room.id) : available(this.entity(room.preset),true); }
  private get manualReady() { return this.queueReady && !!this.hass?.services?.robot_cleaner_queue?.control && !!this.caps?.supported && !this.capsError; }
  private get activeSetup() { return this.showCommitted && this.queueManual ? this.queue?.attributes.setup as ManualSetup ?? this.setup : this.setup; }
  private get stageName() { const target = this.stages[this.index]?.target; return target ? this.rooms.find(room=>room.id===target)?.name ?? humanize(target) : 'whole home'; }
  private setSelection(ids: string[]) { if (this.manual) this.manualSelected=ids; else this.selected=ids; }
  private async readCapabilities() {
    const hass=this.hass, vacuum=this.config?.entity;
    if (!hass || !vacuum) return;
    const request=++this.capsRequest; this.capsFor=vacuum; this.capsLoading=true; this.capsError='';
    try {
      if (!hass.callWS || !hass.services?.robot_cleaner_queue?.get_capabilities) throw new Error('Install the updated Home Assistant queue companion to use manual cleaning.');
      const result=await hass.callWS<{response:ManualCapabilities}>({type:'call_service',domain:'robot_cleaner_queue',service:'get_capabilities',service_data:{vacuum},return_response:true});
      if (request!==this.capsRequest) return;
      const caps=result.response;
      if (!caps || !Array.isArray(caps.modes) || !Array.isArray(caps.room_targets) || !Array.isArray(caps.suction) || !Array.isArray(caps.water) || !Array.isArray(caps.routes) || !Array.isArray(caps.repeats) || caps.modes.some(mode=>!Object.prototype.hasOwnProperty.call(MODE_LABELS,mode.value))) throw new Error('The companion returned an incomplete capability response.');
      this.caps=caps;
      if (caps.supported && caps.modes.length) {
        this.draftSetup=normalizeSetup(caps,this.source==='manual' ? this.setup : caps.defaults);
        if (this.source==='manual') this.setup=normalizeSetup(caps,this.setup);
      }
    } catch(error) { if (request===this.capsRequest) { this.caps=undefined; this.capsError=error instanceof Error ? error.message : 'Could not read robot capabilities.'; } }
    finally { if (request===this.capsRequest) this.capsLoading=false; }
  }
  private async openSetup() {
    if (this.queueActive || this.blocked || this.jobActive) return;
    this.draftSource=this.source; this.draftSetup={...this.setup}; this.sheetOpen=true;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLDialogElement>('dialog')?.showModal();
    await this.readCapabilities();
  }
  private closeSetup() { this.renderRoot.querySelector<HTMLDialogElement>('dialog')?.close(); this.sheetOpen=false; }
  private applySetup() {
    if (this.queueActive || this.blocked || this.jobActive) { this.closeSetup(); return; }
    if (this.draftSource==='manual' && (!this.caps?.supported || this.capsLoading || this.capsError)) return;
    this.planEdited=true; this.source=this.draftSource;
    if (this.source==='manual') this.setup=normalizeSetup(this.caps!,this.draftSetup);
    this.closeSetup(); this.commandError='';
  }
  private get selectedRooms() { return this.selection.map(id => this.rooms.find(room => room.id === id)).filter((room):room is RoomConfig => !!room); }
  private get showCommitted() { return (this.queuePresets.length > 0 || this.queueManual) && (this.queueActive || (!this.planEdited && this.queueManual === this.manual && !this.selection.length && ['attention','completed','cancelled'].includes(this.phase))); }

  protected updated(changed: PropertyValues) {
    if (changed.has('hass') && this.modernController && this.capsFor!==this.config?.entity) void this.readCapabilities();
    if (changed.has('hass') && this.queueActive) { this.planEdited=false; this.source=this.queueManual?'manual':'preset'; }
    if (changed.has('hass') && this.queueActive && this.queueManual && this.capsFor!==this.config?.entity) void this.readCapabilities();
    if (this.sheetOpen && (this.queueActive || this.jobActive)) this.closeSetup();
    if (!changed.has('hass') || !this.request) return;
    const kind = this.request.kind;
    const acknowledged = kind === 'cancel' ? this.phase === 'cancelled' : (kind === 'start' || kind === 'start_manual') ? this.queueActive || this.phase === 'attention'
      : kind === 'full' ? this.jobActive || this.queueActive || this.phase === 'attention'
      : kind === 'stop' ? this.entity(this.config?.cleaning_entity)?.state==='off' && ['idle','docked'].includes(this.vacuum?.state??'')
      : kind === 'pause' ? this.vacuum?.state === 'paused' || this.phase === 'paused'
      : kind === 'resume' ? this.vacuum?.state === 'cleaning'
      : kind === 'return_to_dock' ? ['returning','docked'].includes(this.vacuum?.state ?? '')
      : false;
    if (acknowledged) {
      clearTimeout(this.requestTimer); this.request = undefined;
      if (this.queueActive && (kind === 'start' || kind === 'start_manual')) { if (kind==='start_manual') { this.manualSelected=[]; this.source='manual'; } else this.selected=[]; }
      this.feedback = '';
    }
  }

  private toggleRoom(room: RoomConfig) {
    if (this.queueActive || this.blocked || (!this.selection.includes(room.id) && !this.roomAvailable(room))) return;
    this.planEdited=true;
    this.setSelection(this.selection.includes(room.id) ? this.selection.filter(id => id !== room.id) : [...this.selection,room.id]);
    this.feedback = this.selection.length ? `${this.selectedRooms.map((r,i)=>`${i+1}. ${r.name}`).join(', ')} selected.` : 'Selection cleared.';
    this.commandError = '';
  }
  private async command(kind: 'start'|'start_manual'|'full'|'pause'|'resume'|'return_to_dock'|'cancel'|'stop') {
    if (!this.hass || !this.config || this.blocked || (kind !== 'cancel' && !this.robotReady)) return;
    if (this.config.require_queue && !this.queueReady) return;
    if (kind === 'full' && this.config.require_queue && !this.config.full_clean_entity) return;
    if ((kind === 'start' || kind === 'start_manual' || kind === 'full') && !this.canStart) return;
    if (kind === 'start' && (!this.queueReady || !this.selection.length || this.selectedRooms.some(room => !available(this.entity(room.preset),true)))) return;
    if (kind === 'start_manual' && (!this.manualReady || this.selectedRooms.some(room=>!this.roomAvailable(room)) || this.selectedRooms.length!==this.manualSelected.length)) return;
    this.commandError = ''; this.feedback = kind === 'start' || kind === 'full' ? 'Request sent. Waiting for the robot…' : 'Waiting for the robot…';
    this.request = {kind,since:Date.now()};
    this.requestTimer = setTimeout(() => {
      if (!this.request) return;
      this.request = undefined; this.feedback = '';
      this.commandError = 'The robot has not confirmed this command. Check its state before trying again.';
    },45000);
    try {
      if (kind === 'start_manual') {
        await this.hass.callService('robot_cleaner_queue','control',{command:'start_manual',vacuum:this.config.entity,rooms:[...this.manualSelected],setup:normalizeSetup(this.caps!,this.setup)});
      } else if (kind === 'start' || this.queueActive || kind === 'cancel' || (['pause','resume','return_to_dock','stop'].includes(kind) && this.queueReady && (this.config.require_queue || !!this.hass.services?.robot_cleaner_queue?.control)) || (kind === 'full' && this.queueReady && this.config.full_clean_entity)) {
        const variables: Record<string,unknown> = {command:kind === 'full' ? 'start' : kind,vacuum:this.config.entity};
        if (kind === 'start' || kind === 'full') Object.assign(variables,{presets:kind === 'full' ? [this.config.full_clean_entity] : this.selectedRooms.map(room => room.preset),cleaning_entity:this.config.cleaning_entity,status_entity:this.config.status_entity,error_entity:this.config.error_entity,last_clean_end_entity:this.config.last_clean_end_entity});
        for (const key of Object.keys(variables)) if (variables[key] === undefined) delete variables[key];
        if (this.hass.services?.robot_cleaner_queue?.control) await this.hass.callService('robot_cleaner_queue','control',variables);
        else await this.hass.callService('script','turn_on',{entity_id:this.config.queue_script,variables});
      } else if (kind === 'full' && this.config.full_clean_entity) {
        await this.hass.callService('button','press',{entity_id:this.config.full_clean_entity});
      } else {
        const action = {full:'start',pause:'pause',resume:'start',return_to_dock:'return_to_base',stop:'stop',cancel:undefined,start_manual:undefined}[kind];
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
    if (this.fault) return this.waterEmpty && this.fault==='Water empty' ? 'Dock needs water' : 'Needs attention';
    if (this.phase === 'attention') return 'Sequence needs attention';
    if (this.phase === 'controlling') return this.queue?.attributes.mode === 'finish' ? 'Finishing cleaning' : 'Waiting for the robot';
    if (this.phase === 'preparing') return 'Applying cleaning settings';
    if (this.request?.kind === 'start_manual') return 'Starting your clean';
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
      if (this.queueActive && this.queueManual) return `${this.stages[this.index]?.mode==='vacuum'?'Vacuuming':this.stages[this.index]?.mode==='mop'?'Mopping':'Cleaning'} ${this.stageName}`;
      const room = this.rooms.find(room => room.preset === this.queuePresets[this.index]);
      if (this.queueActive && room) return `Cleaning ${room.name}`;
      const current = this.entity(this.config?.current_room_entity);
      return available(current) ? `Cleaning · ${humanize(current!.state)}` : 'Cleaning in progress';
    }
    if (this.queueActive) return 'Cleaning sequence in progress';
    if (this.phase === 'completed' && this.showCommitted) return 'Your rooms are clean';
    return this.waterAllowed ? 'Ready to vacuum' : 'Ready to clean';
  }
  private subline(): string {
    if (!this.robotReady) return 'Waiting for Home Assistant to reconnect.';
    if (this.fault) return this.waterEmpty && this.fault==='Water empty' ? 'Vacuum-only cleaning is available in Manual setup.' : this.fault;
    if (this.phase === 'attention') return this.queue?.attributes.error || 'The sequence stopped. Check the robot before starting a new plan.';
    if (this.phase === 'controlling') return this.queue?.attributes.mode === 'finish' ? 'Remaining rooms cancelled · Returning to dock for care' : 'Confirming your command · No retry will be sent';
    if (this.queueActive && this.queueManual) {
      if (this.queue?.attributes.waiting_for_dock) return `Next: ${this.stageName} · Waiting for the dock`;
      const stage=this.stages[this.index];
      const label=stage?.mode==='vacuum'?'Vacuum pass':stage?.mode==='mop'?'Mop pass':'Vacuum & mop';
      return `${label} · ${this.queueTargets.length ? `Area ${(stage?.room_index ?? 0)+1} of ${this.queueTargets.length}` : 'Whole home'}${this.activeSetup.repeat>1 ? ` · Run ${(stage?.repeat_index ?? 0)+1} of ${this.activeSetup.repeat}` : ''}`;
    }
    if (this.queueActive && this.queue?.attributes.waiting_for_dock) return `Next: ${this.rooms.find(room => room.preset === this.queuePresets[this.index])?.name ?? 'next preset'} · Waiting for the dock`;
    if (this.queueActive) return `Room ${Math.min(this.index+1,this.queuePresets.length)} of ${this.queuePresets.length} · Runs in your selected order`;
    if (this.jobActive) return this.vacuum?.state === 'paused' ? 'Resume when you are ready, or send the robot home.' : 'Live robot status · No room sequence running';
    if (this.phase === 'completed' && this.showCommitted) return `${this.completed} ${this.queueManual ? 'cleaning stages' : this.completed === 1 ? 'preset' : 'presets'} completed${this.vacuum?.state === 'docked' ? ' · At the dock' : ''}`;
    if (this.selection.length) return `${this.selection.length} ${this.selection.length === 1 ? 'room' : 'rooms'} selected · Ready when you are`;
    return this.vacuum?.state === 'docked' ? 'At the dock · Choose rooms or clean the whole home' : 'Choose rooms in the order you want them cleaned';
  }
  private renderActions() {
    const busy = this.blocked || !this.robotReady || ((this.queueActive || this.config?.require_queue) && !this.queueReady);
    if (this.jobActive || this.queueActive) {
      const paused = this.vacuum?.state === 'paused' || this.phase === 'paused';
      const servicing = /wash|dry|empty|attaching|detaching/.test(this.entity(this.config?.status_entity)?.state ?? '');
      const canPause = paused ? this.feature(8192) : this.feature(4) && this.vacuum?.state === 'cleaning' && !servicing;
      return html`<div class="actions">
        ${canPause ? html`<button class="action primary" data-action=${paused ? 'resume':'pause'} ?disabled=${busy || (paused && !this.feature(8192))} @click=${()=>this.command(paused ? 'resume':'pause')}>${icon(paused ? 'mdi:play':'mdi:pause')}${paused ? 'Resume':'Pause'}</button>`:nothing}
        ${this.feature(16) && this.vacuum?.state !== 'returning' && !servicing ? html`<button class="action ${canPause?'secondary':'primary'}" data-action="dock" ?disabled=${busy} @click=${()=>this.command('return_to_dock')}>${icon('mdi:home-import-outline')}Return to dock</button>`:nothing}
        ${this.feature(8) && this.modernController && !servicing ? html`<button class="action secondary" data-action="stop" ?disabled=${busy} @click=${()=>this.command('stop')}>${icon('mdi:stop')}Stop</button>`:nothing}
      </div>`;
    }
    const selected = this.selection.length;
    const fullAvailable = this.config?.full_clean_entity ? available(this.entity(this.config.full_clean_entity),true) : !this.config?.require_queue && this.feature(8192);
    const selectedAvailable = this.selectedRooms.every(room=>this.roomAvailable(room));
    return html`<div class="actions"><button class="action primary" data-action="start" ?disabled=${!this.canStart || (this.manual ? !this.manualReady || !selectedAvailable || this.selectedRooms.length!==this.manualSelected.length : selected ? !this.queueReady || !selectedAvailable : !fullAvailable)} @click=${()=>this.command(this.manual ? 'start_manual' : selected ? 'start':'full')}>${icon('mdi:play')}${this.blocked ? 'Waiting…' : selected ? `Clean ${selected} ${selected===1?'room':'rooms'}` : 'Clean all rooms'}</button></div>`;
  }
  private async openPanel(panel:DevicePanel) {
    this.panel=panel; this.commandError=''; await this.updateComplete;
    this.renderRoot.querySelector<HTMLDialogElement>('.device-dialog')?.showModal();
    await this.readCapabilities();
  }
  private closePanel() { this.renderRoot.querySelector<HTMLDialogElement>('.device-dialog')?.close(); this.panel=undefined; }
  private async deviceCommand(control:string,value:string|number='') {
    if (!this.hass || !this.config || this.deviceSending || (control!=='locate' && (this.blocked || this.queueActive))) return;
    this.deviceSending=true; this.commandError='';
    try { await this.hass.callService('robot_cleaner_queue','device_control',{vacuum:this.config.entity,control,value}); }
    catch(error) { this.commandError=error instanceof Error ? error.message : 'The device command failed.'; }
    finally { this.deviceSending=false; }
  }
  private renderUtilities() {
    if(!this.modernController || !this.hass?.services?.robot_cleaner_queue?.device_control) return nothing;
    const entities=this.caps?.device_entities??{};
    const panels: Array<[DevicePanel,string,string]>=[['dock','Dock','mdi:ev-station'],['map','Map','mdi:map-outline'],['settings','Settings','mdi:cog-outline'],['care','Care','mdi:tools']];
    return html`<nav class="utilities" aria-label="Robot tools">${this.feature(512)?html`<button class="setting-pill" data-action="locate" ?disabled=${!this.robotReady || this.deviceSending} @click=${()=>this.deviceCommand('locate')}>${icon('mdi:volume-high')}Find</button>`:nothing}${panels.filter(([panel])=>panelKeys(panel,entities,this.hass!).length).map(([panel,label,mdi])=>html`<button class="setting-pill" data-panel=${panel} @click=${()=>this.openPanel(panel)}>${icon(mdi)}${label}</button>`)}</nav>`;
  }
  private renderRoom(room: RoomConfig) {
    const committed = this.showCommitted;
    const position = committed ? (this.manual ? this.queueTargets.indexOf(room.id) : this.queuePresets.indexOf(room.preset)) : this.selection.indexOf(room.id);
    const roomStages = this.stages.map((stage,index)=>({stage,index})).filter(item=>item.stage.target===room.id);
    const done = committed && position >= 0 && (this.manual ? roomStages.length>0 && roomStages.every(item=>item.index<this.completed) : position < this.completed);
    const vacuumDone = committed && this.manual && this.activeSetup.mode==='vacuum_then_mop' && roomStages.some(item=>item.stage.mode==='vacuum' && item.index<this.completed);
    const active = committed && (this.manual ? this.stages[this.index]?.target===room.id : position === this.index) && this.queueActive && !this.queue?.attributes.waiting_for_dock;
    const moving = active && !['preparing','starting'].includes(this.phase) && this.vacuum?.state === 'cleaning';
    const selected = position >= 0 && !done;
    const unavailable = !this.roomAvailable(room) && !committed;
    const roomActivity = this.entity(room.activity_entity)?.state;
    const externalActive = !this.queueActive && ['cleaning','active','on'].includes(roomActivity ?? '') && this.vacuum?.state === 'cleaning';
    const glow = buildGlow(moving || externalActive ? BLUE:ACCENT,moving || externalActive ? 'pulse':'static',selected || moving || externalActive);
    const text = unavailable ? (this.manual ? 'Area unavailable':'Preset unavailable') : done ? 'Completed' : active ? (this.phase === 'preparing' ? 'Preparing…' : this.phase === 'starting' ? 'Starting…' : this.vacuum?.state === 'paused' ? 'Paused' : moving ? 'Cleaning':'In progress') : externalActive ? 'Cleaning' : vacuumDone && selected && this.queueActive ? 'Vacuumed · mop next' : selected ? (committed && ['cancelled','attention'].includes(this.phase) ? 'Not completed':committed?'Queued':'Selected') : this.queueActive ? 'Not in this clean' : 'Tap to select';
    const disabled = this.queueActive || this.blocked || (unavailable && !this.selection.includes(room.id));
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
    const plan = this.showCommitted && this.manual ? this.queueTargets.map(id=>this.rooms.find(room=>room.id===id)?.name ?? humanize(id)) : this.showCommitted ? this.queuePresets.map(preset=>this.rooms.find(room=>room.preset===preset)?.name ?? (preset===this.config?.full_clean_entity ? 'All rooms' : humanize(preset.split('.').slice(1).join('.')))) : this.selectedRooms.map(room=>room.name);
    return html`<div class="outer"><ha-card><div class="root">
      <div class="tile-wrap"><div class="glow-under" style=${glow.style}>${glow.overlay}</div><section class="surface hero" aria-label="Robot status">
        <div class="identity"><span class="robot-icon">${icon('mdi:robot-vacuum')}</span><div class="identity-text"><div class="eyebrow">Robot vacuum</div><div class="name">${this.config.name ?? this.vacuum?.attributes.friendly_name ?? 'Robot'}</div></div>${battery!==undefined ? html`<span class="battery" aria-label=${`Battery ${battery} percent`}>${icon(this.vacuum?.state==='docked'?'mdi:battery-charging':'mdi:battery')} ${battery}%</span>`:nothing}</div>
        <h2>${this.headline()}</h2><p class="subline">${this.subline()}</p>
        ${this.jobActive && (area || time || progress!==undefined) ? html`<div class="pills">${cleaning ? html`<span class="pill live">${icon('mdi:record-circle-outline')}Cleaning</span>`:nothing}${area?html`<span class="pill">${icon('mdi:ruler-square')}${area}</span>`:nothing}${time?html`<span class="pill">${icon('mdi:timer-outline')}${time}</span>`:nothing}${progress!==undefined?html`<span class="pill">${Math.round(progress)}%</span>`:nothing}</div>`:nothing}
        ${this.jobActive && progress!==undefined ? html`<div class="progress" role="progressbar" aria-label=${this.manual?'Current cleaning stage progress':'Current preset progress'} aria-valuenow=${Math.round(progress)} aria-valuemin="0" aria-valuemax="100"><span style=${`width:${progress}%`}></span></div>`:nothing}
        <button class="setup-launch" data-action="setup" aria-label=${`Cleaning setup: ${this.manual ? setupSummary(this.activeSetup) : 'Preset'}`} ?disabled=${this.queueActive || this.blocked || this.jobActive} @click=${()=>this.openSetup()}><span><ha-icon .icon=${this.manual?'mdi:tune-variant':'mdi:bookmark-outline'}></ha-icon>${this.manual ? setupSummary(this.activeSetup) : 'Preset'}</span><span class="setup-edit">${icon('mdi:chevron-right')}</span></button>
        ${this.renderActions()}
      </section></div>
      ${this.waterEmpty ? html`<div class="note water-warning">${icon('mdi:water-alert-outline')}<span>Refill and reseat the dock’s clean-water tank for mopping. ${this.waterAllowed ? 'Your vacuum-only plan can run.' : 'Choose Manual → Vacuum to clean without water. Presets may include mopping.'}</span></div>`:nothing}
      ${this.renderUtilities()}
      ${this.phase === 'attention' ? html`<div class="note">Review the robot, then clear this sequence before choosing a new one.<button class="text-button" data-action="clear-queue" ?disabled=${this.blocked || !this.queueReady} @click=${()=>this.command('cancel')}>Clear sequence</button></div>`:nothing}
      ${this.commandError ? html`<div class="error" role="alert">${this.commandError}<button class="text-button" @click=${()=>this.commandError=''}>Dismiss</button></div>`:nothing}
      ${this.request ? html`<div class="note" role="status">${this.feedback}</div>`:nothing}
      ${!this.queueReady && (this.rooms.length || this.config?.require_queue) ? html`<div class="note">${this.config?.require_queue ? 'The shared cleaning controller is unavailable. Controls will return when it reconnects.' : 'Install and configure the Home Assistant queue companion to clean rooms in order. Full-home cleaning remains available when the robot is ready.'}</div>`:nothing}
      <section class="room-section" aria-label="Rooms"><div class="section-heading"><h3>${this.queueActive?'Cleaning sequence':this.manual?'Choose your areas':'Choose your rooms'}</h3>${this.selection.length && !this.queueActive?html`<button class="text-button" ?disabled=${this.blocked} @click=${()=>{this.planEdited=true;this.setSelection([]);this.feedback='Selection cleared.';}}>Clear selection</button>`:nothing}</div>
        <p class="hint">${this.queueActive ? 'Your sequence continues even when you close this dashboard.' : 'Tap in order. Tap again to remove. Numbers show the cleaning sequence.'}</p>
        <div class="rooms">${repeat(this.rooms,room=>room.id,room=>this.renderRoom(room))}</div>
        ${!this.rooms.length ? html`<p class="note">${this.manual ? 'No mapped areas available. You can clean the whole home.' : 'Add room presets in the card editor to choose individual rooms.'}</p>`:nothing}
        ${this.manual && this.selection.some(id=>!this.rooms.some(room=>room.id===id)) ? html`<p class="note">An area in your selection is no longer mapped. Clear the selection and choose the available areas again.</p>`:nothing}
        ${plan.length ? html`<div class="queue-summary"><div class="eyebrow">${this.showCommitted?'Your sequence':'Selected order'}</div><div class="sequence">${plan.map((name,i)=>html`${i?icon('mdi:chevron-right'):nothing}<span>${i+1}. <b>${name}</b></span>`)}</div>${!this.queueActive && this.selection.length?this.renderActions():nothing}</div>`:nothing}
      </section>
      <div class="sr-only" role="status" aria-live="polite">${this.feedback}</div>
    </div></ha-card></div>
    <dialog class="setup-dialog" aria-labelledby="setup-title" @cancel=${()=>{this.sheetOpen=false;}} @close=${()=>{this.sheetOpen=false;}}>${this.sheetOpen ? renderSetupSheet({source:this.draftSource,setup:this.draftSetup,caps:this.caps,loading:this.capsLoading,error:this.capsError,changeSource:(source)=>{this.draftSource=source;},changeSetup:(setup)=>{if(this.caps)this.draftSetup={...this.draftSetup,...normalizeSetup(this.caps,{...this.draftSetup,...setup})};},close:()=>this.closeSetup(),apply:()=>this.applySetup(),retry:()=>{void this.readCapabilities();}}):nothing}</dialog>
    <dialog class="setup-dialog device-dialog" aria-labelledby="device-title" @cancel=${()=>{this.panel=undefined;}} @close=${()=>{this.panel=undefined;}}>${this.panel&&this.hass ? renderDevicePanel({panel:this.panel,hass:this.hass,entities:this.caps?.device_entities??{},busy:this.blocked||this.queueActive||this.phase==='attention',robotDocked:this.vacuum?.state==='docked'&&!this.jobActive,waterEmpty:this.waterEmpty,fault:!!this.fault&&this.fault!=='Water empty',error:this.commandError,pending:this.deviceSending||this.phase==='controlling',close:()=>this.closePanel(),send:(key,value)=>void this.deviceCommand(key,value)}):nothing}</dialog>`;
  }
}
const cardWindow = window as typeof window & {customCards?: Array<Record<string,unknown>>};
cardWindow.customCards = cardWindow.customCards || [];
cardWindow.customCards.push({type:'robot-vacuum-cleaner-card',name:'Robot Vacuum Cleaner Card',description:'Robot status, room presets and ordered cleaning with Space Hub styling.',preview:true});
console.info('ROBOT VACUUM CLEANER CARD 0.3.2');
