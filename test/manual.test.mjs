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
// The sheet now opens straight into the plan settings; there is no source tab left.
async function selectManual(card) { await openSetup(card); }
async function apply(card) { await click(card, action(card, 'apply-setup')); }
async function patchStates(card, patch) { card.hass = {...card.hass, states: {...card.hass.states, ...patch}}; await settle(card); }
afterEach(() => { for (const element of [...document.body.children]) element.remove(); });
after(async () => { await browser.happyDOM.abort(); browser.close(); });

test('capabilities are read once and room tiles come from the robot', async () => {
  const {card, calls, reads} = await roomFixture();
  assert.ok(room(card, '0_12'));
  assert.ok(!room(card, 'living_preset'), 'Routine tiles are not a tile model any more');
  assert.equal(calls.length, 0);
  assert.deepEqual(reads[0], {type: 'call_service', domain: 'robot_cleaner_queue', service: 'get_capabilities', service_data: {vacuum: 'vacuum.rover'}, return_response: true});
  await openSetup(card);
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

test('cancelled setup edits leave the plan and its settings untouched', async () => {
  const {card, calls} = await roomFixture();
  await click(card, room(card, '0_12'));
  await openSetup(card);
  await click(card, mode(card, 'mop'));
  await click(card, action(card, 'close-setup'));
  assert.equal(room(card, '0_12').getAttribute('aria-pressed'), 'true');
  await click(card, action(card, 'start'));
  assert.deepEqual(calls[0].data.rooms, [{id: '0_12', ...DEFAULT_ROOM}]);
});

test('one draft exists: the ordered rooms keep their order across sheet edits', async () => {
  const {card, calls} = await fixture({states: {'sensor.robot_cleaner_queue': entity('idle', {vacuum: 'vacuum.rover', control_version: 4})}});
  await click(card, room(card, 'hall_area')); await click(card, room(card, 'living_area'));
  await openSetup(card); await click(card, setting(card, 'suction', 'max')); await apply(card);
  assert.equal(room(card, 'hall_area').querySelector('.order')?.textContent.trim(), '1');
  assert.equal(room(card, 'living_area').querySelector('.order')?.textContent.trim(), '2');
  await click(card, action(card, 'start'));
  assert.deepEqual(calls[0].data.rooms, ['hall_area', 'living_area']);
  assert.equal(calls[0].data.setup.suction, 'max');
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

test('an old companion without room support keeps whole-home cleaning available', async () => {
  const {card, calls} = await fixture({services: {robot_cleaner_queue: {control: {}}}});
  await openSetup(card);
  assert.match(root(card).textContent, /updated.*companion/i);
  assert.equal(action(card, 'apply-setup').disabled, true);
  assert.equal(root(card).querySelector('[data-mode]'), null);
  assert.equal(calls.length, 0);
  await click(card, action(card, 'close-setup'));
  assert.ok(!room(card, 'living_preset'), 'No routine tiles without the robot rooms');
  assert.equal(action(card, 'start').disabled, false);
  await click(card, action(card, 'start'));
  assert.deepEqual(calls, [{domain: 'vacuum', action: 'start', data: {entity_id: 'vacuum.rover'}}]);
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
  assert.ok(room(card, 'kitchen_area')); assert.ok(!room(card, 'kitchen_preset'));
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

const controlsFixture = {
  ...baseCapabilities,control_version:3,device_entities:{mop_washing:'switch.rover_wash',mop_drying:'switch.rover_dry',volume:'number.rover_volume',sensor_time_left:'sensor.rover_care',map_0:'image.rover_map'}
};
async function deviceFixture(extra={}) {
  return fixture({config:{dock_error_entity:'sensor.rover_dock_error'},capabilities:controlsFixture,
    services:{robot_cleaner_queue:{control:{},get_capabilities:{},device_control:{}}},states:{
      'vacuum.rover':entity('docked',{supported_features:FEATURES|8|512}),
      'sensor.robot_cleaner_queue':entity('idle',{vacuum:'vacuum.rover',control_version:3}),
      'sensor.rover_dock_error':entity('water_empty'),
      'switch.rover_wash':entity('off'),'switch.rover_dry':entity('on'),
      'number.rover_volume':entity('75',{min:0,max:100}),
      'sensor.rover_care':entity('-5',{unit_of_measurement:'h'}),
      'image.rover_map':entity('2026-01-01',{entity_picture:'/api/image_proxy/image.rover_map?token=fixture'}),...extra
    }});
}
test('older companion blocks presets but manual vacuum-only can start',async()=>{
  const {card,calls}=await deviceFixture();await settle(card);
  assert.ok(card.shadowRoot.querySelector('[data-action="start"]').disabled);
  assert.match(card.shadowRoot.textContent,/Mopping needs water/);
  card.source='manual';card.planEdited=true;card.setup={mode:'vacuum',repeat:1,suction:'max'};await settle(card);
  assert.equal(card.shadowRoot.querySelector('[data-action="start"]').disabled,false);
  card.shadowRoot.querySelector('[data-action="start"]').click();await settle(card);
  assert.equal(calls.at(-1).data.command,'start_manual');assert.equal(calls.at(-1).data.setup.mode,'vacuum');
});
test('old companion cannot gain water exception and other faults still block vacuum',async()=>{
  for(const [version,fault] of [[2,'water_empty'],[3,'duct_blockage']]){
    const {card}=await deviceFixture({'sensor.robot_cleaner_queue':entity('idle',{vacuum:'vacuum.rover',control_version:version}),'sensor.rover_dock_error':entity(fault)});
    card.source='manual';card.planEdited=true;card.setup={mode:'vacuum',repeat:1};await settle(card);
    assert.ok(card.shadowRoot.querySelector('[data-action="start"]').disabled);
  }
});
test('dock water fault blocks washing but keeps drying stop available and uses companion',async()=>{
  const {card,calls}=await deviceFixture();await settle(card);
  card.shadowRoot.querySelector('[data-panel="dock"]').click();await settle(card);
  assert.ok(card.shadowRoot.querySelector('[data-device="mop_washing"]').disabled);
  const dry=card.shadowRoot.querySelector('[data-device="mop_drying"]');assert.equal(dry.disabled,false);dry.click();await settle(card);
  assert.deepEqual(calls.at(-1),{domain:'robot_cleaner_queue',action:'device_control',data:{vacuum:'vacuum.rover',control:'mop_drying',value:'off'}});
});
test('settings persist only changed values and Find never starts cleaning',async()=>{
  const {card,calls}=await deviceFixture();await settle(card);
  card.shadowRoot.querySelector('[data-action="locate"]').click();await settle(card);
  assert.equal(calls.at(-1).data.control,'locate');
  card.shadowRoot.querySelector('[data-panel="settings"]').click();await settle(card);
  const input=card.shadowRoot.querySelector('[data-device="volume"]');input.value='60';input.dispatchEvent(new Event('change'));await settle(card);
  assert.equal(calls.at(-1).data.value,60);assert.equal(calls.at(-1).data.control,'volume');
});
test('map shows only HA proxy images and care has no reset commands',async()=>{
  const {card,calls}=await deviceFixture();await settle(card);
  card.shadowRoot.querySelector('[data-panel="map"]').click();await settle(card);
  assert.match(card.shadowRoot.querySelector('.map-view img').getAttribute('src'),/^\/api\/image_proxy\//);
  card.closePanel();await settle(card);card.shadowRoot.querySelector('[data-panel="care"]').click();await settle(card);
  assert.match(card.shadowRoot.textContent,/Maintenance due/);assert.equal(calls.length,0);
});
test('unavailable native devices disappear and Stop sends stop rather than cancel',async()=>{
  const {card,calls}=await deviceFixture({'switch.rover_wash':entity('unavailable'),'switch.rover_dry':entity('unavailable'),'vacuum.rover':entity('cleaning',{supported_features:FEATURES|8|512}),'binary_sensor.rover_cleaning':entity('on'),'sensor.rover_status':entity('segment_cleaning')});await settle(card);
  assert.equal(card.shadowRoot.querySelector('[data-panel="dock"]'),null);
  card.shadowRoot.querySelector('[data-action="stop"]').click();await settle(card);
  assert.equal(calls.at(-1).data.command,'stop');assert.equal(calls.at(-1).domain,'robot_cleaner_queue');
});


test('an empty water tank blocks a mopping plan and allows a vacuum-only first room',async()=>{
  const {card,calls}=await roomFixture({states:{'sensor.rover_dock_error':entity('water_empty')},
    config:{dock_error_entity:'sensor.rover_dock_error'}});
  // Every room defaults to vacuum and mop, so the all-rooms plan must not start.
  assert.match(root(card).textContent,/Mopping needs water/);
  assert.equal(action(card,'start').disabled,true);
  await click(card,action(card,'start'));
  assert.equal(calls.length,0);
  // A first room that only vacuums is allowed through the same exception.
  await click(card,room(card,'0_12'));
  await openSetup(card);
  await click(card,roomMode(card,'0_12','vacuum'));
  await apply(card);
  assert.equal(action(card,'start').disabled,false);
  await click(card,action(card,'start'));
  assert.deepEqual(calls[0].data.rooms,[{id:'0_12',mode:'vacuum',suction:'balanced',repeat:1}]);
});

test('save manual preset persists order and settings without a cleaning command',async()=>{
  const {card,calls}=await fixture({services:{robot_cleaner_queue:{control:{},get_capabilities:{},save_preset:{}}}});
  await selectManual(card); await click(card,mode(card,'vacuum')); await apply(card);
  await click(card,room(card,'kitchen_area')); await click(card,room(card,'living_area'));
  await click(card,action(card,'save-preset'));
  assert.equal(calls.length,1); assert.equal(calls[0].action,'save_preset');
  assert.deepEqual(calls[0].data.rooms,['kitchen_area','living_area']);
  assert.equal(calls[0].data.setup.mode,'vacuum');
  assert.match(root(card).textContent,/Preset saved in Home Assistant/);
});

test('a fresh card loads a server-saved preset without starting cleaning',async()=>{
  const plan={source:'manual',presets:[],rooms:['kitchen_area','living_area'],setup:{mode:'vacuum',suction:'max',repeat:2},map_id:0};
  const {card,calls}=await fixture({capabilities:{...baseCapabilities,current_map:0,saved_preset:plan},
    states:{'sensor.robot_cleaner_queue':entity('idle',{control_version:4})},services:{robot_cleaner_queue:{control:{},get_capabilities:{},save_preset:{}}}});
  await click(card,action(card,'load-preset'));
  assert.equal(calls.length,0);
  assert.deepEqual(card.manualSelected,['kitchen_area','living_area']);
  assert.deepEqual(card.setup,plan.setup);
  assert.equal(card.source,'manual');
});

test('failed save is shown and never starts cleaning',async()=>{
  const {card}=await fixture({services:{robot_cleaner_queue:{control:{},get_capabilities:{},save_preset:{}}}});
  card.hass.callService=async()=>{throw new Error('Storage unavailable');};
  await click(card,action(card,'save-preset'));
  assert.match(root(card).textContent,/Storage unavailable/);
  assert.doesNotMatch(root(card).textContent,/Preset saved in Home Assistant/);
});

const zoneCapabilities = () => ({...structuredClone(baseCapabilities),
  robot_maps: [{flag:0,name:'Ground floor'},{flag:1,name:'Upstairs'}],
  robot_rooms: [
    {id:'0_1',segment:1,name:'Kitchen',floor:'Ground floor',area_id:'kitchen_area',area_name:'Kitchen'},
    {id:'0_2',segment:2,name:'Dining area',floor:'Ground floor',area_id:'kitchen_area',area_name:'Kitchen'},
    {id:'0_3',segment:3,name:'Office',floor:'Ground floor',area_id:'hall_area',area_name:'Hall'},
    {id:'1_2',segment:2,name:null,floor:'Upstairs',area_id:null,area_name:null},
  ],
  unmapped_areas: [{id:'sauna',name:'Sauna',segments:['0_9']}], rooms_complete: true});

test('the setup sheet shows which robot rooms each area claims',async()=>{
  const {card}=await fixture({capabilities:zoneCapabilities()});
  await selectManual(card);
  const report=root(card).querySelector('.zone-report');
  assert.ok(report,'Expected the zones report');
  assert.match(report.textContent,/4 robot rooms/);
  assert.match(report.textContent,/2 floors/);
  const groups=[...report.querySelectorAll('.zone-groups li')].map(row=>[row.querySelector('.zone-area').textContent,row.querySelector('.zone-rooms').textContent]);
  assert.deepEqual(groups,[['Kitchen','Kitchen, Dining area'],['Hall','Office']]);
  assert.match(report.textContent,/No Home Assistant area: Room 2 \(Upstairs\)/);
  assert.match(report.textContent,/The robot no longer reports: Sauna/);
});

test('the zones report never starts or changes cleaning',async()=>{
  const {card,calls}=await fixture({capabilities:zoneCapabilities()});
  await selectManual(card);
  assert.equal(calls.length,0);
  const report=root(card).querySelector('.zone-report');
  report.querySelector('summary').click(); await settle(card);
  assert.equal(calls.length,0);
});

test('a companion without the report renders no zones section',async()=>{
  const {card}=await fixture();
  await selectManual(card);
  assert.equal(root(card).querySelector('.zone-report'),null);
});

test('an unreadable floor is never reported as a missing area',async()=>{
  // The companion suppresses stale-area claims when it cannot read every floor.
  const {card}=await fixture({capabilities:{...zoneCapabilities(),rooms_complete:false,robot_maps:[{flag:0,name:null}],unmapped_areas:[]}});
  await selectManual(card);
  const report=root(card).querySelector('.zone-report');
  assert.match(report.textContent,/Only the floor the robot is on could be read/);
  assert.doesNotMatch(report.textContent,/The robot no longer reports/);
  assert.doesNotMatch(report.textContent,/floors/);
});

test('a saved manual preset stores the same normalized setup that start would send',async()=>{
  const { card, calls } = await fixture({ services: { robot_cleaner_queue: { control: {}, get_capabilities: {}, save_preset: {} } } });
  await selectManual(card);
  await click(card, mode(card, 'mop'));
  await click(card, setting(card, 'water', 'high'));
  await click(card, setting(card, 'route', 'fast'));
  await apply(card);
  await click(card, action(card, 'save-preset'));
  const saved = calls.find(call => call.action === 'save_preset');
  assert.ok(saved, 'Expected a save_preset call');
  assert.deepEqual(Object.keys(saved.data.setup).sort(), ['mode', 'repeat', 'route', 'water']);
  assert.equal(saved.data.setup.mode, 'mop');
  assert.equal('suction' in saved.data.setup, false);
});


// --- room-first model: tiles, per-room settings, preset round-trip, legacy fallback ---

const roomCapabilities = () => ({...structuredClone(baseCapabilities),
  current_map: 0, area_cleaning: true, rooms_complete: true,
  robot_maps: [{flag: 0, name: 'Ground floor'}],
  robot_rooms: [
    {id: '0_12', segment: 12, name: 'Kitchen', floor: 'Ground floor', area_id: 'kitchen', area_name: 'Kitchen'},
    {id: '0_13', segment: 13, name: 'Dining area', floor: 'Ground floor', area_id: 'kitchen', area_name: 'Kitchen'},
    {id: '0_5', segment: 5, name: 'Hallway', floor: 'Ground floor', area_id: null, area_name: null},
    {id: '1_1', segment: 1, name: 'Upstairs office', floor: 'Loft', area_id: null, area_name: null},
  ]});
/** A card whose companion reports the robot's rooms, so the room model is active. */
function roomFixture(options = {}) {
  return fixture({...options, states: {
    'sensor.robot_cleaner_queue': entity('idle', {vacuum: 'vacuum.rover', control_version: 4, presets: [], current_index: 0, completed: 0}),
    ...(options.states ?? {}),
  }, capabilities: options.capabilities ?? roomCapabilities()});
}
const roomSetting = (card, id, key, value) => root(card).querySelector(`[data-room-setup="${id}"] [data-setting="${key}"][data-value="${value}"]`);
const roomMode = (card, id, value) => root(card).querySelector(`[data-room-setup="${id}"] [data-room-mode="${value}"]`);
const DEFAULT_ROOM = {mode: 'vacuum_mop', suction: 'balanced', water: 'medium', route: 'standard', repeat: 1};

test('room tiles come from the robot map, not from configured preset rooms', async () => {
  const {card, calls} = await roomFixture();
  for (const id of ['0_12', '0_13', '0_5']) assert.ok(room(card, id), `Expected a tile for ${id}`);
  assert.ok(!room(card, 'living_preset'), 'Routine tiles must not be offered once the robot reports rooms');
  assert.ok(!room(card, '1_1'), 'Only the current floor is offered');
  assert.match(room(card, '0_12').textContent, /Kitchen/);
  assert.match(room(card, '0_5').textContent, /Hallway/);
  assert.equal(calls.length, 0);
});

test('start sends the ordered rooms with the settings each one will run with', async () => {
  const {card, calls} = await roomFixture();
  await click(card, room(card, '0_5')); await click(card, room(card, '0_12'));
  assert.equal(calls.length, 0, 'Selecting rooms must not command the robot');
  assert.equal(room(card, '0_5').querySelector('.order')?.textContent.trim(), '1');
  await click(card, action(card, 'start'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, 'robot_cleaner_queue'); assert.equal(calls[0].action, 'control');
  assert.equal(calls[0].data.command, 'start_manual');
  assert.deepEqual(calls[0].data.rooms, [
    {id: '0_5', ...DEFAULT_ROOM},
    {id: '0_12', ...DEFAULT_ROOM},
  ]);
  assert.equal(calls[0].data.presets, undefined);
});

/** The fixture queue never becomes active, so acknowledge a start the way the real one does. */
async function acknowledge(card) {
  await patchStates(card, {'sensor.robot_cleaner_queue': entity('attention', {vacuum: 'vacuum.rover', control_version: 4, error: 'stopped'})});
  await patchStates(card, {'sensor.robot_cleaner_queue': entity('idle', {vacuum: 'vacuum.rover', control_version: 4, presets: [], current_index: 0, completed: 0})});
}

test('a room can be given its own mode and the sheet drops settings that mode cannot use', async () => {
  const {card, calls} = await roomFixture();
  await click(card, room(card, '0_12')); await click(card, room(card, '0_5'));
  await openSetup(card);
  assert.ok(root(card).querySelector('[data-room-setup="0_12"]'), 'Expected a per-room editor for each selected room');
  assert.equal(root(card).querySelector('[data-room-setup="0_13"]'), null, 'Unselected rooms need no editor');
  await click(card, roomMode(card, '0_5', 'vacuum'));
  await click(card, roomSetting(card, '0_5', 'suction', 'max'));
  assert.equal(roomSetting(card, '0_5', 'water', 'high'), null, 'A vacuum room exposes no water flow');
  assert.equal(roomSetting(card, '0_5', 'route', 'standard'), null, 'A vacuum room exposes no mop route');
  assert.equal(roomMode(card, '0_5', 'vacuum').getAttribute('aria-pressed'), 'true');
  assert.equal(roomSetting(card, '0_5', 'suction', 'max').getAttribute('aria-pressed'), 'true');
  assert.equal(roomMode(card, '0_12', 'vacuum_mop').getAttribute('aria-pressed'), 'true', 'Other rooms keep the default');
  await apply(card);
  await click(card, action(card, 'start'));
  assert.deepEqual(calls[0].data.rooms, [
    {id: '0_12', ...DEFAULT_ROOM},
    {id: '0_5', mode: 'vacuum', suction: 'max', repeat: 1},
  ]);
});

test('a room keeps its own settings until it is reset to the defaults', async () => {
  const {card, calls} = await roomFixture();
  await click(card, room(card, '0_12')); await openSetup(card);
  await click(card, roomMode(card, '0_12', 'mop'));
  await click(card, roomSetting(card, '0_12', 'route', 'deep'));
  await apply(card);
  await click(card, action(card, 'start'));
  assert.deepEqual(calls[0].data.rooms, [{id: '0_12', mode: 'mop', water: 'medium', route: 'deep', repeat: 1}]);
  // Reset returns the room to the sheet's defaults.
  await acknowledge(card);
  await openSetup(card);
  await click(card, root(card).querySelector('[data-action="reset-room-setup"][data-room-id="0_12"]'));
  await apply(card);
  await click(card, action(card, 'start'));
  assert.deepEqual(calls.at(-1).data.rooms, [{id: '0_12', ...DEFAULT_ROOM}]);
});

test('saving a room plan stores it and a freshly loaded card restores the same plan', async () => {
  const {card, calls} = await roomFixture({services: {robot_cleaner_queue: {control: {}, get_capabilities: {}, save_preset: {}}}});
  await click(card, room(card, '0_12')); await click(card, room(card, '0_5'));
  await openSetup(card);
  await click(card, roomMode(card, '0_5', 'vacuum'));
  await apply(card);
  await click(card, action(card, 'save-preset'));
  const saved = calls.find(call => call.action === 'save_preset');
  assert.ok(saved, 'Expected save_preset to be called');
  assert.equal(saved.data.source, 'rooms');
  assert.deepEqual(saved.data.rooms, [
    {id: '0_12', ...DEFAULT_ROOM},
    {id: '0_5', mode: 'vacuum', suction: 'balanced', repeat: 1},
  ]);
  assert.equal(saved.data.presets, undefined);
  // The wall-switch path reads the same plan back from the companion.
  const restored = await roomFixture({services: {robot_cleaner_queue: {control: {}, get_capabilities: {}, save_preset: {}}},
    capabilities: {...roomCapabilities(),
      saved_preset: {source: 'rooms', presets: [], rooms: saved.data.rooms, setup: saved.data.setup, map_id: 0}}});
  await click(restored.card, action(restored.card, 'load-preset'));
  assert.equal(room(restored.card, '0_12').querySelector('.order')?.textContent.trim(), '1');
  assert.equal(room(restored.card, '0_5').querySelector('.order')?.textContent.trim(), '2');
  await click(restored.card, action(restored.card, 'start'));
  assert.deepEqual(restored.calls[0].data.rooms, saved.data.rooms);
});

test('a saved room plan that no longer matches the robot is refused, not guessed', async () => {
  const {card, calls} = await roomFixture({services: {robot_cleaner_queue: {control: {}, get_capabilities: {}, save_preset: {}}},
    capabilities: {...roomCapabilities(),
      saved_preset: {source: 'rooms', presets: [], rooms: [{id: '0_99', mode: 'vacuum'}], setup: {mode: 'vacuum', repeat: 1}, map_id: 0}}});
  await click(card, action(card, 'load-preset'));
  assert.match(root(card).textContent, /no longer on the robot/i);
  assert.equal(calls.length, 0);
  assert.match(action(card, 'start').textContent, /Clean all rooms/, 'A refused plan selects nothing');
});

test('legacy room presets load without error and are never started', async () => {
  const {card, calls} = await fixture({states: {'sensor.robot_cleaner_queue': entity('idle', {vacuum: 'vacuum.rover', control_version: 4})}});
  // The configuration still lists routine rooms; they are read and ignored.
  assert.ok(!room(card, 'living_preset'));
  assert.ok(room(card, 'living_area'), 'Home Assistant mapped areas remain the fallback plan');
  await click(card, room(card, 'living_area'));
  await click(card, action(card, 'start'));
  assert.equal(calls[0].data.command, 'start_manual');
  assert.deepEqual(calls[0].data.rooms, ['living_area']);
  assert.equal(calls.some(call => ['button', 'script'].includes(call.domain)), false);
});

test('a card without configured rooms still loads and plans the mapped areas', async () => {
  const {card, calls} = await fixture({config: {rooms: []}});
  assert.ok(!room(card, 'living_preset'));
  assert.ok(room(card, 'living_area'), 'The mapped areas remain the fallback plan');
  await click(card, room(card, 'living_area'));
  await click(card, action(card, 'start'));
  assert.equal(calls[0].data.command, 'start_manual');
  assert.deepEqual(calls[0].data.rooms, ['living_area']);
});

test('a robot with no rooms and no mapped areas says what is needed', async () => {
  const {card, calls} = await fixture({capabilities: {...structuredClone(baseCapabilities), room_targets: []}});
  assert.equal(card.shadowRoot.querySelector('[data-room]'), null);
  assert.match(root(card).textContent, /update it or clean the whole home/i);
  assert.match(action(card, 'start').textContent, /Clean all rooms/);
  assert.equal(calls.length, 0);
});

test('a companion that rejects per-room plans says what has to change', async () => {
  const {card, calls} = await roomFixture({service: async () => {
    throw new Error("Invalid data for call_service at pos 1: expected a string for dictionary value @ data['rooms'][0]");
  }});
  await click(card, room(card, '0_12'));
  await click(card, action(card, 'start'));
  assert.equal(calls.length, 1);
  assert.match(root(card).querySelector('[role="alert"]').textContent, /room contract \(control_version 5 or newer\)/);
  assert.equal(room(card, '0_12').getAttribute('aria-pressed'), 'true', 'The plan stays selected for retry');
});

test('saving a plan a companion cannot store explains itself too', async () => {
  const {card} = await roomFixture({
    services: {robot_cleaner_queue: {control: {}, get_capabilities: {}, save_preset: {}}},
    service: async () => { throw new Error("extra keys not allowed @ data['rooms'][0]['mode']"); }});
  await click(card, room(card, '0_12'));
  await click(card, action(card, 'save-preset'));
  assert.match(root(card).textContent, /room contract \(control_version 5 or newer\)/);
});
