import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { Window } from 'happy-dom';

// The actual release bundle runs against mocked HA entities/services only.
// Never send physical robot commands from tests.
const browser = new Window({ url: 'http://card.test/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'ShadowRoot', 'Document', 'CSSStyleSheet', 'customElements', 'Event', 'CustomEvent', 'MutationObserver', 'Node', 'HTMLInputElement', 'HTMLSelectElement']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? browser : browser[key] });
}
await import('../dist/robot-vacuum-cleaner-card.js');

const FEATURES = 8192 | 4 | 16;
// Legacy configuration: still read without error, no longer a tile model.
const roomDefinitions = [
  { id: 'living', name: 'Living room', preset: 'button.robot_living_room' },
  { id: 'kitchen', name: 'Kitchen', preset: 'button.robot_kitchen' },
  { id: 'hall', name: 'Hall', preset: 'button.robot_hall' },
];
// The robot's own map is what the tiles come from now: living -> 0_1, and so on.
const ROOM_DEFAULTS = { mode: 'vacuum_mop', suction: 'balanced', water: 'medium', route: 'standard', repeat: 1 };
const roomCapabilities = () => ({
  supported: true, current_map: 0, area_cleaning: true, rooms_complete: true,
  modes: [{ value: 'vacuum', label: 'Vacuum' }, { value: 'mop', label: 'Mop' },
          { value: 'vacuum_mop', label: 'Vacuum & mop' }, { value: 'vacuum_then_mop', label: 'Vacuum then mop' }],
  suction: ['quiet', 'balanced', 'turbo', 'max', 'max_plus'], water: ['low', 'medium', 'high'],
  routes: ['standard', 'deep', 'deep_plus', 'fast'],
  routes_by_mode: { vacuum: [], vacuum_mop: ['standard', 'fast'], mop: ['standard', 'deep', 'deep_plus', 'fast'], vacuum_then_mop: ['standard', 'deep', 'deep_plus', 'fast'] },
  repeats: [1, 2], room_targets: [{ id: 'living_area', name: 'Living room' }, { id: 'kitchen_area', name: 'Kitchen' }],
  defaults: { ...ROOM_DEFAULTS },
  robot_maps: [{ flag: 0, name: 'Ground floor' }],
  robot_rooms: [
    { id: '0_1', segment: 1, name: 'Living room', floor: 'Ground floor', area_id: null },
    { id: '0_2', segment: 2, name: 'Kitchen', floor: 'Ground floor', area_id: null },
    { id: '0_3', segment: 3, name: 'Hall', floor: 'Ground floor', area_id: null },
  ],
});
const entity = (state, attributes = {}) => ({ state, attributes });
function initialStates() {
  return {
    'vacuum.robot': entity('docked', { friendly_name: 'Robot', supported_features: FEATURES, battery_level: 84 }),
    'sensor.robot_queue': entity('idle', { vacuum: 'vacuum.robot', control_version: 5, mode: 'preset', presets: [], targets: [], stages: [], setup: {}, current_index: 0, completed: 0 }),
    'script.robot_queue_control': entity('off'),
    'button.robot_all_rooms': entity('unknown'),
    'button.robot_living_room': entity('unknown'),
    'button.robot_kitchen': entity('unknown'),
    'button.robot_hall': entity('unknown'),
    'binary_sensor.robot_cleaning': entity('off'),
    'sensor.robot_status': entity('charging'),
    'sensor.robot_error': entity('none'),
    'sensor.robot_dock_error': entity('none'),
    'sensor.robot_last_clean_end': entity('2026-01-01T12:00:00+00:00'),
  };
}
function config(overrides = {}) {
  return {
    type: 'custom:robot-vacuum-cleaner-card', entity: 'vacuum.robot',
    queue_entity: 'sensor.robot_queue', queue_script: 'script.robot_queue_control',
    full_clean_entity: 'button.robot_all_rooms',
    cleaning_entity: 'binary_sensor.robot_cleaning', status_entity: 'sensor.robot_status',
    error_entity: 'sensor.robot_error', dock_error_entity: 'sensor.robot_dock_error',
    last_clean_end_entity: 'sensor.robot_last_clean_end',
    rooms: structuredClone(roomDefinitions), ...overrides,
  };
}
async function settle(element) {
  // Commands await the service before they set their error, so allow a few turns.
  for (let round = 0; round < 3; round++) { await element.updateComplete; await Promise.resolve(); }
  await element.updateComplete;
}
async function fixture({ states = {}, overrides = {}, service, services, capabilities } = {}) {
  const calls = [];
  let caps = structuredClone(capabilities ?? roomCapabilities());
  const card = document.createElement('robot-vacuum-cleaner-card');
  card.setConfig(config(overrides));
  card.hass = {
    services: services ?? { robot_cleaner_queue: { control: {}, get_capabilities: {}, save_preset: {} } },
    states: { ...initialStates(), ...states },
    async callWS() { return { response: structuredClone(caps) }; },
    async callService(domain, action, data) {
      calls.push({ domain, action, data: structuredClone(data) });
      return service?.(domain, action, data);
    },
  };
  document.body.append(card);
  await settle(card);
  return { card, calls, setCapabilities(value) { caps = structuredClone(value); } };
}
const root = card => card.shadowRoot;
const button = (card, action) => root(card).querySelector(`[data-action="${action}"]`);
const room = (card, id) => root(card).querySelector(`[data-room="${id}"]`);
const order = (card, id) => room(card, id).querySelector('.order')?.textContent.trim();
async function tap(card, id) { room(card, id).click(); await settle(card); }
const textButton = (card, text) => [...root(card).querySelectorAll('button')].find(node => node.textContent.trim() === text);
async function clickText(card, text) {
  const target = textButton(card, text);
  assert.ok(target, `Expected a "${text}" button`);
  target.click();
  await settle(card);
}
async function changeStates(card, patch) {
  card.hass = { ...card.hass, states: { ...card.hass.states, ...patch } };
  await settle(card);
}
afterEach(() => {
  for (const node of [...document.body.children]) node.remove();
});
after(async () => { await browser.happyDOM.abort(); browser.close(); });

test('room taps choose an ordered sequence without starting the robot', async () => {
  const { card, calls } = await fixture();
  await tap(card, '0_3'); await tap(card, '0_1'); await tap(card, '0_2');
  assert.equal(order(card, '0_3'), '1');
  assert.equal(order(card, '0_1'), '2');
  assert.equal(order(card, '0_2'), '3');
  assert.equal(room(card, '0_1').getAttribute('aria-pressed'), 'true');
  assert.match(room(card, '0_2').getAttribute('aria-label'), /position 3/);
  assert.equal(calls.length, 0);
  assert.match(button(card, 'start').textContent, /Start sequence · 3 rooms/);
});

test('deselecting a room reindexes the remaining sequence; reselecting appends it', async () => {
  const { card } = await fixture();
  await tap(card, '0_3'); await tap(card, '0_1'); await tap(card, '0_2');
  await tap(card, '0_1');
  assert.equal(order(card, '0_1'), undefined);
  assert.equal(order(card, '0_3'), '1');
  assert.equal(order(card, '0_2'), '2');
  await tap(card, '0_1');
  assert.equal(order(card, '0_1'), '3');
});

test('ordinary Home Assistant updates preserve the draft room order', async () => {
  const { card } = await fixture();
  await tap(card, '0_2'); await tap(card, '0_3');
  await changeStates(card, { 'vacuum.robot': entity('docked', { supported_features: FEATURES, battery_level: 85 }) });
  assert.equal(order(card, '0_2'), '1'); assert.equal(order(card, '0_3'), '2');
  assert.match(root(card).querySelector('.battery').textContent, /85%/);
});

test('Start sends the ordered rooms with the settings each one runs with', async () => {
  const { card, calls } = await fixture();
  await tap(card, '0_3'); await tap(card, '0_1');
  button(card, 'start').click(); await settle(card);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, 'robot_cleaner_queue'); assert.equal(calls[0].action, 'control');
  assert.deepEqual(calls[0].data, { command: 'start_manual', vacuum: 'vacuum.robot',
    rooms: [{ id: '0_3', ...ROOM_DEFAULTS }, { id: '0_1', ...ROOM_DEFAULTS }], setup: {} });
  assert.equal(calls[0].data.presets, undefined);
  assert.equal(calls.some(call => call.domain === 'button' || call.domain === 'script'), false);
  // A successful service call is not physical acknowledgement.
  assert.equal(button(card, 'start').disabled, true);
  button(card, 'start').click(); await settle(card);
  assert.equal(calls.length, 1);
  await changeStates(card, { 'sensor.unrelated': entity('on') });
  assert.equal(button(card, 'start').disabled, true);
});

