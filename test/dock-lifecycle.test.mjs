import assert from 'node:assert/strict';
import {after,afterEach,test} from 'node:test';
import {Window} from 'happy-dom';

// Native state and backend lifecycle are simulated; never call a real robot.
const browser=new Window({url:'http://dock-lifecycle.test/'});
for(const key of ['window','document','HTMLElement','Element','ShadowRoot','Document','CSSStyleSheet','customElements','Event','CustomEvent','MutationObserver','Node','HTMLInputElement','HTMLSelectElement','KeyboardEvent']) {
  Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?browser:browser[key]});
}
await import('../dist/robot-vacuum-cleaner-card.js');
const entity=(state,attributes={})=>({state,attributes});
const setup={mode:'vacuum_mop',suction:'balanced',water:'medium',route:'standard',repeat:1};
const plan=[{id:'0_1',name:'Kitchen',setup},{id:'0_2',name:'Hallway',setup}];
const stages=plan.map((room,room_index)=>({target:room.id,mode:'vacuum_mop',room_index,pass_index:0,repeat_index:0}));
const capabilities={supported:true,current_map:0,robot_rooms:plan.map((room,index)=>({id:room.id,name:room.name,segment:index+1})),room_targets:[],
  modes:[{value:'vacuum',label:'Vacuum'},{value:'vacuum_mop',label:'Vacuum & mop'}],suction:['quiet','balanced'],water:['low','medium'],routes:['standard'],repeats:[1,2],defaults:setup,
  saved_preset:{source:'rooms',revision:1,map_id:0,presets:[],setup:{},rooms:plan.map(room=>({id:room.id,...room.setup}))}};
const committed={control_version:5,vacuum:'vacuum.rover',mode:'manual',targets:plan.map(room=>room.id),setup:{rooms:plan},stages,current_index:2,completed:2,floor_cleaning_complete:true,waiting_for_dock:false,error:''};
const settle=async card=>{for(let i=0;i<10;i++){await card.updateComplete;await Promise.resolve();}};
async function fixture({phase='finishing',status='charging',vacuum='docked',attrs={},nativeStatus=true}={}) {
  const calls=[];
  const card=document.createElement('robot-vacuum-cleaner-card');
  card.setConfig({type:'custom:robot-vacuum-cleaner-card',entity:'vacuum.rover',cleaning_entity:'binary_sensor.rover_cleaning',...(nativeStatus?{status_entity:'sensor.rover_status'}:{})});
  card.hass={services:{robot_cleaner_queue:{control:{},get_capabilities:{},save_preset:{}}},states:{
    'vacuum.rover':entity(vacuum,{supported_features:8192|4|8|16}),
    'binary_sensor.rover_cleaning':entity(vacuum==='cleaning'?'on':'off'),
    'sensor.rover_status':entity(status),
    'sensor.robot_cleaner_queue':entity(phase,{...committed,dock_status:status,...attrs}),
  },callWS:async()=>({response:structuredClone(capabilities)}),callService:async(...args)=>{calls.push(args);}};
  document.body.append(card);await settle(card);return {card,calls};
}
const root=card=>card.shadowRoot;
const action=(card,name)=>root(card).querySelector(`[data-action="${name}"]`);
const headline=card=>root(card).querySelector('h2').textContent;
const subline=card=>root(card).querySelector('.subline').textContent;
afterEach(()=>{for(const card of [...document.body.children])card.remove();});
after(async()=>{await browser.happyDOM.abort();browser.close();});

for(const [status,vacuum,title] of [
  ['returning_home','returning','Returning to dock'],
  ['washing_the_mop','docked','Washing mops'],
  ['washing_the_mop_2','docked','Washing mops'],
  ['emptying_the_bin','docked','Emptying dustbin'],
  ['charging','docked','Finishing at the dock'],
]) test(`final ${status} keeps the sequence active with all floor rooms completed`,async()=>{
  const {card,calls}=await fixture({status,vacuum});
  assert.equal(headline(card),title);
  assert.match(subline(card),/2 rooms cleaned/);
  assert.doesNotMatch(subline(card),/Next:|Whole home|Room 1|pass|Run /i);
  assert.doesNotMatch(headline(card),/Recharging/);
  for(const room of plan){
    const button=root(card).querySelector(`[data-room="${room.id}"]`);
    assert.equal(button.disabled,true);
    assert.match(button.textContent,/Completed/);
  }
  assert.equal(action(card,'start'),null);
  assert.equal(action(card,'select-all'),null);
  assert.doesNotMatch(root(card).querySelector('.plan-bar').textContent,/Unsaved changes/);
  assert.equal(calls.length,0);
});

