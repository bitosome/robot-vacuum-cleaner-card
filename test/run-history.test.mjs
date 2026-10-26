import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../src/run-history.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}});
const cleanupSource=await readFile(new URL('../src/dock-cleanup.ts',import.meta.url),'utf8');
const cleanupModule=ts.transpileModule(cleanupSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}}).outputText;
const cleanupUrl=`data:text/javascript;base64,${Buffer.from(cleanupModule).toString('base64')}`;
const moduleSource=outputText.replace("'./dock-cleanup'",JSON.stringify(cleanupUrl));
const {cleaningRuns,runRooms,runStateLabel,stageStateLabel,stageTime}=await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
const vacuum='vacuum.rover';
const stage=(index,target,mode,state,extra={})=>({index,target,mode,state,...extra});
const history=(extra={})=>({run_id:'run-1',vacuum,state:'attention',assigned_at:1791871200,rooms:[{id:'0_1',name:'Kitchen'},{id:'0_2',name:'Hall'}],stages:[stage(0,'0_1','vacuum','completed',{finished_at:1791871500}),stage(1,'0_1','mop','attention',{started_at:1791871560}),stage(2,'0_2','vacuum_mop','pending')],interruptions:[{at:1791871600,reason:'Refill clean-water tank.'}],...extra});
const sensor=(last_run=history(),extra={})=>({state:'idle',attributes:{run_history_version:1,last_run,previous_runs:[],...extra}});

test('room results retain partial vacuum-then-mop evidence through interrupted and cleared queues',()=>{
  for(const phase of ['attention','controlling','idle','running']){
    const queue=sensor();queue.state=phase;Object.assign(queue.attributes,{vacuum:'vacuum.other',completed:0,stages:[],targets:[]});
    const [run]=cleaningRuns(queue,vacuum),rooms=runRooms(run);
    assert.equal(rooms.length,2);assert.equal(rooms[0].name,'Kitchen');
    assert.equal(rooms[0].completed,false);assert.equal(rooms[0].stages[0].state,'completed');
    assert.equal(rooms[1].stages[0].state,'pending');
    assert.equal(stageStateLabel(rooms[0].stages[1],run),'Needs attention');
  }
});
test('new starts preserve the original ordered run as independently inspectable history',()=>{
  const original=history(),latest=history({run_id:'run-2',state:'running',stages:[stage(0,'0_2','mop','running')],rooms:[{id:'0_2',name:'Hall'}]});
  const runs=cleaningRuns(sensor(latest,{previous_runs:[original]}),vacuum);
  assert.deepEqual(runs.map(run=>run.run_id),['run-2','run-1']);
  assert.deepEqual(runRooms(runs[1]).map(room=>room.id),['0_1','0_2']);
  assert.equal(runs[1].stages[0].finished_at,1791871500);
  assert.deepEqual(cleaningRuns(structuredClone(sensor(latest,{previous_runs:[original]})),vacuum),runs);
});
test('all repeats and modes must be confirmed before a room is complete',()=>{
  const stages=[stage(0,'0_1','vacuum','completed'),stage(1,'0_1','mop','completed'),stage(2,'0_1','vacuum','completed'),stage(3,'0_1','mop','pending')];
  assert.equal(runRooms(cleaningRuns(sensor(history({stages})),vacuum)[0])[0].completed,false);
  stages[3].state='completed';assert.equal(runRooms(cleaningRuns(sensor(history({stages})),vacuum)[0])[0].completed,true);
});
test('timestamps distinguish native finish, observed confirmation and absent legacy evidence',()=>{
  assert.deepEqual(stageTime(stage(0,'','vacuum','completed',{finished_at:10,confirmed_at:20})),{at:10,label:'Finished'});
  assert.deepEqual(stageTime(stage(0,'','vacuum','completed',{confirmed_at:20})),{at:20,label:'Completion confirmed'});
  assert.equal(stageTime(stage(0,'','vacuum','completed',{started_at:10})),undefined);
  assert.deepEqual(stageTime(stage(0,'','mop','attention',{started_at:10})),{at:10,label:'Cleaning observed'});
  const [run]=cleaningRuns(sensor(history({stages:[stage(0,'0_1','vacuum','completed',{finished_at:'bad',confirmed_at:NaN,started_at:-2})]})),vacuum);
  assert.equal(stageTime(run.stages[0]),undefined);
});
test('terminal state and docked status cannot manufacture completed passes',()=>{
  const [run]=cleaningRuns(sensor(history({state:'completed'})),vacuum);
  assert.equal(runStateLabel(run),'Needs review');assert.equal(runRooms(run)[0].completed,false);
  const pending=run.stages[2];assert.equal(stageStateLabel(pending,run),'Not run');
  assert.equal(stageStateLabel({...pending,state:'running'},run),'Not confirmed');
});
test('stale active states in archived runs are not presented as live cleaning',()=>{
  const [run]=cleaningRuns(sensor(null,{previous_runs:[history({state:'running'})]}),vacuum);
  assert.equal(runStateLabel(run),'Interrupted');assert.equal(stageStateLabel({...run.stages[1],state:'running'},run),'Not confirmed');
});
test('only configured-robot versioned records with valid explicit pass states are accepted',()=>{
  for(const record of [history({vacuum:'vacuum.other'}),history({stages:[]}),history({stages:[stage(0,'0_1','vacuum_then_mop','completed')]}),history({stages:[stage(9,'0_1','vacuum','completed')]}),history({stages:[stage(0,'0_1','vacuum','success')]}),history({stages:Array.from({length:129},(_,i)=>stage(i,'0_1','vacuum','pending'))})]){
    assert.deepEqual(cleaningRuns(sensor(record),vacuum),[]);
  }
  assert.deepEqual(cleaningRuns(sensor(history(),{run_history_version:2}),vacuum),[]);
  const duplicate=history();assert.equal(cleaningRuns(sensor(duplicate,{previous_runs:[duplicate]}),vacuum).length,1);
});
test('legacy queue falls back to verified counts, survives attention, and never invents times',()=>{
  const queue={state:'attention',attributes:{vacuum,mode:'manual',completed:1,current_index:1,stages:history().stages}};
  const [run]=cleaningRuns(queue,vacuum);
  assert.equal(run.legacy,true);assert.equal(run.stages[0].state,'completed');assert.equal(run.stages[1].state,'attention');
  // Native stage objects on old queues normally have no timestamps.
  delete queue.attributes.stages[0].finished_at;
  assert.equal(stageTime(cleaningRuns(queue,vacuum)[0].stages[0]),undefined);
  assert.deepEqual(cleaningRuns({...queue,state:'idle'},vacuum),[]);
});

