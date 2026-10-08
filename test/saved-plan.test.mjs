import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { Window } from 'happy-dom';

// Shipping-bundle regressions: a shared saved sequence must remain distinct
// from the persistent defaults/room preferences and the robot's live settings.
// All Home Assistant traffic is mocked; these tests never control a robot.
const browser = new Window({url: 'http://saved-plan.test/'});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'ShadowRoot', 'Document', 'CSSStyleSheet', 'customElements', 'Event', 'CustomEvent', 'MutationObserver', 'Node', 'HTMLInputElement', 'HTMLSelectElement', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, {configurable: true, value: key === 'window' ? browser : browser[key]});
}
await import('../dist/robot-vacuum-cleaner-card.js');

const entity = (state, attributes = {}) => ({state, attributes});
const savedPlan = () => ({
  source: 'rooms', revision: 4, map_id: 0, presets: [], setup: {},
  rooms: [
    {id: '0_5', mode: 'vacuum', suction: 'max_plus', repeat: 2},
    {id: '0_12', mode: 'mop', water: 'high', route: 'deep', repeat: 1},
  ],
});
const preferences = () => ({revision: 2,
  defaults: {mode: 'vacuum_mop', suction: 'balanced', water: 'medium', route: 'standard', repeat: 1},
  rooms: {'0_5': {mode: 'vacuum', suction: 'quiet', repeat: 1}},
});
const capabilities = () => ({
  supported: true, current_map: 0, area_cleaning: true, rooms_complete: true,
  robot_maps: [{flag: 0, name: 'Ground floor'}],
  robot_rooms: [
    {id: '0_12', segment: 12, name: 'Kitchen', floor: 'Ground floor', area_id: 'kitchen', area_name: 'Kitchen'},
    {id: '0_13', segment: 13, name: 'Dining area', floor: 'Ground floor', area_id: 'dining', area_name: 'Dining area'},
    {id: '0_5', segment: 5, name: 'Hallway', floor: 'Ground floor', area_id: 'hall', area_name: 'Hallway'},
  ],
  modes: [{value: 'vacuum', label: 'Vacuum'}, {value: 'mop', label: 'Mop'},
    {value: 'vacuum_mop', label: 'Vacuum & mop'}, {value: 'vacuum_then_mop', label: 'Vacuum then mop'}],
  suction: ['quiet', 'balanced', 'turbo', 'max', 'max_plus'], water: ['low', 'medium', 'high'],
  routes: ['standard', 'deep', 'deep_plus', 'fast'],
  routes_by_mode: {vacuum: [], vacuum_mop: ['standard', 'fast'], mop: ['standard', 'deep', 'deep_plus', 'fast'], vacuum_then_mop: ['standard', 'deep', 'deep_plus', 'fast']},
  repeats: [1, 2], room_targets: [],
  defaults: {mode: 'vacuum', suction: 'balanced', repeat: 1},
  preferences: preferences(), saved_preset: savedPlan(),
});
const queue = (patch = {}) => entity('idle', {
  vacuum: 'vacuum.rover', control_version: 6, presets: [], current_index: 0, completed: 0,
  preferences_revisions: {'vacuum.rover': 2}, saved_plan_revisions: {'vacuum.rover': 4}, ...patch,
});
async function settle(card) {
  for (let index = 0; index < 12; index++) { await card.updateComplete; await Promise.resolve(); }
}
async function fixture(options = {}) {
  let current = structuredClone(options.capabilities ?? capabilities());
  const calls = [], reads = [];
  const card = document.createElement('robot-vacuum-cleaner-card');
  card.setConfig({type: 'custom:robot-vacuum-cleaner-card', entity: 'vacuum.rover', name: 'Rover',
    queue_entity: 'sensor.robot_cleaner_queue', queue_script: 'script.robot_cleaner_queue_control',
    cleaning_entity: 'binary_sensor.rover_cleaning', status_entity: 'sensor.rover_status',
    error_entity: 'sensor.rover_error', last_clean_end_entity: 'sensor.rover_last_clean_end'});
  card.hass = {
    states: {
      'vacuum.rover': entity('docked', {supported_features: 8192 | 4 | 16, battery_level: 84}),
      'sensor.robot_cleaner_queue': queue(), 'script.robot_cleaner_queue_control': entity('off'),
      'binary_sensor.rover_cleaning': entity('off'), 'sensor.rover_status': entity('charging'),
      'sensor.rover_error': entity('none'), 'sensor.rover_last_clean_end': entity('2026-01-01T12:00:00+00:00'),
    },
    services: {robot_cleaner_queue: {control: {}, get_capabilities: {}, save_preset: {}, save_preferences: {}}},
    async callWS(request) { reads.push(structuredClone(request)); return {response: structuredClone(current)}; },
    async callService(domain, action, data) {
      calls.push({domain, action, data: structuredClone(data)});
      if (options.service) return options.service(domain, action, data);
      if (action === 'save_preset') {
        current.saved_preset = {source: data.source, revision: (current.saved_preset?.revision ?? 0) + 1,
          map_id: current.current_map, rooms: structuredClone(data.rooms), setup: structuredClone(data.setup), presets: []};
      }
    },
  };
  document.body.append(card); await settle(card);
  return {card, calls, reads, setCapabilities(value) { current = structuredClone(value); }};
}
const root = card => card.shadowRoot;
const action = (card, name) => root(card).querySelector(`[data-action="${name}"]`);
const room = (card, id) => root(card).querySelector(`[data-room="${id}"]`);
const select = (card, id, key) => root(card).querySelector(`[data-room-setting="${key}"][data-room-id="${id}"]`);
const order = (card, id) => room(card, id)?.querySelector('.order')?.textContent.trim();
async function click(card, control) {
  assert.ok(control, 'Expected control to be rendered'); assert.equal(control.disabled, false);
  control.click(); await settle(card);
}
async function edit(card, id, key, value) {
  const control = select(card, id, key);
  assert.ok(control, `Expected ${id} ${key} control`); assert.equal(control.disabled, false);
  assert.ok([...control.options].some(option => option.value === String(value)), `Expected ${value} option`);
  control.value = String(value); control.dispatchEvent(new Event('change', {bubbles: true})); await settle(card);
}
async function publishRevision(card, patch) {
  card.hass = {...card.hass, states: {...card.hass.states, 'sensor.robot_cleaner_queue': queue(patch)}};
  await settle(card);
}
afterEach(() => { for (const element of [...document.body.children]) element.remove(); });
after(async () => { await browser.happyDOM.abort(); browser.close(); });

