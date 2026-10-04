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
const roomDefinitions = [
  { id: 'living', name: 'Living room', preset: 'button.robot_living_room' },
  { id: 'kitchen', name: 'Kitchen', preset: 'button.robot_kitchen' },
  { id: 'hall', name: 'Hall', preset: 'button.robot_hall' },
];
const entity = (state, attributes = {}) => ({ state, attributes });
function initialStates() {
  return {
    'vacuum.robot': entity('docked', { friendly_name: 'Robot', supported_features: FEATURES, battery_level: 84 }),
    'sensor.robot_queue': entity('idle', { vacuum: 'vacuum.robot', presets: [], current_index: 0, completed: 0 }),
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
  await element.updateComplete;
  await Promise.resolve();
  await element.updateComplete;
}
async function fixture({ states = {}, overrides = {}, service, services } = {}) {
  const calls = [];
  const card = document.createElement('robot-vacuum-cleaner-card');
  card.setConfig(config(overrides));
  card.hass = {
    services,
    states: { ...initialStates(), ...states },
    async callService(domain, action, data) {
      calls.push({ domain, action, data: structuredClone(data) });
      return service?.(domain, action, data);
    },
  };
  document.body.append(card);
  await settle(card);
  return { card, calls };
}
const root = card => card.shadowRoot;
const button = (card, action) => root(card).querySelector(`[data-action="${action}"]`);
const room = (card, id) => root(card).querySelector(`[data-room="${id}"]`);
const order = (card, id) => room(card, id).querySelector('.order')?.textContent.trim();
async function tap(card, id) { room(card, id).click(); await settle(card); }
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
  await tap(card, 'hall'); await tap(card, 'living'); await tap(card, 'kitchen');
  assert.equal(order(card, 'hall'), '1');
  assert.equal(order(card, 'living'), '2');
  assert.equal(order(card, 'kitchen'), '3');
  assert.equal(room(card, 'living').getAttribute('aria-pressed'), 'true');
  assert.match(room(card, 'kitchen').getAttribute('aria-label'), /position 3/);
  assert.equal(calls.length, 0);
  assert.match(button(card, 'start').textContent, /Clean 3 rooms/);
});

test('deselecting a room reindexes the remaining sequence; reselecting appends it', async () => {
  const { card } = await fixture();
  await tap(card, 'hall'); await tap(card, 'living'); await tap(card, 'kitchen');
  await tap(card, 'living');
  assert.equal(order(card, 'living'), undefined);
  assert.equal(order(card, 'hall'), '1');
  assert.equal(order(card, 'kitchen'), '2');
  await tap(card, 'living');
  assert.equal(order(card, 'living'), '3');
});

test('ordinary Home Assistant updates preserve the draft room order', async () => {
  const { card } = await fixture();
  await tap(card, 'kitchen'); await tap(card, 'hall');
  await changeStates(card, { 'vacuum.robot': entity('docked', { supported_features: FEATURES, battery_level: 85 }) });
  assert.equal(order(card, 'kitchen'), '1'); assert.equal(order(card, 'hall'), '2');
  assert.match(root(card).querySelector('.battery').textContent, /85%/);
});

test('Start sends the ordered preset buttons and vacuum to the persistent queue', async () => {
  const { card, calls } = await fixture();
  await tap(card, 'hall'); await tap(card, 'living');
  button(card, 'start').click(); await settle(card);
  assert.deepEqual(calls, [{ domain: 'script', action: 'turn_on', data: {
    entity_id: 'script.robot_queue_control', variables: {
      command: 'start', vacuum: 'vacuum.robot',
      presets: ['button.robot_hall', 'button.robot_living_room'],
      cleaning_entity: 'binary_sensor.robot_cleaning', status_entity: 'sensor.robot_status',
      error_entity: 'sensor.robot_error', last_clean_end_entity: 'sensor.robot_last_clean_end',
    },
  } }]);
  // A successful service call is not physical acknowledgement.
  assert.equal(button(card, 'start').disabled, true);
  button(card, 'start').click(); await settle(card);
  assert.equal(calls.length, 1);
  await changeStates(card, { 'sensor.unrelated': entity('on') });
  assert.equal(button(card, 'start').disabled, true);
});

