import type {EntityState} from './types';

export type RunStageState = 'pending'|'preparing'|'starting'|'running'|'paused'|'attention'|'completed'|'cancelled';
export type RunMode = 'vacuum'|'mop'|'vacuum_mop';
export interface RunStage {
  index: number; target: string; mode: RunMode; state: RunStageState;
  room_index?: number; pass_index?: number; repeat_index?: number;
  started_at?: number; finished_at?: number; confirmed_at?: number; reason?: string;
}
export interface RunEdit {
  at?:number; before_room_ids:string[]; after_room_ids:string[]; added_room_ids:string[];
  removed_rooms:Array<{id:string;name?:string}>;
}
export interface CleaningRun {
  run_id: string; vacuum: string; state: string; assigned_at?: number; updated_at?: number; finished_at?: number;
  rooms: Array<{id:string;name?:string}>; stages: RunStage[];
  interruptions: Array<{at?:number;reason:string}>; edits?:RunEdit[]; legacy?: boolean; previous?:boolean;
  faults?:Array<{at?:number;resolved_at?:number;source:string;code:string;message:string;room_id:string}>;
}
export interface RunRoom {id:string;name?:string;stages:RunStage[];completed:boolean;}
const stageStates = new Set<RunStageState>(['pending','preparing','starting','running','paused','attention','completed','cancelled']);
const runStates = new Set(['preparing','starting','running','paused','attention','completed','cancelled','cancelling','finishing','recovering']);
const modes = new Set(['vacuum','mop','vacuum_mop']);
const record = (value:unknown):value is Record<string,any> => !!value && typeof value==='object' && !Array.isArray(value);
const timestamp = (value:unknown):number|undefined => typeof value==='number' && Number.isFinite(value) && value>0 && value<8640000000000 ? value : undefined;
const text = (value:unknown):string|undefined => typeof value==='string' && value.trim() ? value : undefined;
const roomIds = (value:unknown):string[] => Array.isArray(value)
  ? value.slice(0,32).filter((id:unknown):id is string=>typeof id==='string'&&!!id).map(id=>id.slice(0,200)) : [];

function readEdits(value:unknown):RunEdit[] {
  if(!Array.isArray(value))return [];
  return value.slice(-12).filter(record).map(edit=>({
    at:timestamp(edit.at),before_room_ids:roomIds(edit.before_room_ids),
    after_room_ids:roomIds(edit.after_room_ids),added_room_ids:roomIds(edit.added_room_ids),
    removed_rooms:Array.isArray(edit.removed_rooms)?edit.removed_rooms.slice(0,32)
      .filter((room:unknown)=>record(room)&&typeof room.id==='string'&&!!room.id)
      .map((room:any)=>({id:room.id.slice(0,200),name:text(room.name)?.slice(0,200)})):[],
  }));
}

/** Consume the versioned server record; the browser never accumulates or invents evidence. */
function readRun(value:unknown,vacuum:string):CleaningRun|undefined {
  if (!record(value) || value.vacuum!==vacuum || !text(value.run_id) || !runStates.has(value.state)
      || !Array.isArray(value.stages) || !value.stages.length || value.stages.length>128) return undefined;
  if (value.stages.some((stage:unknown,index:number)=>!record(stage) || stage.index!==index
      || typeof stage.target!=='string' || !modes.has(stage.mode) || !stageStates.has(stage.state))) return undefined;
  return {
    run_id:value.run_id,vacuum,state:value.state,assigned_at:timestamp(value.assigned_at),updated_at:timestamp(value.updated_at),finished_at:timestamp(value.finished_at),
    faults:Array.isArray(value.faults)?value.faults.slice(-24).filter((entry:unknown)=>record(entry)&&['robot','dock','connection'].includes(entry.source)&&text(entry.message))
      .map((entry:any)=>({at:timestamp(entry.at),resolved_at:timestamp(entry.resolved_at),source:entry.source,code:String(entry.code??'').slice(0,100),message:entry.message.slice(0,300),room_id:String(entry.room_id??'').slice(0,200)})):[],
    rooms:Array.isArray(value.rooms)?value.rooms.filter((room:unknown)=>record(room)&&typeof room.id==='string').map((room:any)=>({id:room.id,name:text(room.name)})):[],
    stages:value.stages.map((stage:any)=>({index:stage.index,target:stage.target,mode:stage.mode,state:stage.state,
      room_index:stage.room_index,pass_index:stage.pass_index,repeat_index:stage.repeat_index,
      started_at:timestamp(stage.started_at),finished_at:timestamp(stage.finished_at),confirmed_at:timestamp(stage.confirmed_at),reason:text(stage.reason)})),
    interruptions:Array.isArray(value.interruptions)?value.interruptions.filter((entry:unknown)=>record(entry)&&text(entry.reason)).map((entry:any)=>({at:timestamp(entry.at),reason:entry.reason})):[],
    edits:readEdits(value.edits),
  };
}