test('backend acknowledgement shows and locks the committed order', async () => {
  const { card, calls } = await fixture();
  await tap(card, '0_3'); await tap(card, '0_2');
  button(card, 'start').click(); await settle(card);
  await changeStates(card, {
    'sensor.robot_queue': entity('running', { vacuum: 'vacuum.robot', control_version: 5, mode: 'manual', presets: [],
      targets: ['0_3', '0_2'], stages: [{ target: '0_3', mode: 'vacuum_mop', room_index: 0, pass_index: 0, repeat_index: 0 }],
      setup: { rooms: [{ id: '0_3', name: 'Hall', setup: { ...ROOM_DEFAULTS } }, { id: '0_2', name: 'Kitchen', setup: { ...ROOM_DEFAULTS } }] },
      current_index: 0, completed: 0 }),
    'vacuum.robot': entity('cleaning', { supported_features: FEATURES }),
    'sensor.robot_status': entity('segment_cleaning'),
  });
  assert.equal(button(card, 'start'), null);
  assert.match(root(card).querySelector('h2').textContent, /Cleaning Hall/);
  assert.equal(order(card, '0_3'), '1'); assert.equal(order(card, '0_2'), '2');
  assert.equal(room(card, '0_3').disabled, true);
  await tap(card, '0_1');
  assert.equal(order(card, '0_1'), undefined);
  assert.equal(calls.length, 1);
  assert.equal(button(card, 'pause').disabled, false);
});

