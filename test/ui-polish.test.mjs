import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { Window } from 'happy-dom';

// Public synthetic fixtures only. Exercise the shipped card without robot traffic.
const browser = new Window({url: 'http://robot-ui-polish.test/'});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'ShadowRoot', 'Document', 'CSSStyleSheet', 'customElements', 'Event', 'CustomEvent', 'MutationObserver', 'Node', 'HTMLInputElement', 'HTMLSelectElement', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, {configurable: true, value: key === 'window' ? browser : browser[key]});
}
await import('../dist/robot-vacuum-cleaner-card.js');
const entity = (state, attributes = {}) => ({state, attributes});
const defaults = {mode: 'vacuum_mop', suction: 'balanced', water: 'medium', route: 'standard', repeat: 1};
const upstairs = {mode: 'mop', water: 'high', route: 'deep', repeat: 2};
const savedPlan = () => ({source: 'rooms', revision: 4, map_id: 0, presets: [], setup: {}, rooms: [
  {id: '0_5', mode: 'vacuum', suction: 'max_plus', repeat: 2},
  {id: '0_12', mode: 'mop', water: 'high', route: 'deep', repeat: 1},
]});
function capabilities() {
  return {supported: true, current_map: 0, rooms_complete: true,
    robot_maps: [{flag: 0, name: 'Ground floor'}, {flag: 1, name: 'Upstairs'}],
    robot_rooms: [{id: '0_5', name: 'Hall'}, {id: '0_12', name: 'Kitchen'}, {id: '0_13', name: 'Dining room'}, {id: '1_7', name: 'Bedroom'}],
    modes: ['vacuum', 'mop', 'vacuum_mop', 'vacuum_then_mop'].map(value => ({value, label: value})),
    suction: ['quiet', 'balanced', 'turbo', 'max', 'max_plus'], water: ['low', 'medium', 'high', 'custom_water_flow'],
    routes: ['standard', 'deep', 'deep_plus'], routes_by_mode: {vacuum: [], vacuum_mop: ['standard'], mop: ['standard', 'deep', 'deep_plus'], vacuum_then_mop: ['standard', 'deep', 'deep_plus']},
    repeats: [1, 2], room_targets: [], defaults: {...defaults}, saved_preset: savedPlan(),
    preferences: {revision: 2, defaults: {...defaults}, rooms: {'0_5': {mode: 'vacuum', suction: 'quiet', repeat: 1}, '1_7': {...upstairs}}}};
}
async function settle(card) { for (let i = 0; i < 12; i++) { await card.updateComplete; await Promise.resolve(); } }
const root = card => card.shadowRoot;
const action = (card, name) => root(card).querySelector(`[data-action="${name}"]`);
const chips = (card, id) => [...root(card).querySelectorAll(`[data-room-editor="${id}"] summary .setting-chip`)];
async function fixture(options = {}) {
  let caps = structuredClone(options.capabilities ?? capabilities());
  const calls = [], card = document.createElement('robot-vacuum-cleaner-card');
  card.setConfig({type: 'custom:robot-vacuum-cleaner-card', entity: 'vacuum.rover', queue_entity: 'sensor.robot_cleaner_queue',
    cleaning_entity: 'binary_sensor.rover_cleaning', status_entity: 'sensor.rover_status'});
  card.hass = {states: {
    'vacuum.rover': entity('docked', {supported_features: 8192 | 4 | 8 | 16, battery_level: 82}),
    'sensor.robot_cleaner_queue': entity('idle', {vacuum: 'vacuum.rover', control_version: 6, current_index: 0, completed: 0}),
    'binary_sensor.rover_cleaning': entity('off'), 'sensor.rover_status': entity('charging'),
  }, services: {robot_cleaner_queue: {get_capabilities: {}, control: {}, save_preferences: {}, save_preset: {}}},
  async callWS() { return {response: structuredClone(caps)}; },
  async callService(domain, service, data) {
    calls.push({domain, service, data: structuredClone(data)});
    if (options.failSave) throw new Error('Storage unavailable');
    if (service === 'save_preferences') caps.preferences = {revision: caps.preferences.revision + 1,
      defaults: structuredClone(data.defaults), rooms: {'1_7': {...upstairs}, ...structuredClone(data.rooms)}};
    if (service === 'save_preset') caps.saved_preset = {source: data.source, revision: caps.saved_preset.revision + 1,
      map_id: 0, presets: [], rooms: structuredClone(data.rooms), setup: structuredClone(data.setup)};
  }};
  document.body.append(card); await settle(card);
  return {card, calls};
}
async function click(card, control) { assert.ok(control); assert.equal(control.disabled, false); control.click(); await settle(card); }
async function edit(card, id, key, value) {
  const control = root(card).querySelector(`[data-room-id="${id}"][data-room-setting="${key}"]`);
  assert.ok(control); assert.equal(control.disabled, false); control.value = String(value);
  control.dispatchEvent(new Event('change', {bubbles: true})); await settle(card);
}
afterEach(() => { for (const card of [...document.body.children]) card.remove(); });
after(async () => { await browser.happyDOM.abort(); browser.close(); });

