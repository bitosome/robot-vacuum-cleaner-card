import assert from 'node:assert/strict';
import {after,afterEach,test} from 'node:test';
import {Window} from 'happy-dom';

// Only synthetic HA entities and service calls; never actuate a physical robot.
const browser=new Window({url:'http://sequence-recovery.test/'});
for(const key of ['window','document','HTMLElement','Element','ShadowRoot','Document','CSSStyleSheet','customElements','Event','CustomEvent','MutationObserver','Node','HTMLInputElement','HTMLSelectElement']) Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?browser:browser[key]});
await import('../dist/robot-vacuum-cleaner-card.js');
const entity=(state,attributes={})=>({state,attributes});
const vacuum='vacuum.rover';
const setup={mode:'vacuum_then_mop',suction:'balanced',water:'medium',route:'standard',repeat:2};
const stages=['vacuum','vacuum','mop','mop'].map((mode,index)=>({target:'0_1',mode,room_index:0,pass_index:Math.floor(index/2),repeat_index:index%2}));
const attrs={vacuum,run_id:'retained-run',control_version:6,execution_version:3,mode:'manual',targets:['0_1'],setup:{rooms:[{id:'0_1',name:'Kitchen',setup}]},stages,current_index:1,completed:1,waiting_for_dock:false,floor_cleaning_complete:false,pending_command:'',command_barrier_until:0,run_history_version:1,history_revision:1,robot_job:'on'};
const record=(extra={})=>({run_id:attrs.run_id,vacuum,state:'running',assigned_at:1791871200,rooms:[{id:'0_1',name:'Kitchen'}],stages:stages.map((stage,index)=>({...stage,index,state:index===0?'completed':index===1?'running':'pending',...(index===0?{finished_at:1791871300}:index===1?{started_at:1791871400}:{})})),interruptions:[],...extra});
const capabilities={supported:true,current_map:0,robot_rooms:[{id:'0_1',name:'Kitchen',segment:1}],room_targets:[],modes:[{value:'vacuum_then_mop'},{value:'vacuum'},{value:'mop'}],suction:['balanced'],water:['medium'],routes:['standard'],repeats:[1,2],defaults:setup};
const settle=async card=>{for(let i=0;i<12;i++){await card.updateComplete;await Promise.resolve();}};
async function fixture({phase='running',attributes={},job='on',status='charging',state='docked',water='none',service,history,controlService=true}={}) {
  const calls=[],card=document.createElement('robot-vacuum-cleaner-card');
  card.setConfig({type:'custom:robot-vacuum-cleaner-card',entity:vacuum,queue_entity:'sensor.queue',status_entity:'sensor.status',cleaning_entity:'binary_sensor.cleaning',dock_error_entity:'sensor.dock_error',area_entity:'sensor.area',time_entity:'sensor.time'});
  card.hass={locale:{language:'en-GB'},config:{time_zone:'Europe/Tallinn'},services:{robot_cleaner_queue:{...(controlService?{control:{}}:{}),get_capabilities:{},get_history:{}}},states:{
    [vacuum]:entity(state,{supported_features:8192|4|8|16,battery_level:29}),
    'sensor.queue':entity(phase,{...attrs,...attributes}),'sensor.status':entity(status),'binary_sensor.cleaning':entity(job),'sensor.dock_error':entity(water),'sensor.area':entity('6.5',{unit_of_measurement:'m²'}),'sensor.time':entity('9.7',{unit_of_measurement:'min'}),
  },async callWS(message){return {response:message.service==='get_history'?history??{last_run:record({state:phase}),previous_runs:[],history_revision:1}:structuredClone(capabilities)};},async callService(domain,action,data){calls.push({domain,action,data});return service?.(data);}};
  document.body.append(card);await settle(card);return {card,calls};
}
async function update(card,patch){card.hass={...card.hass,states:{...card.hass.states,...patch}};await settle(card);}
const root=card=>card.shadowRoot;
const action=(card,name)=>root(card).querySelector(`[data-action="${name}"]`);
const headline=card=>root(card).querySelector('h2').textContent;
const activity=card=>root(card).querySelector('.sequence-activity');
afterEach(()=>{for(const card of [...document.body.children])card.remove();});
after(async()=>{await browser.happyDOM.abort();browser.close();});

