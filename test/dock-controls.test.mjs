import assert from 'node:assert/strict';
import {after,afterEach,test} from 'node:test';
import {Window} from 'happy-dom';

// The release bundle talks only to these synthetic HA fixtures, never a robot.
const browser=new Window({url:'http://dock-controls.test/'});
for(const key of ['window','document','HTMLElement','Element','ShadowRoot','Document','CSSStyleSheet','customElements','Event','CustomEvent','MutationObserver','Node','HTMLInputElement','HTMLSelectElement','KeyboardEvent'])Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?browser:browser[key]});
await import('../dist/robot-vacuum-cleaner-card.js');
const vacuum='vacuum.rover',queueId='sensor.robot_cleaner_queue';
const entity=(state,attributes={})=>({state,attributes});
const deviceEntities={dust_emptying:'switch.rover_bin',mop_washing:'switch.rover_mops',mop_drying:'switch.rover_drying'};
const controls=(patch={})=>Object.fromEntries(Object.keys(deviceEntities).map(key=>[key,{supported:true,available:true,state:'off',can_start:true,can_stop:false,...patch[key]}]));
const checkpoint=(patch={})=>({version:1,run_id:'kept-sequence',revision:2,armed:true,state:'attention',required:{dust_emptying:true,mop_washing:true},actions:{dust_emptying:{state:'completed',started_at:1791871200,completed_at:1791871230},mop_washing:{state:'pending'}},reason:'Refill the clean-water tank to finish washing.',retry_allowed:true,...patch});
const history=(cleanup)=>({run_id:'kept-sequence',vacuum,state:'cancelled',rooms:[{id:'0_1',name:'Kitchen'},{id:'0_2',name:'Hall'}],stages:[{index:0,target:'0_1',mode:'vacuum_mop',state:'completed',finished_at:1791871000},{index:1,target:'0_2',mode:'vacuum_mop',state:'cancelled',started_at:1791871100}],interruptions:[],dock_cleanup:cleanup});
const settle=async card=>{for(let i=0;i<12;i++){await card.updateComplete;await Promise.resolve();}};
async function fixture({phase='idle',attrs={},dock=controls(),service,states={}}={}) {
  const calls=[],card=document.createElement('robot-vacuum-cleaner-card');
  card.setConfig({type:'custom:robot-vacuum-cleaner-card',entity:vacuum,status_entity:'sensor.rover_status',dock_error_entity:'sensor.rover_dock_error'});
  const capabilities={supported:true,current_map:0,room_targets:[],robot_rooms:[{id:'0_1',name:'Kitchen'},{id:'0_2',name:'Hall'}],modes:[{value:'vacuum',label:'Vacuum'}],suction:['balanced'],water:[],routes:[],repeats:[1],defaults:{mode:'vacuum',suction:'balanced',repeat:1},device_entities:deviceEntities,dock_cleanup_version:1,dock_controls:dock};
  card.hass={locale:{language:'en-GB'},config:{time_zone:'Europe/Tallinn'},services:{robot_cleaner_queue:{get_capabilities:{},get_history:{},control:{},device_control:{}}},states:{
    [vacuum]:entity('docked',{supported_features:8192|4|8|16|512,battery_level:87}),
    [queueId]:entity(phase,{vacuum,control_version:8,execution_version:6,mode:'manual',run_id:'kept-sequence',dock_controls:dock,...attrs}),
    'sensor.rover_status':entity('charging'),'sensor.rover_dock_error':entity('none'),
    ...Object.fromEntries(Object.entries(deviceEntities).map(([key,id])=>[id,entity(dock[key]?.state??'unavailable')])),...states,
  },callWS:async message=>({response:message.service==='get_history'?{history_revision:1,last_run:attrs.last_run??null,previous_runs:[]}:structuredClone(capabilities)}),callService:async(domain,action,data)=>{calls.push({domain,action,data:structuredClone(data)});return service?.(domain,action,data);}};
  document.body.append(card);await settle(card);return {card,calls};
}
const root=card=>card.shadowRoot;
async function dockPanel(card){root(card).querySelector('[data-panel="dock"]').click();await settle(card);return root(card).querySelector('dialog');}
async function updateQueue(card,patch,phase){const old=card.hass.states[queueId];card.hass={...card.hass,states:{...card.hass.states,[queueId]:entity(phase??old.state,{...old.attributes,...patch})}};await settle(card);}
afterEach(()=>{for(const card of [...document.body.children])card.remove();});
after(async()=>{await browser.happyDOM.abort();browser.close();});