test('a queue started elsewhere also blocks new starts and preserves backend order', async () => {
  const { card, calls } = await fixture({ states: {
    'sensor.robot_queue': entity('starting', { vacuum: 'vacuum.robot', control_version: 5, mode: 'manual', presets: [],
      targets: ['0_2', '0_1'], stages: [{ target: '0_2', mode: 'vacuum_mop', room_index: 0, pass_index: 0, repeat_index: 0 }],
      setup: { rooms: [{ id: '0_2', name: 'Kitchen', setup: { ...ROOM_DEFAULTS } }, { id: '0_1', name: 'Living room', setup: { ...ROOM_DEFAULTS } }] },
      current_index: 0, completed: 0 }),
  } });
  assert.equal(button(card, 'start'), null);
  assert.equal(order(card, '0_2'), '1'); assert.equal(order(card, '0_1'), '2');
  assert.equal(room(card, '0_3').disabled, true);
  await tap(card, '0_3'); assert.equal(calls.length, 0);
});

test('a room the app has not named falls back to its segment', async () => {
  const { card } = await fixture({ capabilities: { ...roomCapabilities(),
    robot_rooms: roomCapabilities().robot_rooms.map(room => room.id === '0_3' ? { ...room, name: null } : room) } });
  assert.match(room(card, '0_3').textContent, /Room 3/);
  await tap(card, '0_3');
  assert.equal(button(card, 'start').disabled, false);
});

test('a selected room leaving the current map disables Start without losing the selection', async () => {
  const { card, calls, setCapabilities } = await fixture();
  await tap(card, '0_1');
  // The robot changed floor, so the room is no longer on its current map.
  setCapabilities({ ...roomCapabilities(), current_map: 1,
    robot_rooms: [{ id: '1_1', segment: 1, name: 'Loft', floor: 'Loft', area_id: null }] });
  // Capabilities are read when the card needs them again, so let it look.
  button(card, 'refresh-rooms').click(); await settle(card);
  assert.match(root(card).textContent, /no longer on this map/i);
  assert.equal(button(card, 'start').disabled, true);
  button(card, 'start').click(); await settle(card);
  assert.equal(calls.length, 0);
  // Clearing the stale selection makes the new floor's rooms startable again.
  await clickText(card, 'Clear selection');
  assert.equal(button(card, 'start').disabled, true);
  button(card,'select-all').click(); await settle(card);
  assert.equal(button(card,'start').disabled,false);
});

test('without the queue backend an unselected whole-home clean cannot run', async () => {
  const {card,calls}=await fixture({services:{},states:{'sensor.robot_queue':undefined,'script.robot_queue_control':undefined}});
  assert.ok(!room(card,'0_1')); assert.equal(button(card,'start').disabled,true);
  button(card,'start').click(); await settle(card); assert.deepEqual(calls,[]);
});