test('a charging break consistently retains the active pass, sequence progress and measured work',async()=>{
  const {card,calls}=await fixture({attributes:{resume_now_ready:true}});
  assert.equal(headline(card),'Charging to continue');
  assert.match(root(card).querySelector('.subline').textContent,/Kitchen · Vacuum pass 2\/2 paused for charging/);
  assert.match(root(card).querySelector('.progress-summary').textContent,/1 \/ 5 steps/);
  assert.match(root(card).querySelector('.pills').textContent,/Pass so far.*6.5 m².*9.7 min/);
  assert.match(root(card).querySelector('[data-room="0_1"]').textContent,/Charging/);
  assert.match(activity(card).querySelector('summary').textContent,/Charging to continue/);
  assert.match(activity(card).querySelector('[data-history-stage="1"]').textContent,/Vacuum 2\/2 · Charging/);
  assert.match(activity(card).querySelector('[data-history-stage="0"]').textContent,/Done/);
  assert.match(activity(card).querySelector('[data-history-stage="2"]').textContent,/Queued/);
  assert.equal(action(card,'dock'),null);assert.equal(action(card,'pause'),null);assert.equal(action(card,'resume'),null);
  assert.equal(action(card,'resume-now').disabled,false);assert.match(action(card,'stop').textContent,/Stop sequence/);
  assert.equal(calls.length,0,'Observing a charging break must never send a command');
});

test('Continue now delegates only the explicit backend action, once, and waits for real cleaning',async()=>{
  const {card,calls}=await fixture({attributes:{resume_now_ready:true}});
  action(card,'resume-now').click();await settle(card);action(card,'resume-now').click();await settle(card);
  assert.deepEqual(calls,[{domain:'robot_cleaner_queue',action:'control',data:{command:'resume_now',vacuum,run_id:attrs.run_id,current_index:1}}]);
  assert.equal(card.request.kind,'resume_now');
  await update(card,{'sensor.queue':entity('running',{...attrs,resume_now_ready:false})});assert.equal(card.request.kind,'resume_now');
  await update(card,{[vacuum]:entity('cleaning',{supported_features:8192|4|8|16}),'sensor.status':entity('segment_cleaning')});
  assert.equal(card.request,undefined);assert.equal(action(card,'resume-now'),null);assert.match(headline(card),/Vacuuming Kitchen/);
  assert.match(activity(card).querySelector('[data-history-stage="1"]').textContent,/Cleaning/);
});

test('a charging break blocked by the backend shows its reason without offering a generic start',async()=>{
  const {card,calls}=await fixture({attributes:{resume_now_ready:false,resume_now_reason:'Battery is below the safe restart level.'}});
  assert.equal(action(card,'resume-now').disabled,true);assert.match(root(card).textContent,/Battery is below/);
  assert.equal(action(card,'start'),null);action(card,'resume-now').click();await settle(card);assert.equal(calls.length,0);
});

for(const attributes of [{control_version:5,resume_now_ready:true},{control_version:6,resume_now_ready:true,command_barrier_until:Date.now()/1000+120}]) test(`old companions and active barriers cannot force continuation: ${Object.keys(attributes).join(',')}`,async()=>{
  const {card,calls}=await fixture({attributes});const button=action(card,'resume-now');
  if(button){assert.equal(button.disabled,true);button.click();await settle(card);}assert.equal(calls.length,0);
});

test('native unfinished-job telemetry works without a configured cleaning binary sensor',async()=>{
  const {card}=await fixture({job:'unavailable',attributes:{robot_job:'on',resume_now_ready:true}});
  assert.equal(headline(card),'Charging to continue');assert.equal(action(card,'resume-now').disabled,false);
});

test('ordinary docking between completed passes is not described as a battery break',async()=>{
  const {card}=await fixture({job:'off',attributes:{robot_job:'off',waiting_for_dock:true,resume_now_ready:true}});
  assert.equal(headline(card),'Waiting at the dock');assert.equal(action(card,'resume-now'),null);
});