test('backend acknowledgement shows and locks the committed order', async () => {
  const { card, calls } = await fixture();
  await tap(card, 'hall'); await tap(card, 'kitchen');
  button(card, 'start').click(); await settle(card);
  await changeStates(card, {
    'sensor.robot_queue': entity('running', { vacuum: 'vacuum.robot', presets: ['button.robot_hall', 'button.robot_kitchen'], current_index: 0, completed: 0 }),
    'vacuum.robot': entity('cleaning', { supported_features: FEATURES }),
    'sensor.robot_status': entity('segment_cleaning'),
  });
  assert.equal(button(card, 'start'), null);
  assert.match(root(card).querySelector('h2').textContent, /Cleaning Hall/);
  assert.equal(order(card, 'hall'), '1'); assert.equal(order(card, 'kitchen'), '2');
  assert.equal(room(card, 'hall').disabled, true);
  await tap(card, 'living');
  assert.equal(order(card, 'living'), undefined);
  assert.equal(calls.length, 1);
  assert.equal(button(card, 'pause').disabled, false);
});

test('a queue started elsewhere also blocks new starts and preserves backend order', async () => {
  const { card, calls } = await fixture({ states: {
    'sensor.robot_queue': entity('starting', { vacuum: 'vacuum.robot', presets: ['button.robot_kitchen', 'button.robot_living_room'], current_index: 0, completed: 0 }),
  } });
  assert.equal(button(card, 'start'), null);
  assert.equal(order(card, 'kitchen'), '1'); assert.equal(order(card, 'living'), '2');
  assert.equal(room(card, 'hall').disabled, true);
  await tap(card, 'hall'); assert.equal(calls.length, 0);
});

test('preset button unknown is a valid never-pressed state', async () => {
  const { card } = await fixture();
  assert.equal(room(card, 'living').disabled, false);
  await tap(card, 'living');
  assert.equal(button(card, 'start').disabled, false);
});

test('a selected preset becoming unavailable disables Start without losing selection', async () => {
  const { card, calls } = await fixture();
  await tap(card, 'living');
  await changeStates(card, { 'button.robot_living_room': entity('unavailable') });
  assert.equal(order(card, 'living'), '1');
  assert.equal(button(card, 'start').disabled, true);
  assert.equal(room(card, 'living').disabled, false); // Unavailable draft rooms remain removable.
  button(card, 'start').click(); await settle(card);
  assert.equal(calls.length, 0);
  await tap(card, 'living');
  assert.equal(order(card, 'living'), undefined);
  assert.equal(room(card, 'living').disabled, true);
});

test('missing queue backend fails closed for presets but keeps full-home cleaning available', async () => {
  const { card, calls } = await fixture({ states: { 'sensor.robot_queue': undefined, 'script.robot_queue_control': undefined } });
  assert.equal(button(card, 'start').disabled, false);
  await tap(card, 'living');
  assert.equal(button(card, 'start').disabled, true);
  button(card, 'start').click(); await settle(card); assert.equal(calls.length, 0);
  await tap(card, 'living');
  button(card, 'start').click(); await settle(card);
  assert.deepEqual(calls, [{ domain: 'button', action: 'press', data: { entity_id: 'button.robot_all_rooms' } }]);
});

test('a queue assigned to another vacuum cannot start this robot sequence', async () => {
  const { card, calls } = await fixture({ states: {
    'sensor.robot_queue': entity('idle', { vacuum: 'vacuum.other_robot', presets: [] }),
  } });
  await tap(card, 'living'); assert.equal(button(card, 'start').disabled, true);
  button(card, 'start').click(); await settle(card); assert.equal(calls.length, 0);
});

test('service rejection displays a safe error and restores the draft for retry', async () => {
  const { card, calls } = await fixture({ service: async () => { throw new Error('Controller rejected <script>bad()</script>'); } });
  await tap(card, 'hall'); button(card, 'start').click(); await settle(card);
  const alert = root(card).querySelector('[role="alert"]');
  assert.match(alert.textContent, /Controller rejected <script>bad\(\)<\/script>/);
  assert.equal(alert.querySelector('script'), null);
  assert.equal(order(card, 'hall'), '1'); assert.equal(button(card, 'start').disabled, false);
  button(card, 'start').click(); await settle(card); assert.equal(calls.length, 2);
});

test('normal cleaning offers supported Pause and Return to dock controls', async () => {
  const { card, calls } = await fixture({ states: { 'vacuum.robot': entity('cleaning', { supported_features: FEATURES }), 'sensor.robot_status': entity('cleaning') } });
  assert.equal(button(card, 'start'), null);
  button(card, 'pause').click(); await settle(card);
  assert.deepEqual(calls, [{ domain: 'vacuum', action: 'pause', data: { entity_id: 'vacuum.robot' } }]);
  await changeStates(card, { 'vacuum.robot': entity('paused', { supported_features: FEATURES }) });
  button(card, 'resume').click(); await settle(card);
  assert.equal(calls[1].action, 'start');
});