test('a queue assigned to another vacuum is ignored rather than reused', async () => {
  const { card, calls } = await fixture({ states: {
    'sensor.robot_queue': entity('running', { vacuum: 'vacuum.other_robot', control_version: 5, mode: 'manual', presets: [],
      targets: ['0_1'], stages: [{ target: '0_1', mode: 'vacuum_mop', room_index: 0, pass_index: 0, repeat_index: 0 }],
      setup: { rooms: [{ id: '0_1', name: 'Living room', setup: { ...ROOM_DEFAULTS } }] }, current_index: 0, completed: 0 }),
  } });
  // The other robot's committed order must never appear on this card.
  assert.equal(order(card, '0_1'), undefined);
  assert.ok(!/Queued|Completed/.test(room(card, '0_1').textContent));
  const start = button(card, 'start');
  if (start && !start.disabled) { start.click(); await settle(card); }
  assert.equal(calls.some(call => ['script', 'button'].includes(call.domain)), false);
});

test('service rejection displays a safe error and restores the draft for retry', async () => {
  const { card, calls } = await fixture({ service: async () => { throw new Error('Controller rejected <script>bad()</script>'); } });
  await tap(card, '0_3'); button(card, 'start').click(); await settle(card);
  const alert = root(card).querySelector('[role="alert"]');
  assert.match(alert.textContent, /Controller rejected <script>bad\(\)<\/script>/);
  assert.equal(alert.querySelector('script'), null);
  assert.equal(order(card, '0_3'), '1'); assert.equal(button(card, 'start').disabled, false);
  button(card, 'start').click(); await settle(card); assert.equal(calls.length, 2);
});

test('normal cleaning offers supported Pause and Return to dock controls', async () => {
  const { card, calls } = await fixture({ states: { 'vacuum.robot': entity('cleaning', { supported_features: FEATURES }), 'sensor.robot_status': entity('cleaning') } });
  assert.equal(button(card, 'start'), null);
  button(card, 'pause').click(); await settle(card);
  assert.deepEqual(calls, [{ domain: 'robot_cleaner_queue', action: 'control', data: { command: 'pause', vacuum: 'vacuum.robot' } }]);
  await changeStates(card, { 'vacuum.robot': entity('paused', { supported_features: FEATURES }) });
  button(card, 'resume').click(); await settle(card);
  assert.equal(calls[1].data.command, 'resume');
});

test('unsupported pause and dock features are not offered', async () => {
  const { card, calls } = await fixture({ states: { 'vacuum.robot': entity('cleaning', { supported_features: 8192 }) } });
  assert.equal(button(card, 'pause'), null); assert.equal(button(card, 'dock'), null);
  assert.equal(button(card, 'start'), null); assert.equal(calls.length, 0);
});

test('without a companion the card never launches a whole-home fallback',async()=>{
  for(const features of [0,8192]) {
    const {card,calls}=await fixture({services:{},states:{'vacuum.robot':entity('docked',{supported_features:features})}});
    assert.equal(button(card,'start').disabled,true);button(card,'start').click();await settle(card);assert.deepEqual(calls,[]);
  }
});

test('Return to dock uses the queue return_to_dock command rather than cancellation', async () => {
  const { card, calls } = await fixture({ states: {
    'vacuum.robot': entity('cleaning', { supported_features: FEATURES }),
    'sensor.robot_queue': entity('running', { vacuum: 'vacuum.robot', control_version: 5, mode: 'manual', presets: [],
      targets: ['0_1'], stages: [{ target: '0_1', mode: 'vacuum_mop', room_index: 0, pass_index: 0, repeat_index: 0 }],
      setup: { rooms: [{ id: '0_1', name: 'Living room', setup: { ...ROOM_DEFAULTS } }] }, current_index: 0, completed: 0 }),
  } });
  button(card, 'dock').click(); await settle(card);
  assert.deepEqual(calls, [{ domain: 'robot_cleaner_queue', action: 'control', data: { command: 'return_to_dock', vacuum: 'vacuum.robot' } }]);
});

test('a command still being confirmed explains itself and blocks a second one', async () => {
  const { card, calls } = await fixture({ states: {
    'vacuum.robot': entity('cleaning', { supported_features: FEATURES }),
    'sensor.robot_queue': entity('running', { vacuum: 'vacuum.robot', control_version: 5, presets: [], current_index: 0, completed: 0 }),
  } });
  button(card, 'dock').click(); await settle(card);
  // The old failure mode: the button went dim and every further press vanished silently.
  assert.match(root(card).textContent, /Waiting for the robot to reach the dock/);
  assert.equal(button(card, 'dock').disabled, true);
  assert.equal(calls.length, 1);
  await changeStates(card, { 'vacuum.robot': entity('returning', { supported_features: FEATURES }) });
  assert.doesNotMatch(root(card).textContent, /Waiting for the robot to reach the dock/);
  assert.equal(calls.length, 1);
});

