import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { Window } from 'happy-dom';

// Exercise the shipping bundle with generic HA fixtures only. Capability reads
// and local drafts are deliberately separate from commands that move a robot.
const browser = new Window({url: 'http://manual-card.test/'});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'ShadowRoot', 'Document', 'CSSStyleSheet', 'customElements', 'Event', 'CustomEvent', 'MutationObserver', 'Node', 'HTMLInputElement', 'HTMLSelectElement', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, {configurable: true, value: key === 'window' ? browser : browser[key]});
}
await import('../dist/robot-vacuum-cleaner-card.js');
const FEATURES = 8192 | 4 | 16;
const entity = (state, attributes = {}) => ({state, attributes});
const baseConfig = {
  type: 'custom:robot-vacuum-cleaner-card', entity: 'vacuum.rover', name: 'Rover',
  queue_entity: 'sensor.robot_cleaner_queue', queue_script: 'script.robot_cleaner_queue_control',
  cleaning_entity: 'binary_sensor.rover_cleaning', status_entity: 'sensor.rover_status',
  error_entity: 'sensor.rover_error', last_clean_end_entity: 'sensor.rover_last_clean_end',
  full_clean_entity: 'button.rover_all',
  rooms: [
    {id: 'living_preset', name: 'Living room preset', preset: 'button.rover_living'},
    {id: 'kitchen_preset', name: 'Kitchen preset', preset: 'button.rover_kitchen'},
  ],
};
const baseCapabilities = {
  supported: true,
  modes: [
    {value: 'vacuum', label: 'Vacuum'}, {value: 'mop', label: 'Mop'},
    {value: 'vacuum_mop', label: 'Vacuum & mop'}, {value: 'vacuum_then_mop', label: 'Vacuum then mop'},
  ],
  suction: ['quiet', 'balanced', 'turbo', 'max', 'max_plus'], water: ['low', 'medium', 'high'],
  routes: ['standard', 'deep', 'deep_plus', 'fast'],
  routes_by_mode: {vacuum: [], vacuum_mop: ['standard', 'fast'], mop: ['standard', 'deep', 'deep_plus', 'fast'], vacuum_then_mop: ['standard', 'deep', 'deep_plus', 'fast']},
  repeats: [1, 2],
  room_targets: [{id: 'living_area', name: 'Living room'}, {id: 'kitchen_area', name: 'Kitchen'}, {id: 'hall_area', name: 'Hall'}],
  defaults: {mode: 'vacuum_mop', suction: 'balanced', water: 'medium', route: 'standard', repeat: 1},
};
function states() {
  return {
    'vacuum.rover': entity('docked', {friendly_name: 'Rover', supported_features: FEATURES, battery_level: 84}),
    'sensor.robot_cleaner_queue': entity('idle', {vacuum: 'vacuum.rover', presets: [], current_index: 0, completed: 0}),
    'script.robot_cleaner_queue_control': entity('off'),
    'binary_sensor.rover_cleaning': entity('off'), 'sensor.rover_status': entity('charging'),
    'sensor.rover_error': entity('none'), 'sensor.rover_last_clean_end': entity('2026-01-01T12:00:00+00:00'),
    'button.rover_all': entity('unknown'), 'button.rover_living': entity('unknown'), 'button.rover_kitchen': entity('unknown'),
  };
}
async function settle(card) {
  for (let index = 0; index < 6; index++) { await card.updateComplete; await Promise.resolve(); }
}
async function fixture(options = {}) {
  const calls = []; const reads = [];
  let capabilities = structuredClone(options.capabilities ?? baseCapabilities);
  const card = document.createElement('robot-vacuum-cleaner-card');
  card.setConfig(structuredClone({...baseConfig, ...options.config}));
  card.hass = {
    states: {...states(), ...options.states},
    services: options.services ?? {robot_cleaner_queue: {control: {}, get_capabilities: {}}},
    async callWS(request) {
      reads.push(structuredClone(request));
      if (options.readError) throw new Error(options.readError);
      return {response: structuredClone(capabilities)};
    },
    async callService(domain, action, data) {
      calls.push({domain, action, data: structuredClone(data)});
      return options.service?.(domain, action, data);
    },
  };
  document.body.append(card); await settle(card);
  return {card, calls, reads, setCapabilities(value) { capabilities = structuredClone(value); }};
}
const root = card => card.shadowRoot;
const action = (card, value) => root(card).querySelector(`[data-action="${value}"]`);
const mode = (card, value) => root(card).querySelector(`[data-mode="${value}"]`);
const setting = (card, key, value) => root(card).querySelector(`[data-setting="${key}"][data-value="${value}"]`);
const room = (card, value) => root(card).querySelector(`[data-room="${value}"]`);
async function click(card, element) { assert.ok(element, 'Expected control to be rendered'); element.click(); await settle(card); }
async function openSetup(card) { await click(card, action(card, 'setup')); }
async function selectManual(card) { await openSetup(card); await click(card, action(card, 'manual')); }
async function apply(card) { await click(card, action(card, 'apply-setup')); }
async function patchStates(card, patch) { card.hass = {...card.hass, states: {...card.hass.states, ...patch}}; await settle(card); }
afterEach(() => { for (const element of [...document.body.children]) element.remove(); });
after(async () => { await browser.happyDOM.abort(); browser.close(); });