test('unsupported pause and dock features are not offered', async () => {
  const { card, calls } = await fixture({ states: { 'vacuum.robot': entity('cleaning', { supported_features: 8192 }) } });
  assert.equal(button(card, 'pause'), null); assert.equal(button(card, 'dock'), null);
  assert.equal(button(card, 'start'), null); assert.equal(calls.length, 0);
});

test('without a preset, full-home cleaning respects the vacuum START feature', async () => {
  const { card, calls } = await fixture({ overrides: { full_clean_entity: undefined }, states: { 'vacuum.robot': entity('docked', { supported_features: 16 }) } });
  assert.equal(button(card, 'start').disabled, true);
  await changeStates(card, { 'vacuum.robot': entity('docked', { supported_features: 8192 }) });
  button(card, 'start').click(); await settle(card);
  assert.deepEqual(calls, [{ domain: 'vacuum', action: 'start', data: { entity_id: 'vacuum.robot' } }]);
});

test('Return to dock uses the queue return_to_dock command rather than cancellation', async () => {
  const { card, calls } = await fixture({ states: {
    'vacuum.robot': entity('cleaning', { supported_features: FEATURES }),
    'sensor.robot_queue': entity('running', { vacuum: 'vacuum.robot', presets: ['button.robot_living_room'], current_index: 0, completed: 0 }),
  } });
  button(card, 'dock').click(); await settle(card);
  assert.deepEqual(calls, [{ domain: 'script', action: 'turn_on', data: { entity_id: 'script.robot_queue_control', variables: { command: 'return_to_dock', vacuum: 'vacuum.robot' } } }]);
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
  const { card } = await fixture({ overrides: { name: malicious, rooms: [{ ...roomDefinitions[0], name: malicious }] } });
  assert.equal(root(card).querySelector('.name').textContent, malicious);
  assert.equal(root(card).querySelector('.room-name').textContent, malicious);
  assert.equal(root(card).querySelector('img'), null);
  await tap(card, 'living'); assert.match(root(card).querySelector('.sequence').textContent, /<img/);
  assert.equal(root(card).querySelector('img'), null);
});

test('editor emits changed configuration without mutating the input', async () => {
  const Card = customElements.get('robot-vacuum-cleaner-card');
  const editor = await Card.getConfigElement(); const original = config();
  editor.hass = { states: initialStates() }; editor.setConfig(original);
  const events = []; editor.addEventListener('config-changed', event => events.push(event.detail.config));
  document.body.append(editor); await settle(editor);
  const input = editor.shadowRoot.querySelector('[aria-label="Room 1 name"]');
  input.value = 'Reading room'; input.dispatchEvent(new Event('change', { bubbles: true })); await settle(editor);
  assert.equal(events.length, 1); assert.equal(events[0].rooms[0].name, 'Reading room');
  assert.equal(original.rooms[0].name, 'Living room');
  const display = editor.shadowRoot.querySelector('[aria-label="Display name"]');
  display.value = 'My cleaner'; display.dispatchEvent(new Event('change', { bubbles: true })); await settle(editor);
  assert.equal(events[1].name, 'My cleaner');
});


test('native queue service accepts ordered presets without requiring the wrapper script', async () => {
  const { card, calls } = await fixture({
    states: { 'script.robot_queue_control': undefined },
    services: { robot_cleaner_queue: { control: {} } },
  });
  await tap(card, 'kitchen'); await tap(card, 'hall');
  assert.equal(button(card, 'start').disabled, false);
  button(card, 'start').click(); await settle(card);
  assert.equal(calls[0].domain, 'robot_cleaner_queue'); assert.equal(calls[0].action, 'control');
  assert.equal(calls[0].data.command, 'start'); assert.equal(calls[0].data.vacuum, 'vacuum.robot');
  assert.deepEqual(calls[0].data.presets, ['button.robot_kitchen', 'button.robot_hall']);
  assert.equal(calls[0].data.variables, undefined);
});

test('native queue validation errors keep the selected order editable', async () => {
  const { card } = await fixture({
    services: { robot_cleaner_queue: { control: {} } },
    service: async () => { throw new Error('Robot is already cleaning'); },
  });
  await tap(card, 'kitchen'); button(card, 'start').click(); await settle(card);
  assert.match(root(card).querySelector('[role="alert"]').textContent, /already cleaning/);
  assert.equal(order(card, 'kitchen'), '1'); assert.equal(room(card, 'hall').disabled, false);
});