test('water interruption offers a retained sequence, then an explicit retry of only the unconfirmed pass',async()=>{
  const recovery={...attrs,current_index:2,completed:2,robot_job:'off',continuation_action:'retry_stage',continuation_ready:false,continuation_reason:'Refill and reseat the clean-water tank.',error:'Water tank empty.'};
  const {card,calls}=await fixture({phase:'attention',job:'off',water:'water_empty',attributes:recovery});
  assert.equal(headline(card),'Dock needs water');assert.equal(action(card,'continue-sequence').disabled,true);
  assert.match(root(card).querySelector('.recovery-note').textContent,/Refill and reseat/);
  assert.equal(action(card,'start'),null);assert.equal(calls.length,0);
  await update(card,{'sensor.dock_error':entity('none'),'sensor.queue':entity('attention',{...recovery,continuation_ready:true,continuation_reason:''})});
  assert.equal(headline(card),'Sequence paused');assert.match(action(card,'continue-sequence').textContent,/Retry current pass/);
  assert.match(root(card).querySelector('.recovery-note').textContent,/unconfirmed pass will run again; completed passes stay done/);
  action(card,'continue-sequence').click();await settle(card);
  assert.deepEqual(calls,[{domain:'robot_cleaner_queue',action:'control',data:{command:'continue_sequence',vacuum,run_id:attrs.run_id,current_index:2}}]);
  await update(card,{'sensor.queue':entity('preparing',{...recovery,robot_job:'off'})});
  assert.equal(card.request,undefined);assert.equal(action(card,'continue-sequence'),null);
  assert.match(activity(card).querySelector('[data-history-stage="0"]').textContent,/Done/);
});

for(const [kind,label] of [['resume_job','Continue sequence'],['continue_next','Continue sequence'],['finish_docking','Check dock completion']]) test(`${kind} recovery uses its own meaning and never dispatches a saved replacement plan`,async()=>{
  const {card,calls}=await fixture({phase:'attention',job:'off',attributes:{robot_job:'off',continuation_action:kind,continuation_ready:true}});
  assert.match(action(card,'continue-sequence').textContent,new RegExp(label));
  assert.doesNotMatch(root(card).querySelector('.recovery-note').textContent,/will run again/);
  action(card,'continue-sequence').click();await settle(card);
  assert.deepEqual(calls.map(call=>call.data),[{command:'continue_sequence',vacuum,run_id:attrs.run_id,current_index:1}]);
});

test('retained paused native job uses Continue sequence, never destructive generic Resume',async()=>{
  const {card,calls}=await fixture({phase:'attention',state:'paused',status:'paused',attributes:{continuation_action:'resume_job',continuation_ready:true}});
  assert.equal(action(card,'resume'),null);assert.equal(action(card,'continue-sequence').disabled,false);
  action(card,'continue-sequence').click();await settle(card);assert.equal(calls[0].data.command,'continue_sequence');
});

test('recovery errors are surfaced while preserving the sequence and completion evidence',async()=>{
  const {card,calls}=await fixture({phase:'attention',job:'off',attributes:{robot_job:'off',continuation_action:'retry_stage',continuation_ready:true},service:()=>{throw Error('Robot state changed. Wait for a fresh update.');}});
  action(card,'continue-sequence').click();await settle(card);
  assert.equal(card.request,undefined);assert.match(root(card).querySelector('[role="alert"]').textContent,/Robot state changed/);
  assert.match(activity(card).querySelector('[data-history-stage="0"]').textContent,/Done/);assert.equal(calls.length,1);
});

test('an unknown continuation action cannot become an enabled physical action',async()=>{
  const {card,calls}=await fixture({phase:'attention',job:'off',attributes:{robot_job:'off',continuation_action:'invented',continuation_ready:true,continuation_reason:'Review the robot state.'}});
  assert.equal(action(card,'continue-sequence').disabled,true);assert.match(root(card).textContent,/Review the robot state/);
  action(card,'continue-sequence').click();await settle(card);assert.equal(calls.length,0);
});

test('live charging does not overwrite the labels of an earlier sequence',async()=>{
  const previous=record({run_id:'old-run',state:'attention'});
  const {card}=await fixture({history:{last_run:record(),previous_runs:[previous],history_revision:1}});
  const select=activity(card).querySelector('select');select.value='old-run';select.dispatchEvent(new Event('change'));await settle(card);
  assert.doesNotMatch(activity(card).querySelector('.activity-rooms').textContent,/Charging/);assert.match(activity(card).querySelector('summary').textContent,/Needs attention/);
  assert.match(activity(card).querySelector('option[value="retained-run"]').textContent,/Charging to continue/);
  assert.match(headline(card),/Charging to continue/);
});