test('stop says which confirmation it is waiting for', async () => {
  const { card, calls } = await fixture({ states: {
    'vacuum.robot': entity('cleaning', { supported_features: 8192 | 4 | 8 | 16 }),
    'sensor.robot_queue': entity('running', { vacuum: 'vacuum.robot', control_version: 5, presets: [], current_index: 0, completed: 0 }),
  } });
  button(card, 'stop').click(); await settle(card);
  assert.match(root(card).textContent, /Waiting for the robot to stop/);
  assert.equal(calls.length, 1);
});

test('returning robot does not offer a duplicate Return to dock action', async () => {
  const { card } = await fixture({ states: { 'vacuum.robot': entity('returning', { supported_features: FEATURES }) } });
  assert.equal(button(card, 'dock'), null); assert.equal(button(card, 'start'), null);
});

for (const state of ['unknown', 'unavailable', 'error']) {
  test(`robot state ${state} blocks blind cleaning starts`, async () => {
    const { card, calls } = await fixture({ states: { 'vacuum.robot': entity(state, { supported_features: FEATURES }) } });
    assert.equal(button(card, 'start').disabled, true);
    button(card, 'start').click(); await settle(card); assert.equal(calls.length, 0);
  });
}

test('reported vacuum or dock faults prevent new cleaning jobs', async () => {
  const { card, calls } = await fixture({ states: { 'sensor.robot_error': entity('main_brush_jammed') } });
  assert.match(root(card).querySelector('h2').textContent, /Needs attention/);
  assert.match(root(card).querySelector('.subline').textContent, /Main brush jammed/);
  assert.equal(button(card, 'start').disabled, true);
  await changeStates(card, { 'sensor.robot_error': entity('none'), 'sensor.robot_dock_error': entity('water_tank_empty') });
  assert.equal(button(card, 'start').disabled, true);
  button(card, 'start').click(); assert.equal(calls.length, 0);
});

test('robot and room names render as text, not executable markup', async () => {
  const malicious = '<img src=x onerror="alert(1)">';
  const { card } = await fixture({ overrides: { name: malicious },
    capabilities: { ...roomCapabilities(), robot_rooms: [{ id: '0_1', segment: 1, name: malicious, floor: 'Ground floor', area_id: null }] } });
  assert.equal(root(card).querySelector('.name').textContent, malicious);
  assert.equal(root(card).querySelector('.room-name').textContent, malicious);
  assert.equal(root(card).querySelector('img'), null);
  await tap(card, '0_1'); assert.match(root(card).querySelector('.sequence').textContent, /<img/);
  assert.equal(root(card).querySelector('img'), null);
});

test('editor configures the robot and room appearance without routine rooms', async () => {
  const Card = customElements.get('robot-vacuum-cleaner-card');
  const editor = await Card.getConfigElement(); const original = config();
  editor.hass = { states: initialStates() }; editor.setConfig(original);
  const events = []; editor.addEventListener('config-changed', event => events.push(event.detail.config));
  document.body.append(editor); await settle(editor);
  // Rooms come from the robot now, so there are no per-room preset buttons to configure.
  assert.equal(editor.shadowRoot.querySelector('[aria-label="Room 1 name"]'), null);
  assert.equal(editor.shadowRoot.querySelector('[aria-label="Room 1 preset"]'), null);
  // The full-home routine button is gone from the editor too.
  assert.equal(editor.shadowRoot.querySelector('[aria-label="Full-home preset (optional)"]'), null);
  assert.equal(editor.shadowRoot.querySelector('[aria-label="Full-home preset"]'), null);
  // A configuration that still carries one loads without error and is simply unused.
  assert.equal(original.full_clean_entity, 'button.robot_all_rooms');
  const display = editor.shadowRoot.querySelector('[aria-label="Display name"]');
  display.value = 'My cleaner'; display.dispatchEvent(new Event('change', { bubbles: true })); await settle(editor);
  assert.equal(events.length, 1); assert.equal(events[0].name, 'My cleaner');
  const addAppearance = editor.shadowRoot.querySelector('[data-action="add-area-override"]');
  addAppearance.click(); await settle(editor);
  const id = editor.shadowRoot.querySelector('[aria-label="Area 1 ID"]');
  id.value = 'kitchen'; id.dispatchEvent(new Event('change', { bubbles: true })); await settle(editor);
  const last = events.at(-1);
  assert.deepEqual(last.area_overrides, {kitchen: {}});
  assert.equal(original.area_overrides, undefined);
});