test('full-home preset uses the companion when available to preserve queue ownership', async () => {
  const { card, calls } = await fixture({ services: { robot_cleaner_queue: { control: {} } } });
  button(card, 'start').click(); await settle(card);
  assert.equal(calls.length, 1); assert.equal(calls[0].domain, 'robot_cleaner_queue');
  assert.equal(calls[0].data.command, 'start');
  assert.deepEqual(calls[0].data.presets, ['button.robot_all_rooms']);
});

test('attention requires clearing the old sequence before starting another', async () => {
  const { card, calls } = await fixture({ states: {
    'sensor.robot_queue': entity('attention', { vacuum: 'vacuum.robot', presets: ['button.robot_living_room'], current_index: 0, completed: 0, error: 'Completion was not confirmed' }),
  } });
  assert.equal(button(card, 'start').disabled, true);
  assert.match(root(card).querySelector('.subline').textContent, /not confirmed/);
  button(card, 'clear-queue').click(); await settle(card);
  assert.deepEqual(calls, [{ domain: 'script', action: 'turn_on', data: { entity_id: 'script.robot_queue_control', variables: { command: 'cancel', vacuum: 'vacuum.robot' } } }]);
  await changeStates(card, { 'sensor.robot_queue': entity('cancelled', { vacuum: 'vacuum.robot', presets: [], completed: 0 }) });
  assert.equal(button(card, 'clear-queue'), null);
  assert.equal(button(card, 'start').disabled, false);
});

test('clearing an uncertain queue remains possible while the robot is unavailable', async () => {
  const { card, calls } = await fixture({ states: {
    'vacuum.robot': entity('unavailable'),
    'sensor.robot_queue': entity('attention', { vacuum: 'vacuum.robot', presets: ['button.robot_living_room'] }),
  } });
  assert.equal(button(card, 'clear-queue').disabled, false);
  button(card, 'clear-queue').click(); await settle(card);
  assert.equal(calls[0].data.variables.command, 'cancel');
  assert.equal(calls.some(call => call.domain === 'vacuum' || call.domain === 'button'), false);
});

test('paused robot with START but no PAUSE support still offers Resume', async () => {
  const { card, calls } = await fixture({ states: { 'vacuum.robot': entity('paused', { supported_features: 8192 | 16 }) } });
  assert.equal(button(card, 'resume').disabled, false);
  button(card, 'resume').click(); await settle(card);
  assert.deepEqual(calls, [{ domain: 'vacuum', action: 'start', data: { entity_id: 'vacuum.robot' } }]);
});

test('a running queue cannot dispatch controls through an unavailable controller', async () => {
  const { card, calls } = await fixture({ states: {
    'vacuum.robot': entity('cleaning', { supported_features: FEATURES }),
    'sensor.robot_queue': entity('running', { vacuum: 'vacuum.robot', presets: ['button.robot_living_room'] }),
    'script.robot_queue_control': entity('unavailable'),
  } });
  assert.equal(button(card, 'pause').disabled, true); assert.equal(button(card, 'dock').disabled, true);
  button(card, 'dock').click(); await settle(card); assert.equal(calls.length, 0);
});


test('mop servicing does not offer physical pause or docking controls', async () => {
  const {card} = await fixture({states: {
    'vacuum.robot': entity('cleaning',{supported_features:FEATURES}),
    'binary_sensor.robot_cleaning': entity('on'),
    'sensor.robot_status': entity('washing_the_mop'),
    'sensor.robot_queue': entity('running',{vacuum:'vacuum.robot',presets:['button.robot_kitchen'],current_index:0,completed:0}),
  }});
  assert.equal(button(card,'pause'),null);
  assert.equal(button(card,'dock'),null);
  assert.match(root(card).querySelector('h2').textContent,/Washing/);
});

test('next room stays queued while the robot returns to the dock', async () => {
  const {card} = await fixture({states: {
    'vacuum.robot': entity('returning',{supported_features:FEATURES}),
    'sensor.robot_queue': entity('running',{vacuum:'vacuum.robot',presets:['button.robot_kitchen','button.robot_hall'],current_index:1,completed:1,waiting_for_dock:true}),
  }});
  assert.equal(order(card,'kitchen'),'1');
  assert.match(room(card,'kitchen').textContent,/Completed/);
  assert.match(room(card,'hall').textContent,/Queued/);
  assert.match(root(card).querySelector('.subline').textContent,/Next: Hall/);
});