test('saved presets stay the default and manual capabilities use a read-only response request', async () => {
  const {card, calls, reads} = await fixture();
  assert.ok(room(card, 'living_preset')); assert.equal(room(card, 'living_area'), null);
  await selectManual(card);
  assert.equal(calls.length, 0);
  assert.ok(reads.length > 0);
  assert.deepEqual(reads[0], {type: 'call_service', domain: 'robot_cleaner_queue', service: 'get_capabilities', service_data: {vacuum: 'vacuum.rover'}, return_response: true});
  for (const value of ['vacuum', 'mop', 'vacuum_mop', 'vacuum_then_mop']) assert.ok(mode(card, value));
});

test('mode, suction, water, route and count are local until Start', async () => {
  const {card, calls} = await fixture();
  await selectManual(card);
  await click(card, mode(card, 'vacuum_then_mop'));
  await click(card, setting(card, 'suction', 'max'));
  await click(card, setting(card, 'water', 'high'));
  await click(card, setting(card, 'route', 'deep'));
  await click(card, setting(card, 'repeat', '2'));
  await apply(card);
  assert.equal(calls.length, 0);
  await click(card, room(card, 'hall_area')); await click(card, room(card, 'kitchen_area'));
  assert.equal(calls.length, 0);
  await click(card, action(card, 'start'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, 'robot_cleaner_queue'); assert.equal(calls[0].action, 'control');
  assert.equal(calls[0].data.command, 'start_manual');
  assert.equal(calls[0].data.vacuum, 'vacuum.rover');
  assert.deepEqual(calls[0].data.rooms, ['hall_area', 'kitchen_area']);
  assert.deepEqual(calls[0].data.setup, {mode: 'vacuum_then_mop', suction: 'max', water: 'high', route: 'deep', repeat: 2});
  assert.equal(calls[0].data.presets, undefined);
  assert.equal(action(card, 'start').disabled, true);
  await click(card, action(card, 'start')); assert.equal(calls.length, 1);
});

test('manual whole-home cleaning uses empty area targets instead of the full-clean preset', async () => {
  const {card, calls} = await fixture();
  await selectManual(card); await apply(card); await click(card, action(card, 'start'));
  assert.equal(calls.length, 1); assert.equal(calls[0].data.command, 'start_manual');
  assert.deepEqual(calls[0].data.rooms, []); assert.equal(calls[0].data.presets, undefined);
  assert.equal(calls[0].data.setup.mode, 'vacuum_mop');
});

test('cancelled setup edits leave the saved-preset selection and behavior intact', async () => {
  const {card, calls} = await fixture();
  await click(card, room(card, 'living_preset')); await selectManual(card);
  await click(card, mode(card, 'mop')); await click(card, action(card, 'close-setup'));
  assert.ok(room(card, 'living_preset')); assert.equal(room(card, 'living_area'), null);
  assert.equal(room(card, 'living_preset').getAttribute('aria-pressed'), 'true');
  await click(card, action(card, 'start'));
  assert.equal(calls[0].data.command, 'start'); assert.deepEqual(calls[0].data.presets, ['button.rover_living']);
});

test('preset order and native-area order are independent drafts', async () => {
  const {card, calls} = await fixture();
  await click(card, room(card, 'kitchen_preset')); await selectManual(card); await apply(card);
  await click(card, room(card, 'hall_area')); await click(card, room(card, 'living_area'));
  await openSetup(card); await click(card, action(card, 'presets')); await apply(card);
  assert.equal(room(card, 'kitchen_preset').querySelector('.order')?.textContent.trim(), '1');
  await selectManual(card); await apply(card);
  assert.equal(room(card, 'hall_area').querySelector('.order')?.textContent.trim(), '1');
  assert.equal(room(card, 'living_area').querySelector('.order')?.textContent.trim(), '2');
  assert.equal(calls.length, 0);
});

test('vacuum hides water and mop-route controls and omits them from the command', async () => {
  const {card, calls} = await fixture();
  await selectManual(card); await click(card, mode(card, 'vacuum'));
  assert.equal(root(card).querySelector('[data-setting="water"]'), null);
  assert.equal(root(card).querySelector('[data-setting="route"]'), null);
  assert.ok(setting(card, 'suction', 'balanced'));
  await apply(card); await click(card, action(card, 'start'));
  assert.deepEqual(calls[0].data.setup, {mode: 'vacuum', suction: 'balanced', repeat: 1});
});

test('mop hides suction and does not send a stale suction setting', async () => {
  const {card, calls} = await fixture();
  await selectManual(card); await click(card, mode(card, 'mop'));
  assert.equal(root(card).querySelector('[data-setting="suction"]'), null);
  assert.ok(setting(card, 'water', 'medium')); assert.ok(setting(card, 'route', 'deep'));
  await apply(card); await click(card, action(card, 'start'));
  assert.equal(calls[0].data.setup.mode, 'mop'); assert.equal(calls[0].data.setup.suction, undefined);
});

test('combined vacuum and mop does not offer deep mop-only routes', async () => {
  const {card} = await fixture();
  await selectManual(card);
  assert.ok(setting(card, 'route', 'standard')); assert.ok(setting(card, 'route', 'fast'));
  assert.equal(setting(card, 'route', 'deep'), null); assert.equal(setting(card, 'route', 'deep_plus'), null);
  await click(card, mode(card, 'mop')); await click(card, setting(card, 'route', 'deep'));
  await click(card, mode(card, 'vacuum_mop')); await apply(card);
  await openSetup(card);
  assert.equal(setting(card, 'route', 'deep'), null);
  assert.equal(setting(card, 'route', 'standard').getAttribute('aria-pressed'), 'true');
});

test('a vacuum-only robot never offers unsupported mopping modes', async () => {
  const capabilities = {...structuredClone(baseCapabilities), modes: [{value: 'vacuum', label: 'Vacuum'}], water: [], routes: [], routes_by_mode: {vacuum: []}, defaults: {mode: 'vacuum', suction: 'quiet', repeat: 1}};
  const {card, calls} = await fixture({capabilities});
  await selectManual(card);
  assert.ok(mode(card, 'vacuum'));
  for (const value of ['mop', 'vacuum_mop', 'vacuum_then_mop']) assert.equal(mode(card, value), null);
  assert.equal(root(card).querySelector('[data-setting="water"]'), null);
  await apply(card); await click(card, action(card, 'start'));
  assert.deepEqual(calls[0].data.setup, {mode: 'vacuum', suction: 'quiet', repeat: 1});
});

test('unavailable capabilities cannot turn into a blind manual start', async () => {
  const {card, calls} = await fixture({capabilities: {supported: false, modes: [], suction: [], water: [], routes: [], repeats: [], room_targets: [], defaults: {}, error: 'Robot settings are unavailable.'}});
  await openSetup(card);
  const manual = action(card, 'manual');
  if (manual && !manual.disabled) await click(card, manual);
  assert.equal(root(card).querySelector('[data-mode]'), null);
  assert.match(root(card).textContent, /unavailable/i);
  assert.equal(calls.length, 0);
  if (action(card, 'apply-setup') && !action(card, 'apply-setup').disabled) await apply(card);
  if (room(card, 'living_area')) assert.equal(action(card, 'start').disabled, true);
});

test('capability service errors are visible and send no robot action', async () => {
  const {card, calls} = await fixture({readError: 'Unable to read robot settings'});
  await openSetup(card);
  const manual = action(card, 'manual'); if (manual && !manual.disabled) await click(card, manual);
  assert.match(root(card).textContent, /Unable to read robot settings/);
  assert.equal(calls.length, 0);
});

test('old companion without capability support keeps preset cleaning available', async () => {
  const {card, calls} = await fixture({services: {robot_cleaner_queue: {control: {}}}});
  await openSetup(card);
  const manual = action(card, 'manual');
  if (manual && !manual.disabled) await click(card, manual);
  assert.match(root(card).textContent, /updated.*companion/i);
  assert.equal(action(card, 'apply-setup').disabled, true);
  assert.equal(root(card).querySelector('[data-mode]'), null);
  assert.equal(calls.length, 0);
  await click(card, action(card, 'close-setup'));
  await click(card, room(card, 'living_preset')); await click(card, action(card, 'start'));
  assert.equal(calls[0].data.command, 'start');
});

test('ordinary entity updates preserve a configured manual draft and room order', async () => {
  const {card, calls} = await fixture();
  await selectManual(card); await click(card, mode(card, 'vacuum_then_mop')); await apply(card);
  await click(card, room(card, 'hall_area')); await click(card, room(card, 'kitchen_area'));
  await patchStates(card, {'vacuum.rover': entity('docked', {supported_features: FEATURES, battery_level: 85})});
  assert.equal(room(card, 'hall_area').querySelector('.order')?.textContent.trim(), '1');
  assert.equal(room(card, 'kitchen_area').querySelector('.order')?.textContent.trim(), '2');
  await click(card, action(card, 'start'));
  assert.equal(calls[0].data.setup.mode, 'vacuum_then_mop');
  assert.deepEqual(calls[0].data.rooms, ['hall_area', 'kitchen_area']);
});

test('a rejected manual start preserves the setup and selected areas for retry', async () => {
  const {card, calls} = await fixture({service: async () => { throw new Error('Mapped area is no longer available'); }});
  await selectManual(card); await click(card, mode(card, 'mop')); await apply(card);
  await click(card, room(card, 'hall_area')); await click(card, action(card, 'start'));
  assert.match(root(card).querySelector('[role="alert"]').textContent, /Mapped area is no longer available/);
  assert.equal(room(card, 'hall_area').getAttribute('aria-pressed'), 'true');
  assert.equal(action(card, 'start').disabled, false);
  await click(card, action(card, 'start'));
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].data.setup, calls[0].data.setup);
});

