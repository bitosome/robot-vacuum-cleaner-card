import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { Window } from 'happy-dom';

const browser = new Window({url:'http://area-appearance.test/'});
for (const key of ['window','document','HTMLElement','Element','ShadowRoot','Document','CSSStyleSheet','customElements','Event','CustomEvent','MutationObserver','Node','HTMLInputElement','HTMLSelectElement']) {
  Object.defineProperty(globalThis,key,{configurable:true,value:key==='window' ? browser : browser[key]});
}
await import('../dist/robot-vacuum-cleaner-card.js');
const baseConfig = {type:'custom:robot-vacuum-cleaner-card',entity:'vacuum.robot',rooms:[{id:'preset_lounge',name:'Lounge preset',preset:'button.robot_lounge',icon:'mdi:sofa-outline'}]};
const capabilities = {
  supported:true,modes:[{value:'vacuum',label:'Vacuum'}],suction:['balanced'],water:[],routes:[],repeats:[1],
  room_targets:[{id:'living_area',name:'Living area',icon:'mdi:sofa'},{id:'kitchen_area',name:'Kitchen',icon:'mdi:stove'},{id:'hall_area',name:'Hall'}],
  defaults:{mode:'vacuum',suction:'balanced',repeat:1},
};
const state = (state,attributes={})=>({state,attributes});
const states = {
  'vacuum.robot':state('docked',{supported_features:8192|4|16}),
  'sensor.robot_cleaner_queue':state('idle',{vacuum:'vacuum.robot',presets:[]}),
  'button.robot_lounge':state('unknown'),
};
async function settle(element) { for(let index=0;index<6;index++){await element.updateComplete;await Promise.resolve();} }
async function fixture(config={}) {
  const calls=[];const card=document.createElement('robot-vacuum-cleaner-card');
  card.setConfig({...structuredClone(baseConfig),...config});
  card.hass={states,services:{robot_cleaner_queue:{control:{},get_capabilities:{}}},async callWS(){return {response:structuredClone(capabilities)};},async callService(domain,service,data){calls.push({domain,service,data:structuredClone(data)});}};
  document.body.append(card);await settle(card);return {card,calls};
}
const action=(element,value)=>element.shadowRoot.querySelector(`[data-action="${value}"]`);
const room=(card,id)=>card.shadowRoot.querySelector(`[data-room="${id}"]`);
async function click(card,element){assert.ok(element);element.click();await settle(card);}
async function manual(card){await click(card,action(card,'setup'));await click(card,action(card,'manual'));await click(card,action(card,'apply-setup'));}
async function change(editor,label,value){const input=editor.shadowRoot.querySelector(`[aria-label="${label}"]`);assert.ok(input);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));await settle(editor);}
afterEach(()=>{for(const node of [...document.body.children])node.remove();});
after(async()=>{await browser.happyDOM.abort();browser.close();});

test('manual area appearance changes display without adding targets or changing cleaning IDs',async()=>{
  const original={living_area:{name:'Lounge',icon:'mdi:sofa-outline'},unmapped_area:{name:'Not mapped',icon:'mdi:bed'}};
  const {card,calls}=await fixture({area_overrides:original});
  original.living_area.name='Mutated input';original.living_area.icon='mdi:alert';
  assert.equal(room(card,'preset_lounge').querySelector('ha-icon').icon,'mdi:sofa-outline');
  await manual(card);
  assert.match(room(card,'living_area').textContent,/Lounge/);
  assert.equal(room(card,'living_area').querySelector('ha-icon').icon,'mdi:sofa-outline');
  assert.equal(room(card,'kitchen_area').querySelector('ha-icon').icon,'mdi:stove');
  assert.equal(room(card,'hall_area').querySelector('ha-icon').icon,'mdi:floor-plan');
  assert.equal(room(card,'unmapped_area'),null);assert.equal(room(card,'preset_lounge'),null);
  assert.equal(calls.length,0);
  await click(card,room(card,'kitchen_area'));await click(card,room(card,'living_area'));
  await click(card,action(card,'start'));
  assert.deepEqual(calls[0].data.rooms,['kitchen_area','living_area']);
  assert.equal(calls[0].data.command,'start_manual');
});

test('appearance labels remain escaped text',async()=>{
  const label='<img src=x onerror="alert(1)">';
  const {card}=await fixture({area_overrides:{living_area:{name:label}}});await manual(card);
  assert.equal(room(card,'living_area').querySelector('.room-name').textContent,label);
  assert.equal(card.shadowRoot.querySelector('img'),null);
});

test('area overrides reject invalid maps, entries and optional display values',()=>{
  const invalid=[null,[],new Date(),{area:[]},{area:null},{'':{icon:'mdi:sofa'}},{' area ':{name:'Room'}},{area:{name:3}},{area:{name:' '}},{area:{icon:false}},{area:{icon:''}}];
  for(const area_overrides of invalid){const card=document.createElement('robot-vacuum-cleaner-card');assert.throws(()=>card.setConfig({...baseConfig,area_overrides}),/area override|area_overrides|area ID/i);}
});

test('editor adds, updates and removes appearance overrides without mutating its input',async()=>{
  const Card=customElements.get('robot-vacuum-cleaner-card');const editor=await Card.getConfigElement();
  const original={...structuredClone(baseConfig),area_overrides:{living_area:{name:'Living area',icon:'mdi:sofa'}}};
  editor.hass={states};editor.setConfig(original);const emitted=[];
  editor.addEventListener('config-changed',event=>emitted.push(structuredClone(event.detail.config)));
  document.body.append(editor);await settle(editor);
  await change(editor,'Area 1 icon','mdi:sofa-outline');
  assert.equal(emitted.at(-1).area_overrides.living_area.icon,'mdi:sofa-outline');
  assert.equal(original.area_overrides.living_area.icon,'mdi:sofa');
  await click(editor,action(editor,'add-area-override'));
  await change(editor,'Area 2 ID','kitchen_area');await change(editor,'Area 2 name','Cooking');await change(editor,'Area 2 icon','mdi:stove');
  assert.deepEqual(emitted.at(-1).area_overrides.kitchen_area,{name:'Cooking',icon:'mdi:stove'});
  const count=emitted.length;await change(editor,'Area 2 ID','living_area');
  assert.equal(emitted.length,count);assert.match(editor.shadowRoot.querySelector('[role="alert"]').textContent,/unique/);
  await change(editor,'Area 2 ID','kitchen_area');await change(editor,'Area 2 name','');
  assert.deepEqual(emitted.at(-1).area_overrides.kitchen_area,{icon:'mdi:stove'});
  await click(editor,editor.shadowRoot.querySelectorAll('[data-action="remove-area-override"]')[0]);
  assert.deepEqual(emitted.at(-1).area_overrides,{kitchen_area:{icon:'mdi:stove'}});
  assert.deepEqual(original.area_overrides,{living_area:{name:'Living area',icon:'mdi:sofa'}});
});