/** Old companions retain counts but not times; expose only the evidence they actually have. */
function legacyRun(queue:EntityState,vacuum:string):CleaningRun|undefined {
  const a=queue.attributes;
  if(a.vacuum!==vacuum || a.mode!=='manual' || !runStates.has(queue.state) || !Array.isArray(a.stages)
    || !a.stages.length || a.stages.length>128 || !Number.isInteger(a.completed) || a.completed<0 || a.completed>a.stages.length
    || a.stages.some((stage:unknown)=>!record(stage)||typeof stage.target!=='string'||!modes.has(stage.mode))) return undefined;
  const index=Number.isInteger(a.current_index)?a.current_index:-1;
  return {run_id:text(a.run_id)??'legacy-run',vacuum,state:queue.state,legacy:true,
    rooms:Array.isArray(a.setup?.rooms)?a.setup.rooms.filter((room:unknown)=>record(room)&&typeof room.id==='string').map((room:any)=>({id:room.id,name:text(room.name)})):[],
    stages:a.stages.map((stage:any,i:number)=>({...stage,index:i,state:i<a.completed?'completed':i===index&&['preparing','starting','running','paused','attention'].includes(queue.state)?queue.state:queue.state==='cancelled'?'cancelled':'pending'})),
    interruptions:[]};
}
export function cleaningRuns(queue:EntityState|undefined,vacuum:string):CleaningRun[] {
  if(!queue) return [];
  if(queue.attributes.run_history_version!==undefined) {
    if(queue.attributes.run_history_version!==1) return [];
    const candidates=[queue.attributes.last_run,...(Array.isArray(queue.attributes.previous_runs)?queue.attributes.previous_runs.slice(0,5):[])];
    const seen=new Set<string>();
    return candidates.flatMap((value,index)=>{
      const run=readRun(value,vacuum);
      if(!run||seen.has(run.run_id)) return [];
      seen.add(run.run_id);return [{...run,previous:index>0}];
    });
  }
  const legacy=legacyRun(queue,vacuum);
  return legacy?[legacy]:[];
}
export function runRooms(run:CleaningRun):RunRoom[] {
  const rooms=new Map<string,RunRoom>();
  for(const stage of run.stages) {
    const room=rooms.get(stage.target)??{id:stage.target,name:run.rooms.find(room=>room.id===stage.target)?.name,stages:[],completed:false};
    room.stages.push(stage);rooms.set(stage.target,room);
  }
  for(const room of rooms.values()) room.completed=room.stages.every(stage=>stage.state==='completed');
  return [...rooms.values()];
}
export function runStateLabel(run:CleaningRun):string {
  if(run.previous && ['preparing','starting','running','paused','cancelling','finishing','recovering'].includes(run.state)) return 'Interrupted';
  // A terminal label is never evidence for an individual pass.
  if(run.state==='completed'&&!run.stages.every(stage=>stage.state==='completed')) return 'Needs review';
  return ({preparing:'Preparing',starting:'Starting',running:'In progress',paused:'Paused',attention:'Needs attention',completed:'Completed',cancelled:'Stopped',cancelling:'Stopping',finishing:'Dock care',recovering:'Restoring sequence'} as Record<string,string>)[run.state]??'Needs review';
}
export function stageStateLabel(stage:RunStage,run:CleaningRun):string {
  if((run.previous || ['attention','cancelled','completed'].includes(run.state)) && ['preparing','starting','running','paused'].includes(stage.state)) return 'Not confirmed';
  if(run.state==='recovering' && ['preparing','starting','running','paused'].includes(stage.state)) return 'Checking status';
  if(stage.state==='pending') return ['attention','cancelled','completed'].includes(run.state)||run.previous?'Not run':'Queued';
  if(stage.state==='cancelled') return stage.started_at?'Stopped':'Not completed';
  return ({completed:'Done',attention:'Needs attention',paused:'Paused',running:'Cleaning',preparing:'Preparing',starting:'Starting'} as Record<string,string>)[stage.state]??'Not confirmed';
}
export function stageTime(stage:RunStage):{at:number;label:string}|undefined {
  if(stage.state==='completed') {
    if(stage.finished_at) return {at:stage.finished_at,label:'Finished'};
    if(stage.confirmed_at) return {at:stage.confirmed_at,label:'Completion confirmed'};
    return undefined;
  }
  if(stage.started_at) return {at:stage.started_at,label:'Cleaning observed'};
  return undefined;
}