test('a room plan goes to the queue service without the wrapper script', async () => {
  const { card, calls } = await fixture({ states: { 'script.robot_queue_control': undefined } });
  await tap(card, '0_2'); await tap(card, '0_3');
  assert.equal(button(card, 'start').disabled, false);
  button(card, 'start').click(); await settle(card);
  assert.equal(calls[0].domain, 'robot_cleaner_queue'); assert.equal(calls[0].action, 'control');
  assert.equal(calls[0].data.command, 'start_manual');
  assert.deepEqual(calls[0].data.rooms.map(room => room.id), ['0_2', '0_3']);
  assert.equal(calls.some(call => call.domain === 'script'), false);
});

test('native queue validation errors keep the selected order editable', async () => {
  const { card } = await fixture({ service: async () => { throw new Error('Robot is already cleaning'); } });
  await tap(card, '0_2'); button(card, 'start').click(); await settle(card);
  assert.match(root(card).querySelector('[role="alert"]').textContent, /already cleaning/);
  assert.equal(order(card, '0_2'), '1'); assert.equal(room(card, '0_3').disabled, false);
});

test('Select all explicitly plans every current-map room in tile order', async () => {
  const { card, calls } = await fixture();
  assert.equal(button(card,'start').disabled,true);
  button(card,'select-all').click(); await settle(card);
  assert.match(button(card,'start').textContent,/Start sequence/);
  button(card, 'start').click(); await settle(card);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, 'robot_cleaner_queue');
  assert.equal(calls[0].data.command, 'start_manual');
  assert.deepEqual(calls[0].data.rooms, [
    { id: '0_1', ...ROOM_DEFAULTS }, { id: '0_2', ...ROOM_DEFAULTS }, { id: '0_3', ...ROOM_DEFAULTS }]);
  assert.equal(calls[0].data.presets, undefined);
  // No routine entity is touched anywhere: the plan is the robot's own rooms.
  assert.equal(calls.some(call => ['button', 'script'].includes(call.domain)), false);
});

test('Select all keeps settings edited inline before selection', async () => {
  const {card,calls}=await fixture();
  const select=root(card).querySelector('[data-room-editor="0_2"] [data-room-setting="mode"]');
  select.value='vacuum';select.dispatchEvent(new Event('change',{bubbles:true}));await settle(card);
  button(card,'select-all').click();await settle(card);
  button(card,'start').click();await settle(card);
  assert.deepEqual(calls[0].data.rooms,[{id:'0_1',...ROOM_DEFAULTS},{id:'0_2',mode:'vacuum',suction:'balanced',repeat:1},{id:'0_3',...ROOM_DEFAULTS}]);
});

test('attention requires clearing the old sequence before starting another', async () => {
  const { card, calls } = await fixture({ states: {
    'sensor.robot_queue': entity('attention', { vacuum: 'vacuum.robot', control_version: 5, mode: 'manual', presets: [], targets: ['0_1'],
      stages: [{ target: '0_1', mode: 'vacuum_mop', room_index: 0, pass_index: 0, repeat_index: 0 }], setup: {}, current_index: 0, completed: 0,
      error: 'Completion was not confirmed' }),
  } });
  assert.equal(button(card, 'start').disabled, true);
  assert.match(root(card).querySelector('.subline').textContent, /not confirmed/);
  button(card, 'clear-queue').click(); await settle(card);
  assert.deepEqual(calls, [{ domain: 'robot_cleaner_queue', action: 'control', data: { command: 'cancel', vacuum: 'vacuum.robot' } }]);
  await changeStates(card, { 'sensor.robot_queue': entity('cancelled', { vacuum: 'vacuum.robot', control_version: 5, presets: [], targets: [], completed: 0 }) });
  assert.equal(button(card, 'clear-queue'), null);
  assert.equal(button(card, 'start').disabled, true);
  await tap(card,'0_1'); assert.equal(button(card,'start').disabled,false);
});