test('supported dock controls are explicit and dispatch once through the companion without optimistic running state',async()=>{
  let complete;
  const {card,calls}=await fixture({service:()=>new Promise(resolve=>{complete=resolve;})});
  const dialog=await dockPanel(card);
  assert.equal(dialog.querySelectorAll('.dock-control').length,3);
  assert.equal(root(card).querySelector('[data-panel="dock"] ha-icon').icon,'mdi:home-import-outline');
  const wash=dialog.querySelector('[data-device="mop_washing"]');
  assert.equal(wash.disabled,false);wash.click();wash.click();await settle(card);
  assert.deepEqual(calls,[{domain:'robot_cleaner_queue',action:'device_control',data:{vacuum,control:'mop_washing',value:'on'}}]);
  assert.equal(wash.disabled,true);assert.match(wash.closest('.dock-control').textContent,/Idle/);
  complete();await settle(card);
  await updateQueue(card,{dock_controls:controls({mop_washing:{state:'on',can_start:false,can_stop:true}})});
  assert.match(dialog.querySelector('[data-device="mop_washing"]').textContent,/Stop/);
  assert.match(dialog.querySelector('[data-device="mop_washing"]').closest('.dock-control').textContent,/Washing mops/);
});

test('an active native Stop remains available during queue-owned cleanup without clearing the sequence',async()=>{
  const cleanup=checkpoint({state:'running',actions:{dust_emptying:{state:'completed'},mop_washing:{state:'running',started_at:1791871300}},reason:'',retry_allowed:false});
  const {card,calls}=await fixture({phase:'finishing',attrs:{dock_cleanup:cleanup,floor_cleaning_complete:false},dock:controls({mop_washing:{state:'on',can_start:false,can_stop:true}}),states:{'sensor.rover_status':entity('washing_the_mop')}});
  const dialog=await dockPanel(card),stop=dialog.querySelector('[data-device="mop_washing"]');
  assert.equal(stop.disabled,false);assert.equal(stop.title,'Stop mop washing');assert.equal(stop.getAttribute('aria-label'),'Stop mop washing');stop.click();await settle(card);
  assert.deepEqual(calls,[{domain:'robot_cleaner_queue',action:'device_control',data:{vacuum,control:'mop_washing',value:'off'}}]);
  assert.equal(card.hass.states[queueId].attributes.dock_cleanup.run_id,'kept-sequence');
  assert.doesNotMatch(root(card).querySelector('.subline').textContent,/rooms cleaned|Floor cleaning is complete/);
});

test('water inhibits washing while independently available emptying and drying stay usable',async()=>{
  const {card}=await fixture({dock:controls({mop_washing:{can_start:false,reason:'Refill the clean-water tank'}}),states:{'sensor.rover_dock_error':entity('water_empty')}});
  const dialog=await dockPanel(card);
  assert.equal(dialog.querySelector('[data-device="mop_washing"]').disabled,true);
  assert.equal(dialog.querySelector('[data-device="dust_emptying"]').disabled,false);
  assert.equal(dialog.querySelector('[data-device="mop_drying"]').disabled,false);
});

test('supported unavailable dock controls remain visible with a reason',async()=>{
  const {card,calls}=await fixture({dock:controls({mop_washing:{available:false,state:'unavailable',can_start:false}}),states:{'switch.rover_mops':entity('unavailable')}});
  const dialog=await dockPanel(card),wash=dialog.querySelector('[data-device="mop_washing"]');
  assert.equal(wash.disabled,true);assert.match(wash.closest('.dock-control').textContent,/Unavailable/);wash.click();await settle(card);assert.equal(calls.length,0);
});