test('Apply defaults replaces current-floor room and saved-plan overlays without selecting or starting anything', async () => {
  const {card, calls} = await fixture();
  const stored = structuredClone(card.savedPreset), selection = [...card.manualSelected];
  await edit(card, 'defaults', 'suction', 'turbo');
  await click(card, action(card, 'apply-defaults'));
  assert.deepEqual(card.manualSelected, selection);
  for (const id of ['0_5', '0_12', '0_13']) {
    assert.equal(card.roomSetups[id], undefined);
    assert.equal(card.planSetups[id], undefined);
    assert.deepEqual(card.setupFor(id), {...defaults, suction: 'turbo'});
  }
  assert.deepEqual(card.roomSetups['1_7'], upstairs);
  assert.deepEqual(card.savedPreset, stored);
  assert.equal(card.preferencesDirty, true);
  assert.equal(action(card, 'save-preset').disabled, false);
  assert.deepEqual(calls, []);
});

test('Save room settings after Apply defaults leaves the wall-switch plan unchanged until Save plan', async () => {
  const {card, calls} = await fixture();
  await click(card, action(card, 'apply-defaults'));
  await click(card, action(card, 'save-preferences'));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {domain: 'robot_cleaner_queue', service: 'save_preferences', data: {
    vacuum: 'vacuum.rover', revision: 2, map_id: 0, defaults, rooms: {},
  }});
  assert.deepEqual(card.savedPreset, savedPlan());
  assert.equal(card.preferencesDirty, false);
  assert.equal(action(card, 'save-preset').disabled, false);
  assert.deepEqual(card.startPlan().map(room => room.setup), [defaults, defaults]);
  await click(card, action(card, 'save-preset'));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].service, 'save_preset');
  assert.deepEqual(calls[1].data.rooms, [{id: '0_5', ...defaults}, {id: '0_12', ...defaults}]);
  assert.equal(action(card, 'save-preset').disabled, true);
  assert.ok(!calls.some(call => call.service === 'control'));
});

test('a failed preference save retains the applied draft and the old saved plan', async () => {
  const {card, calls} = await fixture({failSave: true});
  await click(card, action(card, 'apply-defaults'));
  await click(card, action(card, 'save-preferences'));
  assert.equal(card.preferencesDirty, true);
  assert.deepEqual(card.setupFor('0_5'), defaults);
  assert.deepEqual(card.savedPreset, savedPlan());
  assert.match(root(card).textContent, /Storage unavailable/);
  assert.deepEqual(calls.map(call => call.service), ['save_preferences']);
});

for (const reason of ['queue', 'robot', 'request']) test(`Apply defaults cannot change a draft while ${reason} is busy`, async () => {
  const {card, calls} = await fixture();
  if (reason === 'queue') card.hass = {...card.hass, states: {...card.hass.states,
    'sensor.robot_cleaner_queue': entity('running', {vacuum: 'vacuum.rover', control_version: 6, mode: 'manual', targets: ['0_5'],
      stages: [{target: '0_5', mode: 'vacuum', room_index: 0, repeat_index: 0}], current_index: 0, completed: 0})}};
  if (reason === 'robot') card.hass = {...card.hass, states: {...card.hass.states,
    'vacuum.rover': entity('cleaning', {supported_features: 8192 | 4 | 8 | 16})}};
  if (reason === 'request') card.savingPreferences = true;
  await settle(card);
  const before = structuredClone({rooms: card.roomSetups, overlays: card.planSetups, defaults: card.setup});
  assert.equal(action(card, 'apply-defaults').disabled, true);
  card.applyDefaultsToRooms(); await settle(card);
  assert.deepEqual({rooms: card.roomSetups, overlays: card.planSetups, defaults: card.setup}, before);
  assert.deepEqual(calls, []);
});

