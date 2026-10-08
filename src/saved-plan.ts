import {matchesSetup, normalizeSetup, type ManualCapabilities, type ManualSetup, type SavedPreset} from './manual-setup';

/** Compare execution, independent of object key order or irrelevant mode settings. */
export function settingsKey(setup: Partial<ManualSetup>) {
  return [setup.mode,setup.repeat ?? 1,setup.mode==='mop'?null:setup.suction ?? null,
    setup.mode==='vacuum'?null:setup.water ?? null,setup.mode==='vacuum'?null:setup.route ?? null];
}
export function planKey(plan: SavedPreset|undefined, caps?: ManualCapabilities): string {
  if (!plan || plan.source==='preset') return '';
  const map=plan.map_id ?? caps?.current_map ?? null;
  const rooms=plan.rooms.map(room=> {
    const id=typeof room==='string'?room:room.id;
    const input={...plan.setup,...(typeof room==='string'?{}:room)};
    // Invalid stored values are not equivalent to their valid fallback. Keeping
    // them distinct lets the user repair and save a plan after options disappear.
    const setup=caps && matchesSetup(caps,{id,...input}) ? normalizeSetup(caps,input) : input;
    return [id,settingsKey(setup)];
  });
  return JSON.stringify([map,rooms]);
}