test('clearing an uncertain queue remains possible while the robot is unavailable', async () => {
  const { card, calls } = await fixture({ states: {
    'vacuum.robot': entity('unavailable'),
    'sensor.robot_queue': entity('attention', { vacuum: 'vacuum.robot', control_version: 5, presets: [], targets: ['0_1'] }),
  } });
  assert.equal(button(card, 'clear-queue').disabled, false);
  button(card, 'clear-queue').click(); await settle(card);
  assert.equal(calls[0].data.command, 'cancel');
  assert.equal(calls[0].action, 'control');
  assert.equal(calls.some(call => call.domain === 'vacuum' || call.domain === 'button'), false);
});

test('paused robot with START but no PAUSE support still offers Resume', async () => {
  const { card, calls } = await fixture({ states: { 'vacuum.robot': entity('paused', { supported_features: 8192 | 16 }) } });
  assert.equal(button(card, 'resume').disabled, false);
  button(card, 'resume').click(); await settle(card);
  assert.deepEqual(calls, [{ domain: 'robot_cleaner_queue', action: 'control', data: { command: 'resume', vacuum: 'vacuum.robot' } }]);
});

test('a running queue cannot dispatch controls through an unavailable controller', async () => {
  const { card, calls } = await fixture({ states: {
    'vacuum.robot': entity('cleaning', { supported_features: FEATURES }),
    'sensor.robot_queue': entity('running', { vacuum: 'vacuum.robot', control_version: 5, presets: [], targets: ['0_1'] }),
    'script.robot_queue_control': entity('unavailable'),
  }, services: {} });
  assert.equal(button(card, 'pause').disabled, true); assert.equal(button(card, 'dock').disabled, true);
  button(card, 'dock').click(); await settle(card); assert.equal(calls.length, 0);
});


test('mop servicing does not offer physical pause or docking controls', async () => {
  const {card} = await fixture({states: {
    'vacuum.robot': entity('cleaning',{supported_features:FEATURES}),
    'binary_sensor.robot_cleaning': entity('on'),
    'sensor.robot_status': entity('washing_the_mop'),
    'sensor.robot_queue': entity('running',{vacuum:'vacuum.robot',control_version:5,mode:'manual',presets:[],targets:['0_2'],current_index:0,completed:0}),
  }});
  assert.equal(button(card,'pause'),null);
  assert.equal(button(card,'dock'),null);
  assert.match(root(card).querySelector('h2').textContent,/Washing/);
});

test('next room stays queued while the robot returns to the dock', async () => {
  const {card} = await fixture({states: {
    'vacuum.robot': entity('returning',{supported_features:FEATURES}),
    'sensor.robot_queue': entity('running',{vacuum:'vacuum.robot',control_version:5,mode:'manual',presets:[],targets:['0_2','0_3'],
      stages:[{target:'0_2',mode:'vacuum_mop',room_index:0,pass_index:0,repeat_index:0},{target:'0_3',mode:'vacuum_mop',room_index:1,pass_index:0,repeat_index:0}],
      setup:{rooms:[{id:'0_2',name:'Kitchen',setup:{...ROOM_DEFAULTS}},{id:'0_3',name:'Hall',setup:{...ROOM_DEFAULTS}}]},current_index:1,completed:1,waiting_for_dock:true}),
  }});
  assert.equal(order(card,'0_2'),'1');
  assert.match(room(card,'0_2').textContent,/Completed/);
  assert.match(room(card,'0_3').textContent,/Queued/);
  assert.match(root(card).querySelector('.subline').textContent,/Next: Hall/);
});

test('app-started jobs use the shared companion for pause, resume and docking', async () => {
  const { card, calls } = await fixture({ services: {robot_cleaner_queue:{control:{}}}, states: {
    'vacuum.robot': entity('cleaning', {supported_features:FEATURES}),
    'sensor.robot_status': entity('cleaning'),
    'binary_sensor.robot_cleaning': entity('on'),
  }});
  button(card,'pause').click(); await settle(card);
  assert.deepEqual(calls[0], {domain:'robot_cleaner_queue',action:'control',data:{command:'pause',vacuum:'vacuum.robot'}});
  await changeStates(card, {'vacuum.robot':entity('paused',{supported_features:FEATURES})});
  button(card,'resume').click(); await settle(card);
  assert.equal(calls[1].data.command,'resume');
  await changeStates(card, {'vacuum.robot':entity('cleaning',{supported_features:FEATURES})});
  button(card,'dock').click(); await settle(card);
  assert.equal(calls[2].data.command,'return_to_dock');
  assert.equal(calls.some(call=>['vacuum','button'].includes(call.domain)),false);
});