test('latched water warning requires a refill confirmation without sending a command on open or cancel',async()=>{
  const {card,calls}=await fixture({phase:'attention',job:'off',water:'water_empty',attributes:{robot_job:'off',continuation_action:'retry_stage',continuation_ready:true,continuation_requires_water_ack:true}});
  action(card,'continue-sequence').click();await settle(card);
  assert.equal(root(card).querySelector('.recovery-dialog').open,true);
  assert.match(root(card).querySelector('.recovery-dialog').textContent,/filled and reseated/);assert.equal(calls.length,0);
  action(card,'cancel-refill').click();await settle(card);assert.equal(calls.length,0);
  assert.equal(root(card).querySelector('.recovery-dialog').open,false);
  action(card,'continue-sequence').click();await settle(card);action(card,'confirm-refill').click();await settle(card);
  assert.deepEqual(calls.map(call=>call.data),[{command:'continue_sequence',vacuum,run_id:attrs.run_id,current_index:1,water_refilled:true}]);
});

test('a refill acknowledgement cannot apply to a changed run or pass',async()=>{
  const recovery={...attrs,robot_job:'off',continuation_action:'retry_stage',continuation_ready:true,continuation_requires_water_ack:true};
  const {card,calls}=await fixture({phase:'attention',job:'off',water:'water_empty',attributes:recovery});
  action(card,'continue-sequence').click();await settle(card);
  await update(card,{'sensor.queue':entity('attention',{...recovery,run_id:'replacement-run'})});
  action(card,'confirm-refill').click();await settle(card);
  assert.equal(calls.length,0);assert.match(root(card).querySelector('[role="alert"]').textContent,/sequence changed/);
});

test('a latched water warning acknowledged for the active pass does not hide actual cleaning',async()=>{
  const {card}=await fixture({state:'cleaning',status:'segment_cleaning',water:'water_empty',attributes:{water_refill_ack_active:true}});
  assert.match(headline(card),/Vacuuming Kitchen/);
  assert.match(root(card).querySelector('.water-warning').textContent,/still reports a water warning.*refilled for this pass/);
  await update(card,{'sensor.dock_error':entity('dirty_water_full')});
  assert.equal(headline(card),'Needs attention');
});

test('an acknowledgement in a historical or old-version queue cannot silence a current water fault',async()=>{
  const {card}=await fixture({phase:'attention',job:'off',water:'water_empty',attributes:{current_index:2,completed:2,robot_job:'off',water_refill_ack_active:true}});
  assert.equal(headline(card),'Dock needs water');
  await update(card,{'sensor.queue':entity('running',{...attrs,current_index:2,completed:2,control_version:5,water_refill_ack_active:true})});
  assert.equal(headline(card),'Dock needs water');
});

test('an accepted native continuation describes resuming the current pass rather than a fresh sequence',async()=>{
  const {card}=await fixture({phase:'starting',attributes:{pending_command:'resume'}});
  assert.equal(headline(card),'Resuming current pass');
  await update(card,{'sensor.queue':entity('starting',{...attrs,pending_command:'resume_now'})});
  assert.equal(headline(card),'Resuming current pass');
});


test('a robot that continued after a fault can reconnect sequence tracking without a generic resume',async()=>{
  const {card,calls}=await fixture({phase:'attention',state:'cleaning',status:'segment_cleaning',attributes:{continuation_action:'resume_observation',continuation_ready:true}});
  assert.equal(headline(card),'Vacuuming Kitchen');
  assert.match(root(card).querySelector('.subline').textContent,/robot continued/);
  assert.match(root(card).querySelector('.recovery-note').textContent,/Sequence tracking paused.*without restarting it/s);
  assert.match(root(card).querySelector('.progress-summary').textContent,/1 \/ 5 steps/);
  assert.equal(action(card,'resume'),null);assert.equal(action(card,'pause'),null);
  assert.equal(action(card,'continue-sequence').disabled,false);
  assert.equal(action(card,'stop').disabled,false);assert.equal(action(card,'dock').disabled,false);
  action(card,'continue-sequence').click();await settle(card);
  assert.deepEqual(calls.map(call=>call.data),[{command:'continue_sequence',vacuum,run_id:attrs.run_id,current_index:1}]);
  await update(card,{'sensor.queue':entity('running',{...attrs})});assert.equal(card.request,undefined);
  assert.equal(action(card,'pause').disabled,false,'Pause returns after sequence ownership is reattached');
  action(card,'pause').click();await settle(card);
  assert.deepEqual(calls.map(call=>call.data.command),['continue_sequence','pause']);
});