test('room pills show frozen mode-relevant values and preserve the Max+ distinction', async () => {
  const {card} = await fixture();
  const vacuum = chips(card, '0_5'), mop = chips(card, '0_12');
  assert.ok(vacuum.length >= 3); assert.ok(mop.length >= 4);
  for (const chip of [...vacuum, ...mop]) assert.ok(chip.querySelector('ha-icon'), 'Every setting chip has a bounded HA icon');
  assert.match(vacuum.map(chip => chip.textContent).join(' '), /Vacuum.*Max\+.*×2/);
  assert.doesNotMatch(vacuum.map(chip => chip.textContent).join(' '), /Water|Route|Medium|Standard/);
  assert.match(mop.map(chip => chip.textContent).join(' '), /Mop.*High.*Deep.*×1/);
  assert.doesNotMatch(mop.map(chip => chip.textContent).join(' '), /Suction|Balanced|Max/);
  await edit(card, '0_5', 'suction', 'max');
  assert.match(chips(card, '0_5').map(chip => chip.textContent).join(' '), /Max/);
  assert.doesNotMatch(chips(card, '0_5').map(chip => chip.textContent).join(' '), /Max\+/);
});

test('main view has one Start action and moves default editing out of the status hero', async () => {
  const {card} = await fixture();
  assert.equal(root(card).querySelectorAll('[data-action="start"]').length, 1);
  assert.equal(root(card).querySelector('.hero .default-settings'), null);
  assert.ok(root(card).querySelector('.default-settings [data-action="apply-defaults"]'));
});


test('overall progress ignores native room percentage and includes final dock confirmation', async () => {
  const {card} = await fixture();
  const stages = [{target:'0_5',mode:'vacuum'},{target:'0_5',mode:'mop'},{target:'0_12',mode:'vacuum'},{target:'0_12',mode:'mop'}];
  card.setConfig({...card.config, progress_entity:'sensor.rover_progress'});
  const publish=async (phase,completed,nativeProgress,robotState='cleaning')=>{
    card.hass={...card.hass,states:{...card.hass.states,
      'vacuum.rover':entity(robotState,{supported_features:8192|4|8|16}),
      'sensor.rover_status':entity(robotState==='cleaning'?'cleaning':'charging'),
      'binary_sensor.rover_cleaning':entity(robotState==='cleaning'?'on':'off'),
      'sensor.rover_progress':entity(String(nativeProgress)),
      'sensor.robot_cleaner_queue':entity(phase,{vacuum:'vacuum.rover',mode:'manual',control_version:6,stages,targets:['0_5','0_12'],completed,current_index:completed,floor_cleaning_complete:completed===4})}};
    await settle(card);
  };
  await publish('running',2,95);
  assert.equal(root(card).querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'40');
  assert.match(root(card).querySelector('.progress-summary').textContent,/2 \/ 5 steps/);
  await publish('running',2,1);
  assert.equal(root(card).querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'40');
  await publish('finishing',4,100,'returning');
  assert.equal(root(card).querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'80');
  await publish('completed',4,100,'docked');
  assert.equal(root(card).querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'100');
});

test('an app-started clean after a completed sequence keeps its own metrics and progress', async () => {
  const {card} = await fixture();
  card.setConfig({...card.config,progress_entity:'sensor.rover_progress',area_entity:'sensor.rover_area',time_entity:'sensor.rover_time'});
  card.hass={...card.hass,states:{...card.hass.states,
    'vacuum.rover':entity('cleaning',{supported_features:8192|4|8|16}),
    'binary_sensor.rover_cleaning':entity('on'),'sensor.rover_status':entity('cleaning'),
    'sensor.rover_progress':entity('35'), 'sensor.rover_area':entity('12.5',{unit_of_measurement:'m²'}),'sensor.rover_time':entity('9',{unit_of_measurement:'min'}),
    'sensor.robot_cleaner_queue':entity('completed',{vacuum:'vacuum.rover',mode:'manual',control_version:6,stages:[{target:'0_5',mode:'vacuum'}],completed:1,floor_cleaning_complete:true})}};
  await settle(card);
  assert.equal(root(card).querySelector('.progress-summary'),null);
  assert.match(root(card).querySelector('.hero .pills').textContent,/12.5 m².*9 min.*35%/);
  const progress=root(card).querySelector('[role="progressbar"]');
  assert.equal(progress.getAttribute('aria-label'),'Current cleaning progress');
  assert.equal(progress.getAttribute('aria-valuenow'),'35');
});

test('collapsed room settings expose their selected values in the accessible name', async () => {
  const {card} = await fixture();
  const summary=root(card).querySelector('[data-room-editor="0_5"] summary');
  assert.match(summary.getAttribute('aria-label'),/Settings for Hall: Vacuum.*Suction Max\+.*×2/);
});
