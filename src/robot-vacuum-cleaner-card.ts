import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { matchesSetup, MODE_LABELS, normalizeSetup, renderSetupSheet, roomLabel, roomsPayload, savedRoomSetup, setupSummary, type CleaningSource, type ManualCapabilities, type ManualSetup, type ManualStage, type PlanRoom, type RobotRoom, type SavedPreset, type SavedRoom, type SetupRoom } from './manual-setup';
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
  @state() private source: CleaningSource = 'rooms';
  @state() private manualSelected: string[] = [];
  @state() private setup: ManualSetup = {mode:'vacuum_mop',repeat:1};
  /** Per-room overrides of the sheet's global settings, keyed by robot room id. */
  @state() private roomSetups: Record<string, ManualSetup> = {};
  @state() private draftRoomSetups: Record<string, ManualSetup> = {};
  @state() private caps?: ManualCapabilities;
  @state() private capsLoading = false;
  @state() private capsError = '';
  @state() private sheetOpen = false;
  @state() private draftSource: CleaningSource = 'preset';
  @state() private draftSetup: ManualSetup = {mode:'vacuum_mop',repeat:1};
  @state() private planEdited = false;
  @state() private panel?: DevicePanel;
  @state() private deviceSending = false;
  @state() private savingPreset = false;
  @state() private presetFeedback = '';
  @state() private savedPreset?: SavedPreset;
  private capsFor = '';
  private capsRequest = 0;
  private requestTimer?: ReturnType<typeof setTimeout>;

  setConfig(config: CardConfig) { if (this.config?.entity !== config.entity) { this.capsRequest++; this.capsFor=''; this.caps=undefined; this.savedPreset=undefined; this.presetFeedback=''; this.manualSelected=[]; this.source='preset'; } this.config = validateConfig(config); this.selected = []; }
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
  /** The integration's own uncertainty window, so the card cannot unlock early. */
  private get barrierUntil() {
    const raw = this.queue?.attributes.command_barrier_until;
    const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(seconds) ? seconds : 0;
  }
  private get barrierActive() { return this.barrierUntil * 1000 > Date.now() + 500; }
  /** Remaining whole minutes of the window, never below one while it is open. */
  private get barrierMinutes() { return Math.max(1, Math.ceil((this.barrierUntil * 1000 - Date.now()) / 60000)); }
  private get barrierNotice() { return `Waiting ${this.barrierMinutes} min for the robot’s acknowledgement window`; }
  /**
   * A command is genuinely in flight. This is what freezes editing, because the
   * dashboard is about to change underneath the user.
   */
  private get blocked() { return this.savingPreset || this.deviceSending || this.phase === 'controlling' || !!this.request || !!this.queue?.attributes.pending_command; }
  /**
   * The engine's uncertainty window only forbids motion. Selecting rooms, editing
   * settings, saving a plan and clearing a finished sequence are all local.
   */
  private get dispatchBlocked() { return this.blocked || this.barrierActive; }
  /** A committed plan that has stopped: it can be dismissed to plan a fresh one. */
  private get terminalSequence() {
    if (this.phase === 'attention') return true;
    return ['cancelled','completed'].includes(this.phase) && (this.queueTargets.length > 0 || this.queuePresets.length > 0);
  }
  private get waterEmpty() { return this.entity(this.config?.dock_error_entity)?.state === 'water_empty'; }
  private get modernController() { return Number(this.queue?.attributes.control_version) >= 3; }
  /** A dock with no clean water can still run a plan whose next room is vacuum-only. */
  private get waterAllowed() { return this.waterEmpty && this.modernController && this.manual && this.activeSetup.mode==='vacuum'; }
  private get fault() {
    const err = this.entity(this.config?.error_entity)?.state;
    const dock = this.entity(this.config?.dock_error_entity)?.state;
    return !quietError(err) ? humanize(err) : !quietError(dock) && !(dock==='water_empty' && this.waterAllowed) ? humanize(dock) : this.vacuum?.state === 'error' ? 'Robot needs attention' : '';
  }
  private get canStart() { return this.phase !== 'attention' && (!this.config?.require_queue || this.queueReady) && this.robotReady && !this.jobActive && !this.queueActive && !this.dispatchBlocked && !this.fault && ['docked','idle'].includes(this.vacuum?.state ?? ''); }
  private get queueReady() { return available(this.queue) && (!!this.hass?.services?.robot_cleaner_queue?.control || available(this.entity(this.config?.queue_script))); }
  private feature(bit: number) { return ((Number(this.vacuum?.attributes.supported_features) || 0) & bit) !== 0; }
  private get queueManual() { return this.queue?.attributes.mode === 'manual'; }
  /** The robot's own rooms on the floor it is standing on: the primary tile model. */
  private get robotRooms(): RobotRoom[] {
    const map = this.caps?.current_map;
    if (map === undefined || map === null) return [];
    return (this.caps?.robot_rooms ?? []).filter(room => typeof room?.id === 'string' && room.id.startsWith(`${map}_`));
  }
  /** Room plans are the model whenever the companion reports the robot's own rooms. */
  private get roomMode() { return this.robotRooms.length > 0; }
  private get queueRoomSetups(): SetupRoom[] {
    const rooms = this.queue?.attributes.setup?.rooms;
    return Array.isArray(rooms) ? rooms.filter((room:unknown):room is SetupRoom => !!room && typeof (room as SetupRoom).id === 'string') : [];
  }
  /** A plan started through the robot's rooms, whether or not capabilities are loaded. */
  private get queueRooms() { return this.queueRoomSetups.length > 0; }
  private roomName(room: Pick<RobotRoom,'id'|'name'|'segment'|'area_id'> & {name?: string|null}): string {
    const overrides = this.config?.area_overrides;
    const area = room.area_id ? overrides?.[room.area_id] : undefined;
    const own = overrides?.[room.id];
    return area?.name ?? own?.name ?? room.name ?? (room.segment === undefined ? roomLabel(room as RobotRoom) : `Room ${room.segment}`);
  }
  private roomIcon(room: Pick<RobotRoom,'id'|'area_id'>): string {
    const overrides = this.config?.area_overrides;
    return (room.area_id ? overrides?.[room.area_id]?.icon : undefined) ?? overrides?.[room.id]?.icon ?? 'mdi:floor-plan';
  }
  private setupFor(id: string, source: Record<string, ManualSetup> = this.roomSetups): ManualSetup {
    const chosen = source[id] ?? this.setup;
    return this.caps ? normalizeSetup(this.caps, chosen) : chosen;
  }
  /** The ordered plan Start would send: the selection, or every room on this map. */
  private startPlan(): PlanRoom[] {
    const ids = this.roomMode && !this.manualSelected.length ? this.robotRooms.map(room => room.id) : this.manualSelected;
    return ids.map(id => ({id, setup: this.setupFor(id)}));
  }
  private get companionReady() { return !!this.hass?.services?.robot_cleaner_queue?.control && !!this.caps?.supported; }
  private get sheetRooms(): SetupRoom[] {
    return this.manualSelected.map(id => {
      const chosen = this.draftRoomSetups[id] ?? this.draftSetup;
      return {id, name: this.rooms.find(room => room.id === id)?.name ?? humanize(id),
              setup: this.caps ? normalizeSetup(this.caps, chosen) : chosen, customised: !!this.draftRoomSetups[id]};
    });
  }
  private get queueTargets(): string[] { return Array.isArray(this.queue?.attributes.targets) ? this.queue!.attributes.targets : []; }
  private get stages(): ManualStage[] { return Array.isArray(this.queue?.attributes.stages) ? this.queue!.attributes.stages : []; }
  private get manual() {
    if (this.queueActive) return this.queueManual || this.queueRooms;
    return this.roomMode || this.source === 'manual';
  }
  private get selection() { return this.manual ? this.manualSelected : this.selected; }
  private get rooms(): RoomConfig[] {
    // Robot rooms first: the tiles are the robot's own map, not a configuration list.
    if (this.roomMode) return this.robotRooms.map(room => ({id:room.id,name:this.roomName(room),preset:room.id,icon:this.roomIcon(room)}));
    if (this.queueActive && this.queueRooms) return this.queueRoomSetups.map(room => ({id:room.id,name:this.roomName({id:room.id,name:room.name}),preset:room.id,icon:this.roomIcon({id:room.id})}));
    if (!this.manual) return [];   // Roborock app routines are no longer a tile model
    if (!this.caps) return this.queueTargets.map(id=>({id,name:humanize(id),preset:id,icon:'mdi:floor-plan'}));
    return this.caps.room_targets.map(target=>{
      const overrides = this.config?.area_overrides;
      const appearance = overrides && Object.prototype.hasOwnProperty.call(overrides,target.id) ? overrides[target.id] : undefined;
      return {id:target.id,name:appearance?.name ?? target.name,preset:target.id,icon:appearance?.icon ?? target.icon ?? 'mdi:floor-plan'};
    });
  }
  private roomAvailable(room: RoomConfig) {
    if (this.roomMode) return this.robotRooms.some(candidate => candidate.id === room.id);
    if (this.queueActive && this.queueRooms) return true;
    return !!this.caps?.room_targets.some(target=>target.id===room.id);
  }
  private get manualReady() { return this.queueReady && !!this.hass?.services?.robot_cleaner_queue?.control && !!this.caps?.supported && !this.capsError; }
  /** What the room being cleaned right now is actually running with. */
  private get activeSetup(): ManualSetup {
    if (this.showCommitted && this.queueRooms) {
      const id = this.queueTargets[this.index] ?? this.queueRoomSetups[this.index]?.id;
      const stored = this.queueRoomSetups.find(room => room.id === id)?.setup;
      if (stored?.mode) return this.caps ? normalizeSetup(this.caps, stored) : stored;
    }
    if (this.roomMode && !this.showCommitted) {
      const first = this.startPlan()[0];
      if (first) return first.setup;
    }
    const committed = this.showCommitted && this.queueManual ? this.queue?.attributes.setup as ManualSetup | undefined : undefined;
    return committed?.mode ? committed : this.setup;
  }
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
      this.caps=caps; this.savedPreset=caps.saved_preset;
      // Rooms are the model as soon as the companion reports them, without waiting for
      // another dashboard state change to notice.
      if (this.robotRooms.length && !this.queueActive && this.source!=='rooms') {
        this.source='rooms'; this.selected=[];
        // The sheet and the card must agree on the defaults the robot reports.
        if (!this.planEdited) this.setup=normalizeSetup(caps,caps.defaults);
      } else if (!this.robotRooms.length && this.source!=='manual' && caps.room_targets?.length) {
        // Room-less robots fall back to Home Assistant's mapped areas, the only plan
        // the companion can still run for them.
        this.source='manual';
      }
      if (caps.supported && caps.modes.length) {
        this.draftSetup=normalizeSetup(caps,this.source==='manual' ? this.setup : caps.defaults);
        if (this.source==='manual') this.setup=normalizeSetup(caps,this.setup);
      }
    } catch(error) { if (request===this.capsRequest) { this.caps=undefined; this.capsError=error instanceof Error ? error.message : 'Could not read robot capabilities.'; } }
    finally { if (request===this.capsRequest) this.capsLoading=false; }
  }
  private get canSavePreset() { return !!this.hass?.services?.robot_cleaner_queue?.save_preset && !this.blocked && !this.queueActive && !this.jobActive && (!this.manual || this.manualReady); }
  private async savePreset() {
    if (!this.canSavePreset || !this.hass || !this.config) return;
    const setup = this.caps ? normalizeSetup(this.caps,this.setup) : {...this.setup};
    const plan: SavedPreset = this.roomMode
      ? {source:'rooms',presets:[],rooms:roomsPayload(this.startPlan()),setup,...(this.caps?.current_map!==undefined?{map_id:this.caps.current_map}:{})}
      : {source:'manual',presets:[],rooms:[...this.manualSelected],setup};
    this.savingPreset=true; this.commandError=''; this.presetFeedback='';
    try {
      await this.hass.callService('robot_cleaner_queue','save_preset',{vacuum:this.config.entity,source:plan.source,rooms:plan.rooms,setup:plan.setup});
      this.savedPreset=plan;
      this.presetFeedback='Preset saved in Home Assistant. Your wall switch will use it. Nothing started.';
      await this.readCapabilities();
    } catch(error) {
      const message=error instanceof Error ? error.message : 'Could not save the preset. Your previous preset is unchanged.';
      this.commandError = this.schemaHint(message, plan.source==='rooms');
    }
    finally { this.savingPreset=false; }
  }
  private loadPreset() {
    const plan=this.savedPreset;
    if (!plan || this.blocked || this.queueActive || this.jobActive) return;
    if (plan.source==='rooms') {
      const entries=plan.rooms.filter((room):room is SavedRoom => !!room && typeof room === 'object');
      if (!this.roomMode || !this.caps) { this.commandError='The queue companion must report the robot’s rooms before this saved plan can be used.'; return; }
      if (!entries.length || (plan.map_id!==undefined && plan.map_id!==this.caps.current_map)) { this.commandError='The saved plan belongs to another map. Select that map and save a new preset.'; return; }
      if (entries.some(entry=>!this.robotRooms.some(room=>room.id===entry.id))) { this.commandError='A saved room is no longer on the robot’s current map. Edit and save a new preset.'; return; }
      const setups: Record<string,ManualSetup> = {};
      for (const entry of entries) {
        if (!matchesSetup(this.caps,entry)) { this.commandError='The saved plan uses settings the robot no longer offers. Edit and save a new preset.'; return; }
        setups[entry.id]=savedRoomSetup(this.caps,entry,this.setup);
      }
      this.setup=normalizeSetup(this.caps,plan.setup); this.roomSetups=setups; this.manualSelected=entries.map(entry=>entry.id);
    } else if (plan.source==='manual') {
      const areas=plan.rooms.filter((room):room is string => typeof room === 'string');
      const normalized=this.caps ? normalizeSetup(this.caps,plan.setup) : undefined;
      if (!this.caps?.supported || (plan.map_id!==undefined && plan.map_id!==this.caps.current_map) || !normalized || Object.keys(plan.setup).some(key=>normalized[key as keyof ManualSetup]!==plan.setup[key as keyof ManualSetup]) || areas.some(id=>!this.caps!.room_targets.some(room=>room.id===id))) {
        this.commandError='The saved preset has settings or areas that are no longer available. Edit and save a new preset.'; return;
      }
      this.setup={...plan.setup}; this.manualSelected=areas;
    } else {
      this.commandError='That saved preset runs Roborock app routines, which this card no longer uses. Choose rooms and save a new plan.'; return;
    }
    this.source=plan.source; this.planEdited=true; this.commandError=''; this.presetFeedback='Preset loaded. Press Start when ready.';
  }
  private async openSetup() {
    if (this.queueActive || this.blocked || this.jobActive) return;
    this.draftSource=this.source; this.draftSetup={...this.setup}; this.draftRoomSetups={...this.roomSetups}; this.sheetOpen=true;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLDialogElement>('dialog')?.showModal();
    await this.readCapabilities();
  }
  private closeSetup() { this.renderRoot.querySelector<HTMLDialogElement>('dialog')?.close(); this.sheetOpen=false; }
  private applySetup() {
    if (this.queueActive || this.blocked || this.jobActive) { this.closeSetup(); return; }
    if (this.draftSource!=='preset' && (!this.caps?.supported || this.capsLoading || this.capsError)) return;
    this.planEdited=true; this.source=this.draftSource;
    if (this.source!=='preset') this.setup=normalizeSetup(this.caps!,this.draftSetup);
    if (this.source==='rooms') this.roomSetups={...this.draftRoomSetups};
    this.closeSetup(); this.commandError='';
  }
  private changeRoomSetup(id: string, partial: Partial<ManualSetup>) {
    if (!this.caps) return;
    const current = this.draftRoomSetups[id] ?? this.draftSetup;
    this.draftRoomSetups = {...this.draftRoomSetups, [id]: normalizeSetup(this.caps, {...current, ...partial})};
  }
  private resetRoomSetup(id: string) { const next={...this.draftRoomSetups}; delete next[id]; this.draftRoomSetups=next; }
  private get selectedRooms() { return this.selection.map(id => this.rooms.find(room => room.id === id)).filter((room):room is RoomConfig => !!room); }
  private get showCommitted() { return (this.queuePresets.length > 0 || this.queueManual) && (this.queueActive || (!this.planEdited && this.queueManual === this.manual && !this.selection.length && ['attention','completed','cancelled'].includes(this.phase))); }

  protected updated(changed: PropertyValues) {
    // The service that answers get_capabilities decides the tile model, so ask for it
    // whenever it exists instead of guessing from the queue version.
    if (changed.has('hass') && this.capsFor!==this.config?.entity
        && (this.modernController || !!this.hass?.services?.robot_cleaner_queue?.get_capabilities)) void this.readCapabilities();
    if (changed.has('hass') && this.queueActive) { this.planEdited=false; this.source=this.queueRooms||this.queueManual?'manual':'preset'; }
    if (changed.has('hass') && !this.queueActive && this.roomMode && this.source!=='rooms') { this.source='rooms'; this.selected=[]; }
    if (changed.has('hass') && this.queueActive && this.queueManual && this.capsFor!==this.config?.entity) void this.readCapabilities();
    if (this.sheetOpen && (this.queueActive || this.jobActive)) this.closeSetup();
    if (!changed.has('hass') || !this.request) return;
    const kind = this.request.kind;
    const acknowledged = kind === 'cancel' ? this.phase === 'cancelled' : kind === 'start_manual' ? this.queueActive || this.phase === 'attention'
      : kind === 'stop' ? this.entity(this.config?.cleaning_entity)?.state==='off' && ['idle','docked'].includes(this.vacuum?.state??'')
      : kind === 'pause' ? this.vacuum?.state === 'paused' || this.phase === 'paused'
      : kind === 'resume' ? this.vacuum?.state === 'cleaning'
      : kind === 'return_to_dock' ? ['returning','docked'].includes(this.vacuum?.state ?? '')
      : false;
    if (acknowledged) {
      clearTimeout(this.requestTimer); this.request = undefined;
      if (this.queueActive && kind === 'start_manual') { this.manualSelected=[]; this.source = this.roomMode ? 'rooms' : 'manual'; }
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
  private waitingText(kind: string) {
    return ({
      start_manual: 'Request sent. Waiting for the robot to start…',
      stop: 'Waiting for the robot to stop…',
      return_to_dock: 'Waiting for the robot to reach the dock…',
      pause: 'Waiting for the robot to pause…',
      resume: 'Waiting for the robot to resume…',
      cancel: 'Clearing the sequence…',
    } as Record<string,string>)[kind] ?? 'Waiting for the robot…';
  }
  /**
   * The companion validates its own service schema before the handler runs, so a
   * rejected room list arrives as a schema message that reads like a card bug.
   */
  private schemaHint(message: string, roomPlan: boolean) {
    return roomPlan && /rooms|dictionary|extra keys|expected a string|not a valid value/i.test(message)
      ? `${message} — room plans need the queue companion's room contract (control_version 5 or newer).`
      : message;
  }
  /** Start the plan through the companion, or the whole home natively when there is none. */
  private async startClean() {
    const rooms = this.roomMode ? roomsPayload(this.startPlan()) : [...this.manualSelected];
    if (this.companionReady) {
      await this.hass!.callService('robot_cleaner_queue','control',{command:'start_manual',vacuum:this.config!.entity,rooms,setup:normalizeSetup(this.caps!,this.setup)});
      return;
    }
    if (rooms.length || this.roomMode || !this.feature(8192)) throw new Error('Room cleaning needs the updated Home Assistant queue companion.');
    await this.hass!.callService('vacuum','start',{entity_id:this.config!.entity});
  }
  private async command(kind: 'start_manual'|'pause'|'resume'|'return_to_dock'|'cancel'|'stop') {
    if (!this.hass || !this.config) return;
    if (kind !== 'cancel' && !this.robotReady) { this.commandError = 'The robot is unavailable.'; return; }
    // A refused press must say why. Silently returning looks like a broken button:
    // after Stop the queue holds the previous command open until the robot confirms it.
    if (kind !== 'cancel' && this.dispatchBlocked) {
      this.commandError = '';
      // The barrier is not a command in flight: name it and its remaining time.
      this.feedback = this.barrierActive && !this.blocked ? this.barrierNotice
        : this.request ? this.waitingText(this.request.kind) : 'Waiting for the robot to confirm the previous command.';
      return;
    }
    if (this.config.require_queue && !this.queueReady) { this.commandError = 'The robot cleaner queue is not available yet.'; return; }
    if (kind === 'start_manual') {
      if (!this.canStart) return;
      const plan = this.startPlan();
      if (this.roomMode && !plan.length) return;
      if (this.selection.length && (this.selectedRooms.length !== this.manualSelected.length || this.selectedRooms.some(room => !this.roomAvailable(room)))) return;
      if (!this.companionReady && !(!this.config.require_queue && !this.roomMode && !plan.length && this.feature(8192))) {
        this.commandError = 'Room cleaning needs the updated Home Assistant queue companion.';
        return;
      }
    }
    this.commandError = ''; this.feedback = this.waitingText(kind);
    this.request = {kind,since:Date.now()};
    clearTimeout(this.requestTimer);
    const pendingRequest = this.request;
    // Long enough not to contradict the integration's own 60-second window, and tied to
    // this request so a stale timer can never abort a newer command's confirmation.
    this.requestTimer = setTimeout(() => {
      if (this.request !== pendingRequest) return;
      this.request = undefined; this.feedback = '';
      this.commandError = 'The robot has not confirmed this command. Check its state before trying again.';
    },90000);
    try {
      if (kind === 'start_manual') {
        await this.startClean();
      } else if (this.queueActive || kind === 'cancel' || (['pause','resume','return_to_dock','stop'].includes(kind) && this.queueReady && (this.config.require_queue || !!this.hass.services?.robot_cleaner_queue?.control))) {
        const variables: Record<string,unknown> = {command:kind,vacuum:this.config.entity};
        for (const key of Object.keys(variables)) if (variables[key] === undefined) delete variables[key];
        if (this.hass.services?.robot_cleaner_queue?.control) await this.hass.callService('robot_cleaner_queue','control',variables);
        else await this.hass.callService('script','turn_on',{entity_id:this.config.queue_script,variables});
      } else {
        const action = {pause:'pause',resume:'start',return_to_dock:'return_to_base',stop:'stop',cancel:undefined,start_manual:undefined}[kind];
        if (!action) throw new Error('Unsupported command.');
        await this.hass.callService('vacuum',action,{entity_id:this.config.entity});
      }
    } catch(error) {
      clearTimeout(this.requestTimer); this.request = undefined; this.feedback = '';
      const message = error instanceof Error ? error.message : 'The command could not be sent.';
      this.commandError = this.schemaHint(message, kind==='start_manual' && this.roomMode);
    }
  }

  private headline(): string {
    if (!this.robotReady) return 'Robot unavailable';
    if (this.fault) return this.waterEmpty && this.fault==='Water empty' ? 'Dock needs water' : 'Needs attention';
    if (this.phase === 'attention') return 'Sequence needs attention';
    if (this.phase === 'controlling') return this.queue?.attributes.mode === 'finish' ? 'Finishing cleaning' : 'Waiting for the robot';
    if (this.phase === 'preparing') return 'Applying cleaning settings';
    if (this.request?.kind === 'start_manual') return 'Starting your clean';
    if (this.phase === 'starting') return 'Starting your sequence';
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
    return this.waterAllowed && this.manual ? 'Ready to vacuum' : 'Ready to clean';
  }
  private subline(): string {
    if (!this.robotReady) return 'Waiting for Home Assistant to reconnect.';
    if (this.fault) return this.waterEmpty && this.fault==='Water empty' ? 'A vacuum-only plan can run. Mopping needs water.' : this.fault;
    if (this.phase === 'attention') return this.queue?.attributes.error || 'The sequence stopped. Check the robot before starting a new plan.';
    if (this.phase === 'controlling') return this.queue?.attributes.mode === 'finish' ? 'Remaining rooms cancelled · Returning to dock for care' : 'Confirming your command · No retry will be sent';
    if (this.queueActive && this.queueManual) {
      if (this.queue?.attributes.waiting_for_dock) return `Next: ${this.stageName} · Waiting for the dock`;
      const stage=this.stages[this.index];
      const label=stage?.mode==='vacuum'?'Vacuum pass':stage?.mode==='mop'?'Mop pass':'Vacuum & mop';
      return `${label} · ${this.queueTargets.length ? `${this.queueRooms?'Room':'Area'} ${(stage?.room_index ?? 0)+1} of ${this.queueTargets.length}` : 'Whole home'}${this.activeSetup.repeat>1 ? ` · Run ${(stage?.repeat_index ?? 0)+1} of ${this.activeSetup.repeat}` : ''}`;
    }
    if (this.queueActive && this.queue?.attributes.waiting_for_dock) return `Next: ${this.rooms.find(room => room.preset === this.queuePresets[this.index])?.name ?? 'next preset'} · Waiting for the dock`;
    if (this.queueActive) return `Room ${Math.min(this.index+1,this.queuePresets.length)} of ${this.queuePresets.length} · Runs in your selected order`;
    if (this.jobActive) return this.vacuum?.state === 'paused' ? 'Resume when you are ready, or send the robot home.' : 'Live robot status · No room sequence running';
    if (this.phase === 'completed' && this.showCommitted) return `${this.completed} ${this.manual ? (this.completed === 1 ? 'room' : 'rooms') : 'cleaning stages'} completed${this.vacuum?.state === 'docked' ? ' · At the dock' : ''}`;
    if (this.selection.length) return `${this.selection.length} ${this.selection.length === 1 ? 'room' : 'rooms'} selected · Ready when you are`;
    return this.vacuum?.state === 'docked' ? 'At the dock · Choose rooms or clean the whole home' : 'Choose rooms in the order you want them cleaned';
  }
  private renderActions() {
    const busy = this.dispatchBlocked || !this.robotReady || ((this.queueActive || this.config?.require_queue) && !this.queueReady);
    const waiting = this.barrierActive && !this.blocked ? this.barrierNotice : 'Waiting…';
    if (this.jobActive || this.queueActive) {
      const paused = this.vacuum?.state === 'paused' || this.phase === 'paused';
      const servicing = /wash|dry|empty|attaching|detaching/.test(this.entity(this.config?.status_entity)?.state ?? '');
      const canPause = paused ? this.feature(8192) : this.feature(4) && this.vacuum?.state === 'cleaning' && !servicing;
      return html`<div class="actions">
        ${canPause ? html`<button class="action primary" data-action=${paused ? 'resume':'pause'} ?disabled=${busy || (paused && !this.feature(8192))} @click=${()=>this.command(paused ? 'resume':'pause')}>${icon(paused ? 'mdi:play':'mdi:pause')}${paused ? 'Resume':'Pause'}</button>`:nothing}
        ${this.feature(16) && this.vacuum?.state !== 'returning' && !servicing ? html`<button class="action ${canPause?'secondary':'primary'}" data-action="dock" ?disabled=${busy} @click=${()=>this.command('return_to_dock')}>${icon('mdi:home-import-outline')}Return to dock</button>`:nothing}
        ${this.feature(8) && this.modernController && !servicing ? html`<button class="action secondary" data-action="stop" ?disabled=${busy} @click=${()=>this.command('stop')}>${icon('mdi:stop')}Stop</button>`:nothing}
      </div>${this.barrierActive && !this.blocked ? html`<p class="hint" role="status">${this.barrierNotice}</p>`:nothing}`;
    }
    const selected = this.selection.length;
    const selectedAvailable = this.selectedRooms.every(room=>this.roomAvailable(room));
    // Without a companion the only plan left is a native whole-home start.
    const startable = this.companionReady || (!this.config?.require_queue && !this.roomMode && !selected && this.feature(8192));
    const disabled = !this.canStart || !startable || (this.manual && !this.manualReady)
      || (selected > 0 && (!selectedAvailable || this.selectedRooms.length !== this.manualSelected.length));
    return html`<div class="actions"><button class="action primary" data-action="start" ?disabled=${disabled} @click=${()=>this.command('start_manual')}>${icon('mdi:play')}${this.dispatchBlocked ? waiting : selected ? `Clean ${selected} ${selected===1?'room':'rooms'}` : 'Clean all rooms'}</button></div>`;
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
    const position = committed ? (this.manual ? this.queueTargets.indexOf(room.id) : this.queuePresets.indexOf(room.preset ?? '')) : this.selection.indexOf(room.id);
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
    const plan = this.showCommitted && this.manual
      ? this.queueTargets.map(id=>this.rooms.find(room=>room.id===id)?.name ?? humanize(id))
      : this.manual ? this.startPlan().map(room=>this.rooms.find(candidate=>candidate.id===room.id)?.name ?? humanize(room.id)) : [];
    return html`<div class="outer"><ha-card><div class="root">
      <div class="tile-wrap"><div class="glow-under" style=${glow.style}>${glow.overlay}</div><section class="surface hero" aria-label="Robot status">
        <div class="identity"><span class="robot-icon">${icon('mdi:robot-vacuum')}</span><div class="identity-text"><div class="eyebrow">Robot vacuum</div><div class="name">${this.config.name ?? this.vacuum?.attributes.friendly_name ?? 'Robot'}</div></div>${battery!==undefined ? html`<span class="battery" aria-label=${`Battery ${battery} percent`}>${icon(this.vacuum?.state==='docked'?'mdi:battery-charging':'mdi:battery')} ${battery}%</span>`:nothing}</div>
        <h2>${this.headline()}</h2><p class="subline">${this.subline()}</p>
        ${this.jobActive && (area || time || progress!==undefined) ? html`<div class="pills">${cleaning ? html`<span class="pill live">${icon('mdi:record-circle-outline')}Cleaning</span>`:nothing}${area?html`<span class="pill">${icon('mdi:ruler-square')}${area}</span>`:nothing}${time?html`<span class="pill">${icon('mdi:timer-outline')}${time}</span>`:nothing}${progress!==undefined?html`<span class="pill">${Math.round(progress)}%</span>`:nothing}</div>`:nothing}
        ${this.jobActive && progress!==undefined ? html`<div class="progress" role="progressbar" aria-label=${this.manual?'Current cleaning stage progress':'Current preset progress'} aria-valuenow=${Math.round(progress)} aria-valuemin="0" aria-valuemax="100"><span style=${`width:${progress}%`}></span></div>`:nothing}
        <button class="setup-launch" data-action="setup" aria-label=${`Cleaning setup: ${setupSummary(this.activeSetup)}`} ?disabled=${this.queueActive || this.blocked || this.jobActive} @click=${()=>this.openSetup()}><span><ha-icon .icon=${'mdi:tune-variant'}></ha-icon>${setupSummary(this.activeSetup)}</span><span class="setup-edit">${icon('mdi:chevron-right')}</span></button>
        ${this.renderActions()}
      </section></div>
      ${this.waterEmpty ? html`<div class="note water-warning">${icon('mdi:water-alert-outline')}<span>Refill and reseat the dock’s clean-water tank for mopping. ${this.waterAllowed ? 'You can start this clean. Roborock may skip or stop mopping until water is available.' : 'Mopping needs water. Make the plan’s first room vacuum-only, or wait until the tank is refilled.'}</span></div>`:nothing}
      ${this.renderUtilities()}
      ${this.terminalSequence ? html`<div class="note">${this.phase === 'attention' ? this.queue?.attributes.error || 'Review the robot, then clear this sequence before choosing a new one.' : 'This sequence has finished. Clear it to plan a fresh one.'}<button class="text-button" data-action="clear-queue" ?disabled=${!this.queueReady} @click=${()=>this.command('cancel')}>${this.phase === 'attention' ? 'Clear sequence' : 'Start a new sequence'}</button></div>`:nothing}
      ${this.commandError ? html`<div class="error" role="alert">${this.commandError}<button class="text-button" @click=${()=>this.commandError=''}>Dismiss</button></div>`:nothing}
      ${this.request ? html`<div class="note">${this.feedback}</div>`:nothing}
      ${!this.queueReady && (this.rooms.length || this.config?.require_queue) ? html`<div class="note">${this.config?.require_queue ? 'The shared cleaning controller is unavailable. Controls will return when it reconnects.' : 'Install and configure the Home Assistant queue companion to clean rooms in order. Full-home cleaning remains available when the robot is ready.'}</div>`:nothing}
      ${this.hass.services?.robot_cleaner_queue?.save_preset ? html`<section class="surface hero" aria-label="Reusable preset"><div class="section-heading preset-heading"><h3>Preset</h3><div class="pills preset-buttons">${this.savedPreset ? html`<button class="text-button" data-action="load-preset" ?disabled=${this.blocked||this.queueActive||this.jobActive} @click=${()=>this.loadPreset()}>Load preset</button>`:nothing}<button class="action" data-action="save-preset" ?disabled=${!this.canSavePreset} @click=${()=>this.savePreset()}>${icon('mdi:content-save-outline')}${this.savingPreset?'Saving…':'Save preset'}</button></div></div><p class="hint">Save this room order and setup for the card and wall switch. Saving replaces the previous preset without starting cleaning.</p>${this.presetFeedback ? html`<p class="hint" role="status">${this.presetFeedback}</p>`:nothing}</section>`:nothing}
      <section class="room-section" aria-label="Rooms"><div class="section-heading"><h3>${this.queueActive?'Cleaning sequence':this.roomMode||this.manual?'Choose your rooms':'Choose your rooms'}</h3>${this.selection.length && !this.queueActive?html`<button class="text-button" ?disabled=${this.blocked} @click=${()=>{this.planEdited=true;this.setSelection([]);this.feedback='Selection cleared.';}}>Clear selection</button>`:nothing}</div>
        <p class="hint">${this.queueActive ? 'Your sequence continues even when you close this dashboard.' : this.roomMode ? 'Tap the robot’s rooms in order. Tap again to remove; open Cleaning setup to give a room its own settings.' : 'Tap in order. Tap again to remove. Numbers show the cleaning sequence.'}</p>
        <div class="rooms">${repeat(this.rooms,room=>room.id,room=>this.renderRoom(room))}</div>
        ${!this.rooms.length ? html`<p class="note">${this.roomMode ? 'The robot reports no rooms on its current map.' : this.manual ? 'No mapped areas available. You can clean the whole home.' : 'Rooms need the queue companion to report the robot’s own map, so update it or clean the whole home below.'}</p>`:nothing}
        ${this.manual && this.selection.some(id=>!this.rooms.some(room=>room.id===id)) ? html`<p class="note">${this.roomMode ? 'A room in your selection is no longer on this map.' : 'An area in your selection is no longer mapped.'} Clear the selection and choose the available rooms again.</p>`:nothing}
        ${plan.length ? html`<div class="queue-summary"><div class="eyebrow">${this.showCommitted?'Your sequence':'Selected order'}</div><div class="sequence">${plan.map((name,i)=>html`${i?icon('mdi:chevron-right'):nothing}<span>${i+1}. <b>${name}</b></span>`)}</div>${!this.queueActive && this.selection.length?this.renderActions():nothing}</div>`:nothing}
      </section>
      <div class="sr-only" role="status" aria-live="polite">${this.feedback}</div>
    </div></ha-card></div>
    <dialog class="setup-dialog" aria-labelledby="setup-title" @cancel=${()=>{this.sheetOpen=false;}} @close=${()=>{this.sheetOpen=false;}}>${this.sheetOpen ? renderSetupSheet({source:this.draftSource,setup:this.draftSetup,caps:this.caps,loading:this.capsLoading,error:this.capsError,rooms:this.draftSource==='rooms'?this.sheetRooms:undefined,changeSetup:(setup)=>{if(this.caps)this.draftSetup={...this.draftSetup,...normalizeSetup(this.caps,{...this.draftSetup,...setup})};},changeRoomSetup:(id,setup)=>this.changeRoomSetup(id,setup),resetRoomSetup:(id)=>this.resetRoomSetup(id),close:()=>this.closeSetup(),apply:()=>this.applySetup(),retry:()=>{void this.readCapabilities();}}):nothing}</dialog>
    <dialog class="setup-dialog device-dialog" aria-labelledby="device-title" @cancel=${()=>{this.panel=undefined;}} @close=${()=>{this.panel=undefined;}}>${this.panel&&this.hass ? renderDevicePanel({panel:this.panel,hass:this.hass,entities:this.caps?.device_entities??{},busy:this.blocked||this.queueActive||this.phase==='attention',robotDocked:this.vacuum?.state==='docked'&&!this.jobActive,waterEmpty:this.waterEmpty,fault:!!this.fault&&this.fault!=='Water empty',error:this.commandError,pending:this.deviceSending||this.phase==='controlling',close:()=>this.closePanel(),send:(key,value)=>void this.deviceCommand(key,value)}):nothing}</dialog>`;
  }
}
const cardWindow = window as typeof window & {customCards?: Array<Record<string,unknown>>};
cardWindow.customCards = cardWindow.customCards || [];
cardWindow.customCards.push({type:'robot-vacuum-cleaner-card',name:'Robot Vacuum Cleaner Card',description:'Robot status and ordered cleaning of the robot’s own rooms with Space Hub styling.',preview:true});
console.info('ROBOT VACUUM CLEANER CARD 0.6.1');
