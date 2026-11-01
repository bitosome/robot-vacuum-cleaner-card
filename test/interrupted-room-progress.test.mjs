import assert from 'node:assert/strict';
import {after,afterEach,test} from 'node:test';
import {Window} from 'happy-dom';
import {openSettings} from './settings-navigation.mjs';

// Actual release bundle, synthetic server-owned confirmations, mobile viewport.
// No physical robot commands or production identifiers are used.
const browser=new Window({url:'http://interrupted-room-progress.test/',width:390,height:844});
for(const key of ['window','document','HTMLElement','Element','ShadowRoot','Document','CSSStyleSheet','customElements','Event','CustomEvent','MutationObserver','Node','HTMLInputElement','HTMLSelectElement']) Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?browser:browser[key]});
await import('../dist/robot-vacuum-cleaner-card.js');
const vacuum='vacuum.rover',runId='synthetic-interrupted-run';
const entity=(state,attributes={})=>({state,attributes});
const setup={mode:'vacuum_mop',suction:'balanced',water:'medium',route:'standard',repeat:1};
const plan=['Kitchen','Office','Hall','Entrance'].map((name,index)=>({id:`0_${index+1}`,name,setup:{...setup}}));
const stages=plan.map((room,room_index)=>({target:room.id,mode:'vacuum_mop',room_index,pass_index:0,repeat_index:0}));
const capabilities={supported:true,current_map:0,robot_rooms:plan.map((room,index)=>({id:room.id,name:room.name,segment:index+1})),room_targets:[],
  modes:[{value:'vacuum'},{value:'vacuum_mop'},{value:'vacuum_then_mop'}],suction:['balanced','turbo'],water:['medium'],routes:['standard'],repeats:[1,2],defaults:setup,
  saved_preset:{source:'rooms',revision:1,map_id:0,presets:[],setup:{},rooms:[{id:'0_4',...setup,suction:'turbo'},{id:'0_1',...setup}]}};
const cleanup={version:1,run_id:runId,revision:1,state:'attention',armed:true,required:{mop_washing:true,dust_emptying:true},actions:{mop_washing:{state:'pending'},dust_emptying:{state:'pending'}},reason:'Dock completion was not confirmed.',retry_allowed:false};
const attrs={vacuum,run_id:runId,mode:'finish',control_version:6,execution_version:3,targets:plan.map(room=>room.id),setup:{rooms:plan},stages,current_index:3,completed:3,
  floor_cleaning_complete:false,waiting_for_dock:false,recovery_ready:false,pending_command:'',dock_status:'charging',dock_cleanup:cleanup,
  run_history_version:1,history_revision:1,last_run:{run_id:runId,state:'attention',completed_count:3,stage_count:4}};
const history={run_id:runId,vacuum,state:'attention',assigned_at:1791871200,rooms:plan.map(({id,name})=>({id,name})),
  stages:stages.map((stage,index)=>({...stage,index,state:index<3?'completed':'attention',...(index<3?{finished_at:1791871500+index*600}:{reason:'Cleaning did not start.'})})),interruptions:[{at:1791874000,reason:'Dock completion was not confirmed.'}]};
const settle=async card=>{for(let i=0;i<15;i++){await card.updateComplete;await Promise.resolve();}};
async function fixture({phase='attention',attributes={},job=false,caps=capabilities}={}) {
  const calls=[],card=document.createElement('robot-vacuum-cleaner-card');
  card.style.width='390px';
  card.setConfig({type:'custom:robot-vacuum-cleaner-card',entity:vacuum,queue_entity:'sensor.queue',status_entity:'sensor.status',cleaning_entity:'binary_sensor.cleaning'});
  card.hass={locale:{language:'en-GB'},config:{time_zone:'Europe/Tallinn'},services:{robot_cleaner_queue:{control:{},get_capabilities:{},get_history:{},save_preset:{}}},states:{
    [vacuum]:entity(job?'cleaning':'docked',{supported_features:8192|4|8|16,battery_level:84}),
    'sensor.queue':entity(phase,{...attrs,...attributes}),'sensor.status':entity(job?'segment_cleaning':'charging'),'binary_sensor.cleaning':entity(job?'on':'off'),
  },async callWS(message){return {response:structuredClone(message.service==='get_history'?{history_revision:1,last_run:history,previous_runs:[]}:caps)};},async callService(...args){calls.push(args);}};
  document.body.append(card);await settle(card);return {card,calls};
}
async function update(card,phase,attributes) {card.hass={...card.hass,states:{...card.hass.states,'sensor.queue':entity(phase,{...attrs,...attributes})}};await settle(card);}
const root=card=>card.shadowRoot;
const action=(card,name)=>root(card).querySelector(`[data-action="${name}"]`);
const room=(card,id)=>root(card).querySelector(`[data-room="${id}"]`);
const states=card=>plan.map(({id})=>room(card,id).querySelector('.room-state')?.textContent.trim()??'');
afterEach(()=>{for(const card of [...document.body.children])card.remove();});
after(async()=>{await browser.happyDOM.abort();browser.close();});