test('an offline robot cannot start a previously configured manual job', async () => {
  const {card, calls} = await fixture();
  await selectManual(card); await apply(card); await click(card, room(card, 'hall_area'));
  await patchStates(card, {'vacuum.rover': entity('unavailable')});
  assert.equal(action(card, 'start').disabled, true);
  await click(card, action(card, 'start')); assert.equal(calls.length, 0);
});

test('manual cleaning started elsewhere shows the committed native-area sequence', async () => {
  const {card} = await fixture({states: {
    'vacuum.rover': entity('cleaning', {supported_features: FEATURES}),
    'sensor.rover_status': entity('mopping'),
    'sensor.robot_cleaner_queue': entity('running', {
      vacuum: 'vacuum.rover', mode: 'manual', presets: [], targets: ['kitchen_area', 'hall_area'],
      setup: {mode: 'vacuum_then_mop', suction: 'max', water: 'high', route: 'standard', repeat: 1},
      stages: [
        {target: 'kitchen_area', mode: 'vacuum', room_index: 0, pass_index: 0, repeat_index: 0},
        {target: 'hall_area', mode: 'vacuum', room_index: 1, pass_index: 0, repeat_index: 0},
        {target: 'kitchen_area', mode: 'mop', room_index: 0, pass_index: 1, repeat_index: 0},
        {target: 'hall_area', mode: 'mop', room_index: 1, pass_index: 1, repeat_index: 0},
      ], current_index: 2, completed: 2,
    }),
  }});
  assert.equal(action(card, 'start'), null);
  assert.match(root(card).textContent, /Mop|mop/);
  assert.ok(room(card, 'kitchen_area')); assert.ok(room(card, 'hall_area'));
  assert.equal(room(card, 'kitchen_area').disabled, true);
  assert.equal(room(card, 'hall_area').disabled, true);
  assert.doesNotMatch(room(card, 'hall_area').textContent, /Completed/);
});


