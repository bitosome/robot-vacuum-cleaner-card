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
async function moveKey(card, id, key) {
  root(card).querySelector(`[data-drag-room="${id}"]`).dispatchEvent(new browser.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  await settle(card);
}

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

test('room toggles follow visible order regardless of tap order, without starting the robot', async () => {
  const { card, calls } = await fixture();
  await tap(card, '0_3'); await tap(card, '0_1'); await tap(card, '0_2');
  assert.equal(order(card, '0_1'), '1');
  assert.equal(order(card, '0_2'), '2');
  assert.equal(order(card, '0_3'), '3');
  assert.equal(room(card, '0_1').getAttribute('aria-checked'), 'true');
  assert.match(room(card, '0_2').getAttribute('aria-label'), /position 2/);
  assert.equal(calls.length, 0);
  assert.match(button(card, 'start').textContent, /Start sequence · 3 rooms/);
});

test('toggling a room off and on keeps its arranged position', async () => {
  const { card } = await fixture();
  await tap(card, '0_3'); await tap(card, '0_1'); await tap(card, '0_2');
  await tap(card, '0_1');
  assert.equal(order(card, '0_1'), undefined);
  assert.equal(order(card, '0_2'), '1');
  assert.equal(order(card, '0_3'), '2');
  await tap(card, '0_1');
  assert.equal(order(card, '0_1'), '1');
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
  await moveKey(card,'0_3','Home');
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

function editableRun(patch={}) {
  return entity('running',{vacuum:'vacuum.robot',control_version:8,queue_edit_version:1,
    run_id:'run-edit',queue_revision:4,queue_editable:true,queue_edit_reason:'',
    protected_room_ids:['0_1','0_2'],editable_room_ids:['0_3','0_4'],
    mode:'manual',presets:[],targets:['0_1','0_2','0_3','0_4'],
    setup:{rooms:['0_1','0_2','0_3','0_4'].map(id=>({id,name:`Room ${id}`,setup:{...ROOM_DEFAULTS,...(id==='0_2'?{mode:'vacuum_then_mop'}:{})}}))},
    stages:[
      {target:'0_1',mode:'vacuum_mop',room_index:0,pass_index:0,repeat_index:0},
      {target:'0_2',mode:'vacuum',room_index:1,pass_index:0,repeat_index:0},
      {target:'0_2',mode:'mop',room_index:1,pass_index:1,repeat_index:0},
      {target:'0_3',mode:'vacuum_mop',room_index:2,pass_index:0,repeat_index:0},
      {target:'0_4',mode:'vacuum_mop',room_index:3,pass_index:0,repeat_index:0},
    ],current_index:1,completed:1,...patch});
}
async function editableFixture(options={}) {
  const caps=roomCapabilities();
  caps.robot_rooms.push({id:'0_4',segment:4,name:'Bedroom'},{id:'0_5',segment:5,name:'Office'});
  return fixture({services:{robot_cleaner_queue:{control:{},get_capabilities:{},save_preset:{},update_queue:{}}},
    capabilities:caps,states:{'sensor.robot_queue':editableRun(),'vacuum.robot':entity('cleaning',{supported_features:FEATURES}),
      'binary_sensor.robot_cleaning':entity('on'),'sensor.robot_status':entity('segment_cleaning')},...options});
}
test('live queue editing protects completed/current room and all its passes while changing only a draft',async()=>{
  const {card,calls}=await editableFixture();
  button(card,'edit-queue').click();await settle(card);
  assert.equal(room(card,'0_1').disabled,true);assert.equal(room(card,'0_2').disabled,true);
  assert.equal(root(card).querySelector('[data-drag-room="0_2"]'),null);
  assert.equal(button(card,'apply-queue-edit').disabled,true);
  await tap(card,'0_3');await tap(card,'0_5');await moveKey(card,'0_5','Home');
  assert.equal(order(card,'0_1'),'1');assert.equal(order(card,'0_2'),'2');
  assert.equal(order(card,'0_5'),'3');assert.equal(order(card,'0_4'),'4');
  assert.equal(room(card,'0_3').getAttribute('aria-checked'),'false');
  assert.match(room(card,'0_3').textContent,/Removed from queue/);
  assert.equal(calls.length,0);assert.equal(button(card,'apply-queue-edit').disabled,false);
  assert.equal(button(card,'save-preset'),null);
  button(card,'apply-queue-edit').click();await settle(card);
  assert.deepEqual(calls,[{domain:'robot_cleaner_queue',action:'update_queue',data:{
    vacuum:'vacuum.robot',run_id:'run-edit',revision:4,rooms:[{id:'0_5',...ROOM_DEFAULTS},{id:'0_4',...ROOM_DEFAULTS}],
  }}]);
  assert.match(root(card).textContent,/Waiting for the shared queue/);
  await changeStates(card,{'sensor.robot_queue':editableRun({queue_revision:5,editable_room_ids:['0_5','0_4'],targets:['0_1','0_2','0_5','0_4'],
    setup:{rooms:['0_1','0_2','0_5','0_4'].map(id=>({id,setup:{...ROOM_DEFAULTS}}))}})});
  assert.equal(button(card,'apply-queue-edit'),null);
  assert.match(root(card).textContent,/Remaining rooms updated/);
});
test('cancel discards queue edits and all pending settings without saving defaults or wall-switch plan',async()=>{
  const {card,calls}=await editableFixture();
  button(card,'edit-queue').click();await settle(card);await tap(card,'0_3');await tap(card,'0_5');
  const select=root(card).querySelector('[data-room-editor="0_4"] select');
  select.value='vacuum';select.dispatchEvent(new browser.Event('change',{bubbles:true}));await settle(card);
  button(card,'cancel-queue-edit').click();await settle(card);
  assert.equal(room(card,'0_3').getAttribute('aria-checked'),'true');assert.equal(order(card,'0_5'),undefined);
  button(card,'edit-queue').click();await settle(card);
  assert.equal(root(card).querySelector('[data-room-editor="0_4"] select').value,'vacuum_mop');
  assert.equal(button(card,'apply-queue-edit').disabled,true);assert.deepEqual(calls,[]);
});
test('current room advancement locks the draft and reload protects the newly started room',async()=>{
  const {card,calls}=await editableFixture();
  button(card,'edit-queue').click();await settle(card);await tap(card,'0_4');
  await changeStates(card,{'sensor.robot_queue':editableRun({queue_revision:5,current_index:3,completed:3,
    protected_room_ids:['0_1','0_2','0_3'],editable_room_ids:['0_4']})});
  assert.match(root(card).textContent,/sequence changed/);
  assert.equal(button(card,'apply-queue-edit').disabled,true);assert.equal(room(card,'0_3').disabled,true);
  button(card,'apply-queue-edit').click();await settle(card);assert.deepEqual(calls,[]);
  button(card,'reload-queue-edit').click();await settle(card);
  assert.equal(room(card,'0_3').disabled,true);assert.equal(room(card,'0_4').disabled,false);
  assert.equal(room(card,'0_4').getAttribute('aria-checked'),'true');
});
test('removing all untouched rooms submits an explicit empty tail rather than a whole-house clean',async()=>{
  const {card,calls}=await editableFixture();
  button(card,'edit-queue').click();await settle(card);await tap(card,'0_3');await tap(card,'0_4');
  assert.match(root(card).textContent,/No more rooms after the current room/);
  button(card,'apply-queue-edit').click();await settle(card);
  assert.deepEqual(calls[0].data.rooms,[]);assert.equal(calls[0].action,'update_queue');
});
test('capability refresh cannot silently omit a missing pending room from queue edits',async()=>{
  const caps=roomCapabilities();caps.robot_rooms.push({id:'0_5',segment:5,name:'Office'});
  const {card,calls}=await editableFixture({capabilities:caps});
  button(card,'edit-queue').click();await settle(card);
  assert.ok(room(card,'0_4'));assert.equal(room(card,'0_4').getAttribute('aria-checked'),'true');
  await tap(card,'0_3');assert.equal(button(card,'apply-queue-edit').disabled,true);
  await tap(card,'0_4');assert.equal(button(card,'apply-queue-edit').disabled,false);
  button(card,'apply-queue-edit').click();await settle(card);assert.deepEqual(calls[0].data.rooms,[]);
});
test('stale server rejection preserves the unsaved queue draft and exposes the error',async()=>{
  const {card,calls}=await editableFixture({service(){throw new Error('Queue changed elsewhere. Reload remaining rooms.');}});
  button(card,'edit-queue').click();await settle(card);await tap(card,'0_3');
  button(card,'apply-queue-edit').click();await settle(card);
  assert.equal(room(card,'0_3').getAttribute('aria-checked'),'false');
  assert.match(root(card).textContent,/Queue changed elsewhere/);
  assert.equal(calls.length,1);assert.equal(button(card,'cancel-queue-edit').disabled,false);
});
test('water warnings do not block queue edits while attention eligibility comes from the backend',async()=>{
  const q=editableRun();q.state='attention';
  const {card,calls}=await editableFixture({states:{'sensor.robot_queue':q,
    'sensor.robot_dock_error':entity('water_empty'),'vacuum.robot':entity('docked',{supported_features:FEATURES})}});
  assert.equal(button(card,'edit-queue').disabled,false);
  button(card,'edit-queue').click();await settle(card);
  assert.equal(room(card,'0_2').disabled,true);
  await tap(card,'0_3');assert.equal(button(card,'apply-queue-edit').disabled,false);assert.deepEqual(calls,[]);
});
test('a different run or malformed pending boundary never accepts an old draft',async()=>{
  const {card,calls}=await editableFixture();button(card,'edit-queue').click();await settle(card);await tap(card,'0_3');
  await changeStates(card,{'sensor.robot_queue':editableRun({run_id:'another-run'})});
  assert.equal(button(card,'apply-queue-edit').disabled,true);
  button(card,'apply-queue-edit').click();await settle(card);assert.deepEqual(calls,[]);
  button(card,'cancel-queue-edit').click();await settle(card);
  await changeStates(card,{'sensor.robot_queue':editableRun({protected_room_ids:['0_2'],editable_room_ids:['0_3','0_4']})});
  assert.equal(button(card,'edit-queue'),null);
});
test('finishing a run never claims that an unsubmitted added room was cleaned',async()=>{
  const {card}=await editableFixture();button(card,'edit-queue').click();await settle(card);await tap(card,'0_5');
  const q=editableRun({queue_revision:8,current_index:5,completed:5,floor_cleaning_complete:true,
    protected_room_ids:['0_1','0_2','0_3','0_4'],editable_room_ids:[],queue_editable:false});q.state='finishing';
  await changeStates(card,{'sensor.robot_queue':q});
  assert.match(room(card,'0_1').textContent,/Completed/);
  assert.doesNotMatch(room(card,'0_5').textContent,/Completed/);
  assert.equal(button(card,'apply-queue-edit').disabled,true);
});
test('unavailable live setting controls still allow removing and reordering the frozen pending tail',async()=>{
  const caps={...roomCapabilities(),supported:false,modes:[],suction:[],water:[],routes:[],repeats:[],robot_rooms:[]};
  const {card,calls}=await editableFixture({capabilities:caps});
  assert.equal(button(card,'edit-queue').disabled,false);
  button(card,'edit-queue').click();await settle(card);
  assert.equal(room(card,'0_2').disabled,true);assert.equal(room(card,'0_3').disabled,false);
  await moveKey(card,'0_4','Home');await tap(card,'0_3');
  assert.equal(order(card,'0_4'),'3');assert.equal(button(card,'apply-queue-edit').disabled,false);
  button(card,'apply-queue-edit').click();await settle(card);
  assert.deepEqual(calls[0].data.rooms,[{id:'0_4',...ROOM_DEFAULTS}]);
});
test('an added room stays visible and removable if capabilities disappear during queue editing',async()=>{
  const {card,calls,setCapabilities}=await editableFixture();
  button(card,'edit-queue').click();await settle(card);await tap(card,'0_5');
  setCapabilities({...roomCapabilities(),supported:false,modes:[],suction:[],water:[],routes:[],repeats:[],robot_rooms:[],room_targets:[]});
  await changeStates(card,{'sensor.robot_queue':editableRun({preferences_revisions:{'vacuum.robot':1}})});
  assert.match(room(card,'0_5').textContent,/Office/);
  assert.equal(room(card,'0_5').getAttribute('aria-checked'),'true');
  assert.equal(button(card,'apply-queue-edit').disabled,true);
  await tap(card,'0_5');await moveKey(card,'0_4','Home');
  assert.equal(button(card,'apply-queue-edit').disabled,false);
  await tap(card,'0_3');await tap(card,'0_3');
  assert.equal(room(card,'0_3').getAttribute('aria-checked'),'true');
  button(card,'apply-queue-edit').click();await settle(card);
  assert.deepEqual(calls[0].data.rooms,[{id:'0_4',...ROOM_DEFAULTS},{id:'0_3',...ROOM_DEFAULTS}]);
});
test('keyboard queue reordering keeps focus on the same handle for repeated movement',async()=>{
  const {card}=await editableFixture();
  button(card,'edit-queue').click();await settle(card);
  root(card).querySelector('[data-drag-room="0_4"]').focus();
  await moveKey(card,'0_4','Home');
  assert.equal(root(card).activeElement.dataset.dragRoom,'0_4');
  await moveKey(card,'0_4','ArrowDown');
  assert.equal(root(card).activeElement.dataset.dragRoom,'0_4');
  assert.equal(order(card,'0_4'),'4');
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

test('a confirmed Stop keeps Return to dock available for the idle robot away from its dock',async()=>{
  const queue={vacuum:'vacuum.robot',control_version:6,mode:'manual',targets:['0_1'],stages:[{target:'0_1',mode:'vacuum',room_index:0,pass_index:0,repeat_index:0}],current_index:0,completed:0};
  const {card,calls}=await fixture({states:{
    'vacuum.robot':entity('cleaning',{supported_features:FEATURES|8}),
    'sensor.robot_status':entity('segment_cleaning'),
    'binary_sensor.robot_cleaning':entity('on'),
    'sensor.robot_queue':entity('running',queue),
  }});
  button(card,'stop').click();await settle(card);
  await changeStates(card,{'sensor.robot_queue':entity('controlling',{...queue,pending_command:'stop'})});
  assert.equal(button(card,'dock').disabled,true);
  await changeStates(card,{
    'vacuum.robot':entity('idle',{supported_features:FEATURES|8}),
    'sensor.robot_status':entity('idle'),
    'binary_sensor.robot_cleaning':entity('off'),
    'sensor.robot_queue':entity('cancelled',queue),
  });
  assert.equal(card.request,undefined);
  assert.equal(button(card,'dock').disabled,false);
  assert.equal(button(card,'pause'),null);assert.equal(button(card,'stop'),null);
  button(card,'dock').click();await settle(card);button(card,'dock').click();await settle(card);
  assert.deepEqual(calls.map(call=>call.data.command),['stop','return_to_dock']);
  assert.ok(calls.every(call=>call.domain==='robot_cleaner_queue'));
  await changeStates(card,{'vacuum.robot':entity('returning',{supported_features:FEATURES|8})});
  assert.equal(button(card,'dock'),null);
});

for(const phase of ['idle','cancelled','attention']) test(`an idle robot can return home with a ${phase} queue and no startable plan`,async()=>{
  const {card,calls}=await fixture({states:{
    'vacuum.robot':entity('idle',{supported_features:FEATURES}),
    'sensor.robot_status':entity('idle'),
    'sensor.robot_dock_error':entity('water_empty'),
    'sensor.robot_queue':entity(phase,{vacuum:'vacuum.robot',control_version:5,execution_version:3,recovery_ready:false}),
  }});
  assert.equal(button(card,'dock').disabled,false);
  assert.ok(!button(card,'start')||button(card,'start').disabled);
  button(card,'dock').click();await settle(card);
  assert.deepEqual(calls,[{domain:'robot_cleaner_queue',action:'control',data:{command:'return_to_dock',vacuum:'vacuum.robot'}}]);
});

for(const [state,status,features] of [
  ['docked','charging',FEATURES],['returning','returning_home',FEATURES],
  ['idle','washing_the_mop',FEATURES],['idle','going_to_wash_the_mop',FEATURES],
  ['idle','idle',FEATURES&~16],
]) test(`stopped robot does not offer duplicate or unsupported docking: ${state}, ${status}, ${features}`,async()=>{
  const {card,calls}=await fixture({states:{
    'vacuum.robot':entity(state,{supported_features:features}),
    'sensor.robot_status':entity(status),
    'sensor.robot_queue':entity('cancelled',{vacuum:'vacuum.robot',control_version:6}),
  }});
  assert.equal(button(card,'dock'),null);assert.deepEqual(calls,[]);
});

for(const constraint of ['robot_unavailable','pending_command','barrier','required_queue_unavailable']) test(`idle Return to dock respects ${constraint}`,async()=>{
  const {card,calls}=await fixture({overrides:{require_queue:true},states:{
    'vacuum.robot':entity(constraint==='robot_unavailable'?'unavailable':'idle',{supported_features:FEATURES}),
    'sensor.robot_status':entity('idle'),
    'sensor.robot_queue':entity(constraint==='required_queue_unavailable'?'unavailable':'cancelled',{vacuum:'vacuum.robot',control_version:6,pending_command:constraint==='pending_command'?'stop':'',command_barrier_until:constraint==='barrier'?Date.now()/1000+60:0}),
  }});
  assert.equal(button(card,'dock').disabled,true);
  button(card,'dock').click();await settle(card);assert.deepEqual(calls,[]);
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
  await tap(card, '0_1'); assert.match(room(card, '0_1').getAttribute('aria-label'), /<img/);
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

test('legacy attention offers prominent clearing instead of a disabled start', async () => {
  const { card, calls } = await fixture({ states: {
    'sensor.robot_queue': entity('attention', { vacuum: 'vacuum.robot', control_version: 5, mode: 'manual', presets: [], targets: ['0_1'],
      stages: [{ target: '0_1', mode: 'vacuum_mop', room_index: 0, pass_index: 0, repeat_index: 0 }], setup: {}, current_index: 0, completed: 0,
      error: 'Completion was not confirmed' }),
  } });
  assert.equal(button(card, 'start'), null);
  assert.match(root(card).textContent, /not confirmed/);
  assert.equal(button(card,'clear-queue').classList.contains('primary'),true);
  assert.match(root(card).querySelector('.subline').textContent, /Clear the stopped sequence/);
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


const stoppedQueue = (extra={}) => entity('attention', {
  vacuum:'vacuum.robot', control_version:5, execution_version:3, mode:'manual', run_id:'previous-run',
  targets:['0_1'], setup:{rooms:[{id:'0_1',name:'Living room',setup:ROOM_DEFAULTS}]},
  stages:[{target:'0_1',mode:'vacuum_mop',room_index:0,pass_index:0,repeat_index:0}],
  current_index:0, completed:0, error:'Previous cleaning command was not confirmed.',
  pending_command:'', recovery_ready:true, recovery_reason:'', command_barrier_until:0, ...extra,
});

test('a recovered stopped run preloads the saved plan and starts a new explicit run without mandatory clearing',async()=>{
  const capabilities=roomCapabilities();
  capabilities.saved_preset={source:'rooms',map_id:0,revision:3,setup:{},rooms:[{id:'0_2',...ROOM_DEFAULTS}]};
  const {card,calls}=await fixture({capabilities,states:{'sensor.robot_queue':stoppedQueue()}});
  assert.equal(button(card,'start').disabled,false);
  assert.equal(room(card,'0_2').getAttribute('aria-checked'),'true');
  assert.match(root(card).querySelector('h2').textContent,/Ready to clean/);
  assert.match(root(card).querySelector('.recovery-note').textContent,/Previous sequence stopped/);
  assert.equal(calls.length,0,'No retry may be sent merely because recovery becomes ready');
  button(card,'start').click();await settle(card);
  assert.deepEqual(calls.map(call=>call.data.command),['start_manual']);
  assert.deepEqual(calls[0].data.rooms,[{id:'0_2',...ROOM_DEFAULTS}]);
});

test('a stopped run immediately releases per-room editors and stale pending attributes do not lock local plans',async()=>{
  const {card,calls}=await fixture({states:{'sensor.robot_queue':stoppedQueue({recovery_ready:false,pending_command:'start',recovery_reason:'Waiting for a fresh robot update.'})}});
  const field=root(card).querySelector('[data-room-editor="0_1"] [data-room-setting="mode"]');
  assert.equal(field.disabled,false);
  field.value='vacuum';field.dispatchEvent(new Event('change',{bubbles:true}));await settle(card);
  await tap(card,'0_1');
  assert.equal(room(card,'0_1').getAttribute('aria-checked'),'true');
  assert.equal(button(card,'save-preset').disabled,false);
  assert.equal(button(card,'start'),null);
  assert.match(root(card).querySelector('.subline').textContent,/Waiting for a fresh robot update/);
  assert.equal(button(card,'clear-queue').disabled,false);
  assert.equal(calls.length,0);
});

test('a successful clear is acknowledged without waiting for a new HA state event',async()=>{
  let finish;
  const {card,calls}=await fixture({states:{'sensor.robot_queue':stoppedQueue({recovery_ready:false})},service:()=>new Promise(resolve=>{finish=resolve;})});
  button(card,'clear-queue').click();await settle(card);
  assert.equal(button(card,'clear-queue').disabled,true);
  button(card,'clear-queue').click();await settle(card);
  assert.equal(calls.length,1);
  finish();await settle(card);
  assert.equal(card.request,undefined);
  assert.equal(button(card,'clear-queue').disabled,false);
  assert.deepEqual(calls.map(call=>[call.domain,call.data.command]),[['robot_cleaner_queue','cancel']]);
});

test('old attention telemetry cannot acknowledge or swallow a rejected new start',async()=>{
  let reject;
  const {card}=await fixture({states:{'sensor.robot_queue':stoppedQueue()},service:()=>new Promise((_resolve,fail)=>{reject=fail;})});
  await tap(card,'0_1');button(card,'start').click();await settle(card);
  await changeStates(card,{'sensor.robot_queue':stoppedQueue({robot_observed_at:Date.now()/1000})});
  assert.equal(card.request?.kind,'start_manual');
  reject(Error('The dock is not ready for mopping.'));await settle(card);
  assert.equal(card.request,undefined);
  assert.match(root(card).querySelector('[role="alert"]').textContent,/dock is not ready/);
});

test('a new run failure acknowledges only its new run id',async()=>{
  const {card}=await fixture({states:{'sensor.robot_queue':stoppedQueue()}});
  await tap(card,'0_1');button(card,'start').click();await settle(card);
  assert.equal(card.request?.kind,'start_manual');
  await changeStates(card,{'sensor.robot_queue':stoppedQueue({run_id:'new-run',error:'New command failed.',recovery_ready:false})});
  assert.equal(card.request,undefined);
  assert.match(root(card).querySelector('.recovery-note').textContent,/New command failed/);
});

test('a reported recovery never bypasses a live dispatch barrier',async()=>{
  const {card,calls}=await fixture({states:{'sensor.robot_queue':stoppedQueue({command_barrier_until:Math.floor(Date.now()/1000)+180})}});
  await tap(card,'0_1');
  assert.equal(button(card,'start').disabled,true);
  assert.match(button(card,'start').textContent,/Waiting 3 min/);
  button(card,'start').click();await settle(card);assert.equal(calls.length,0);
  assert.equal(button(card,'clear-queue').disabled,false);
});

test('recovered attention permits available dock and settings controls with water policy intact',async()=>{
  const capabilities=roomCapabilities();
  capabilities.device_entities={dust_emptying:'switch.robot_emptying',mop_washing:'switch.robot_washing',volume:'number.robot_volume'};
  const {card,calls}=await fixture({capabilities,services:{robot_cleaner_queue:{control:{},get_capabilities:{},device_control:{}}},states:{
    'sensor.robot_queue':stoppedQueue(),
    'switch.robot_emptying':entity('off'),'switch.robot_washing':entity('off'),'number.robot_volume':entity('50',{min:0,max:100}),
    'sensor.robot_dock_error':entity('water_empty'),
  }});
  root(card).querySelector('[data-panel="dock"]').click();await settle(card);
  const empty=root(card).querySelector('[data-device="dust_emptying"]');
  const wash=root(card).querySelector('[data-device="mop_washing"]');
  assert.equal(empty.disabled,false);
  assert.equal(wash.disabled,true);
  empty.click();await settle(card);
  assert.deepEqual(calls.map(call=>call.data.control),['dust_emptying']);
});


for (const [nativeStatus,activity,title] of [
  ['washing_the_mop','docked','Washing mops'],
  ['washing_the_mop_2','docked','Washing mops'],
  ['air_drying_stopping','docked','Finishing mop drying'],
  ['segment_mopping','cleaning','Cleaning in progress'],
  ['back_to_dock_washing_duster','returning','Returning to dock'],
]) test(`fresh normalized ${nativeStatus} does not look offline when HA omits its vacuum mapping`,async()=>{
  const {card,calls}=await fixture({states:{
    'vacuum.robot':entity('unknown',{supported_features:FEATURES}),
    'sensor.robot_status':entity(nativeStatus),
    'sensor.robot_queue':stoppedQueue({recovery_ready:false,robot_connected:true,robot_activity:activity,robot_observed_at:Date.now()/1000}),
  }});
  assert.equal(root(card).querySelector('h2').textContent,title);
  assert.doesNotMatch(root(card).querySelector('.subline').textContent,/reconnect/);
  assert.equal(calls.length,0);
});

for (const [native,attrs] of [
  ['unavailable',{}],
  ['unknown',{robot_connected:false}],
  ['unknown',{robot_observed_at:Date.now()/1000-120}],
  ['unknown',{execution_version:2}],
  ['unknown',{execution_version:undefined}],
  ['unknown',{robot_activity:'invented'}],
]) test(`normalized status never hides ${native} with ${JSON.stringify(Object.keys(attrs))}`,async()=>{
  const {card}=await fixture({states:{
    'vacuum.robot':entity(native,{supported_features:FEATURES}),
    'sensor.robot_queue':stoppedQueue({robot_connected:true,robot_activity:'docked',robot_observed_at:Date.now()/1000,...attrs}),
  }});
  assert.equal(root(card).querySelector('h2').textContent,'Robot unavailable');
  assert.equal(button(card,'clear-queue').disabled,false);
});

test('historical attention does not remove controls for an external active cleaning job',async()=>{
  const {card,calls}=await fixture({states:{
    'vacuum.robot':entity('cleaning',{supported_features:FEATURES|8}),
    'binary_sensor.robot_cleaning':entity('on'),
    'sensor.robot_status':entity('segment_cleaning'),
    'sensor.robot_queue':stoppedQueue({recovery_ready:false,recovery_reason:'A cleaning job is active.'}),
  }});
  for(const action of ['pause','dock','stop']) assert.equal(button(card,action).disabled,false);
  assert.equal(button(card,'start'),null);
  button(card,'dock').click();await settle(card);
  assert.deepEqual(calls.map(call=>call.data.command),['return_to_dock']);
});

function visibleRooms(card) { return [...root(card).querySelectorAll('[data-room-item]')].map(node=>node.dataset.roomItem); }
function pointer(card,id,type,y,pointerId=7) {
  const target=type==='pointerdown'?root(card).querySelector(`[data-drag-room="${id}"]`):window;
  target.dispatchEvent(new browser.PointerEvent(type,{pointerId,pointerType:'touch',isPrimary:true,button:0,clientY:y,bubbles:true,cancelable:true}));
}
function mockRoomGeometry(card) {
  for(const node of root(card).querySelectorAll('[data-room-item]'))node.getBoundingClientRect=()=>{
    const i=visibleRooms(card).indexOf(node.dataset.roomItem);
    return {top:i*100,bottom:i*100+90,height:90,left:0,right:360,width:360};
  };
  globalThis.requestAnimationFrame=callback=>browser.requestAnimationFrame(callback);
  globalThis.cancelAnimationFrame=id=>browser.cancelAnimationFrame(id);
  globalThis.getComputedStyle=node=>browser.getComputedStyle(node);
}

test('keyboard handles reorder disabled and enabled rooms without altering membership or settings',async()=>{
  const {card,calls}=await fixture();
  await tap(card,'0_3');await tap(card,'0_1');
  await moveKey(card,'0_3','Home');
  assert.deepEqual(visibleRooms(card),['0_3','0_1','0_2']);
  assert.deepEqual(card.manualSelected,['0_3','0_1']);
  await moveKey(card,'0_2','Home'); // Disabled room can still be arranged.
  assert.deepEqual(card.manualSelected,['0_3','0_1']);
  await tap(card,'0_2');assert.deepEqual(card.manualSelected,['0_2','0_3','0_1']);
  await tap(card,'0_2');await tap(card,'0_2');
  assert.deepEqual(card.manualSelected,['0_2','0_3','0_1']);
  assert.deepEqual(calls,[]);
});

test('touch drag reorders the actual room tiles and the eventual start payload',async()=>{
  const {card,calls}=await fixture();await tap(card,'0_1');await tap(card,'0_3');
  mockRoomGeometry(card);
  pointer(card,'0_3','pointerdown',245);pointer(card,'0_3','pointermove',35);await settle(card);
  assert.deepEqual(visibleRooms(card),['0_3','0_1','0_2']);
  assert.ok(root(card).querySelector('[data-room-item="0_3"]').classList.contains('dragging'));
  pointer(card,'0_3','pointerup',35);await settle(card);
  assert.equal(root(card).querySelector('.dragging'),null);
  assert.deepEqual(calls,[]);
  button(card,'start').click();await settle(card);
  assert.deepEqual(calls[0].data.rooms.map(room=>room.id),['0_3','0_1']);
});

for(const cancel of ['pointercancel','Escape','lostpointercapture','blur'])test(`cancelled touch drag restores the draft (${cancel})`,async()=>{
  const {card,calls}=await fixture();await tap(card,'0_1');await tap(card,'0_3');mockRoomGeometry(card);
  pointer(card,'0_3','pointerdown',245);pointer(card,'0_3','pointermove',35);await settle(card);
  if(cancel==='Escape')window.dispatchEvent(new browser.KeyboardEvent('keydown',{key:'Escape',cancelable:true}));
  else if(cancel==='blur')window.dispatchEvent(new browser.Event('blur'));
  else if(cancel==='lostpointercapture')root(card).querySelector('[data-drag-room="0_3"]').dispatchEvent(new browser.PointerEvent(cancel,{pointerId:7}));
  else pointer(card,'0_3','pointercancel',35);
  await settle(card);
  assert.deepEqual(visibleRooms(card),['0_1','0_2','0_3']);assert.deepEqual(card.manualSelected,['0_1','0_3']);
  assert.deepEqual(calls,[]);
});

test('handle tap and a second pointer cannot select or move a room',async()=>{
  const {card,calls}=await fixture();mockRoomGeometry(card);
  pointer(card,'0_3','pointerdown',245);pointer(card,'0_3','pointermove',15,99);
  pointer(card,'0_3','pointermove',242);pointer(card,'0_3','pointerup',242);await settle(card);
  assert.deepEqual(visibleRooms(card),['0_1','0_2','0_3']);assert.deepEqual(card.manualSelected,[]);assert.deepEqual(calls,[]);
});

test('a running sequence displays frozen order and cannot be reordered or toggled',async()=>{
  const {card,calls}=await fixture({states:{
    'vacuum.robot':entity('cleaning',{supported_features:FEATURES}),
    'sensor.robot_queue':entity('running',{vacuum:'vacuum.robot',mode:'manual',targets:['0_3','0_1'],setup:{rooms:[{id:'0_3',setup:ROOM_DEFAULTS},{id:'0_1',setup:ROOM_DEFAULTS}]},stages:[{target:'0_3',mode:'vacuum_mop'},{target:'0_1',mode:'vacuum_mop'}],current_index:0,completed:0})
  }});
  assert.deepEqual(visibleRooms(card),['0_3','0_1','0_2']);
  assert.equal(root(card).querySelector('[data-drag-room]'),null);
  assert.equal(room(card,'0_3').disabled,true);await tap(card,'0_2');assert.deepEqual(calls,[]);
});

test('pending room controls work directly during cleaning without a separate edit-mode step',async()=>{
  const {card,calls}=await editableFixture();
  assert.equal(room(card,'0_1').disabled,true);
  assert.equal(room(card,'0_2').disabled,true);
  assert.equal(room(card,'0_3').disabled,false);
  assert.equal(room(card,'0_5').disabled,false);
  assert.equal(root(card).querySelector('[data-drag-room="0_3"]').disabled,false);
  await tap(card,'0_5');
  assert.equal(room(card,'0_5').getAttribute('aria-checked'),'true');
  assert.equal(button(card,'apply-queue-edit').disabled,false);
  assert.deepEqual(calls,[],'Toggling creates a draft, never a robot command');
  button(card,'cancel-queue-edit').click();await settle(card);
  assert.equal(room(card,'0_5').getAttribute('aria-checked'),'false');
});

test('keyboard reordering directly opens a pending-only queue draft',async()=>{
  const {card,calls}=await editableFixture();
  await moveKey(card,'0_4','Home');
  assert.equal(order(card,'0_1'),'1');assert.equal(order(card,'0_2'),'2');
  assert.equal(order(card,'0_4'),'3');assert.equal(order(card,'0_3'),'4');
  assert.equal(button(card,'apply-queue-edit').disabled,false);
  assert.deepEqual(calls,[]);
});