test('a fresh dashboard preloads the saved native-room sequence and exact settings without a command', async () => {
  const {card, calls} = await fixture();
  assert.equal(order(card, '0_5'), '1'); assert.equal(order(card, '0_12'), '2');
  assert.equal(order(card, '0_13'), undefined);
  // HappyDOM selects the wrong option while detached Lit option fragments are
  // first inserted (also reproducible with a standalone native select). Verify
  // the visible settings summary and the exact executable payload here; later
  // edit/refresh tests exercise the select values after normal updates.
  assert.match(root(card).querySelector('[data-room-editor="0_5"] summary').textContent, /Vacuum · Suction Max\+ · ×2/);
  assert.match(root(card).querySelector('[data-room-editor="0_12"] summary').textContent, /Mop · Water High · Route Deep · ×1/);
  assert.equal(action(card, 'save-preset').disabled, true);
  assert.equal(action(card, 'save-preferences').disabled, true);
  assert.equal(calls.length, 0);
  await click(card, action(card, 'start'));
  assert.equal(calls.length, 1); assert.equal(calls[0].action, 'control');
  assert.deepEqual(calls[0].data.rooms, savedPlan().rooms);
  assert.deepEqual(calls[0].data.setup, {});
});

test('Save plan tracks effective settings and becomes disabled when a selected-room edit is reverted', async () => {
  const {card, calls} = await fixture();
  await edit(card, '0_5', 'suction', 'turbo');
  assert.equal(action(card, 'save-preset').disabled, false);
  await edit(card, '0_5', 'suction', 'max_plus');
  assert.equal(action(card, 'save-preset').disabled, true);
  await edit(card, '0_12', 'repeat', 2);
  assert.equal(action(card, 'save-preset').disabled, false);
  await edit(card, '0_12', 'repeat', 1);
  assert.equal(action(card, 'save-preset').disabled, true);
  assert.equal(calls.length, 0);
});

