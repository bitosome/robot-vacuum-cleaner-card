import assert from 'node:assert/strict';
import {after,afterEach,test} from 'node:test';
import {Window} from 'happy-dom';
const browser=new Window({url:'http://sequence-activity.test/'});
for(const key of ['window','document','HTMLElement','Element','ShadowRoot','Document','CSSStyleSheet','customElements','Event','CustomEvent','MutationObserver','Node','HTMLInputElement','HTMLSelectElement']) Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?browser:browser[key]});
await import('../dist/robot-vacuum-cleaner-card.js');
const entity=(state,attributes={})=>({state,attributes});
const vacuum='vacuum.rover';
const run=(extra={})=>({run_id:'assigned-plan',vacuum,state:'attention',assigned_at:1791871200,rooms:[{id:'0_1',name:'Kitchen'},{id:'0_2',name:'Hall'}],stages:[
  {index:0,target:'0_1',mode:'vacuum',state:'completed',finished_at:1791871500},
  {index:1,target:'0_1',mode:'mop',state:'attention',started_at:1791871560,reason:'Water tank empty.'},
  {index:2,target:'0_2',mode:'vacuum_mop',state:'pending'}],interruptions:[{at:1791871600,reason:'Water tank empty.'}],...extra});
const response=(last_run=run(),extra={})=>({response:{history_revision:1,last_run,previous_runs:[],...extra}});
const capabilities={supported:true,current_map:0,modes:[{value:'vacuum'}],suction:['balanced'],water:[],routes:[],repeats:[1],room_targets:[],robot_rooms:[{id:'0_1',name:'Kitchen'},{id:'0_2',name:'Hall'}]};
const config=(id=vacuum)=>({type:'custom:robot-vacuum-cleaner-card',entity:id,queue_entity:'sensor.queue'});
const queue=(revision=1,phase='idle',extra={})=>entity(phase,{vacuum,control_version:6,run_history_version:1,history_revision:revision,...extra});
async function settle(card){for(let i=0;i<15;i++){await card.updateComplete;await Promise.resolve();}}
async function fixture(options={}){
  const calls=[],card=document.createElement('robot-vacuum-cleaner-card');card.setConfig(config());
  card.hass={locale:{language:'en-GB'},config:{time_zone:'Europe/Tallinn'},services:{robot_cleaner_queue:{control:{},get_capabilities:{},get_history:{},save_preset:{}}},states:{[vacuum]:entity('docked',{supported_features:8192|4|16,battery_level:90}),'sensor.queue':queue()},
    async callWS(message){calls.push(message);return message.service==='get_history'?(options.history?options.history(message):response()):{response:structuredClone(capabilities)};},async callService(){throw new Error('No motion or mutation expected');}};
  document.body.append(card);await settle(card);return {card,calls};
}
async function update(card,patch){card.hass={...card.hass,states:{...card.hass.states,...patch}};await settle(card);}
const root=card=>card.shadowRoot;
const activity=card=>root(card).querySelector('.sequence-activity');
afterEach(()=>{for(const card of [...document.body.children])card.remove();});
after(async()=>{await browser.happyDOM.abort();browser.close();});

test('water interruption keeps all ordered rooms, per-mode outcomes and HA-local finish times',async()=>{
  const {card,calls}=await fixture();const view=activity(card);
  assert.equal(view.open,true);assert.match(view.textContent,/0 \/ 2 rooms · Needs attention/);
  assert.deepEqual([...view.querySelectorAll('[data-history-room]')].map(n=>n.dataset.historyRoom),['0_1','0_2']);
  assert.match(view.querySelector('[data-history-stage="0"]').textContent,/Vacuum · Done/);
  assert.match(view.querySelector('[data-history-stage="0"] time').title,/Finished: 13 October 2026 at 09:05/);
  assert.match(view.querySelector('[data-history-stage="1"]').textContent,/Mop · Needs attention/);
  assert.match(view.querySelector('[data-history-stage="2"]').textContent,/Vacuum & mop · Not run/);
  assert.equal(view.querySelectorAll('.activity-room-done').length,0);
  assert.match(root(card).querySelector('.section-heading').textContent,/Next plan/);
  assert.deepEqual(calls.filter(c=>c.service==='get_history').map(c=>c.service_data),[{vacuum}]);
});

