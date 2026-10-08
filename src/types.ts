export interface EntityState { state: string; attributes: Record<string, any>; last_changed?: string; last_updated?: string; }
export interface Hass { hassUrl?(path:string):string; states: Record<string, EntityState>; services?: Record<string, Record<string, unknown>>; callWS?<T = unknown>(message: Record<string, unknown>): Promise<T>; callService(domain: string, service: string, data: Record<string, unknown>): Promise<unknown>; }
export interface AreaAppearance { name?: string; icon?: string; }
/**
 * A legacy tile: a Roborock app routine per room. Rooms now come from the robot's own
 * map, so `preset` is optional and only used as the fallback when the companion
 * reports no robot rooms.
 */
export interface RoomConfig { id: string; name: string; preset?: string; icon?: string; activity_entity?: string; }
export interface CardConfig {
  type: string; entity: string; name?: string; rooms: RoomConfig[];
  battery_entity?: string; activity_entity?: string; status_entity?: string; cleaning_entity?: string;
  current_room_entity?: string; progress_entity?: string; area_entity?: string; time_entity?: string;
  error_entity?: string; dock_error_entity?: string; full_clean_entity?: string; last_clean_end_entity?: string;
  require_queue?: boolean; queue_entity?: string; queue_script?: string; area_overrides?: Record<string, AreaAppearance>;
}
export const BAD = new Set(['unknown', 'unavailable', 'none', '']);
export const QUEUE_ACTIVE = new Set(['preparing', 'starting', 'running', 'paused', 'cancelling']);
export function available(entity?: EntityState, button = false): boolean {
  return !!entity && entity.state !== 'unavailable' && (button || !BAD.has(entity.state));
}
export function humanize(value: unknown): string { return String(value ?? '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()); }
export function numeric(entity?: EntityState): number | undefined {
  if (!available(entity)) return undefined;
  const value = Number(entity!.state);
  return Number.isFinite(value) ? value : undefined;
}
export function validateConfig(raw: CardConfig): CardConfig {
  if (!raw || !/^vacuum\.[a-z0-9_]+$/.test(raw.entity ?? '')) throw new Error('Choose a vacuum entity.');
  if (raw.rooms !== undefined && !Array.isArray(raw.rooms)) throw new Error('rooms must be a list of rooms.');
  if (raw.require_queue !== undefined && typeof raw.require_queue !== 'boolean') throw new Error('require_queue must be true or false.');
  const ids = new Set<string>(); const presets = new Set<string>();
  (raw.rooms ?? []).forEach(room => {
    if (!room.id || !room.name) throw new Error('Every room needs an id and a name.');
    if (room.preset && !/^button\.[a-z0-9_]+$/.test(room.preset)) throw new Error('A room preset must be a button entity.');
    if (room.activity_entity && !/^[a-z_]+\.[a-z0-9_]+$/.test(room.activity_entity)) throw new Error(`Invalid activity entity for ${room.name}.`);
    if (ids.has(room.id) || (room.preset && presets.has(room.preset))) throw new Error('Room IDs and preset entities must be unique.');
    ids.add(room.id); if (room.preset) presets.add(room.preset);
  });
  for (const key of ['queue_script','queue_entity','battery_entity','activity_entity','status_entity','cleaning_entity','current_room_entity','progress_entity','area_entity','time_entity','error_entity','dock_error_entity','full_clean_entity','last_clean_end_entity'] as const) {
    if (raw[key] && !/^[a-z_]+\.[a-z0-9_]+$/.test(raw[key]!)) throw new Error(`Invalid ${key} entity.`);
  }
  if (raw.queue_script && !raw.queue_script.startsWith('script.')) throw new Error('queue_script must be a script entity.');
  let areaOverrides: Record<string, AreaAppearance> | undefined;
  if (raw.area_overrides !== undefined) {
    const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
    if (!plainObject(raw.area_overrides)) throw new Error('area_overrides must be an object keyed by Home Assistant area ID.');
    areaOverrides = Object.fromEntries(Object.entries(raw.area_overrides).map(([id, appearance]) => {
      if (!id.trim() || id !== id.trim() || !plainObject(appearance)) throw new Error('Every area override needs an area ID and appearance object.');
      for (const key of ['name', 'icon'] as const) {
        if (appearance[key] !== undefined && (typeof appearance[key] !== 'string' || !appearance[key]!.trim())) throw new Error(`Area override ${key} must be a non-empty string.`);
      }
      return [id, {...(appearance.name !== undefined ? {name: appearance.name as string} : {}), ...(appearance.icon !== undefined ? {icon: appearance.icon as string} : {})}];
    }));
  }
  return { ...raw, ...(areaOverrides !== undefined ? {area_overrides: areaOverrides} : {}), queue_entity: raw.queue_entity ?? 'sensor.robot_cleaner_queue', queue_script: raw.queue_script ?? 'script.robot_cleaner_queue_control', rooms: (raw.rooms ?? []).map(room => ({...room})) };
}