test('mobile room tiles retain three confirmed rooms after dock attention and a fresh dashboard load',async()=>{
  for(let load=0;load<2;load++){
    const {card,calls}=await fixture();
    assert.equal(browser.innerWidth,390);
    assert.deepEqual(states(card),['Cleaned','Cleaned','Cleaned','Not completed']);
    assert.equal(root(card).querySelector('.room-section h3').textContent,'Interrupted sequence');
    assert.deepEqual([...root(card).querySelectorAll('[data-room]')].map(node=>node.dataset.room),plan.map(room=>room.id),'Frozen execution order wins over the differently ordered saved plan');
    assert.equal(root(card).querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'75');
    assert.match(root(card).querySelector('.progress-summary').textContent,/3 \/ 4 rooms/);
    assert.equal(root(card).querySelectorAll('.room.done').length,3);
    for(const {id} of plan.slice(0,3)) assert.equal(room(card,id).querySelector('.room-protected ha-icon').icon,'mdi:check');
    for(const {id} of plan) assert.equal(room(card,id).disabled,true);
    assert.equal(action(card,'select-all'),null);assert.equal(root(card).querySelector('.plan-section'),null);
    await openSettings(card,'0_4');
    const suction=root(card).querySelector('[data-room-id="0_4"][data-room-setting="suction"]');
    assert.equal(suction.value,'balanced','The interrupted room keeps its assigned setup');assert.equal(suction.disabled,true);
    assert.equal(calls.length,0);card.remove();
  }
});

test('an unowned native resume does not erase or impersonate the interrupted sequence',async()=>{
  const {card,calls}=await fixture({job:true,attributes:{mode:'manual',dock_cleanup:undefined,continuation_ready:false,continuation_action:'',error:'The robot resumed outside the sequence.'}});
  assert.deepEqual(states(card),['Cleaned','Cleaned','Cleaned','Not completed']);
  assert.equal(root(card).querySelector('.room-section h3').textContent,'Interrupted sequence');
  assert.match(root(card).querySelector('.progress-summary').textContent,/Interrupted sequence.*3 \/ 4 rooms/);
  assert.equal(root(card).querySelectorAll('.room.active').length,0,'An unadopted robot job cannot be shown as this run’s active room');
  for(const {id} of plan) assert.equal(room(card,id).disabled,true);
  assert.equal(action(card,'start'),null);assert.equal(action(card,'select-all'),null);assert.equal(calls.length,0);
});

test('a partially completed room keeps confirmed pass count without claiming the whole room is clean',async()=>{
  const partialStages=[{...stages[0],mode:'vacuum'},{...stages[0],mode:'mop',pass_index:1},...stages.slice(1)];
  const {card}=await fixture({attributes:{stages:partialStages,completed:1,current_index:1}});
  assert.equal(states(card)[0],'1 / 2 passes done');assert.equal(root(card).querySelectorAll('.room.done').length,0);
  assert.equal(root(card).querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'0');
  assert.match(room(card,'0_1').getAttribute('aria-label'),/1 \/ 2 passes done/);
});

test('cancel, dock control and final care preserve the confirmed prefix without making the untouched room active',async()=>{
  const {card}=await fixture();
  for(const phase of ['cancelled','controlling','finishing','attention']){
    await update(card,phase,{});
    assert.deepEqual(states(card),['Cleaned','Cleaned','Cleaned','Not completed']);
    assert.equal(root(card).querySelectorAll('.room.active').length,0);
  }
});

test('missing current map rooms cannot hide confirmed rooms from a retained run',async()=>{
  const {card}=await fixture({caps:{...capabilities,robot_rooms:[capabilities.robot_rooms[3]]}});
  assert.deepEqual(states(card),['Cleaned','Cleaned','Cleaned','Not completed']);
});

test('cleared and recovered next plans keep historical outcomes outside their selectable room tiles',async()=>{
  const {card}=await fixture();
  await update(card,'attention',{mode:'manual',recovery_ready:true,dock_cleanup:undefined});
  assert.ok(states(card).every(state=>state!=='Cleaned'));
  assert.match(root(card).querySelector('.room-section h3').textContent,/Next plan/);
  assert.ok(action(card,'select-all'));
  await update(card,'idle',{mode:'idle',run_id:'',targets:[],stages:[],setup:{},completed:0,dock_cleanup:undefined});
  assert.equal(root(card).querySelectorAll('.room.done').length,0);
  assert.equal(root(card).querySelector('[role="progressbar"]'),null);
  assert.equal(root(card).querySelectorAll('.activity-room-done').length,3,'Retained history remains independently visible');
  assert.equal(room(card,'0_4').disabled,false);
});

test('a new run and unrelated native control cannot inherit the previous run’s confirmed rooms',async()=>{
  const {card}=await fixture();
  await update(card,'starting',{mode:'manual',run_id:'new-run',completed:0,current_index:0,dock_cleanup:undefined});
  assert.equal(root(card).querySelectorAll('.room.done').length,0);
  assert.equal(root(card).querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'0');
  for(const mode of ['external','device']){
    await update(card,'attention',{mode,run_id:'unowned-run',stages:[],targets:[],completed:0,dock_cleanup:undefined});
    assert.equal(root(card).querySelectorAll('.room.done').length,0);assert.equal(root(card).querySelector('[role="progressbar"]'),null);
  }
});

test('a stale finish summary cannot lend completed rooms to a different run',async()=>{
  const {card}=await fixture({attributes:{run_id:'another-run'}});
  assert.equal(root(card).querySelectorAll('.room.done').length,0);assert.equal(root(card).querySelector('[role="progressbar"]'),null);
});