test('clear, external resume and draft edits cannot remove the server-owned activity',async()=>{
  const {card,calls}=await fixture();
  for(const phase of ['controlling','idle','attention']) await update(card,{'sensor.queue':queue(1,phase,{stages:[],targets:[],completed:0})});
  root(card).querySelector('[data-room="0_2"]').click();await settle(card);
  assert.equal(activity(card).querySelectorAll('[data-history-room]').length,2);
  assert.match(activity(card).querySelector('[data-history-stage="0"]').textContent,/Done/);
  assert.equal(calls.filter(c=>c.service==='get_history').length,1,'native state ticks do not repeatedly fetch unchanged history');
});

test('earlier runs remain selectable after a new smaller run and an unrelated queue owner',async()=>{
  const latest=run({run_id:'new-plan',state:'running',stages:[{index:0,target:'0_2',mode:'mop',state:'running'}],rooms:[{id:'0_2',name:'Hall'}]});
  const {card}=await fixture({history:()=>response(latest,{previous_runs:[run()]})});
  await update(card,{'sensor.queue':queue(1,'running',{vacuum:'vacuum.other'})});
  const select=activity(card).querySelector('select');select.value='assigned-plan';select.dispatchEvent(new Event('change'));await settle(card);
  assert.equal(activity(card).dataset.runId,'assigned-plan');assert.match(activity(card).querySelector('summary').textContent,/Earlier sequence/);
  assert.equal(activity(card).querySelectorAll('[data-history-room]').length,2);
});

test('a mid-flight revision change discards stale data and refreshes once for the new revision',async()=>{
  let resolve;let reads=0;
  const {card}=await fixture({history:()=>{reads++;return reads===1?new Promise(done=>{resolve=done;}):response(run({run_id:'fresh'}),{history_revision:2});}});
  await update(card,{'sensor.queue':queue(2)});resolve(response(run({run_id:'stale'})));await settle(card);
  assert.equal(reads,2);assert.equal(activity(card).dataset.runId,'fresh');
});

test('old robot responses are discarded after reconfiguring the card',async()=>{
  let resolve;
  const {card}=await fixture({history:message=>message.service_data.vacuum===vacuum?new Promise(done=>{resolve=done;}):response(null)});
  card.setConfig(config('vacuum.other'));await update(card,{'vacuum.other':entity('docked')});
  resolve(response());await settle(card);assert.equal(activity(card),null);
});

test('service reconnect refreshes the same revision without losing the visible record',async()=>{
  const {card,calls}=await fixture();
  card.hass={...card.hass,services:{robot_cleaner_queue:{control:{},get_capabilities:{}}}};await settle(card);
  assert.ok(activity(card));
  card.hass={...card.hass,services:{robot_cleaner_queue:{control:{},get_capabilities:{},get_history:{}}}};await settle(card);
  assert.equal(calls.filter(c=>c.service==='get_history').length,2);
});

test('failed refresh retains confirmed evidence, reports failure and supports a read-only retry',async()=>{
  let reads=0;const {card}=await fixture({history:()=>{reads++;if(reads===2)throw new Error('Connection lost');return response();}});
  await update(card,{'sensor.queue':queue(2)});
  assert.ok(activity(card));assert.match(root(card).textContent,/Activity could not be refreshed/);
  root(card).querySelector('[data-action="refresh-history"]').click();await settle(card);
  assert.equal(reads,3);assert.equal(root(card).querySelector('[data-action="refresh-history"]'),null);
});