test('unfinished cancellation care retains room history and resumes only its guarded checkpoint',async()=>{
  const cleanup=checkpoint();
  const {card,calls}=await fixture({phase:'attention',attrs:{dock_cleanup:cleanup,run_history_version:1,last_run:history(cleanup),floor_cleaning_complete:false,recovery_ready:false}});
  assert.equal(root(card).querySelector('h2').textContent,'Dock care needs attention');
  assert.equal(root(card).querySelector('[data-action="clear-queue"]'),null);
  assert.equal(root(card).querySelector('[data-action="start"]'),null);
  assert.match(root(card).querySelector('[data-history-stage="0"]').textContent,/Done/);
  assert.match(root(card).querySelector('[data-history-stage="1"]').textContent,/Stopped/);
  assert.match(root(card).querySelector('.sequence-activity [data-cleanup-action="dust_emptying"] time').textContent,/13 Oct/);
  const retry=root(card).querySelector('[data-action="resume-dock-cleanup"]');retry.click();retry.click();await settle(card);
  assert.deepEqual(calls,[{domain:'robot_cleaner_queue',action:'control',data:{command:'resume_dock_cleanup',vacuum,run_id:'kept-sequence',cleanup_revision:2}}]);
  assert.equal(retry.disabled,true);
  await updateQueue(card,{dock_cleanup:checkpoint({revision:3,state:'waiting',retry_allowed:false,reason:''})},'finishing');
  assert.equal(card.request,undefined,'A new backend checkpoint acknowledges resumption, not completion');
  assert.notEqual(root(card).querySelector('h2').textContent,'Ready to clean');
});

test('blocked care explains its cause and cannot be bypassed with an unguarded retry',async()=>{
  const {card,calls}=await fixture({phase:'attention',attrs:{dock_cleanup:checkpoint({retry_allowed:false,reason:'Dock is unavailable.'})}});
  const retry=root(card).querySelector('[data-action="resume-dock-cleanup"]');assert.equal(retry.disabled,true);retry.click();await settle(card);
  assert.match(root(card).querySelector('.subline').textContent,/Dock is unavailable/);assert.equal(calls.length,0);
});

test('docked and a terminal queue cannot fabricate completion of a pending wash',async()=>{
  const cleanup=checkpoint({state:'completed',reason:'',retry_allowed:true});
  const {card}=await fixture({phase:'cancelled',attrs:{dock_cleanup:cleanup,run_history_version:1,last_run:history(cleanup)}});
  assert.equal(root(card).querySelector('h2').textContent,'Dock care needs attention');
  assert.equal(root(card).querySelector('[data-action="resume-dock-cleanup"]').disabled,true);
  assert.doesNotMatch(root(card).querySelector('.sequence-activity').textContent,/Dock care complete|Mops washed/);
});

test('completed care remains in cancelled history without changing unfinished room outcomes',async()=>{
  const cleanup=checkpoint({state:'completed',actions:{dust_emptying:{state:'completed',completed_at:1791871230},mop_washing:{state:'completed',completed_at:1791871600}},reason:'',retry_allowed:false});
  const {card,calls}=await fixture({phase:'cancelled',attrs:{dock_cleanup:cleanup,run_history_version:1,last_run:history(cleanup),floor_cleaning_complete:false}});
  const activity=root(card).querySelector('.sequence-activity');
  assert.match(activity.textContent,/Dock care complete/);assert.match(activity.textContent,/Mops washed/);assert.match(activity.querySelector('[data-history-stage="1"]').textContent,/Stopped/);
  assert.doesNotMatch(root(card).querySelector('h2').textContent,/Your rooms are clean/);
  const dialog=await dockPanel(card);assert.equal(dialog.querySelector('[data-action="resume-dock-cleanup"]'),null);assert.equal(calls.length,0);
});