test('Save plan detects room membership changes and their reversal', async () => {
  const {card} = await fixture();
  await click(card, room(card, '0_13'));
  assert.equal(order(card, '0_13'), '3');
  assert.equal(action(card, 'save-preset').disabled, false);
  await click(card, room(card, '0_13'));
  assert.equal(action(card, 'save-preset').disabled, true);
  await click(card, room(card, '0_12'));
  assert.equal(action(card, 'save-preset').disabled, false);
  await click(card, room(card, '0_12'));
  assert.equal(action(card, 'save-preset').disabled, true);
});

test('the same rooms in a different order are a plan change; restoring order clears it', async () => {
  const {card} = await fixture();
  await click(card, room(card, '0_5')); await click(card, room(card, '0_5'));
  assert.equal(order(card, '0_12'), '1'); assert.equal(order(card, '0_5'), '2');
  assert.equal(action(card, 'save-preset').disabled, false);
  await click(card, room(card, '0_12')); await click(card, room(card, '0_12'));
  assert.equal(order(card, '0_5'), '1'); assert.equal(order(card, '0_12'), '2');
  assert.equal(action(card, 'save-preset').disabled, true);
});

test('an unselected room preference edit does not dirty the saved plan', async () => {
  const {card, calls} = await fixture();
  await edit(card, '0_13', 'suction', 'max');
  assert.equal(action(card, 'save-preferences').disabled, false);
  assert.equal(action(card, 'save-preset').disabled, true);
  assert.equal(order(card, '0_13'), undefined);
  assert.equal(calls.length, 0);
});

test('reloading a saved plan leaves the shared preference profile untouched and clean', async () => {
  const {card, calls} = await fixture();
  await click(card, room(card, '0_13'));
  await click(card, action(card, 'load-preset'));
  assert.equal(order(card, '0_13'), undefined);
  assert.equal(select(card, '0_5', 'suction').value, 'max_plus');
  assert.equal(select(card, 'defaults', 'suction').value, 'balanced');
  assert.equal(action(card, 'save-preferences').disabled, true);
  assert.equal(action(card, 'save-preset').disabled, true);
  assert.equal(calls.length, 0);
});

test('shared preference refresh updates defaults but preserves the saved sequence settings', async () => {
  const {card, calls, setCapabilities} = await fixture();
  const changed = capabilities();
  changed.preferences = {revision: 3, defaults: {mode: 'vacuum', suction: 'turbo', repeat: 1},
    rooms: {'0_5': {mode: 'vacuum', suction: 'balanced', repeat: 1},
      '0_12': {mode: 'vacuum', suction: 'quiet', repeat: 1}}};
  setCapabilities(changed);
  await publishRevision(card, {preferences_revisions: {'vacuum.rover': 3}});
  assert.equal(select(card, 'defaults', 'suction').value, 'turbo');
  assert.equal(select(card, '0_5', 'suction').value, 'max_plus');
  assert.equal(select(card, '0_12', 'mode').value, 'mop');
  assert.equal(select(card, '0_12', 'water').value, 'high');
  assert.equal(order(card, '0_5'), '1'); assert.equal(order(card, '0_12'), '2');
  assert.equal(action(card, 'save-preset').disabled, true);
  assert.equal(action(card, 'save-preferences').disabled, true);
  assert.equal(calls.length, 0);
});

test('capability refresh cannot overwrite unsaved plan order, membership, or settings', async () => {
  const {card, calls, setCapabilities} = await fixture();
  await edit(card, '0_5', 'suction', 'turbo');
  await click(card, room(card, '0_5')); await click(card, room(card, '0_5'));
  await click(card, room(card, '0_13'));
  const changed = capabilities(); changed.defaults.suction = 'quiet';
  setCapabilities(changed);
  await click(card, action(card, 'refresh-rooms'));
  assert.equal(select(card, '0_5', 'suction').value, 'turbo');
  assert.equal(order(card, '0_12'), '1'); assert.equal(order(card, '0_5'), '2'); assert.equal(order(card, '0_13'), '3');
  assert.equal(action(card, 'save-preset').disabled, false);
  assert.equal(calls.length, 0);
});