test('queue dock status supplies the same final-care feedback without a configured native status entity',async()=>{
  const {card}=await fixture({status:'washing_the_mop',nativeStatus:false});
  assert.equal(headline(card),'Washing mops');
  assert.match(subline(card),/Final dock care/);
});

test('completion restores the saved plan and distinguishes passive drying from an active cleaning sequence',async()=>{
  const {card,calls}=await fixture({status:'washing_the_mop'});
  card.hass={...card.hass,states:{...card.hass.states,
    'sensor.rover_status':entity('charging'),
    'sensor.robot_cleaner_queue':entity('completed',{...committed,dock_status:'charging',dock_drying:true}),
  }};
  await settle(card);
  assert.equal(headline(card),'Your rooms are clean');
  assert.match(subline(card),/Cleaning is complete.*Mops are drying/);
  assert.equal(action(card,'start').disabled,false,'Passive drying must not hold the next clean for hours');
  assert.equal(action(card,'save-preset').disabled,true);
  assert.deepEqual(card.manualSelected,['0_1','0_2']);
  assert.equal(calls.length,0);
});

for(const status of ['washing_the_mop','washing_the_mop_2','emptying_the_bin','attaching_the_mop','detaching_the_mop','air_drying_stopping']) test(`docked/job-off ${status} cannot enable a new cleaning run`,async()=>{
  const {card,calls}=await fixture({phase:'idle',status,attrs:{mode:'idle',targets:[],stages:[],setup:{},floor_cleaning_complete:false,completed:0,current_index:0}});
  assert.equal(action(card,'start').disabled,true);
  assert.match(action(card,'start').textContent,/Waiting for dock care/);
  assert.match(subline(card),/Dock care is in progress/);
  action(card,'start').click();await settle(card);
  assert.equal(calls.length,0);
});

test('mop washing between rooms describes the real next stage instead of final completion',async()=>{
  const {card}=await fixture({phase:'preparing',status:'washing_the_mop',attrs:{current_index:1,completed:1,floor_cleaning_complete:false,waiting_for_dock:true}});
  assert.equal(headline(card),'Washing mops');
  assert.match(subline(card),/Next: Hallway/);
  assert.doesNotMatch(subline(card),/rooms cleaned|Floor cleaning complete/);
});

test('an uncertain start explains observation without another dispatch and clears once the robot acknowledges',async()=>{
  const {card,calls}=await fixture({phase:'starting',attrs:{current_index:0,completed:0,floor_cleaning_complete:false,start_uncertain:true,command_failure:{operation:'start',category:'timeout',exception_types:['TimeoutError']}}});
  assert.equal(headline(card),'Waiting for cleaning to start');
  assert.match(subline(card),/may have reached the robot.*will not be sent again/);
  assert.doesNotMatch(root(card).textContent,/TimeoutError/);
  assert.equal(action(card,'start'),null);
  card.hass={...card.hass,states:{...card.hass.states,
    'vacuum.rover':entity('cleaning',{supported_features:8192|4|8|16}),
    'binary_sensor.rover_cleaning':entity('on'),
    'sensor.rover_status':entity('segment_cleaning'),
    'sensor.robot_cleaner_queue':entity('running',{...committed,current_index:0,completed:0,floor_cleaning_complete:false,start_uncertain:false}),
  }};await settle(card);
  assert.match(headline(card),/Cleaning Kitchen/);
  assert.doesNotMatch(subline(card),/may have reached/);
  assert.equal(calls.length,0);
});

test('attention details appear once instead of repeating the backend error in both hero and notice',async()=>{
  const message='The robot did not confirm the cleaning command.';
  const {card}=await fixture({phase:'attention',attrs:{error:message,floor_cleaning_complete:false}});
  assert.equal(root(card).textContent.split(message).length-1,1);
  assert.match(subline(card),/Clear the stopped sequence/);
});

test('charging between passes does not claim the battery needs recharging',async()=>{
  const {card}=await fixture({phase:'running',status:'charging',attrs:{current_index:1,completed:1,floor_cleaning_complete:false,waiting_for_dock:true}});
  assert.equal(headline(card),'Waiting at the dock');
  assert.match(subline(card),/Next: Hallway/);
  assert.doesNotMatch(subline(card),/rooms cleaned|Floor cleaning complete/);
});