test('manual dock rejection remains visible inside the shared modal',async()=>{
  const {card}=await fixture({service:()=>{throw new Error('Dock is busy.');}});
  const dialog=await dockPanel(card);dialog.querySelector('[data-device="dust_emptying"]').click();await settle(card);
  assert.match(dialog.textContent,/Dock is busy/);assert.equal(dialog.querySelector('[data-device="dust_emptying"]').disabled,false);
});

test('cleanup obligations recorded during a room do not replace active cleaning controls or water recovery',async()=>{
  const cleanup=checkpoint({armed:false,state:'pending',actions:{dust_emptying:{state:'pending'},mop_washing:{state:'pending'}},reason:'',retry_allowed:false});
  const setup={mode:'vacuum_mop',suction:'balanced',water:'medium',repeat:1};
  const attrs={dock_cleanup:cleanup,current_index:0,completed:0,floor_cleaning_complete:false,targets:['0_1','0_2'],stages:[{target:'0_1',mode:'vacuum_mop',room_index:0},{target:'0_2',mode:'vacuum_mop',room_index:1}],setup:{rooms:[{id:'0_1',setup},{id:'0_2',setup}]}};
  const {card,calls}=await fixture({phase:'running',attrs,states:{[vacuum]:entity('cleaning',{supported_features:8192|4|8|16}),'sensor.rover_status':entity('segment_cleaning')}});
  assert.equal(root(card).querySelector('h2').textContent,'Cleaning Kitchen');
  assert.equal(root(card).querySelector('[data-action="pause"]').disabled,false);
  assert.equal(root(card).querySelector('[data-action="stop"]').disabled,false);
  assert.equal(root(card).querySelector('[data-action="dock"]').disabled,false);
  assert.equal(root(card).querySelector('[data-action="resume-dock-cleanup"]'),null);
  card.hass={...card.hass,states:{...card.hass.states,[vacuum]:entity('docked',{supported_features:8192|4|8|16}),'sensor.rover_status':entity('charging'),'sensor.rover_dock_error':entity('water_empty')}};
  await updateQueue(card,{continuation_action:'retry_stage',continuation_ready:false,continuation_reason:'Refill the clean-water tank.'},'attention');
  assert.equal(root(card).querySelector('h2').textContent,'Dock needs water');
  assert.ok(root(card).querySelector('[data-action="continue-sequence"]'));
  assert.equal(root(card).querySelector('[data-action="resume-dock-cleanup"]'),null);
  assert.equal(calls.length,0);
});

test('Stop without docking keeps new cleaning blocked and offers a return for owed care',async()=>{
  const cleanup=checkpoint({armed:false,state:'pending',reason:'',retry_allowed:false});
  const {card,calls}=await fixture({phase:'cancelled',attrs:{dock_cleanup:cleanup},states:{[vacuum]:entity('idle',{supported_features:8192|4|8|16}),'sensor.rover_status':entity('idle')}});
  assert.equal(root(card).querySelector('h2').textContent,'Return for dock care');
  assert.equal(root(card).querySelector('[data-action="start"]'),null);
  assert.equal(root(card).querySelector('[data-action="clear-queue"]'),null);
  const dock=root(card).querySelector('[data-action="dock"]');assert.equal(dock.disabled,false);dock.click();await settle(card);
  assert.deepEqual(calls,[{domain:'robot_cleaner_queue',action:'control',data:{command:'return_to_dock',vacuum}}]);
});

test('cleanup modal explains the global interruption once and does not show unsupported actions',async()=>{
  const cleanup=checkpoint();
  const {card}=await fixture({phase:'attention',attrs:{dock_cleanup:cleanup},dock:controls({dust_emptying:{can_start:false,reason:cleanup.reason},mop_washing:{can_start:false,reason:cleanup.reason},mop_drying:{supported:false}})});
  const dialog=await dockPanel(card);
  assert.equal(dialog.textContent.split(cleanup.reason).length-1,1);
  assert.equal(dialog.querySelector('[data-device="mop_drying"]'),null);
  assert.match(dialog.querySelector('[data-device="mop_washing"]').closest('.dock-control').textContent,/Waiting for dock care/);
});