test('native dialog cancellation discards unapplied changes without sending a command', async () => {
  const {card, calls} = await fixture();
  await selectManual(card); await click(card, mode(card, 'vacuum')); await apply(card);
  await click(card, room(card, 'hall_area'));
  await openSetup(card); await click(card, mode(card, 'mop'));
  const dialog = root(card).querySelector('dialog');
  // Browsers dispatch cancel on Escape and close when it is not prevented.
  // Happy DOM has no operating-system Escape default action, so emulate it.
  if (dialog.dispatchEvent(new Event('cancel', {cancelable: true}))) dialog.close();
  await settle(card);
  assert.equal(root(card).querySelector('[data-mode]'), null);
  assert.equal(room(card, 'hall_area').getAttribute('aria-pressed'), 'true');
  assert.equal(calls.length, 0);
  await click(card, action(card, 'start'));
  assert.equal(calls[0].data.setup.mode, 'vacuum');
});

test('a selected mapped area disappearing disables Start rather than silently ignoring it', async () => {
  const {card, calls, setCapabilities} = await fixture();
  await selectManual(card); await apply(card); await click(card, room(card, 'hall_area'));
  setCapabilities({...structuredClone(baseCapabilities), room_targets: baseCapabilities.room_targets.filter(target => target.id !== 'hall_area')});
  await openSetup(card); await apply(card);
  assert.equal(action(card, 'start').disabled, true);
  await click(card, action(card, 'start')); assert.equal(calls.length, 0);
});

