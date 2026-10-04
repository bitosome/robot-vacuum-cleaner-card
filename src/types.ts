export interface EntityState { state: string; attributes: Record<string, any>; last_changed?: string; last_updated?: string; }
export interface Hass { states: Record<string, EntityState>; services?: Record<string, Record<string, unknown>>; callService(domain: string, service: string, data: Record<string, unknown>): Promise<unknown>; }
export interface RoomConfig { id: string; name: string; preset: string; icon?: string; activity_entity?: string; }
export interface CardConfig {
  type: string; entity: string; name?: string; rooms: RoomConfig[];
  battery_entity?: string; activity_entity?: string; status_entity?: string; cleaning_entity?: string;
  current_room_entity?: string; progress_entity?: string; area_entity?: string; time_entity?: string;
  error_entity?: string; dock_error_entity?: string; full_clean_entity?: string; last_clean_end_entity?: string;
  queue_entity?: string; queue_script?: string;
}
export const BAD = new Set(['unknown', 'unavailable', 'none', '']);
export const QUEUE_ACTIVE = new Set(['starting', 'running', 'paused', 'cancelling']);
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
  if (!Array.isArray(raw.rooms)) throw new Error('Configure a rooms list with a name and preset button for each room.');
  const ids = new Set<string>(); const presets = new Set<string>();
  raw.rooms.forEach(room => {
    if (!room.id || !room.name || !/^button\.[a-z0-9_]+$/.test(room.preset)) throw new Error('Every room needs an id, name and button preset entity.');
    if (ids.has(room.id) || presets.has(room.preset)) throw new Error('Room IDs and preset entities must be unique.');
    ids.add(room.id); presets.add(room.preset);
  });
  for (const key of ['queue_script','queue_entity','battery_entity','activity_entity','status_entity','cleaning_entity','current_room_entity','progress_entity','area_entity','time_entity','error_entity','dock_error_entity','full_clean_entity','last_clean_end_entity'] as const) {
    if (raw[key] && !/^[a-z_]+\.[a-z0-9_]+$/.test(raw[key]!)) throw new Error(`Invalid ${key} entity.`);
  }
  if (raw.queue_script && !raw.queue_script.startsWith('script.')) throw new Error('queue_script must be a script entity.');
  return { ...raw, queue_entity: raw.queue_entity ?? 'sensor.robot_cleaner_queue', queue_script: raw.queue_script ?? 'script.robot_cleaner_queue_control', rooms: raw.rooms.map(room => ({...room})) };
}