test('all passes completed during final dock fault keeps rooms done while dock care stays unconfirmed',async()=>{
  const done=run();done.stages=done.stages.map(stage=>({...stage,state:'completed',finished_at:1791871500}));
  const {card}=await fixture({history:()=>response(done)});
  assert.equal(activity(card).querySelectorAll('.activity-room-done').length,2);
  assert.match(activity(card).textContent,/2 \/ 2 rooms · Needs attention/);
  assert.match(activity(card).textContent,/Final docking and dock care are not yet confirmed/);
});

test('untrusted room labels and errors render as text and no synthetic completion time appears',async()=>{
  const entry=run({rooms:[{id:'0_1',name:'<img src=x onerror=alert(1)>'}],interruptions:[{reason:'<script>bad()</script>'}]});
  delete entry.stages[0].finished_at;
  const {card}=await fixture({history:()=>response(entry)});
  assert.equal(activity(card).querySelector('img,script'),null);
  assert.match(activity(card).textContent,/<img src=x onerror=alert\(1\)>/);
  assert.match(activity(card).querySelector('[data-history-stage="0"]').textContent,/Time unavailable/);
  assert.equal(activity(card).querySelector('[data-history-stage="0"] time'),null);
});

test('queue changes are collapsed and distinguish removed rooms from confirmed cleaning',async()=>{
  const entry=run({edits:[
    {at:1791871700,before_room_ids:['0_1','0_2'],after_room_ids:['0_1','0_3'],added_room_ids:['0_3'],removed_rooms:[{id:'0_2',name:'Hall'}]},
    {at:1791871800,before_room_ids:['0_1','0_3','0_2'],after_room_ids:['0_1','0_2','0_3'],added_room_ids:[],removed_rooms:[]},
  ],rooms:[{id:'0_1',name:'Kitchen'},{id:'0_3',name:'Office'}]});
  const {card}=await fixture({history:()=>response(entry)});
  const changes=activity(card).querySelector('.activity-edits');
  assert.equal(changes.open,false);
  assert.match(changes.querySelector('summary').textContent,/Queue changes · 2/);
  assert.match(changes.textContent,/Removed: Hall · Added: Office/);
  assert.match(changes.textContent,/Room order changed/);
  assert.match(changes.querySelector('time').title,/Queue updated:/);
  assert.match(activity(card).querySelector('[data-history-stage="0"]').textContent,/Vacuum · Done/);
  assert.match(activity(card).querySelector('[data-history-stage="2"]').textContent,/Not run/);
});

test('activity does not add queue-change clutter for older runs and treats labels as text',async()=>{
  const plain=await fixture();
  assert.equal(activity(plain.card).querySelector('.activity-edits'),null);
  const entry=run({edits:[{before_room_ids:['0_9'],after_room_ids:[],added_room_ids:[],removed_rooms:[{id:'0_9',name:'<img src=x onerror=alert(1)>'}]}]});
  const {card}=await fixture({history:()=>response(entry)});
  const changes=activity(card).querySelector('.activity-edits');
  assert.equal(changes.querySelector('img'),null);
  assert.match(changes.textContent,/<img src=x onerror=alert\(1\)>/);
  assert.equal(changes.querySelector('time'),null);
});

test('fault journal shows source messages, affected room, onset and resolution times',async()=>{
  const {card}=await fixture({history:()=>response(run({faults:[
    {at:1791871600,resolved_at:1791871660,source:'robot',code:'water',message:'Clean-water tank warning',room_id:'0_1'},
    {at:1791871661,resolved_at:null,source:'dock',code:'water_empty',message:'Clean-water tank empty',room_id:'0_1'},
  ]}))});
  const journal=activity(card).querySelector('.activity-faults');
  assert.equal(journal.open,true);assert.match(journal.textContent,/Errors & warnings · 2/);
  assert.match(journal.textContent,/Clean-water tank warning · Kitchen/);
  assert.match(journal.textContent,/Resolved/);assert.match(journal.textContent,/Not yet confirmed resolved/);
  assert.equal(journal.querySelectorAll('time').length,3);
  await update(card,{'sensor.queue':queue(1,'completed')});
  assert.match(activity(card).textContent,/Clean-water tank warning/);
});