test('queue edits retain removed and re-added room evidence without altering completed passes',()=>{
  const original=history({edits:[
    {at:1791871700,before_room_ids:['0_1','0_2'],after_room_ids:['0_1'],added_room_ids:[],removed_rooms:[{id:'0_2',name:'Hall',state:'removed'}]},
    {at:1791871800,before_room_ids:['0_1'],after_room_ids:['0_1','0_2'],added_room_ids:['0_2'],removed_rooms:[]},
  ]});
  const [run]=cleaningRuns(sensor(original),vacuum);
  assert.equal(run.edits.length,2);
  assert.equal(run.edits[0].removed_rooms[0].name,'Hall');
  assert.deepEqual(run.edits[1].added_room_ids,['0_2']);
  assert.equal(run.stages[0].finished_at,1791871500);
  assert.equal(run.stages[2].state,'pending');
  run.edits[0].removed_rooms[0].name='Changed';
  run.edits[1].added_room_ids.push('0_3');
  assert.equal(original.edits[0].removed_rooms[0].name,'Hall');
  assert.deepEqual(original.edits[1].added_room_ids,['0_2']);
});

test('malformed or older queue-change fields do not discard cleaning evidence or invent edit times',()=>{
  for(const edits of [undefined,null,{},'invalid']){
    const [run]=cleaningRuns(sensor(history({edits})),vacuum);
    assert.deepEqual(run.edits,[]);
    assert.equal(run.stages[0].finished_at,1791871500);
  }
  const edits=Array.from({length:15},()=>({at:-1,before_room_ids:['0_1',null],after_room_ids:'bad',added_room_ids:[false,'0_2'],removed_rooms:[null,{id:1},{id:'0_3',name:'Office'}]}));
  const [run]=cleaningRuns(sensor(history({edits})),vacuum);
  assert.equal(run.edits.length,12);
  assert.equal(run.edits[0].at,undefined);
  assert.deepEqual(run.edits[0].before_room_ids,['0_1']);
  assert.deepEqual(run.edits[0].after_room_ids,[]);
  assert.deepEqual(run.edits[0].added_room_ids,['0_2']);
  assert.deepEqual(run.edits[0].removed_rooms,[{id:'0_3',name:'Office'}]);
});