test('manual count shows the current room repeat rather than the vacuum/mop phase number', async () => {
  const {card} = await fixture({states: {
    'vacuum.rover': entity('cleaning', {supported_features: FEATURES}),
    'sensor.rover_status': entity('cleaning'),
    'sensor.robot_cleaner_queue': entity('running', {
      vacuum: 'vacuum.rover', mode: 'manual', presets: [], targets: ['kitchen_area'],
      setup: {mode: 'vacuum_then_mop', suction: 'max', water: 'high', route: 'standard', repeat: 2},
      stages: [
        {target: 'kitchen_area', mode: 'vacuum', room_index: 0, pass_index: 0, repeat_index: 0},
        {target: 'kitchen_area', mode: 'vacuum', room_index: 0, pass_index: 0, repeat_index: 1},
        {target: 'kitchen_area', mode: 'mop', room_index: 0, pass_index: 1, repeat_index: 0},
        {target: 'kitchen_area', mode: 'mop', room_index: 0, pass_index: 1, repeat_index: 1},
      ], current_index: 1, completed: 1,
    }),
  }});
  assert.match(root(card).querySelector('.subline').textContent, /Run 2 of 2/);
  const queue = card.hass.states['sensor.robot_cleaner_queue'];
  await patchStates(card, {'sensor.robot_cleaner_queue': entity('running', {...queue.attributes, current_index: 2, completed: 2})});
  assert.match(root(card).querySelector('.subline').textContent, /Run 1 of 2/);
});

test('an external manual run keeps its completed plan until a new local setup is applied', async () => {
  const attrs = {
    vacuum: 'vacuum.rover', mode: 'manual', presets: [], targets: ['kitchen_area'],
    setup: {mode: 'vacuum_then_mop', suction: 'max', water: 'high', route: 'deep', repeat: 1},
    stages: [
      {target: 'kitchen_area', mode: 'vacuum', room_index: 0, pass_index: 0, repeat_index: 0},
      {target: 'kitchen_area', mode: 'mop', room_index: 0, pass_index: 1, repeat_index: 0},
    ], current_index: 1, completed: 1,
  };
  const {card, calls} = await fixture({states: {
    'vacuum.rover': entity('cleaning', {supported_features: FEATURES}),
    'sensor.rover_status': entity('mopping'),
    'sensor.robot_cleaner_queue': entity('running', attrs),
  }});
  assert.match(action(card, 'setup').textContent, /Vacuum then mop/);
  await patchStates(card, {
    'vacuum.rover': entity('docked', {supported_features: FEATURES}),
    'sensor.rover_status': entity('charging'),
    'sensor.robot_cleaner_queue': entity('completed', {...attrs, completed: 2}),
  });
  assert.ok(room(card, 'kitchen_area')); assert.equal(room(card, 'kitchen_preset'), null);
  assert.match(room(card, 'kitchen_area').textContent, /Completed/);
  assert.match(action(card, 'setup').textContent, /Vacuum then mop/);
  assert.match(root(card).querySelector('h2').textContent, /Your rooms are clean/);
  await openSetup(card); await click(card, mode(card, 'vacuum')); await apply(card);
  assert.match(action(card, 'setup').textContent, /Vacuum/);
  assert.doesNotMatch(action(card, 'setup').textContent, /then mop/);
  assert.doesNotMatch(room(card, 'kitchen_area').textContent, /Completed/);
  assert.match(root(card).querySelector('h2').textContent, /Ready to clean/);
  await click(card, room(card, 'hall_area')); await click(card, action(card, 'start'));
  assert.equal(calls.length, 1); assert.equal(calls[0].data.setup.mode, 'vacuum');
  assert.deepEqual(calls[0].data.rooms, ['hall_area']);
});
