import { html, nothing } from 'lit';
import { humanize } from './types';

export type CleaningMode = 'vacuum'|'mop'|'vacuum_mop'|'vacuum_then_mop';
/** `rooms` is the room-first model; `preset` and `manual` remain as the legacy fallback. */
export type CleaningSource = 'preset'|'manual'|'rooms';
export interface ManualSetup { mode: CleaningMode; suction?: string; water?: string; route?: string; repeat: number; }
/** One room of a saved plan, in the flat shape the queue service accepts. */
export interface SavedRoom { id: string; mode?: CleaningMode; suction?: string; water?: string; route?: string; repeat?: number; }
export interface SavedPreset { source: CleaningSource; presets: string[]; rooms: Array<string|SavedRoom>; setup: ManualSetup; map_id?: number; }
export interface RobotRoom { id: string; name?: string|null; segment?: number; floor?: string|null; area_id?: string|null; area_name?: string|null; }
export interface RobotMap { flag: number; name?: string|null; }
export interface UnmappedArea { id: string; name: string; segments: string[]; }
export interface RoomPreferences { revision: number; defaults: Partial<ManualSetup>; rooms: Record<string,ManualSetup>; }
export interface ManualCapabilities {
  preferences?: RoomPreferences;
  saved_preset?: SavedPreset; current_map?: number;
  control_version?: number; device_entities?: Record<string,string>;
  supported: boolean; modes: Array<{value: CleaningMode; label: string}>;
  suction: string[]; water: string[]; routes: string[]; routes_by_mode?: Partial<Record<CleaningMode,string[]>>;
  repeats: number[]; room_targets: Array<{id:string; name:string; icon?:string}>; defaults?: Partial<ManualSetup>; error?: string;
  robot_maps?: RobotMap[]; robot_rooms?: RobotRoom[]; unmapped_areas?: UnmappedArea[]; rooms_complete?: boolean;
  area_cleaning?: boolean; unavailable_controls?: string[];
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
/** A room of the plan being built: the robot's room id plus the settings it will run with. */
export interface PlanRoom { id: string; setup: ManualSetup; }
/** True when every setting a saved room pinned still survives normalisation. */
export function matchesSetup(caps: ManualCapabilities, saved: SavedRoom): boolean {
  const fallback: ManualSetup = {mode: caps.modes[0]?.value ?? 'vacuum', repeat: caps.repeats[0] ?? 1,
                                 suction: caps.defaults?.suction, water: caps.defaults?.water, route: caps.defaults?.route};
  const normalized = savedRoomSetup(caps, saved, fallback);
  return (Object.keys(saved) as Array<keyof SavedRoom>).every(key =>
    key === 'id' || normalized[key as keyof ManualSetup] === saved[key]);
}
/** Read one saved room into the settings it should run with, tolerating legacy string ids. */
export function savedRoomSetup(caps: ManualCapabilities, room: string|SavedRoom|undefined, fallback: ManualSetup): ManualSetup {
  if (!room || typeof room === 'string') return normalizeSetup(caps, fallback);
  return normalizeSetup(caps, {mode: fallback.mode, suction: fallback.suction, water: fallback.water, route: fallback.route, repeat: fallback.repeat, ...room});
}
/** The flat per-room payload both `start_manual` and `save_preset` accept. */
export function roomsPayload(rooms: PlanRoom[]): SavedRoom[] { return rooms.map(room => ({id: room.id, ...room.setup})); }
export interface ZoneGroup { areaId: string; areaName: string; rooms: string[]; }
export interface ZoneRoom { id: string; label: string; floor?: string|null; }
/** The Roborock app names every room; Home Assistant areas group them into real rooms. */
export function roomLabel(room: RobotRoom) { return room.name || (room.segment === undefined ? room.id : `Room ${room.segment}`); }
export function zoneGroups(caps: ManualCapabilities): {mapped: ZoneGroup[]; unassigned: ZoneRoom[]} {
  const mapped = new Map<string, ZoneGroup>();
  const unassigned: ZoneRoom[] = [];
  for (const room of caps.robot_rooms ?? []) {
    const label = roomLabel(room);
    if (!room.area_id) { unassigned.push({id: room.id, label, floor: room.floor}); continue; }
    const group = mapped.get(room.area_id) ?? {areaId: room.area_id, areaName: room.area_name || room.area_id, rooms: []};
    group.rooms.push(label);
    mapped.set(room.area_id, group);
  }
  return {mapped: [...mapped.values()], unassigned};
}
/**
 * Read-only. The robot reports finer rooms than Home Assistant areas hold, so this
 * shows which real rooms claim which robot rooms, and what is left uncovered, without
 * ever writing Home Assistant configuration.
 */
export function renderZoneReport(caps: ManualCapabilities) {
  const {mapped, unassigned} = zoneGroups(caps);
  const dropped = caps.unmapped_areas ?? [];
  if (!mapped.length && !unassigned.length && !dropped.length) return nothing;
  const rooms = (caps.robot_rooms ?? []).length;
  const floors = (caps.robot_maps ?? []).map(map=>map.name).filter(Boolean) as string[];
  return html`<details class="zone-report"><summary>Zones &amp; areas${rooms ? html`<span class="zone-count">${rooms} robot ${rooms===1?'room':'rooms'}${floors.length>1?` · ${floors.length} floors`:''}</span>`:nothing}</summary>
    ${caps.rooms_complete === false ? html`<p class="zone-note">Only the floor the robot is on could be read, so unlisted areas are not reported as missing.</p>`:nothing}
    ${mapped.length ? html`<ul class="zone-groups">${mapped.map(group=>html`<li><span class="zone-area">${group.areaName}</span><span class="zone-rooms">${group.rooms.join(', ')}</span></li>`)}</ul>`:nothing}
    ${unassigned.length ? html`<p class="zone-note" role="status">No Home Assistant area: ${unassigned.map(room=>`${room.label}${room.floor?` (${room.floor})`:''}`).join(', ')}. These rooms can still be selected directly.</p>`:nothing}
    ${dropped.length ? html`<p class="zone-note">The robot no longer reports: ${dropped.map(area=>area.name).join(', ')}. Re-map those areas or remove the old rooms.</p>`:nothing}
  </details>`;
}
export interface SetupRoom { id: string; name: string; setup: ManualSetup; customised: boolean; }
