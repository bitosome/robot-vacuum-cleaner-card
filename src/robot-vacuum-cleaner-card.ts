import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { matchesSetup, MODE_LABELS, normalizeSetup, renderZoneReport, roomLabel, roomsPayload, savedRoomSetup, setupSummary, type CleaningSource, type ManualCapabilities, type ManualSetup, type ManualStage, type PlanRoom, type RobotRoom, type SavedPreset, type SavedRoom, type SetupRoom } from './manual-setup';
import {planKey} from './saved-plan';
import {reconcileOrder, moveRoom} from './room-order';
import {createQueueDraft, queueDraftChanged, queueDraftCurrent, queueDraftRooms, queueEditSnapshot, queueRoomsKey, reorderQueueDraft, type QueueEditDraft} from './queue-edit';
import {loadNativeSortable} from './native-sortable';
import {sequenceProgress} from './sequence-progress';
import {cleaningRuns, type CleaningRun} from './run-history';
import {renderSequenceActivity} from './sequence-activity';
import {renderRoomSettings,renderSettingPills,settingsSummary} from './room-settings';
import {dockServiceLabel, passiveMopDrying, returningToDock} from './robot-status';
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
  @state() private request?: {kind:string; since:number; phase:string; runId?:string};
  @state() private feedback = '';
  @state() private commandError = '';
  @state() private source: CleaningSource = 'rooms';
  @state() private manualSelected: string[] = [];
  @state() private roomOrder: string[] = [];
  @state() private queueDraft?: QueueEditDraft;
  @state() private savingQueue = false;
  @state() private queueEditMessage = '';
  private queueEditAccepted?: {runId:string;revision:number};
  private queueEditTimer?: ReturnType<typeof setTimeout>;
  @state() private sortableReady = false;
  private sortOrder?: string[];
  private sortMove?: {oldIndex:number;newIndex:number};
  private autoSaveTimer?: ReturnType<typeof setTimeout>;
  @state() private autoSaveError = '';
  private autoSaveKey = '';
  @state() private preferencesSaveError = '';
  private get sharedPlan() { return this.caps?.shared_plan_version===1; }
  private async loadSortable() { this.sortableReady=await loadNativeSortable(); }
  private cancelSort() { this.sortOrder=undefined; this.sortMove=undefined; }
  private sortStart() { clearTimeout(this.autoSaveTimer);this.autoSaveKey=''; this.sortOrder=this.orderedRooms.map(room=>room.id); this.sortMove=undefined; }
  private sortMoved(event:CustomEvent<{oldIndex:number;newIndex:number}>) { event.stopPropagation(); this.sortMove=event.detail; }
  private async sortEnd() {
    const order=this.sortOrder,move=this.sortMove;this.cancelSort();this.requestUpdate();
    // HA restores its DOM placeholder after drag-end. Let that finish before Lit
    // applies the new keyed order, in either direction.
    await new Promise(resolve=>setTimeout(resolve,0));
    if(!order || !move || !this.canArrangeRooms || order.join('|')!==this.orderedRooms.map(room=>room.id).join('|'))return;
    const {oldIndex,newIndex}=move;
    if(!Number.isInteger(oldIndex)||!Number.isInteger(newIndex)||oldIndex<0||newIndex<0||oldIndex>=order.length||newIndex>=order.length)return;
    const id=order[oldIndex];if(!this.canArrangeRoom(id))return;
    if(!this.queueDraft&&this.queueEditSupported)this.beginQueueEdit();
    this.reorderRooms(moveRoom(order,id,newIndex));this.announceOrder(id);
  }
  @state() private setup: ManualSetup = {mode:'vacuum_mop',repeat:1};
  /** Per-room overrides of the default settings, keyed by robot room id. */
  @state() private roomSetups: Record<string, ManualSetup> = {};
  /** Frozen saved-plan values never replace the household preference profile. */
  @state() private planSetups: Record<string,ManualSetup> = {};
  @state() private planDraftTouched = false;
  private loadedPlanSignature = '';
  private planBaseRevision = 0;
  private savedPlanFetchedRevision = 0;
  @state() private caps?: ManualCapabilities;
  @state() private capsLoading = false;
  @state() private capsError = '';
  @state() private planEdited = false;
  @state() private panel?: DevicePanel;
  @state() private recoveryPrompt?: {kind:'refill'|'restart';runId:string;index:number;action:string;token?:string};
  @state() private historyRunId?: string;
  @state() private historyRecords: CleaningRun[] = [];
  @state() private historyLoading = false;
  @state() private historyError = '';
  private historyFor = '';
  private historyRequest = 0;
  private historyOnline = false;
  @state() private deviceSending = false;
  @state() private savingPreset = false;
  @state() private presetFeedback = '';
  @state() private savedPreset?: SavedPreset;
  @state() private preferencesDirty = false;
  @state() private savingPreferences = false;
  @state() private preferencesMessage = '';
  @state() private preferencesRevision = 0;
  private preferencesFetchedRevision = 0;
  private configEpoch = 0;
  private refreshPending = false;
  private capsFor = '';
  private capsRequest = 0;
  private mapState?: string;
  private barrierTimer?: ReturnType<typeof setTimeout>;
  private requestTimer?: ReturnType<typeof setTimeout>;

  setConfig(config: CardConfig) { if (this.config?.entity !== config.entity) { this.cancelSort(); clearTimeout(this.autoSaveTimer); this.autoSaveError=''; this.preferencesSaveError=''; this.autoSaveKey=''; this.roomOrder=[]; clearTimeout(this.queueEditTimer); this.queueEditAccepted=undefined; this.queueDraft=undefined; this.savingQueue=false; this.queueEditMessage=''; this.closeRecoveryPrompt(); this.configEpoch++; this.historyRunId=undefined; this.historyRecords=[]; this.historyFor=''; this.historyRequest++; this.historyLoading=false; this.historyError=''; this.capsRequest++; this.capsLoading=false; this.refreshPending=false; this.mapState=undefined; this.savingPreset=false; this.savingPreferences=false; this.deviceSending=false; clearTimeout(this.requestTimer); this.request=undefined; this.commandError=''; this.feedback=''; this.capsFor=''; this.caps=undefined; this.savedPreset=undefined; this.preferencesDirty=false; this.preferencesRevision=0; this.preferencesFetchedRevision=0; this.preferencesMessage=''; this.presetFeedback=''; this.manualSelected=[]; this.roomSetups={}; this.planSetups={}; this.planDraftTouched=false; this.loadedPlanSignature=''; this.planBaseRevision=0; this.savedPlanFetchedRevision=0; this.setup={mode:'vacuum_mop',repeat:1}; this.planEdited=false; this.source='rooms'; } this.config = validateConfig(config); this.selected = []; }
  getCardSize() { return 8; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 9, min_rows: 6 }; }
  static async getConfigElement() { await import('./editor'); return document.createElement('robot-vacuum-cleaner-card-editor'); }
  static getStubConfig(hass?: Hass) {
    return {type:'custom:robot-vacuum-cleaner-card',entity:Object.keys(hass?.states ?? {}).find(id => id.startsWith('vacuum.')) ?? 'vacuum.robot',rooms:[]};
  }
  connectedCallback() { super.connectedCallback(); void this.loadSortable(); void this.readHistory(); }
  disconnectedCallback() { this.cancelSort(); super.disconnectedCallback(); this.historyRequest++; this.historyFor=''; this.historyLoading=false; clearTimeout(this.requestTimer); clearTimeout(this.barrierTimer); clearTimeout(this.queueEditTimer); this.queueEditAccepted=undefined; this.savingQueue=false; this.request = undefined; }
  private entity(id?: string) { return id ? this.hass?.states[id] : undefined; }
  private get vacuum() {
    const native=this.entity(this.config?.entity);
    // HA omits a few documented Roborock enum states (for example mop washing).
    // Use the companion's normalized native observation only for that unknown
    // state, never to conceal an offline entity or a real error.
    if (native?.state!=='unknown' || !(Number(this.queue?.attributes.execution_version)>=3) || this.queue?.attributes.robot_connected!==true) return native;
    const observed=Number(this.queue?.attributes.robot_observed_at), activity=this.queue?.attributes.robot_activity;
    const age=Date.now()/1000-observed;
    return Number.isFinite(observed) && observed>0 && age>=-30 && age<=90 && ['docked','idle','cleaning','paused','returning'].includes(activity)
      ? {...native,state:activity as string} : native;
  }
  private get queue() { const q = this.entity(this.config?.queue_entity); return q?.attributes.vacuum && q.attributes.vacuum !== this.config?.entity ? undefined : q; }
  private get phase() { return this.queue?.state ?? 'unavailable'; }
  private get queueActive() { return QUEUE_ACTIVE.has(this.phase); }
  private get restartRecovering() { return this.phase==='recovering'; }
  private get restartRecordPending() { return Number(this.queue?.attributes.control_version)>=7 && this.queue?.attributes.restart_record_pending===true; }
  private get restartRecoveryReason() { const reason=this.queue?.attributes.restart_recovery_reason; return typeof reason==='string'&&reason ? reason : 'Checking the robot after Home Assistant restarted. Your rooms and completed passes are kept.'; }
  private get queuePresets(): string[] { return Array.isArray(this.queue?.attributes.presets) ? this.queue!.attributes.presets.filter((p:unknown) => typeof p === 'string') : []; }
  private get index() { return Math.max(0,Number(this.queue?.attributes.current_index) || 0); }
  private get completed() { return Math.max(0,Number(this.queue?.attributes.completed) || 0); }
  private get robotReady() { return available(this.vacuum); }
  private get dockStatus() {
    const native=this.entity(this.config?.status_entity);
    return available(native) ? native!.state : String(this.queue?.attributes.dock_status ?? '');
  }
  private get dockService() { return dockServiceLabel(this.dockStatus); }
  private get dockServicing() { return !!this.dockService || returningToDock(this.dockStatus); }
  private get dockDrying() {
    const reported=this.queue?.attributes.dock_drying;
    return typeof reported==='boolean' ? reported : this.entity(this.caps?.device_entities?.mop_drying)?.state==='on' || passiveMopDrying(this.dockStatus);
  }
  private get floorCleaningComplete() { return this.phase==='finishing' || this.queue?.attributes.floor_cleaning_complete===true; }
  private get startUncertain() { return this.queue?.attributes.start_uncertain===true; }
  private get nativeJobActive() { return this.entity(this.config?.cleaning_entity)?.state === 'on' || this.queue?.attributes.robot_job === 'on'; }
  private get jobActive() { return this.nativeJobActive || ['cleaning','paused','returning'].includes(this.vacuum?.state ?? ''); }
  /** A native unfinished job can be docked for charging without finishing its pass. */
  private get chargingBreak() {
    return this.queueActive && !this.restartRecovering && !this.floorCleaningComplete && !this.queue?.attributes.waiting_for_dock
      && !['preparing','starting','finishing','controlling'].includes(this.phase)
      && this.vacuum?.state==='docked' && ['charging','charging_complete'].includes(this.dockStatus)
      && this.nativeJobActive;
  }
  private get continuationSupported() { return Number(this.queue?.attributes.control_version)>=6 && this.queueManual && this.stages.length>0 && this.phase==='attention'; }
  private get continuationAction() {
    const value=this.queue?.attributes.continuation_action;
    return ['resume_job','resume_observation','retry_stage','continue_next','finish_docking'].includes(value) ? String(value) : '';
  }
  private get recoveryContext() {
    const {run_id,current_index}=this.queue?.attributes??{};
    return typeof run_id==='string'&&run_id && Number.isInteger(current_index)&&current_index>=0&&current_index<=this.stages.length ? {runId:run_id,index:current_index as number}:undefined;
  }
  private get continuationReady() { return this.continuationSupported && !!this.recoveryContext && !!this.continuationAction && this.queue?.attributes.continuation_ready===true; }
  private get observingRetainedJob() { return this.continuationReady && this.continuationAction==='resume_observation'; }
  private get waterRefillConfirmation() { return this.queue?.attributes.continuation_requires_water_ack===true; }
  private get continuationLabel() { return this.continuationAction==='retry_stage'?'Retry current pass':this.continuationAction==='finish_docking'?'Check dock completion':'Continue sequence'; }
  private get continuationReason() { const reason=this.queue?.attributes.continuation_reason; return typeof reason==='string'&&reason?reason:'Waiting for the robot to confirm it can continue.'; }
  private get resumeNowSupported() { return Number(this.queue?.attributes.control_version)>=6 && !this.restartRecordPending && this.chargingBreak; }
  private get resumeNowReady() { return this.resumeNowSupported && !!this.recoveryContext && this.index<this.stages.length && this.queue?.attributes.resume_now_ready===true; }
  private get restartResumeSupported() { return this.restartRecordPending && ['recovering','running','paused','attention'].includes(this.phase) && ['docked','paused'].includes(this.vacuum?.state??'') && this.nativeJobActive; }
  private get restartResumeToken() { const token=this.queue?.attributes.restart_resume_token; return typeof token==='string'&&token ? token : ''; }
  private get restartResumeReady() { return this.restartResumeSupported && !!this.recoveryContext && this.index<this.stages.length && !!this.restartResumeToken && this.queue?.attributes.restart_resume_ready===true; }
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
  private get blocked() { return this.savingQueue || this.savingPreferences || this.savingPreset || this.deviceSending || this.phase === 'controlling' || !!this.request || (this.queueActive && !!this.queue?.attributes.pending_command); }
  /**
   * The engine's uncertainty window only forbids motion. Selecting rooms, editing
   * settings, saving a plan and clearing a finished sequence are all local.
   */
  private get dispatchBlocked() { return this.blocked || this.barrierActive || !!this.queue?.attributes.pending_command; }
  /** A stopped run is historical once the backend has freshly confirmed readiness. */
  private get recoveryReady() { return this.phase==='attention' && Number(this.queue?.attributes.execution_version)>=3 && this.queue?.attributes.recovery_ready===true; }
  private get recoveryReason() {
    const reason=this.queue?.attributes.recovery_reason;
    return typeof reason==='string' && reason ? reason : this.barrierActive ? this.barrierNotice : 'Clear the stopped sequence before starting a new plan.';
  }
  /** A committed plan that has stopped: it can be dismissed to plan a fresh one. */
  private get terminalSequence() {
    if (this.phase === 'attention') return true;
    return !this.planEdited && !this.selection.length && ['cancelled','completed'].includes(this.phase) && (this.queueTargets.length > 0 || this.queuePresets.length > 0);
  }
  private get waterEmpty() { return this.entity(this.config?.dock_error_entity)?.state === 'water_empty'; }
  private get waterAcknowledged() { return Number(this.queue?.attributes.control_version)>=6 && this.queueActive && this.queueManual && this.index<this.stages.length && this.queue?.attributes.water_refill_ack_active===true; }
  private get modernController() { return Number(this.queue?.attributes.control_version) >= 3; }
  /** A dock with no clean water can still run a plan whose next room is vacuum-only. */
  private get waterAllowed() { return this.waterEmpty && this.modernController && this.manual && (this.continuationSupported?this.stages[this.index]?.mode:this.activeSetup.mode)==='vacuum'; }
  private get fault() {
    const err = this.entity(this.config?.error_entity)?.state;
    const dock = this.entity(this.config?.dock_error_entity)?.state;
    return !quietError(err) ? humanize(err) : !quietError(dock) && !(dock==='water_empty' && (this.waterAllowed||this.waterAcknowledged)) ? humanize(dock) : this.vacuum?.state === 'error' ? 'Robot needs attention' : '';
  }
  private get canStart() { return !this.queueDraft && (this.phase !== 'attention' || this.recoveryReady) && (!this.config?.require_queue || this.queueReady) && this.robotReady && !this.jobActive && !this.queueActive && !this.dockServicing && !this.dispatchBlocked && !this.fault && ['docked','idle'].includes(this.vacuum?.state ?? ''); }
  /** Stopping ends a job, not the trip home: native idle does not mean docked. */
  private get canReturnToDock() { return this.feature(16) && !['returning','docked'].includes(this.vacuum?.state ?? '') && !this.dockServicing; }
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
    const chosen = this.planSetups[id] ?? source[id] ?? this.setup;
    return chosen;
  }
  /** The ordered plan Start would send: only the explicit selection. */
  private startPlan(): PlanRoom[] {
    const ids = this.manualSelected;
    return ids.map(id => ({id, setup: this.setupFor(id)}));
  }
  private get companionReady() { return !!this.hass?.services?.robot_cleaner_queue?.control && !!this.caps?.supported; }
  private get queueTargets(): string[] { return Array.isArray(this.queue?.attributes.targets) ? this.queue!.attributes.targets : []; }
  private get stages(): ManualStage[] { return Array.isArray(this.queue?.attributes.stages) ? this.queue!.attributes.stages : []; }
  private get manual() {
    if (this.queueActive) return this.queueManual || this.queueRooms;
    return this.roomMode || this.source === 'manual';
  }
  private get selection() { return this.manual ? this.manualSelected : this.selected; }
  private retainDraftRooms(rooms:RoomConfig[]):RoomConfig[] {
    if(!this.queueDraft)return rooms;
    return [...rooms,...this.queueDraft.order.filter(id=>!rooms.some(room=>room.id===id))
      .map(id=>({id,name:this.queueDraft!.names[id]??id,preset:id,icon:this.roomIcon({id})}))];
  }
  private get rooms(): RoomConfig[] {
    // Robot rooms first: the tiles are the robot's own map, not a configuration list.
    if (this.roomMode) {
      const rooms=this.robotRooms.map(room => ({id:room.id,name:this.roomName(room),preset:room.id,icon:this.roomIcon(room)}));
      // A map/capability refresh must not silently remove a committed room from an edit.
      if(this.queueDraft)for(const room of this.queueRoomSetups) {
        if(!rooms.some(current=>current.id===room.id))rooms.push({id:room.id,name:this.roomName({id:room.id,name:room.name}),preset:room.id,icon:this.roomIcon({id:room.id})});
      }
      return this.retainDraftRooms(rooms);
    }
    if ((this.queueActive || this.queueDraft) && this.queueRooms) return this.retainDraftRooms(this.queueRoomSetups.map(room => ({id:room.id,name:this.roomName({id:room.id,name:room.name}),preset:room.id,icon:this.roomIcon({id:room.id})})));
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
    if ((this.queueActive || this.queueDraft) && this.queueRooms) return this.queueRoomSetups.some(item=>item.id===room.id);
    return !!this.caps?.room_targets.some(target=>target.id===room.id);
  }
  private get orderedRooms() {
    const preferred=this.queueDraft?.order??(this.showCommitted?this.queueTargets:this.roomOrder);
    const order=reconcileOrder(preferred,this.rooms.map(room=>room.id));
    const rooms=new Map(this.rooms.map(room=>[room.id,room]));
    return order.map(id=>rooms.get(id)!);
  }
  private get queueEditSnapshot() { return this.config?queueEditSnapshot(this.queue,this.config.entity):undefined; }
  private get queueEditSupported() { return !!this.hass?.services?.robot_cleaner_queue?.update_queue && !!this.queueEditSnapshot && (this.queueActive || this.phase==='attention'); }
  private get queueDraftStale() { return !!this.queueDraft && !queueDraftCurrent(this.queueDraft,this.queueEditSnapshot); }
  private get canEditQueue() { return this.queueEditSupported && this.queueEditSnapshot!.editable && !this.blocked; }
  private get canChangeQueueDraft() { return !!this.queueDraft && !this.queueDraftStale && this.canEditQueue; }
  private get canArrangeRooms() { return this.queueDraft?this.canChangeQueueDraft:this.queueEditSupported?this.canEditQueue:!this.queueActive && !this.jobActive && !this.blocked && !!this.caps?.supported; }
  private canArrangeRoom(id:string) { return this.canArrangeRooms && !(this.queueDraft?.protectedIds??(this.queueEditSupported?this.queueEditSnapshot?.protectedIds:[]))?.includes(id); }
  private beginQueueEdit() {
    const snapshot=this.queueEditSnapshot;
    if(!snapshot || !this.canEditQueue)return;
    this.cancelSort();
    this.queueDraft=createQueueDraft(snapshot,this.rooms.map(room=>room.id),id=>this.roomSetups[id]??this.setup,Object.fromEntries(this.rooms.map(room=>[room.id,room.name])));
    this.queueEditMessage='';
  }
  private cancelQueueEdit() {
    if(this.savingQueue)return;
    this.cancelSort();this.queueDraft=undefined;this.queueEditMessage='';this.preloadPlan();
  }
  private get validQueueDraft() {
    const draft=this.queueDraft;
    return !!draft && queueDraftRooms(draft).every(room=>{
      const frozen=draft.pending.find(item=>item.id===room.id);
      // Removing/reordering the server's frozen tail needs no live setting controls.
      if(frozen && queueRoomsKey([room])===queueRoomsKey([frozen]))
        return !this.caps?.supported || this.roomAvailable({id:room.id,name:room.id});
      return !!this.caps?.supported && this.roomMode && this.roomAvailable({id:room.id,name:room.id})
        && matchesSetup(this.caps,{id:room.id,...room.setup});
    });
  }
  private async applyQueueEdit() {
    const draft=this.queueDraft,hass=this.hass,vacuum=this.config?.entity,epoch=this.configEpoch;
    if(!draft || !hass || !vacuum || !this.canChangeQueueDraft || !this.validQueueDraft || !queueDraftChanged(draft))return;
    this.cancelSort();this.savingQueue=true;this.queueEditMessage='';
    try {
      await hass.callService('robot_cleaner_queue','update_queue',{vacuum,run_id:draft.runId,revision:draft.revision,rooms:roomsPayload(queueDraftRooms(draft))});
      if(this.configEpoch!==epoch)return;
      this.queueEditAccepted={runId:draft.runId,revision:draft.revision};
      this.queueEditMessage='Update accepted. Waiting for the shared queue…';
      this.confirmQueueEdit();
      if(this.queueEditAccepted)this.queueEditTimer=setTimeout(()=>{
        this.queueEditAccepted=undefined;this.savingQueue=false;
        this.queueEditMessage='Update accepted, but the shared queue has not refreshed. Reload remaining rooms before making another change.';
      },20000);
    } catch(error) {
      if(this.configEpoch===epoch) {this.savingQueue=false;this.queueEditMessage=error instanceof Error?error.message:'Could not update the queue. Reload remaining rooms before trying again.';}
    }
  }
  private confirmQueueEdit() {
    const accepted=this.queueEditAccepted,a=this.queue?.attributes;
    if(!accepted || a?.run_id!==accepted.runId || !(a.queue_revision>accepted.revision))return;
    clearTimeout(this.queueEditTimer);this.queueEditAccepted=undefined;this.savingQueue=false;this.queueDraft=undefined;
    this.queueEditMessage='Remaining rooms updated. Saved plan unchanged.';this.feedback=this.queueEditMessage;
  }
  private reorderRooms(order:string[]) {
    if(!this.canArrangeRooms)return;
    if(this.queueDraft) {this.queueDraft=reorderQueueDraft(this.queueDraft,order);return;}
    this.roomOrder=reconcileOrder(order,this.rooms.map(room=>room.id));
    this.planEdited=true;
    this.setSelection(this.selection);
  }
  private announceOrder(id:string) {
    const room=this.rooms.find(room=>room.id===id);
    this.feedback=`${room?.name??'Room'} moved to position ${this.orderedRooms.findIndex(room=>room.id===id)+1}.`;
  }
  private async reorderKey(event:KeyboardEvent,id:string) {
    if(!this.canArrangeRoom(id))return;
    const focused=this.shadowRoot?.activeElement===event.currentTarget;
    const epoch=this.configEpoch;
    const order=this.orderedRooms.map(room=>room.id),index=order.indexOf(id);
    const next=event.key==='ArrowUp'?index-1:event.key==='ArrowDown'?index+1:event.key==='Home'?0:event.key==='End'?order.length-1:undefined;
    if(next===undefined)return;
    event.preventDefault();event.stopPropagation();
    if(!this.queueDraft && this.queueEditSupported)this.beginQueueEdit();
    this.reorderRooms(moveRoom(order,id,next));this.announceOrder(id);
    await this.updateComplete;
    if(focused && this.isConnected && epoch===this.configEpoch && this.canArrangeRoom(id))
      [...this.renderRoot.querySelectorAll<HTMLElement>('[data-drag-room]')].find(handle=>handle.dataset.dragRoom===id)?.focus();
  }
  private get manualReady() { return this.queueReady && !!this.hass?.services?.robot_cleaner_queue?.control && !!this.caps?.supported && !this.capsError; }
  /** What the room being cleaned right now is actually running with. */
  private get activeSetup(): ManualSetup {
    if (this.showCommitted && this.queueRooms) {
      const id = this.stages[this.index]?.target;
      const stored = this.queueRoomSetups.find(room => room.id === id)?.setup;
      if (stored?.mode) return stored;
    }
    if (this.roomMode && !this.showCommitted) {
      const first = this.startPlan()[0];
      if (first) return first.setup;
    }
    const committed = this.showCommitted && this.queueManual ? this.queue?.attributes.setup as ManualSetup | undefined : undefined;
    return committed?.mode ? committed : this.planCommonSetup;
  }
  private get stageName() { const target = this.stages[this.index]?.target; return target ? this.rooms.find(room=>room.id===target)?.name ?? humanize(target) : 'whole home'; }
  private get passLabel() {
    const stage=this.stages[this.index];
    const label=stage?.mode==='vacuum'?'Vacuum pass':stage?.mode==='mop'?'Mop pass':'Vacuum & mop';
    const repeats=this.queueRoomSetups.find(room=>room.id===stage?.target)?.setup.repeat ?? this.queue?.attributes.setup?.repeat ?? 1;
    return `${label}${repeats>1?` ${(stage?.repeat_index??0)+1}/${repeats}`:''}`;
  }
  private setSelection(ids: string[]) {
    this.planDraftTouched=true;
    // Keep missing IDs so capability changes cannot silently shorten a saved plan.
    const order=reconcileOrder(this.roomOrder,this.rooms.map(room=>room.id));
    const selected=new Set(ids);
    const next=[...order.filter(id=>selected.has(id)),...ids.filter(id=>!order.includes(id))];
    if (this.manual) this.manualSelected=next; else this.selected=next;
  }
  private requestCapabilitiesRefresh() {
    if (this.capsLoading) this.refreshPending=true;
    else void this.readCapabilities();
  }
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
      const preservePlan=this.planDraftTouched && this.planChanged;
      this.caps=caps; this.savedPreset=caps.saved_preset;
      this.savedPlanFetchedRevision=caps.saved_plan_revision ?? caps.saved_preset?.revision ?? 0;
      if (!preservePlan) {
        this.planDraftTouched=false;
        // An invalid/retired plan must still be replaceable using the revision
        // this dashboard actually read, even when it cannot be preloaded.
        this.planBaseRevision=this.savedPlanFetchedRevision;
      }
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
      if (caps.supported && caps.modes.length && !this.planEdited) this.setup=normalizeSetup(caps,caps.defaults);
      if (caps.preferences) {
        this.preferencesFetchedRevision=caps.preferences.revision;
        if (!this.preferencesDirty) this.applyPreferences();
        else if (caps.preferences.revision!==this.preferencesRevision) this.preferencesMessage='Shared settings changed in another dashboard. Reload shared settings before saving.';
      }
      this.preloadPlan();
    } catch(error) { if (request===this.capsRequest) { this.caps=undefined; this.capsError=error instanceof Error ? error.message : 'Could not read robot capabilities.'; } }
    finally { if (request===this.capsRequest) {
      this.capsLoading=false;
      if (this.refreshPending) { this.refreshPending=false; void this.readCapabilities(); }
    } }
  }
  private applyPreferences() {
    const profile=this.caps?.preferences;
    if (!profile || !this.caps) return;
    // Preserve stored values exactly. A removed option must fail validation rather
    // than silently change a household preference to another setting.
    this.setup=profile.defaults.mode ? {...profile.defaults} as ManualSetup : normalizeSetup(this.caps,this.caps.defaults);
    this.roomSetups=structuredClone(profile.rooms);
    this.preferencesRevision=profile.revision;
    this.preferencesDirty=false;
  }
  private async reloadPreferences() {
    const epoch=this.configEpoch;
    const dirty=this.preferencesDirty;
    this.preferencesDirty=false; this.preferencesSaveError='';
    await this.readCapabilities();
    if (this.configEpoch!==epoch) return;
    if (this.capsError) this.preferencesDirty=dirty;
    this.preferencesMessage=this.capsError || 'Shared room settings loaded.';
  }
  private async savePreferences() {
    if (!this.hass || !this.config || !this.caps || this.blocked || this.caps.current_map===undefined) return;
    const vacuum=this.config.entity, epoch=this.configEpoch;
    const rooms=Object.fromEntries(this.robotRooms.filter(room=>this.roomSetups[room.id]).map(room=>[room.id,{...this.roomSetups[room.id]}]));
    this.savingPreferences=true; this.preferencesMessage=''; this.preferencesSaveError='';
    try {
      await this.hass.callService('robot_cleaner_queue','save_preferences',{vacuum,revision:this.preferencesRevision,map_id:this.caps.current_map,defaults:{...this.setup},rooms});
      if (this.config?.entity!==vacuum || this.configEpoch!==epoch) return;
      this.preferencesDirty=false;
      await this.readCapabilities();
      if (this.configEpoch!==epoch) return;
      this.preferencesMessage='Room settings saved.';
    } catch (error) { if(this.configEpoch===epoch) { this.preferencesMessage=error instanceof Error ? error.message : 'Could not save room settings. Your changes are still unsaved.'; this.preferencesSaveError=this.preferencesMessage; } }
    finally { if(this.configEpoch===epoch) this.savingPreferences=false; }
  }
  private get validSelection() {
    return !!this.caps && this.manualSelected.every(id=>this.rooms.some(room=>room.id===id)
      && matchesSetup(this.caps!,{id,...this.setupFor(id)}));
  }
  private get planCommonSetup() { return this.manualSelected.length ? this.setupFor(this.manualSelected[0]) : this.setup; }
  private draftPlan(): SavedPreset {
    return this.roomMode
      ? {source:'rooms',presets:[],...(this.sharedPlan?{room_order:reconcileOrder(this.roomOrder,this.rooms.map(room=>room.id))}:{}),rooms:roomsPayload(this.startPlan()),setup:{} as ManualSetup,map_id:this.caps?.current_map}
      : {source:'manual',presets:[],...(this.sharedPlan?{room_order:reconcileOrder(this.roomOrder,this.rooms.map(room=>room.id))}:{}),rooms:[...this.manualSelected],setup:{...this.planCommonSetup},map_id:this.caps?.current_map};
  }
  private get planChanged() { return planKey(this.draftPlan(),this.caps)!==planKey(this.savedPreset,this.caps); }
  private get canSavePreset() { return !this.queueDraft && !!this.hass?.services?.robot_cleaner_queue?.save_preset && !this.blocked && !this.queueActive && !this.jobActive && this.manualReady && (this.sharedPlan||this.manualSelected.length>0) && this.validSelection && this.planChanged; }
  private async savePreset() {
    if (!this.canSavePreset || !this.hass || !this.config || this.sortOrder || (this.sharedPlan && this.preferencesDirty)) return;
    const plan=this.draftPlan(), vacuum=this.config.entity, epoch=this.configEpoch;
    this.savingPreset=true; this.commandError=''; this.presetFeedback=''; this.autoSaveError='';
    try {
      await this.hass.callService('robot_cleaner_queue','save_preset',{vacuum,source:plan.source,rooms:plan.rooms,setup:plan.setup,...(plan.room_order?{room_order:plan.room_order}:{}),...(this.savedPreset?.revision!==undefined || this.caps?.saved_plan_revision!==undefined ? {revision:this.planBaseRevision}: {})});
      if (this.config?.entity!==vacuum || this.configEpoch!==epoch) return;
      this.savedPreset=plan; this.planDraftTouched=false; this.loadedPlanSignature='';
      this.presetFeedback=this.sharedPlan?'':'Plan saved for the wall switch.';
      await this.readCapabilities();
    } catch(error) {
      if (this.config?.entity!==vacuum || this.configEpoch!==epoch) return;
      const message=error instanceof Error ? error.message : 'Could not save the plan. Your previous plan is unchanged.';
      this.commandError=this.schemaHint(message,plan.source==='rooms');
      if(this.sharedPlan)this.autoSaveError=this.commandError;
    } finally { if (this.configEpoch===epoch) this.savingPreset=false; }
  }
  private schedulePlanSave() {
    // A dashboard navigation must not discard the user's edits during debounce.
    // These writes persist settings only; physical cleaning always needs a click.
    // setConfig still cancels pending writes when this card changes robots.
    if(this.sharedPlan && this.preferencesDirty) {
      if(this.preferencesSaveError || this.blocked || this.queueActive || this.jobActive || this.sortOrder || !this.caps?.supported || !this.hass?.services?.robot_cleaner_queue?.save_preferences)return;
      const key=JSON.stringify(['preferences',this.setup,this.roomSetups]);
      if(key===this.autoSaveKey)return;
      clearTimeout(this.autoSaveTimer);this.autoSaveKey=key;
      this.autoSaveTimer=setTimeout(()=>{this.autoSaveKey='';if(!this.preferencesSaveError)void this.savePreferences();},300);
      return;
    }

    if(!this.sharedPlan || !this.planDraftTouched || !this.planChanged || this.autoSaveError || !this.canSavePreset || this.sortOrder)return;
    const key=planKey(this.draftPlan(),this.caps);
    if(key===this.autoSaveKey)return;
    clearTimeout(this.autoSaveTimer);this.autoSaveKey=key;
    this.autoSaveTimer=setTimeout(()=>{this.autoSaveKey='';if(this.sharedPlan&&!this.autoSaveError)void this.savePreset();},300);
  }
  private preloadPlan() {
    if (!this.savedPreset || !this.caps?.supported || this.queueActive || this.jobActive || this.request || this.queueDraft) return;
    const signature=JSON.stringify([this.savedPreset.revision ?? 0,this.savedPreset,this.caps.current_map]);
    if (signature===this.loadedPlanSignature) return;
    if (this.planDraftTouched && this.planChanged) {
      if ((this.savedPreset.revision ?? 0)!==this.planBaseRevision) this.presetFeedback='Plan changed elsewhere. Reload before saving.';
      return;
    }
    this.loadPreset(true);
  }
  private loadPreset(automatic=false) {
    const plan=this.savedPreset;
    if (!plan || (!automatic && this.blocked) || this.queueActive || this.jobActive || this.queueDraft) return;
    const fail=(message:string)=>{ this.presetFeedback=message; };
    if (!this.caps?.supported) return;
    if (plan.map_id!==undefined && plan.map_id!==this.caps.current_map) { fail('Saved plan belongs to another map. Select that map to load it.'); return; }
    if (plan.source==='rooms' && plan.rooms.every(room=>typeof room==='object' && room!==null)) {
      const entries=plan.rooms as SavedRoom[];
      if ((!entries.length&&!plan.room_order) || !this.roomMode || new Set(entries.map(room=>room.id)).size!==entries.length || entries.some(entry=>!this.robotRooms.some(room=>room.id===entry.id))) { fail('A saved room is no longer on the robot’s current map. Review and save a new plan.'); return; }
      const setups: Record<string,ManualSetup> = {};
      for (const entry of entries) {
        const frozen={...plan.setup,...entry};
        if (!matchesSetup(this.caps,frozen)) { fail('Saved plan has settings the robot no longer offers. Review and save a new plan.'); return; }
        setups[entry.id]=savedRoomSetup(this.caps,frozen,normalizeSetup(this.caps,plan.setup));
      }
      this.planSetups=setups; this.manualSelected=entries.map(entry=>entry.id);
      this.source='rooms';
    } else if (plan.source==='manual' || (plan.source==='rooms' && plan.rooms.every(room=>typeof room==='string'))) {
      const areas=plan.rooms.filter((room):room is string=>typeof room==='string');
      if (this.roomMode || (!areas.length&&!plan.room_order) || areas.length!==plan.rooms.length || new Set(areas).size!==areas.length || (areas.length>0&&!matchesSetup(this.caps,{id:'',...plan.setup})) || areas.some(id=>!this.caps!.room_targets.some(room=>room.id===id))) { fail('Saved area plan cannot be loaded here. Choose current rooms and save a new plan.'); return; }
      // Legacy area plans have a common setup, independent from shared defaults.
      this.planSetups=Object.fromEntries(areas.map(id=>[id,normalizeSetup(this.caps!,plan.setup)]));
      this.manualSelected=areas; this.source='manual';
    } else { fail('Saved Roborock routines are retired. Choose rooms and save a new plan.'); return; }
    this.roomOrder=reconcileOrder(plan.room_order??this.manualSelected,this.rooms.map(room=>room.id));
    this.planBaseRevision=plan.revision ?? 0;
    this.loadedPlanSignature=JSON.stringify([plan.revision ?? 0,plan,this.caps.current_map]);
    this.planDraftTouched=false; this.planEdited=true; this.commandError=''; this.autoSaveError=''; this.autoSaveKey='';
    if (!automatic) this.presetFeedback='Saved plan restored.';
  }
  private get historyKey() {
    // The queue is global; its current owner may be another vacuum. History is
    // independently scoped by the read-only API's configured vacuum argument.
    const entity=this.entity(this.config?.queue_entity);
    return `${this.config?.entity}:${this.config?.queue_entity}:${entity?.attributes.history_revision ?? ''}`;
  }
  private get historySupported() {
    return available(this.entity(this.config?.queue_entity)) && this.entity(this.config?.queue_entity)?.attributes.run_history_version===1 && !!this.hass?.services?.robot_cleaner_queue?.get_history && !!this.hass.callWS;
  }
  private async readHistory(force=false) {
    if(!this.historySupported || this.historyLoading || !this.config || !this.hass?.callWS || (!force&&this.historyFor===this.historyKey)) return;
    const key=this.historyKey,epoch=this.configEpoch,vacuum=this.config.entity,request=++this.historyRequest;
    this.historyFor=key;this.historyLoading=true;this.historyError='';
    try {
      const result=await this.hass.callWS<{response:{history_revision:number;last_run:unknown;previous_runs:unknown[]}}>({type:'call_service',domain:'robot_cleaner_queue',service:'get_history',service_data:{vacuum},return_response:true});
      if(epoch!==this.configEpoch || request!==this.historyRequest || key!==this.historyKey) return;
      if(!result?.response || !Number.isInteger(result.response.history_revision) || !Array.isArray(result.response.previous_runs) || !('last_run' in result.response)) throw new Error('The companion returned an incomplete activity record.');
      const records=cleaningRuns({state:'idle',attributes:{run_history_version:1,...result.response}},vacuum);
      if([result.response.last_run,...result.response.previous_runs].filter(Boolean).length!==records.length) throw new Error('Some sequence activity could not be verified.');
      this.historyRecords=records;
    } catch(error) {
      if(epoch===this.configEpoch && request===this.historyRequest && key===this.historyKey) this.historyError=error instanceof Error?error.message:'Sequence activity could not be refreshed.';
    } finally {
      if(epoch===this.configEpoch && request===this.historyRequest) {
        this.historyLoading=false;
        if(key!==this.historyKey) void this.readHistory();
      }
    }
  }
  private get selectedRooms() { return this.selection.map(id => this.rooms.find(room => room.id === id)).filter((room):room is RoomConfig => !!room); }
  private get showCommitted() { return !!this.queueDraft || this.queueActive && (this.queuePresets.length > 0 || this.queueManual); }

  protected updated(changed: PropertyValues) {
    this.schedulePlanSave();
    if(changed.has('hass'))this.confirmQueueEdit();
    if(this.sortOrder && !this.canArrangeRooms)this.cancelSort();
    if (changed.has('hass') || changed.has('config')) {
      if(this.historyOnline && !this.historySupported) this.historyFor='';
      this.historyOnline=this.historySupported;
      void this.readHistory();
    }
    if (changed.has('hass')) {
      const revision=this.entity(this.config?.queue_entity)?.attributes.preferences_revisions?.[this.config?.entity ?? ''];
      const savedRevision=this.entity(this.config?.queue_entity)?.attributes.saved_plan_revisions?.[this.config?.entity ?? ''];
      if (this.caps && typeof savedRevision==='number' && savedRevision!==this.savedPlanFetchedRevision && !this.savingPreset) this.requestCapabilitiesRefresh();
      if (this.caps && typeof revision==='number' && revision!==this.preferencesFetchedRevision && !this.savingPreferences) this.requestCapabilitiesRefresh();
      const mapId=this.caps?.device_entities?.selected_map;
      const value=mapId?this.entity(mapId)?.state:undefined;
      if(this.mapState!==undefined && value!==undefined && value!==this.mapState) this.requestCapabilitiesRefresh();
      this.mapState=value;
      clearTimeout(this.barrierTimer);
    }
    if(this.isConnected && this.barrierActive) {
      clearTimeout(this.barrierTimer);
      this.barrierTimer=setTimeout(()=>this.requestUpdate(),Math.min(60000,Math.max(1,this.barrierUntil*1000-Date.now())));
    }

    // The service that answers get_capabilities decides the tile model, so ask for it
    // whenever it exists instead of guessing from the queue version.
    if (changed.has('hass') && this.capsFor!==this.config?.entity
        && (this.modernController || !!this.hass?.services?.robot_cleaner_queue?.get_capabilities)) void this.readCapabilities();
    if (changed.has('hass') && this.queueActive) { this.planEdited=false; this.planDraftTouched=false; this.loadedPlanSignature=''; this.source=this.queueRooms||this.queueManual?'manual':'preset'; }
    if (changed.has('hass') && !this.queueActive && this.roomMode && this.source!=='rooms') { this.source='rooms'; this.selected=[]; }
    if (changed.has('hass') && this.queueActive && this.queueManual && this.capsFor!==this.config?.entity) void this.readCapabilities();
    if (changed.has('hass') && !this.queueActive) this.preloadPlan();
    if (!changed.has('hass') || !this.request) return;
    const kind = this.request.kind;
    const acknowledged = kind === 'cancel' ? ['idle','cancelled'].includes(this.phase) : kind === 'start_manual' ? this.queueActive || this.phase === 'attention' && (this.request.phase!=='attention' || !!this.queue?.attributes.run_id && this.queue.attributes.run_id!==this.request.runId)
      : kind === 'stop' ? this.entity(this.config?.cleaning_entity)?.state==='off' && ['idle','docked'].includes(this.vacuum?.state??'')
      : kind === 'pause' ? this.vacuum?.state === 'paused' || this.phase === 'paused'
      : kind === 'resume' || kind==='resume_now' ? this.vacuum?.state === 'cleaning' && !this.dockServicing
      : kind === 'continue_sequence' ? this.phase!=='attention' && this.queue?.attributes.run_id===this.request.runId
      : kind === 'return_to_dock' ? ['returning','docked'].includes(this.vacuum?.state ?? '')
      : false;
    if (acknowledged) {
      clearTimeout(this.requestTimer); this.request = undefined;
      if (this.queueActive && kind === 'start_manual') { this.manualSelected=[]; this.source = this.roomMode ? 'rooms' : 'manual'; }
      this.feedback = '';
    }
  }

  private toggleRoom(room: RoomConfig) {
    if(!this.queueDraft && this.queueEditSupported && this.canArrangeRoom(room.id))this.beginQueueEdit();
    if(this.queueDraft) {
      const selected=this.queueDraft.selected;
      const known=this.queueDraft.pending.some(item=>item.id===room.id);
      if(!this.canChangeQueueDraft || this.queueDraft.protectedIds.includes(room.id) || !selected.includes(room.id)&&(!this.roomAvailable(room) || !known&&!this.caps?.supported))return;
      this.queueDraft={...this.queueDraft,selected:selected.includes(room.id)?selected.filter(id=>id!==room.id):[...selected,room.id]};
      this.queueEditMessage='';
      return;
    }
    if (this.queueActive || this.jobActive || this.blocked || (!this.selection.includes(room.id) && !this.roomAvailable(room))) return;
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
      resume_now: 'Waiting for the robot to leave the charging break…',
      continue_sequence: 'Continuing the retained sequence…',
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
  /** Only an explicit room/area selection can start a cleaning plan. */
  private async startClean() {
    const rooms = this.roomMode ? roomsPayload(this.startPlan()) : [...this.manualSelected];
    if (!rooms.length || !this.companionReady) throw new Error('Select available rooms before starting.');
    await this.hass!.callService('robot_cleaner_queue','control',{command:'start_manual',vacuum:this.config!.entity,rooms,setup:this.roomMode?{}:{...this.planCommonSetup}});
  }
  private async continueRetained() {
    if (!this.continuationReady || this.dispatchBlocked || !this.recoveryContext) return;
    if (!this.waterRefillConfirmation) { await this.command('continue_sequence'); return; }
    this.recoveryPrompt={kind:'refill',...this.recoveryContext,action:this.continuationAction};
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLDialogElement>('.recovery-dialog')?.showModal();
  }
  private closeRecoveryPrompt() {
    const action=this.recoveryPrompt?.kind==='restart'?'resume-after-restart':'continue-sequence';
    this.recoveryPrompt=undefined;
    this.renderRoot?.querySelector<HTMLDialogElement>('.recovery-dialog')?.close();
    this.renderRoot?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.focus();
  }
  private async confirmWaterRefilled() {
    const prompt=this.recoveryPrompt,context=this.recoveryContext;
    this.closeRecoveryPrompt();
    if (prompt?.kind!=='refill' || prompt.runId!==context?.runId || prompt.index!==context.index || prompt.action!==this.continuationAction) {
      this.commandError='The sequence changed. Review the current pass before continuing.'; return;
    }
    await this.command('continue_sequence',true);
  }
  private async resumeAfterRestart() {
    if (!this.restartResumeReady || this.dispatchBlocked || !this.recoveryContext) return;
    this.recoveryPrompt={kind:'restart',...this.recoveryContext,action:'resume_now',token:this.restartResumeToken};
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLDialogElement>('.recovery-dialog')?.showModal();
  }
  private async confirmRestartResume() {
    const prompt=this.recoveryPrompt,context=this.recoveryContext;
    this.closeRecoveryPrompt();
    if (prompt?.kind!=='restart' || prompt.runId!==context?.runId || prompt.index!==context.index || !prompt.token || prompt.token!==this.restartResumeToken || !this.restartResumeReady) {
      this.commandError='The robot or sequence changed. Review its current state before resuming.'; return;
    }
    await this.command('resume_now',false,prompt.token);
  }
  private async command(kind: 'start_manual'|'pause'|'resume'|'return_to_dock'|'cancel'|'stop'|'continue_sequence'|'resume_now',waterRefilled=false,recoveryToken?:string) {
    if (!this.hass || !this.config) return;
    if(kind==='start_manual'&&this.sharedPlan&&this.preferencesDirty) {
      clearTimeout(this.autoSaveTimer);this.autoSaveKey='';
      await this.savePreferences();
      if(this.preferencesDirty || this.preferencesSaveError)return;
    }
    if(kind==='start_manual'&&this.sharedPlan&&this.planDraftTouched&&this.planChanged) {
      clearTimeout(this.autoSaveTimer);this.autoSaveKey='';
      await this.savePreset();
      if(this.autoSaveError || this.planChanged)return;
    }
    if (kind==='cancel' && this.request?.kind==='cancel') return;
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
    if (kind==='return_to_dock' && !this.canReturnToDock) return;
    if (this.restartRecovering && !['cancel','stop','return_to_dock'].includes(kind) && !(kind==='resume_now' && recoveryToken===this.restartResumeToken && this.restartResumeReady)) return;
    if (kind==='resume' && this.restartRecordPending) return;
    // Recovery eligibility belongs to the companion; never turn it into a generic
    // vacuum.start fallback or replace the retained room plan from the browser.
    if (kind==='continue_sequence' && (!this.continuationReady || !this.hass.services?.robot_cleaner_queue?.control)) return;
    if (kind==='continue_sequence' && this.waterRefillConfirmation && !waterRefilled) return;
    if (kind==='resume_now' && (!(recoveryToken?this.restartResumeReady&&recoveryToken===this.restartResumeToken:this.resumeNowReady) || !this.hass.services?.robot_cleaner_queue?.control)) return;
    if (kind === 'start_manual') {
      if (!this.canStart || !this.manualSelected.length || !this.validSelection) return;
      const plan = this.startPlan();
      if (this.roomMode && !plan.length) return;
      if (this.selection.length && (this.selectedRooms.length !== this.manualSelected.length || this.selectedRooms.some(room => !this.roomAvailable(room)))) return;
      if (!this.companionReady) {
        this.commandError = 'Room cleaning needs the updated Home Assistant queue companion.';
        return;
      }
    }
    this.commandError = ''; this.feedback = this.waitingText(kind);
    this.request = {kind,since:Date.now(),phase:this.phase,runId:this.queue?.attributes.run_id};
    clearTimeout(this.requestTimer);
    const pendingRequest = this.request, epoch=this.configEpoch;
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
      } else if (this.queueActive || ['cancel','continue_sequence','resume_now'].includes(kind) || (['pause','resume','return_to_dock','stop'].includes(kind) && this.queueReady && (this.config.require_queue || !!this.hass.services?.robot_cleaner_queue?.control))) {
        const variables: Record<string,unknown> = {command:kind,vacuum:this.config.entity};
        if (kind==='continue_sequence'||kind==='resume_now') {
          variables.run_id=this.recoveryContext!.runId;
          variables.current_index=this.recoveryContext!.index;
          if (kind==='continue_sequence'&&waterRefilled) variables.water_refilled=true;
          if (kind==='resume_now'&&recoveryToken) variables.recovery_token=recoveryToken;
        }
        for (const key of Object.keys(variables)) if (variables[key] === undefined) delete variables[key];
        if (this.hass.services?.robot_cleaner_queue?.control) await this.hass.callService('robot_cleaner_queue','control',variables);
        else await this.hass.callService('script','turn_on',{entity_id:this.config.queue_script,variables});
      } else {
        const action = {pause:'pause',resume:'start',return_to_dock:'return_to_base',stop:'stop',cancel:undefined,start_manual:undefined,continue_sequence:undefined,resume_now:undefined}[kind];
        if (!action) throw new Error('Unsupported command.');
        await this.hass.callService('vacuum',action,{entity_id:this.config.entity});
      }
      // Cancel only clears the shared plan: successful service completion is its
      // acknowledgement. It has no physical action to wait 90 seconds for.
      if (kind==='cancel' && this.configEpoch===epoch && this.request===pendingRequest) {
        clearTimeout(this.requestTimer); this.request=undefined; this.feedback='Stopped sequence cleared. Your saved plan is unchanged.';
        this.preloadPlan();
      }
    } catch(error) {
      if (this.configEpoch!==epoch || this.request!==pendingRequest) return;
      clearTimeout(this.requestTimer); this.request = undefined; this.feedback = '';
      const message = error instanceof Error ? error.message : 'The command could not be sent.';
      this.commandError = this.schemaHint(message, kind==='start_manual' && this.roomMode);
    }
  }

  private headline(): string {
    if (!this.robotReady) return 'Robot unavailable';
    if (this.observingRetainedJob) {
      if (this.dockService) return this.dockService;
      if (this.vacuum?.state==='cleaning') return `${this.stages[this.index]?.mode==='vacuum'?'Vacuuming':this.stages[this.index]?.mode==='mop'?'Mopping':'Cleaning'} ${this.stageName}`;
      if (this.vacuum?.state==='returning') return 'Returning to dock';
    }
    if (this.fault) return this.waterEmpty && this.fault==='Water empty' ? 'Dock needs water' : 'Needs attention';
    if (this.restartRecovering) {
      if (this.dockService) return this.dockService;
      if (this.vacuum?.state==='cleaning') return 'Cleaning in progress';
      if (this.vacuum?.state==='paused') return 'Cleaning paused';
      if (this.vacuum?.state==='returning' || returningToDock(this.dockStatus)) return 'Returning to dock';
      if (this.vacuum?.state==='docked') return this.dockStatus==='charging'?'Charging':'At the dock';
      return 'Restoring sequence';
    }
    if (this.continuationSupported && !this.dockServicing && this.vacuum?.state!=='cleaning') return 'Sequence paused';
    if (this.phase === 'attention' && !this.recoveryReady && !this.jobActive && !this.dockServicing) return 'Sequence stopped';
    if (this.phase === 'controlling') return this.queue?.attributes.mode === 'finish' ? 'Finishing cleaning' : 'Waiting for the robot';
    if (this.startUncertain) return 'Waiting for cleaning to start';
    if (this.phase === 'finishing') {
      if (this.dockService) return this.dockService;
      if (this.vacuum?.state==='returning' || returningToDock(this.dockStatus)) return 'Returning to dock';
      return 'Finishing at the dock';
    }
    if (this.dockService) return this.dockService;
    if (this.chargingBreak) return 'Charging to continue';
    if (this.phase === 'preparing') return 'Applying cleaning settings';
    if (this.request?.kind === 'start_manual') return 'Starting your clean';
    if (this.phase === 'starting') return ['resume','resume_now'].includes(this.queue?.attributes.pending_command)?'Resuming current pass':'Starting your sequence';
    if (this.vacuum?.state === 'paused') return 'Cleaning paused';
    if (this.vacuum?.state === 'returning') return 'Returning to dock';
    const status = this.dockStatus;
    if (status && !passiveMopDrying(status) && /wash|empty|charging_complete|charging|docking|going_to/.test(status)) {
      if (this.queueActive && /charg/.test(status)) return 'Waiting at the dock';
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
    if (this.phase === 'completed' && (this.showCommitted || this.floorCleaningComplete && this.dockDrying)) return 'Your rooms are clean';
    return this.waterAllowed && this.manual ? 'Ready to vacuum' : 'Ready to clean';
  }
  private subline(): string {
    if (this.restartRecovering) return this.restartRecoveryReason;
    if (!this.robotReady) return 'Waiting for Home Assistant to reconnect.';
    if (this.observingRetainedJob) return 'The robot continued. Reconnect the sequence to keep the remaining rooms.';
    if (this.fault) return this.waterEmpty && this.fault==='Water empty' ? this.continuationSupported?'Refill the clean-water tank. Your sequence is kept.':'A vacuum-only plan can run. Mopping needs water.' : this.fault;
    if (this.continuationSupported && !this.dockServicing && this.vacuum?.state!=='cleaning') return 'Your rooms and completed passes are kept.';
    if (this.phase==='attention' && !this.jobActive && !this.dockServicing) return this.recoveryReady ? 'Ready for a new clean.' : this.recoveryReason;
    if (this.phase === 'controlling') return this.queue?.attributes.mode === 'finish' ? 'Remaining rooms cancelled · Returning to dock for care' : 'Confirming your command · No retry will be sent';
    if (this.startUncertain) return 'The start request may have reached the robot. Waiting for confirmation; it will not be sent again.';
    if (this.phase==='finishing') {
      const count=this.queueTargets.length;
      const complete=count ? `${count} ${count===1?'room':'rooms'} cleaned` : 'Floor cleaning complete';
      if (this.dockService) return `${complete} · Final dock care in progress`;
      if (this.vacuum?.state==='returning' || returningToDock(this.dockStatus)) return `${complete} · Returning for dock care`;
      return `${complete} · Confirming the robot is settled at the dock`;
    }
    if (this.phase==='completed' && this.floorCleaningComplete && this.dockDrying) return 'Cleaning is complete. Mops are drying at the dock.';
    if (this.chargingBreak) return `${this.stageName} · ${this.passLabel} paused for charging`;
    if (!this.queueActive && this.dockService) return 'Dock care is in progress. Cleaning can start when it finishes.';
    if (this.queueActive && this.queueManual) {
      if (this.dockService) return `Next: ${this.stageName}`;
      if (this.phase === 'preparing' && this.queue?.attributes.pending_command === 'configure') {
        const requested = this.queue.attributes.requested_settings;
        const observed = this.queue.attributes.robot_settings;
        if (requested && observed) {
          const label = (value: unknown) => value === 'max_plus' ? 'Max+' : typeof value === 'string' ? humanize(value) : 'Unavailable';
          const pending = ['mode', 'suction', 'water', 'route'].filter(key => typeof requested[key] === 'string' && requested[key] !== observed[key]);
          if (pending.length) return pending.map(key => `${humanize(key)}: ${label(requested[key])} requested · ${label(observed[key])} reported`).join('; ');
          return 'Settings confirmed · Waiting for the robot to be ready';
        }
      }
      if (this.queue?.attributes.waiting_for_dock) return `Next: ${this.stageName} · Waiting for the dock`;
      const stage=this.stages[this.index];
      const label=stage?.mode==='vacuum'?'Vacuum pass':stage?.mode==='mop'?'Mop pass':'Vacuum & mop';
      return `${label} · ${this.queueTargets.length ? `${this.queueRooms?'Room':'Area'} ${(stage?.room_index ?? 0)+1} of ${this.queueTargets.length}` : 'Whole home'}${this.activeSetup.repeat>1 ? ` · Run ${(stage?.repeat_index ?? 0)+1} of ${this.activeSetup.repeat}` : ''}`;
    }
    if (this.queueActive && this.queue?.attributes.waiting_for_dock) return `Next: ${this.rooms.find(room => room.preset === this.queuePresets[this.index])?.name ?? 'next preset'} · Waiting for the dock`;
    if (this.queueActive) return `Room ${Math.min(this.index+1,this.queuePresets.length)} of ${this.queuePresets.length}`;
    if (this.jobActive) return this.vacuum?.state === 'paused' ? 'Resume when you are ready, or send the robot home.' : 'Started outside this sequence';
    if (this.phase === 'completed' && this.showCommitted) { const count=this.queueTargets.length; return `${count||this.completed} ${count?(count===1?'room':'rooms'):'cleaning stages'} completed${this.vacuum?.state==='docked'?' · At the dock':''}`; }
    if (this.dockDrying && !this.dockServicing) return `Mops are drying at the dock${this.selection.length ? ` · ${this.selection.length} ${this.selection.length===1?'room':'rooms'} selected` : ' · Ready for another clean'}`;
    if (this.selection.length) return `${this.selection.length} ${this.selection.length === 1 ? 'room' : 'rooms'} selected`;
    return this.vacuum?.state === 'docked' ? 'At the dock · Select rooms to clean' : 'Select rooms to clean';
  }
  private renderRecovery() {
    if (this.phase!=='attention') return nothing;
    const failed=this.queue?.attributes.error;
    if (this.continuationSupported) {
      const description=this.continuationAction==='retry_stage'
        ? `${this.stageName} · ${this.passLabel}. This unconfirmed pass will run again; completed passes stay done.`
        : this.continuationAction==='resume_job'?`Resume the robot’s unfinished pass in ${this.stageName}. Completed passes stay done.`
        : this.continuationAction==='resume_observation'?`The robot is already working on ${this.stageName}. Continue tracking this pass and the remaining rooms without restarting it.`
        : this.continuationAction==='continue_next'?`Continue with ${this.stageName}. Completed passes stay done.`
        : this.continuationAction==='finish_docking'?'Floor cleaning is complete. Confirm the remaining dock care.'
        : 'Your sequence and completed passes are kept.';
      const blocked=this.dispatchBlocked || !this.robotReady || !this.queueReady || !this.hass?.services?.robot_cleaner_queue?.control || !this.continuationReady;
      return html`<section class="recovery-note" aria-label="Retained cleaning sequence"><div class="recovery-heading"><strong>${this.observingRetainedJob?'Sequence tracking paused':'Continue this sequence'}</strong><span>${this.completed} / ${this.stages.length} passes done</span></div><p>${description}</p>
        <button class="action primary" data-action="continue-sequence" ?disabled=${blocked} @click=${()=>this.continueRetained()}>${icon(this.continuationAction==='retry_stage'?'mdi:restart':'mdi:play')}${this.request?.kind==='continue_sequence'?'Continuing…':this.continuationLabel}</button>
        ${!this.continuationReady?html`<p class="recovery-hint" role="status">${this.continuationReason}</p>`:nothing}
        ${this.continuationReady&&this.barrierActive?html`<p class="recovery-hint" role="status">${this.barrierNotice}</p>`:nothing}
        ${failed?html`<details class="recovery-details"><summary>Interruption details</summary><p>${failed}</p></details>`:nothing}
        <button class="text-button" data-action="clear-queue" ?disabled=${!this.queueReady || !!this.request} @click=${()=>this.command('cancel')}>${icon('mdi:close-circle-outline')}Clear sequence</button><p class="recovery-hint">Clearing keeps recorded activity and your saved plan. It does not stop or move the robot.</p></section>`;
    }
    return html`<section class="recovery-note" aria-label="Previous cleaning sequence"><div class="recovery-heading"><strong>Previous sequence stopped</strong><span>${this.completed} of ${this.stages.length || this.queueTargets.length || 0} passes completed</span></div>${failed ? html`<p>${failed}</p>`:nothing}<button class="${this.recoveryReady?'text-button':'action primary'}" data-action="clear-queue" ?disabled=${!this.queueReady || this.request?.kind==='cancel'} @click=${()=>this.command('cancel')}>${icon('mdi:close-circle-outline')}${this.request?.kind==='cancel'?'Clearing…':'Clear stopped sequence'}</button><p class="recovery-hint">${this.historySupported?'Clearing releases the stopped queue. Recorded activity and your saved plan are kept; the robot does not move.':'Clearing dismisses this run. It does not move the robot or change your saved plan.'}</p></section>`;
  }
  private renderActions() {
    if (this.phase==='finishing') return nothing;
    const busy = this.dispatchBlocked || !this.robotReady || ((this.queueActive || this.config?.require_queue) && !this.queueReady);
    const waiting = this.barrierActive && !this.blocked ? this.barrierNotice : 'Waiting…';
    const dockAction=(primary=false)=>this.canReturnToDock ? html`<button class="action ${primary?'primary':'secondary'}" data-action="dock" ?disabled=${busy} @click=${()=>this.command('return_to_dock')}>${icon('mdi:home-import-outline')}Return to dock</button>`:nothing;
    // Retained plans have their own recovery action. Getting an idle robot home
    // remains independent of whether that plan can start or continue.
    if (!this.jobActive && (this.continuationSupported || this.phase==='attention' && !this.recoveryReady)) {
      return this.canReturnToDock ? html`<div class="actions">${dockAction(true)}</div>`:nothing;
    }
    if (this.jobActive || this.queueActive) {
      const paused = this.vacuum?.state === 'paused' || this.phase === 'paused';
      const servicing = this.dockServicing;
      const canPause = !this.restartRecovering && !this.continuationSupported && (paused ? !this.restartRecordPending && this.feature(8192) && !this.chargingBreak : this.feature(4) && this.vacuum?.state === 'cleaning' && !servicing);
      return html`<div class="actions">
        ${this.restartResumeSupported?html`<button class="action primary" data-action="resume-after-restart" ?disabled=${busy || !this.restartResumeReady || !this.hass?.services?.robot_cleaner_queue?.control} @click=${()=>this.resumeAfterRestart()}>${icon('mdi:play')}${this.request?.kind==='resume_now'?'Resuming…':this.vacuum?.state==='docked'?'Continue now':'Resume robot'}</button>`:nothing}
        ${this.resumeNowSupported?html`<button class="action primary" data-action="resume-now" ?disabled=${busy || !this.resumeNowReady || !this.hass?.services?.robot_cleaner_queue?.control} @click=${()=>this.command('resume_now')}>${icon('mdi:play')}${this.request?.kind==='resume_now'?'Continuing…':'Continue now'}</button>`:nothing}
        ${canPause ? html`<button class="action primary" data-action=${paused ? 'resume':'pause'} ?disabled=${busy || (paused && !this.feature(8192))} @click=${()=>this.command(paused ? 'resume':'pause')}>${icon(paused ? 'mdi:play':'mdi:pause')}${paused ? 'Resume':'Pause'}</button>`:nothing}
        ${dockAction(!canPause)}
        ${this.feature(8) && this.modernController && !servicing ? html`<button class="action secondary" data-action="stop" ?disabled=${busy} @click=${()=>this.command('stop')}>${icon('mdi:stop')}${this.chargingBreak?'Stop sequence':'Stop'}</button>`:nothing}
      </div>${this.restartResumeSupported&&!this.restartResumeReady&&this.queue?.attributes.restart_resume_reason?html`<p class="hint" role="status">${this.queue.attributes.restart_resume_reason}</p>`:nothing}${this.resumeNowSupported&&!this.resumeNowReady&&this.queue?.attributes.resume_now_reason?html`<p class="hint" role="status">${this.queue.attributes.resume_now_reason}</p>`:nothing}${this.barrierActive && !this.blocked ? html`<p class="hint" role="status">${this.barrierNotice}</p>`:nothing}`;
    }
    const selected = this.selection.length;
    const selectedAvailable = this.selectedRooms.every(room=>this.roomAvailable(room));
    const startable = this.companionReady && this.validSelection;
    const disabled = !selected || !this.canStart || !startable || (this.manual && !this.manualReady)
      || (selected > 0 && (!selectedAvailable || this.selectedRooms.length !== this.manualSelected.length));
    return html`<div class="actions"><button class="action primary" data-action="start" ?disabled=${disabled} @click=${()=>this.command('start_manual')}>${icon('mdi:play')}${this.dispatchBlocked ? waiting : this.dockServicing ? 'Waiting for dock care' : selected>1 ? `Start sequence · ${selected} rooms` : selected===1 ? 'Clean 1 room' : 'Select rooms to clean'}</button>${dockAction()}</div>`;
  }
  private async openPanel(panel:DevicePanel) {
    this.panel=panel; this.commandError=''; await this.updateComplete;
    this.renderRoot.querySelector<HTMLDialogElement>('.device-dialog')?.showModal();
    await this.readCapabilities();
  }
  private closePanel() { this.renderRoot.querySelector<HTMLDialogElement>('.device-dialog')?.close(); this.panel=undefined; }
  private async deviceCommand(control:string,value:string|number='') {
    if (!this.hass || !this.config || this.deviceSending || (control!=='locate' && (this.blocked || this.queueActive))) return;
    const epoch=this.configEpoch, vacuum=this.config.entity;
    this.deviceSending=true; this.commandError='';
    try { await this.hass.callService('robot_cleaner_queue','device_control',{vacuum,control,value}); if(this.configEpoch===epoch && control==='selected_map') await this.readCapabilities(); }
    catch(error) { if(this.configEpoch===epoch) this.commandError=error instanceof Error ? error.message : 'The device command failed.'; }
    finally { if(this.configEpoch===epoch) this.deviceSending=false; }
  }
  private renderUtilities() {
    if(!this.modernController || !this.hass?.services?.robot_cleaner_queue?.device_control) return nothing;
    const entities=this.caps?.device_entities??{};
    const panels: Array<[DevicePanel,string,string]>=[['dock','Dock','mdi:ev-station'],['map','Map','mdi:map-outline'],['settings','Settings','mdi:cog-outline'],['care','Care','mdi:tools'],['status','Details','mdi:information-outline']];
    const visiblePanels=panels.filter(([panel])=>panelKeys(panel,entities,this.hass!).length);
    const canLocate=this.feature(512);
    const count=visiblePanels.length+(canLocate?1:0);
    if (!count) return nothing;
    return html`<div class="utilities" role="group" aria-label="Robot tools" style=${`--utility-columns:${Math.min(3,count)};--utility-wide-columns:${count}`}>
      ${canLocate?html`<button class="setting-pill" data-action="locate" title="Play a sound to find the robot" ?disabled=${!this.robotReady || this.deviceSending} @click=${()=>this.deviceCommand('locate')}><ha-icon icon="mdi:volume-high" aria-hidden="true"></ha-icon><span>Find</span></button>`:nothing}
      ${visiblePanels.map(([panel,label,mdi])=>html`<button class="setting-pill" data-panel=${panel} aria-haspopup="dialog" aria-expanded=${this.panel===panel?'true':'false'} title=${panel==='dock'?'Dock controls':`Open ${label.toLowerCase()}`} @click=${()=>this.openPanel(panel)}><ha-icon .icon=${mdi} aria-hidden="true"></ha-icon><span>${label}</span></button>`)}
    </div>`;
  }
  private editSetup(id:string|undefined, patch:Partial<ManualSetup>) {
    if(this.queueDraft) {
      if(!id || !this.caps || !this.canChangeQueueDraft || this.queueDraft.protectedIds.includes(id))return;
      this.queueDraft={...this.queueDraft,setups:{...this.queueDraft.setups,[id]:normalizeSetup(this.caps,{...this.queueDraft.setups[id],...patch})}};
      this.queueEditMessage='';return;
    }
    if (!this.caps || this.queueActive || this.blocked || this.jobActive) return;
    this.planEdited=true; this.planDraftTouched=true; this.preferencesDirty=true; this.preferencesMessage=''; this.commandError=''; this.presetFeedback='';
    if (id) {
      this.roomSetups={...this.roomSetups,[id]:normalizeSetup(this.caps,{...this.setupFor(id),...patch})};
      const overlays={...this.planSetups}; delete overlays[id]; this.planSetups=overlays;
    } else {
      this.setup=normalizeSetup(this.caps,{...this.setup,...patch});
      if (!this.roomMode) this.planSetups={};
    }
  }
  private get canApplyDefaults() {
    if (!this.roomMode || !this.caps?.supported || this.queueActive || this.blocked || this.jobActive) return false;
    return this.robotRooms.some(room=>!!this.roomSetups[room.id] || !!this.planSetups[room.id]);
  }
  private applyDefaultsToRooms() {
    if (!this.canApplyDefaults) return;
    const overrides={...this.roomSetups}, overlays={...this.planSetups};
    for (const room of this.robotRooms) { delete overrides[room.id]; delete overlays[room.id]; }
    this.roomSetups=overrides; this.planSetups=overlays;
    this.planEdited=true; this.planDraftTouched=true; this.preferencesDirty=true;
    this.commandError=''; this.presetFeedback='';
    this.preferencesMessage=`Defaults applied to ${this.robotRooms.length} rooms on this map.`;
    this.feedback=this.preferencesMessage;
  }
  private renderPreferences() {
    const canSave=!!this.hass?.services?.robot_cleaner_queue?.save_preferences;
    const dirty=this.preferencesDirty||this.savingPreferences;
    const save=()=>html`<button class="action" data-action="save-preferences" title="Save shared defaults and room settings for everyone" ?disabled=${this.blocked||!this.preferencesDirty||!this.caps?.supported} @click=${()=>this.savePreferences()}>${icon('mdi:content-save-outline')}${this.savingPreferences?'Saving…':'Save room settings'}</button>`;
    return html`<section class="surface preferences-panel" aria-label="Room defaults and shared settings">
      <details class="default-settings"><summary><span class="defaults-heading">${icon('mdi:tune-variant')}<span class="defaults-title">Room defaults</span><span class="defaults-mode">${setupSummary(this.setup)}</span>${icon('mdi:chevron-down')}</span></summary>
        ${this.caps?.supported ? renderRoomSettings({id:'defaults',name:'default settings',setup:this.setup,caps:this.caps,disabled:this.queueActive||this.blocked||this.jobActive,change:patch=>this.editSetup(undefined,patch)}):html`<p class="hint">${this.capsError||'Reading cleaning capabilities…'}</p>`}
        <div class="defaults-actions">${this.roomMode?html`<button class="action" data-action="apply-defaults" title="Replace custom settings for all rooms on the current map; keep the selected order" ?disabled=${!this.canApplyDefaults} @click=${()=>this.applyDefaultsToRooms()}>${icon('mdi:select-all')}Apply to all rooms</button>`:nothing}${canSave&&!dirty&&!this.sharedPlan?save():nothing}
          ${canSave?html`<button class="text-button" data-action="reload-preferences" ?disabled=${this.blocked||this.capsLoading} @click=${()=>this.reloadPreferences()}>Reload shared settings</button>`:nothing}
          <button class="text-button" data-action="refresh-rooms" ?disabled=${this.capsLoading||this.blocked} @click=${()=>this.readCapabilities()}>Refresh rooms</button></div>
        <p class="hint">${this.roomMode?'Apply to all replaces custom settings on this map. ':''}${this.sharedPlan?'Changes save automatically for everyone.':'Save room settings to share them. Save plan updates the wall switch.'}</p>
        ${!canSave?html`<p class="hint">Update the queue integration to save shared room settings.</p>`:nothing}
        ${this.caps?renderZoneReport(this.caps):nothing}
      </details>
      ${canSave&&dirty?html`<div class="preferences-toolbar" role="status"><span class="preferences-label">${this.sharedPlan?(this.preferencesSaveError?'Settings not saved':this.savingPreferences?'Saving…':'Changes pending'):'Unsaved room settings'}</span><div class="preferences-actions">${!this.sharedPlan?save():this.preferencesSaveError?html`<button class="text-button" @click=${()=>this.savePreferences()}>Retry</button><button class="text-button" @click=${()=>this.reloadPreferences()}>Reload shared settings</button>`:nothing}</div></div>`:nothing}
      ${this.preferencesMessage?html`<p class="hint" role="status">${this.preferencesMessage}</p>`:nothing}
    </section>`;
  }
  private displayedRoomSetup(id:string):ManualSetup {
    if(this.queueDraft && !this.queueDraft.protectedIds.includes(id))return this.queueDraft.setups[id]??this.setupFor(id);
    if (!this.showCommitted) return this.setupFor(id);
    const stored=this.queueRoomSetups.find(room=>room.id===id)?.setup;
    const common=this.queue?.attributes.setup;
    return stored?.mode ? stored : common?.mode ? common : this.setupFor(id);
  }
  private renderRoom(room: RoomConfig) {
    const committed = this.showCommitted;
    const draft=this.queueDraft;
    const protectedRoom=!!(draft?.protectedIds??(this.queueEditSupported?this.queueEditSnapshot?.protectedIds:[]))?.includes(room.id);
    const directEdit=!draft && this.queueEditSupported;
    const sequenceIds=draft?[...draft.protectedIds,...queueDraftRooms(draft).map(room=>room.id)]:this.queueTargets;
    const position = committed ? (this.manual || draft ? sequenceIds.indexOf(room.id) : this.queuePresets.indexOf(room.preset ?? '')) : this.selection.indexOf(room.id);
    const roomStages = this.stages.map((stage,index)=>({stage,index})).filter(item=>item.stage.target===room.id);
    const assigned = this.manual || draft ? this.queueTargets.includes(room.id) && roomStages.length>0 : this.queuePresets.includes(room.preset??'');
    const done = committed && assigned && position >= 0 && (this.manual || draft ? roomStages.every(item=>item.index<this.completed) : this.floorCleaningComplete || position < this.completed);
    const vacuumDone = committed && this.manual && this.activeSetup.mode==='vacuum_then_mop' && roomStages.some(item=>item.stage.mode==='vacuum' && item.index<this.completed);
    const active = committed && !this.floorCleaningComplete && (this.manual ? this.stages[this.index]?.target===room.id : position === this.index) && this.queueActive && !this.queue?.attributes.waiting_for_dock;
    const moving = active && !this.restartRecovering && !['preparing','starting'].includes(this.phase) && this.vacuum?.state === 'cleaning';
    const selected = position >= 0 && !done;
    const unavailable = !this.roomAvailable(room) && (!committed || !!draft&&!protectedRoom);
    const roomActivity = this.entity(room.activity_entity)?.state;
    const externalActive = !this.queueActive && ['cleaning','active','on'].includes(roomActivity ?? '') && this.vacuum?.state === 'cleaning';
    const glow = buildGlow(moving || externalActive ? BLUE:ACCENT,moving || externalActive ? 'pulse':'static',selected || moving || externalActive);
    const text = unavailable ? (this.manual ? 'Area unavailable':'Room unavailable') : done ? 'Completed' : active ? (this.restartRecovering?'Checking status':this.chargingBreak?'Charging':this.phase === 'preparing' ? 'Preparing…' : this.phase === 'starting' ? 'Starting…' : this.vacuum?.state === 'paused' ? 'Paused' : moving ? 'Cleaning':'In progress') : externalActive ? 'Cleaning' : vacuumDone && selected && this.queueActive ? 'Vacuumed · mop next' : selected ? (committed && ['cancelled','attention'].includes(this.phase) ? 'Not completed':committed?'Queued':'Selected') : draft?.pending.some(item=>item.id===room.id)?'Removed from queue':this.queueActive || draft ? 'Not in this clean' : 'Tap to select';
    const disabled = draft ? !this.canChangeQueueDraft || protectedRoom || !draft.selected.includes(room.id)&&(unavailable || !draft.pending.some(item=>item.id===room.id)&&!this.caps?.supported) : directEdit ? !this.canEditQueue || protectedRoom || unavailable || !this.queueTargets.includes(room.id)&&!this.caps?.supported : this.queueActive || this.jobActive || this.blocked || (unavailable && !this.selection.includes(room.id));
    const setup=this.displayedRoomSetup(room.id);
    const locked=draft?disabled:disabled||this.jobActive||this.showCommitted;
    return html`<div class="tile-wrap room-item" data-room-item=${room.id}><div class="glow-under" style=${glow.style}>${glow.overlay}</div><section class="surface room ${selected?'selected':''} ${moving||externalActive?'active':''} ${done?'done':''}">
      <div class="room-header">${!committed||(draft||directEdit)&&!protectedRoom?html`<button class="room-drag" data-drag-room=${room.id} aria-label=${`Move ${room.name}`} aria-describedby="room-reorder-help" ?disabled=${!this.canArrangeRoom(room.id)} @keydown=${(event:KeyboardEvent)=>this.reorderKey(event,room.id)}>${icon('mdi:drag-horizontal')}</button>`:nothing}
      <button class="room-select" data-room=${room.id} role="switch" aria-checked=${position>=0?'true':'false'} aria-label=${`${room.name}, ${text.toLowerCase()}${position>=0?`, position ${position+1}`:''}${protectedRoom?', protected from queue edits':''}`} ?disabled=${disabled} @click=${()=>this.toggleRoom(room)}><ha-icon class="room-icon" .icon=${room.icon??'mdi:floor-plan'}></ha-icon><span class="room-title"><span class="room-name">${room.name}</span>${!['Tap to select','Selected'].includes(text)?html`<span class="room-state">${text}</span>`:nothing}</span>${position>=0?html`<span class="order">${position+1}</span>`:nothing}${protectedRoom?html`<span class="room-protected" title="Started rooms keep all their passes">${icon(done?'mdi:check':'mdi:lock-outline')}</span>`:html`<span class="room-toggle ${position>=0?'on':''}" aria-hidden="true"><span></span></span>`}</button></div>
      <details class="room-inline" data-room-editor=${room.id}><summary aria-label=${`Settings for ${room.name}: ${settingsSummary(setup)}`}><span class="room-settings-summary">${renderSettingPills(setup)}</span><ha-icon class="settings-edit-icon" icon="mdi:tune-variant" aria-hidden="true"></ha-icon></summary>${this.caps?.supported?renderRoomSettings({id:room.id,name:room.name,setup,caps:this.caps,disabled:locked||!this.roomMode,change:patch=>this.editSetup(room.id,patch)}):nothing}${(this.roomSetups[room.id]||this.planSetups[room.id])&&!this.showCommitted?html`<button class="text-button" data-action="reset-room" data-room-id=${room.id} ?disabled=${locked} @click=${()=>{const next={...this.roomSetups};delete next[room.id];this.roomSetups=next;const overlays={...this.planSetups};delete overlays[room.id];this.planSetups=overlays;this.planEdited=true;this.planDraftTouched=true;this.preferencesDirty=true;this.preferencesMessage='';}}>Use defaults</button>`:nothing}</details>
    </section></div>`;
  }

  private renderQueueEditStatus() {
    const draft=this.queueDraft;
    if(!draft)return this.queueEditMessage?html`<p class="hint queue-edit-status" role="status">${this.queueEditMessage}</p>`:nothing;
    const stale=this.queueDraftStale;
    return html`<div class="queue-edit-status" role="status">
      <p>${this.savingQueue?this.queueEditMessage||'Updating the shared queue…':stale?'The sequence changed. Reload remaining rooms before applying your changes.':!this.canEditQueue?this.queueEditSnapshot?.reason||'Queue editing is temporarily unavailable.':queueDraftRooms(draft).length?`${queueDraftRooms(draft).length} rooms remaining · Started rooms keep all their passes.`:'No more rooms after the current room and its dock care.'}</p>
      ${!this.savingQueue&&this.queueEditMessage?html`<p class="error">${this.queueEditMessage}</p>`:nothing}
      ${!stale&&!this.validQueueDraft?html`<p class="error">A room or setting is unavailable. Remove it or refresh rooms before applying.</p>`:nothing}
      ${stale?html`<button class="text-button" data-action="reload-queue-edit" ?disabled=${!this.canEditQueue} @click=${()=>this.beginQueueEdit()}>Reload remaining</button>`:nothing}
    </div>`;
  }

  private metric(entityId: string | undefined, fallbackUnit: string) {
    const entity = this.entity(entityId); const value = numeric(entity);
    return value === undefined ? undefined : `${Math.round(value*10)/10} ${entity?.attributes.unit_of_measurement ?? fallbackUnit}`;
  }
  protected render() {
    if (!this.config || !this.hass) return nothing;
    const runs=this.entity(this.config?.queue_entity)?.attributes.run_history_version===1?this.historyRecords:cleaningRuns(this.queue,this.config.entity);
    const cleaning = this.vacuum?.state === 'cleaning' && !this.dockServicing && (!this.queueActive || !this.floorCleaningComplete);
    const rawBattery = this.config.battery_entity ? numeric(this.entity(this.config.battery_entity)) : Number(this.vacuum?.attributes.battery_level);
    const battery = Number.isFinite(rawBattery) && rawBattery! >= 0 && rawBattery! <= 100 ? Math.round(rawBattery!) : undefined;
    const rawProgress = numeric(this.entity(this.config.progress_entity));
    const progress = rawProgress === undefined ? undefined : Math.max(0,Math.min(100,rawProgress));
    const sequence = this.queueActive || (this.phase==='attention'&&(!this.jobActive||this.observingRetainedJob)) || (this.phase==='completed'&&!this.planDraftTouched&&!this.jobActive)
      ? sequenceProgress(this.queue,this.config.entity) : undefined;
    const sequenceLabel=this.restartRecovering?'Restoring sequence':this.phase==='attention'?(this.observingRetainedJob?'Retained sequence':this.continuationSupported?'Paused sequence':'Stopped sequence'):'Sequence progress';
    const area = this.metric(this.config.area_entity,'m²'); const time = this.metric(this.config.time_entity,'min');
    const glow = buildGlow(BLUE,'pulse',cleaning);
    return html`<div class="outer"><ha-card><div class="root">
      <div class="tile-wrap"><div class="glow-under" style=${glow.style}>${glow.overlay}</div><section class="surface hero" aria-label="Robot status">
        <div class="identity"><span class="robot-icon">${icon('mdi:robot-vacuum')}</span><div class="identity-text"><div class="name">${this.config.name ?? this.vacuum?.attributes.friendly_name ?? 'Robot'}</div></div>${battery!==undefined ? html`<span class="battery" aria-label=${`Battery ${battery} percent`}>${icon(this.vacuum?.state==='docked'?'mdi:battery-charging':'mdi:battery')} ${battery}%</span>`:nothing}</div>
        <h2>${this.headline()}</h2><p class="subline">${this.subline()}</p>
        ${sequence ? html`<div class="progress-summary" title=${sequence.valueText}><span>${sequenceLabel}</span><strong>${sequence.label}</strong></div><div class="progress" role="progressbar" aria-label=${this.phase==='attention'?`${sequenceLabel} progress`:'Rooms completed'} aria-valuenow=${Math.round(sequence.roomPercent)} aria-valuemin="0" aria-valuemax="100" aria-valuetext=${sequence.valueText}><span style=${`width:${sequence.roomPercent}%`}></span></div>${sequence.dockLabel?html`<span class="metric-caption" role="status">${sequence.dockLabel}</span>`:nothing}`:nothing}
        ${this.jobActive && !this.dockServicing && (!this.queueActive || !this.floorCleaningComplete) && (area || time || (!this.queueActive&&progress!==undefined)) ? html`<div class="pills" aria-label=${this.queueActive&&!this.restartRecovering?'Current cleaning pass':'Current clean'}>${this.queueActive?html`<span class="metric-caption">${this.restartRecovering?'Robot so far':this.chargingBreak?'Pass so far':'Current pass'}</span>`:nothing}${area?html`<span class="pill">${icon('mdi:ruler-square')}${area}</span>`:nothing}${time?html`<span class="pill">${icon('mdi:timer-outline')}${time}</span>`:nothing}${!this.queueActive&&progress!==undefined?html`<span class="pill">${Math.round(progress)}%</span>`:nothing}</div>`:nothing}
        ${!this.queueActive&&!sequence&&this.jobActive&&progress!==undefined ? html`<div class="progress" role="progressbar" aria-label="Current cleaning progress" aria-valuenow=${Math.round(progress)} aria-valuemin="0" aria-valuemax="100"><span style=${`width:${progress}%`}></span></div>`:nothing}
        ${this.renderRecovery()}
        ${this.renderActions()}
        ${this.renderUtilities()}
      ${renderSequenceActivity({runs,selectedRunId:this.historyRunId,locale:this.hass.locale?.language,timeZone:this.hass.config?.time_zone,
        liveState:this.chargingBreak?{runId:this.queue?.attributes.run_id??'legacy-run',stageIndex:this.index,label:'Charging to continue',stageLabel:'Charging'}:undefined,
        roomName:(id,name)=>name??this.roomName({id,name:this.rooms.find(room=>room.id===id)?.name}),roomIcon:id=>this.roomIcon({id,area_id:this.robotRooms.find(room=>room.id===id)?.area_id}),select:id=>{this.historyRunId=id;}})}
      ${this.historyError?html`<div class="note" role="status">Activity could not be refreshed. ${this.historyError}<button class="text-button" data-action="refresh-history" ?disabled=${this.historyLoading} @click=${()=>this.readHistory(true)}>Retry</button></div>`:nothing}
      </section></div>
      ${this.waterEmpty&&!this.continuationSupported ? html`<div class="note water-warning">${icon('mdi:water-alert-outline')}<span>${this.waterAcknowledged?'The dock still reports a water warning. You confirmed the tank was refilled for this pass.':this.waterAllowed?`Refill and reseat the dock’s clean-water tank for mopping. ${this.queueActive?'Vacuuming can continue.':'Vacuuming can start.'} Any later mopping stage waits for a healthy dock.`:'Refill and reseat the dock’s clean-water tank for mopping.'}</span></div>`:nothing}

      ${this.terminalSequence && this.phase!=='attention' ? html`<div class="note">This sequence has finished. Choose rooms for a fresh plan.<button class="text-button" data-action="clear-queue" ?disabled=${!this.queueReady || this.request?.kind==='cancel'} @click=${()=>this.command('cancel')}>Start a new sequence</button></div>`:nothing}
      ${this.capsError || this.caps?.error ? html`<div class="note" role="status">${this.capsError || this.caps?.error}<button class="text-button" data-action="retry-capabilities" ?disabled=${this.capsLoading} @click=${()=>this.readCapabilities()}>Refresh rooms</button></div>`:nothing}
      ${this.selection.length && !this.validSelection ? html`<p class="note">Some selected rooms or settings are no longer available. Review them before saving or starting.</p>`:nothing}
      ${this.commandError && this.commandError!==this.queue?.attributes.error ? html`<div class="error" role="alert">${this.commandError}<button class="text-button" @click=${()=>this.commandError=''}>Dismiss</button></div>`:nothing}
      ${this.request ? html`<div class="note">${this.feedback}</div>`:nothing}
      ${!this.queueReady && (this.rooms.length || this.config?.require_queue) ? html`<div class="note">${this.config?.require_queue ? 'The shared cleaning controller is unavailable. Controls will return when it reconnects.' : 'Install and configure the Home Assistant queue companion to clean rooms in order. Select rooms after the controller reconnects.'}</div>`:nothing}
      ${!this.queueDraft&&!this.queueActive&&!this.jobActive?html`<section class="surface plan-section" aria-label="Cleaning plan settings">
      ${!this.sharedPlan&&this.hass.services?.robot_cleaner_queue?.save_preset ? html`<section class="plan-bar" aria-label="Saved cleaning plan"><div class="plan-toolbar"><span class="plan-label">${!this.savedPreset?'Wall switch':this.presetFeedback && !this.selection.length?'Review saved plan':this.planChanged&&!this.queueActive?'Unsaved changes':'Saved plan'}</span>${this.savedPreset && !this.queueActive && (this.planChanged||this.presetFeedback) ? html`<button class="text-button" data-action="load-preset" title="Restore the saved wall-switch plan" ?disabled=${this.blocked||this.queueActive||this.jobActive} @click=${()=>this.loadPreset()}>Reload</button>`:nothing}<button class="action" data-action="save-preset" ?disabled=${!this.canSavePreset} @click=${()=>this.savePreset()}>${icon('mdi:content-save-outline')}${this.savingPreset?'Saving…':'Save plan'}</button></div>${this.presetFeedback ? html`<p class="hint" role="status">${this.presetFeedback}</p>`:nothing}</section>`:nothing}
      ${this.sharedPlan?html`<div class="plan-toolbar" role="status"><span class="plan-label">${this.savingPreset?'Saving…':this.autoSaveError?'Plan not saved':this.planDraftTouched&&this.planChanged?'Changes pending':'Shared plan'}</span>${this.autoSaveError?html`<button class="text-button" @click=${()=>{this.autoSaveError='';void this.savePreset();}}>Retry</button><button class="text-button" @click=${()=>{this.planDraftTouched=false;this.autoSaveError='';this.loadedPlanSignature='';void this.readCapabilities();}}>Reload shared plan</button>`:nothing}</div>`:nothing}
      ${this.renderPreferences()}
      </section>`:nothing}
      <section class="room-section" aria-label="Rooms"><div class="section-heading"><h3>${this.queueDraft?'Edit remaining':this.queueActive?'Cleaning sequence':runs.length?'Next plan':'Rooms'}</h3>${this.queueDraft?html`<button class="text-button" data-action="cancel-queue-edit" ?disabled=${this.savingQueue} @click=${()=>this.cancelQueueEdit()}>Cancel</button>`:this.queueEditSupported?html`<button class="text-button" data-action="edit-queue" title=${this.queueEditSnapshot?.reason||'Change rooms that have not started'} ?disabled=${!this.canEditQueue} @click=${()=>this.beginQueueEdit()}>Edit remaining</button>`:!this.queueActive?html`<button class="text-button" data-action="select-all" ?disabled=${this.blocked||!this.rooms.length} @click=${()=>{this.planEdited=true;this.setSelection(this.selection.length===this.rooms.length?[]:this.orderedRooms.map(room=>room.id));}}>${this.selection.length===this.rooms.length&&this.rooms.length?'Clear selection':'Select all'}</button>`:nothing}</div>
        ${this.renderQueueEditStatus()}
        <span class="sr-only" id="room-reorder-help">${this.queueDraft?'Drag to reorder remaining rooms, or use the arrow keys, Home and End. Started rooms stay fixed. Toggle remaining rooms, then apply changes.':this.queueActive?'Drag or toggle rooms that have not started, then apply changes. Started rooms stay fixed.':'Drag to reorder rooms, or use the arrow keys, Home and End. Toggle rooms to include them, then start the sequence.'}</span><ha-sortable .disabled=${!this.sortableReady||!this.canArrangeRooms} .handleSelector=${".room-drag:not(:disabled)"} .draggableSelector=${"[data-room-item]"} @drag-start=${()=>this.sortStart()} @item-moved=${(event:CustomEvent<{oldIndex:number;newIndex:number}>)=>this.sortMoved(event)} @drag-end=${()=>void this.sortEnd()}><div class="rooms">${repeat(this.orderedRooms,room=>room.id,room=>this.renderRoom(room))}</div></ha-sortable>
        ${this.queueDraft?html`<div class="queue-edit-footer"><span>Saved plan stays unchanged</span><button class="action primary" data-action="apply-queue-edit" ?disabled=${!this.canChangeQueueDraft||!this.validQueueDraft||!queueDraftChanged(this.queueDraft)} @click=${()=>this.applyQueueEdit()}>${icon('mdi:check')}${this.savingQueue?'Updating…':'Apply changes'}</button></div>`:nothing}
        ${!this.rooms.length ? html`<p class="note">${this.roomMode ? 'The robot reports no rooms on its current map.' : this.manual ? 'No mapped areas available. Map areas to this robot in Home Assistant.' : 'Room cleaning needs the updated queue companion and an available robot map.'}</p>`:nothing}
        ${this.manual && this.selection.some(id=>!this.rooms.some(room=>room.id===id)) ? html`<p class="note">${this.roomMode ? 'A room in your selection is no longer on this map.' : 'An area in your selection is no longer mapped.'} Clear the selection and choose the available rooms again.</p>`:nothing}

      </section>
      <div class="sr-only" role="status" aria-live="polite">${this.feedback}</div>
    </div></ha-card></div>
    <dialog class="setup-dialog device-dialog" aria-labelledby="device-title" @cancel=${()=>{this.panel=undefined;}} @close=${()=>{this.panel=undefined;}}>${this.panel&&this.hass ? renderDevicePanel({panel:this.panel,hass:this.hass,entities:this.caps?.device_entities??{},busy:this.blocked||this.queueActive||(this.phase==='attention'&&!this.recoveryReady),motionBlocked:this.barrierActive||!!this.queue?.attributes.pending_command||(this.phase==='attention'&&!this.recoveryReady),motionReason:this.phase==='attention'?this.recoveryReason:this.barrierActive?this.barrierNotice:'Waiting for the robot to confirm the previous command.',robotDocked:this.vacuum?.state==='docked'&&!this.jobActive,waterEmpty:this.waterEmpty,fault:!!this.fault&&this.fault!=='Water empty',error:this.commandError,pending:this.deviceSending||this.phase==='controlling',close:()=>this.closePanel(),send:(key,value)=>void this.deviceCommand(key,value)}):nothing}</dialog>
    <dialog class="recovery-dialog" aria-labelledby="recovery-title" aria-describedby="recovery-description" @cancel=${()=>this.closeRecoveryPrompt()} @close=${()=>{this.recoveryPrompt=undefined;}}>${this.recoveryPrompt?html`<div class="recovery-dialog-body">
      ${this.recoveryPrompt.kind==='restart'?html`<h3 id="recovery-title">Resume the robot’s current job?</h3><p id="recovery-description">The robot has an unfinished job. Resume it now and keep your saved sequence? The remaining rooms will continue only after its cleaning record matches this pass.</p><div class="actions"><button class="action secondary" data-action="cancel-restart-resume" @click=${()=>this.closeRecoveryPrompt()}>Cancel</button><button class="action primary" data-action="confirm-restart-resume" ?disabled=${this.dispatchBlocked||!this.restartResumeReady} @click=${()=>this.confirmRestartResume()}>${icon('mdi:play')}Resume current job</button></div>`
      :html`<h3 id="recovery-title">Clean-water tank refilled?</h3><p id="recovery-description">The dock still reports an empty clean-water tank. Confirm you filled and reseated it before continuing this pass.</p><div class="actions"><button class="action secondary" data-action="cancel-refill" @click=${()=>this.closeRecoveryPrompt()}>Cancel</button><button class="action primary" data-action="confirm-refill" ?disabled=${this.dispatchBlocked||!this.continuationReady} @click=${()=>this.confirmWaterRefilled()}>${icon('mdi:water-check-outline')}I refilled the tank</button></div>`}
    </div>`:nothing}</dialog>`;
  }
}
const cardWindow = window as typeof window & {customCards?: Array<Record<string,unknown>>};
cardWindow.customCards = cardWindow.customCards || [];
cardWindow.customCards.push({type:'robot-vacuum-cleaner-card',name:'Robot Vacuum Cleaner Card',description:'Robot status and ordered cleaning of the robot’s own rooms with Space Hub styling.',preview:true});
console.info('ROBOT VACUUM CLEANER CARD 0.16.4');