test('saving a changed plan uses its server revision and makes the exact draft clean', async () => {
  const {card, calls} = await fixture();
  await edit(card, '0_12', 'water', 'low');
  await click(card, action(card, 'save-preset'));
  assert.equal(calls.length, 1); assert.equal(calls[0].action, 'save_preset');
  assert.equal(calls[0].data.revision, 4);
  assert.deepEqual(calls[0].data.rooms, [savedPlan().rooms[0], {...savedPlan().rooms[1], water: 'low'}]);
  assert.equal(action(card, 'save-preset').disabled, true);
  assert.ok(!calls.some(call => call.action === 'save_preferences'), 'Saving a plan must not silently persist preferences');
});

test('a failed plan save preserves the local draft and remains saveable', async () => {
  const {card, calls} = await fixture({service: () => { throw new Error('Plan changed in another dashboard. Reload it before saving.'); }});
  await edit(card, '0_12', 'water', 'low');
  await click(card, action(card, 'save-preset'));
  assert.equal(calls.length, 1);
  assert.equal(select(card, '0_12', 'water').value, 'low');
  assert.equal(action(card, 'save-preset').disabled, false);
  assert.match(root(card).textContent, /Plan changed in another dashboard/);
});

test('another user saving a plan reloads an unchanged dashboard without moving the robot', async () => {
  const {card, calls, reads, setCapabilities} = await fixture();
  const changed = capabilities();
  changed.saved_preset = {...savedPlan(), revision: 5, rooms: [savedPlan().rooms[1], savedPlan().rooms[0]]};
  const beforeReads = reads.length;
  setCapabilities(changed);
  await publishRevision(card, {saved_plan_revisions: {'vacuum.rover': 5}});
  assert.ok(reads.length > beforeReads, 'Plan revisions must trigger a capability refresh');
  assert.equal(order(card, '0_12'), '1'); assert.equal(order(card, '0_5'), '2');
  assert.equal(action(card, 'save-preset').disabled, true);
  assert.equal(action(card, 'save-preferences').disabled, true);
  assert.equal(calls.length, 0);
});

test('another user saving a plan cannot overwrite a locally changed sequence', async () => {
  const {card, calls, setCapabilities} = await fixture();
  await edit(card, '0_5', 'suction', 'turbo');
  const changed = capabilities(); changed.saved_preset = {...savedPlan(), revision: 5,
    rooms: [{id: '0_13', mode: 'vacuum', suction: 'quiet', repeat: 1}]};
  setCapabilities(changed);
  await publishRevision(card, {saved_plan_revisions: {'vacuum.rover': 5}});
  assert.equal(order(card, '0_5'), '1'); assert.equal(order(card, '0_12'), '2'); assert.equal(order(card, '0_13'), undefined);
  assert.equal(select(card, '0_5', 'suction').value, 'turbo');
  assert.match(root(card).textContent, /another dashboard|another user|changed elsewhere/i);
  assert.equal(calls.length, 0);
});

test('a saved plan from another map or with a missing room never preloads a guessed selection', async () => {
  for (const [plan, warning] of [
    [{...savedPlan(), map_id: 1}, /another map/i],
    [{...savedPlan(), rooms: [{id: '0_99', mode: 'vacuum', suction: 'quiet', repeat: 1}]}, /no longer on .*map/i],
  ]) {
    const {card, calls} = await fixture({capabilities: {...capabilities(), saved_preset: plan}});
    for (const id of ['0_5', '0_12', '0_13']) assert.equal(order(card, id), undefined);
    assert.equal(action(card, 'start').disabled, true);
    assert.equal(action(card, 'save-preset').disabled, true);
    assert.equal(action(card, 'save-preferences').disabled, true);
    assert.match(root(card).textContent, warning);
    assert.equal(calls.length, 0);
    card.remove();
  }
});