test('standalone acknowledgement blocks edits without inventing a room sequence', async () => {
  const { card, calls } = await fixture({states:{
    'sensor.robot_queue':entity('controlling',{vacuum:'vacuum.robot',control_version:5,mode:'external',presets:[],targets:[],pending_command:'pause'}),
    'vacuum.robot':entity('cleaning',{supported_features:FEATURES}),
    'sensor.robot_status':entity('cleaning'),
  }});
  assert.equal(button(card,'pause').disabled,true);
  assert.equal(room(card,'0_1').disabled,true);
  assert.match(root(card).querySelector('h2').textContent,/Waiting/);
  assert.doesNotMatch(root(card).textContent,/Room 0 of 0|Room 1 of 0/);
  assert.equal(calls.length,0);
});

for (const missing of ['sensor','service']) test(`required companion ${missing} loss never falls back to native cleaning`, async () => {
  const {card,calls}=await fixture({overrides:{require_queue:true},services:missing==='service'?{}:{robot_cleaner_queue:{control:{}}},states:{
    'script.robot_queue_control':undefined,
    ...(missing==='sensor'?{'sensor.robot_queue':undefined}:{}),
  }});
  assert.equal(button(card,'start').disabled,true);
  button(card,'start').click(); await settle(card);
  await changeStates(card,{'vacuum.robot':entity('cleaning',{supported_features:FEATURES}),'sensor.robot_status':entity('cleaning')});
  assert.equal(button(card,'pause').disabled,true);
  assert.equal(button(card,'dock').disabled,true);
  button(card,'pause').click(); button(card,'dock').click(); await settle(card);
  assert.deepEqual(calls,[]);
});

test('required companion never falls back to a native whole-home clean', async () => {
  const {card,calls}=await fixture({overrides:{require_queue:true,full_clean_entity:undefined},services:{robot_cleaner_queue:{control:{}}}});
  assert.equal(button(card,'start').disabled,true);
  button(card,'start').click(); await settle(card);
  assert.deepEqual(calls,[]);
});

test('a rejected shared external command is shown without native fallback',async()=>{
  const {card,calls}=await fixture({overrides:{require_queue:true},services:{robot_cleaner_queue:{control:{}}},service:async()=>{throw Error('Check the unfinished job first');},states:{
    'vacuum.robot':entity('paused',{supported_features:FEATURES}),'sensor.robot_status':entity('paused'),
  }});
  button(card,'resume').click();await settle(card);
  assert.equal(calls.length,1);assert.equal(calls[0].domain,'robot_cleaner_queue');
  assert.match(root(card).querySelector('[role="alert"]').textContent,/unfinished job/);
});
test('the integration command barrier keeps the movement controls locked', async () => {
  const barrier = Math.floor(Date.now() / 1000) + 600;
  const { card, calls } = await fixture({ states: {
    'vacuum.robot': entity('cleaning', { supported_features: FEATURES }),
    'sensor.robot_queue': entity('cancelled', { vacuum: 'vacuum.robot', command_barrier_until: barrier }),
  } });
  assert.equal(button(card, 'dock').disabled, true);
  button(card, 'dock').click(); await settle(card);
  assert.equal(calls.length, 0);
  await changeStates(card, { 'sensor.robot_queue': entity('cancelled', { vacuum: 'vacuum.robot' }) });
  assert.equal(button(card, 'dock').disabled, false);
});

test('a sequence that needs attention can always be cleared', async () => {
  const { card, calls } = await fixture({ services: { robot_cleaner_queue: { control: {} } }, states: {
    'vacuum.robot': entity('docked', { supported_features: FEATURES }),
    'sensor.robot_queue': entity('attention', {
      vacuum: 'vacuum.robot', error: 'The command failed.', pending_command: 'start',
      command_barrier_until: Math.floor(Date.now() / 1000) + 600,
    }),
  } });
  const clear = root(card).querySelector('[data-action="clear-queue"]');
  assert.ok(clear, 'Expected a clear control while the queue needs attention');
  assert.equal(clear.disabled, false);
  clear.click(); await settle(card);
  assert.deepEqual(calls.map(call => call.data.command), ['cancel']);
});