test('after an external sequence completes the saved plan is restored without sending a command', async () => {
  const {card, calls} = await fixture();
  // An independent sequence can differ from both this dashboard's draft and
  // the wall-switch plan. Its completion must not replace the saved plan.
  await click(card, room(card, '0_13'));
  const committed = {
    ...queue().attributes, mode: 'manual', targets: ['0_13'],
    setup: {rooms: [{id: '0_13', name: 'Dining area', setup: {mode: 'vacuum', suction: 'quiet', repeat: 1}}]},
    stages: [{target: '0_13', mode: 'vacuum', room_index: 0, repeat_index: 0}],
    current_index: 0, completed: 0,
  };
  card.hass = {...card.hass, states: {...card.hass.states,
    'sensor.robot_cleaner_queue': entity('running', committed),
    'vacuum.rover': entity('cleaning', {supported_features: 8192 | 4 | 16}),
    'binary_sensor.rover_cleaning': entity('on'),
  }};
  await settle(card);
  assert.equal(order(card, '0_13'), '1');
  assert.equal(select(card, '0_13', 'suction').disabled, true);
  card.hass = {...card.hass, states: {...card.hass.states,
    'sensor.robot_cleaner_queue': entity('completed', {...committed, completed: 1}),
    'vacuum.rover': entity('docked', {supported_features: 8192 | 4 | 16}),
    'binary_sensor.rover_cleaning': entity('off'),
  }};
  await settle(card);
  assert.equal(order(card, '0_5'), '1'); assert.equal(order(card, '0_12'), '2');
  assert.equal(order(card, '0_13'), undefined);
  assert.equal(select(card, '0_5', 'suction').value, 'max_plus');
  assert.equal(select(card, '0_12', 'water').value, 'high');
  assert.equal(action(card, 'save-preset').disabled, true);
  assert.equal(action(card, 'save-preferences').disabled, true);
  assert.equal(calls.length, 0);
});

for (const [reason, invalid] of [
  ['missing room', {...savedPlan(), rooms:[{id:'0_99',mode:'vacuum',suction:'quiet',repeat:1}]}],
  ['retired routine', {...savedPlan(),source:'preset',rooms:[],presets:['button.rover_old_routine']}],
  ['another map', {...savedPlan(),map_id:1}],
]) test(`an unreadable saved plan (${reason}) can be replaced using its current revision`,async()=>{
  const {card,calls}=await fixture({capabilities:{...capabilities(),saved_preset:invalid}});
  assert.equal(action(card,'start').disabled,true);
  await click(card,room(card,'0_13'));
  assert.equal(action(card,'save-preset').disabled,false);
  await click(card,action(card,'save-preset'));
  assert.equal(calls.length,1);
  assert.equal(calls[0].action,'save_preset');
  assert.equal(calls[0].data.revision,4);
  assert.deepEqual(calls[0].data.rooms.map(entry=>entry.id),['0_13']);
  assert.equal(action(card,'save-preset').disabled,true);
});

test('replacing an unavailable saved option with its valid fallback is a saveable plan change',async()=>{
  const changed=capabilities();
  changed.preferences={revision:2,defaults:{mode:'vacuum',suction:'balanced',repeat:1},rooms:{}};
  changed.saved_preset={...savedPlan(),rooms:[{id:'0_5',mode:'vacuum',suction:'retired_power',repeat:1}]};
  const {card,calls}=await fixture({capabilities:changed});
  assert.match(root(card).textContent,/settings the robot no longer offers/);
  await click(card,room(card,'0_5'));
  assert.equal(action(card,'save-preset').disabled,false);
  await click(card,action(card,'save-preset'));
  assert.equal(calls[0].data.revision,4);
  assert.equal(calls[0].data.rooms[0].suction,'balanced');
  assert.equal(action(card,'save-preset').disabled,true);
});

for (const control of ['save-preferences','reload-preferences']) test(`${control} cannot publish stale feedback after switching robot during refresh`,async()=>{
  const {card}=await fixture();
  await edit(card,'0_13','suction','max');
  let completeRead;
  card.hass.callWS=()=>new Promise(resolve=>{completeRead=resolve;});
  action(card,control).click();
  await settle(card);
  assert.equal(typeof completeRead,'function','The capability refresh should be pending');
  card.setConfig({type:'custom:robot-vacuum-cleaner-card',entity:'vacuum.other'});
  await settle(card);
  completeRead({response:capabilities()});
  await settle(card);
  assert.equal(card.preferencesMessage,'');
  assert.equal(card.preferencesDirty,false);
  assert.doesNotMatch(root(card).textContent,/Room settings saved for everyone|Shared room settings loaded/);
});
