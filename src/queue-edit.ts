import type {ManualSetup, PlanRoom} from './manual-setup';
import type {EntityState} from './types';
import {reconcileOrder} from './room-order';

/** Only the server decides which complete rooms have not started yet. */
export interface QueueEditSnapshot {
  runId:string; revision:number; editable:boolean; reason:string;
  protectedIds:string[]; pending:PlanRoom[];
}
export interface QueueEditDraft extends QueueEditSnapshot {
  order:string[]; selected:string[]; setups:Record<string,ManualSetup>; names:Record<string,string>;
}
const ids=(value:unknown):value is string[] => Array.isArray(value)
  && value.every(id=>typeof id==='string'&&!!id) && new Set(value).size===value.length;

export function queueEditSnapshot(queue:EntityState|undefined,vacuum:string):QueueEditSnapshot|undefined {
  const a=queue?.attributes;
  if(!a || a.vacuum!==vacuum || a.queue_edit_version!==1 || a.mode!=='manual'
    || typeof a.run_id!=='string' || !a.run_id || !Number.isInteger(a.queue_revision) || a.queue_revision<0
    || !ids(a.protected_room_ids) || !ids(a.editable_room_ids) || !ids(a.targets)
    || [...a.protected_room_ids,...a.editable_room_ids].join('\0')!==a.targets.join('\0')
    || !Array.isArray(a.setup?.rooms)) return undefined;
  const pending:PlanRoom[]=[];
  for(const id of a.editable_room_ids) {
    const matches=a.setup.rooms.filter((room:any)=>room?.id===id);
    const setup=matches.length===1?matches[0].setup:undefined;
    if(!setup || !['vacuum','mop','vacuum_mop','vacuum_then_mop'].includes(setup.mode)
      || !Number.isInteger(setup.repeat) || setup.repeat<1) return undefined;
    pending.push({id,setup:{...setup}});
  }
  return {runId:a.run_id,revision:a.queue_revision,editable:a.queue_editable===true,
    reason:typeof a.queue_edit_reason==='string'?a.queue_edit_reason:'',
    protectedIds:[...a.protected_room_ids],pending};
}

export function createQueueDraft(snapshot:QueueEditSnapshot,available:string[],defaults:(id:string)=>ManualSetup,names:Record<string,string>={}):QueueEditDraft {
  const selected=snapshot.pending.map(room=>room.id);
  const setups=Object.fromEntries(available.map(id=>[id,{...defaults(id)}]));
  for(const room of snapshot.pending) setups[room.id]={...room.setup};
  return {...snapshot,protectedIds:[...snapshot.protectedIds],pending:structuredClone(snapshot.pending),
    order:reconcileOrder([...snapshot.protectedIds,...selected],[...snapshot.protectedIds,...selected,...available]),selected,setups,names:{...names}};
}

export function queueDraftCurrent(draft:QueueEditDraft,snapshot:QueueEditSnapshot|undefined):boolean {
  return !!snapshot && snapshot.runId===draft.runId && snapshot.revision===draft.revision
    && snapshot.protectedIds.join('\0')===draft.protectedIds.join('\0')
    && queueRoomsKey(snapshot.pending)===queueRoomsKey(draft.pending);
}
export function queueDraftRooms(draft:QueueEditDraft):PlanRoom[] {
  return draft.order.filter(id=>draft.selected.includes(id)&&!draft.protectedIds.includes(id))
    .map(id=>({id,setup:{...draft.setups[id]}}));
}
export function queueRoomsKey(rooms:PlanRoom[]):string {
  return JSON.stringify(rooms.map(({id,setup:s})=>[id,s.mode,s.suction??null,s.water??null,s.route??null,s.repeat]));
}
export function queueDraftChanged(draft:QueueEditDraft):boolean {
  return queueRoomsKey(queueDraftRooms(draft))!==queueRoomsKey(draft.pending);
}
/** Dragging past a protected room can never move it out of the fixed prefix. */
export function reorderQueueDraft(draft:QueueEditDraft,order:string[]):QueueEditDraft {
  return {...draft,order:[...draft.protectedIds,...reconcileOrder(order,draft.order).filter(id=>!draft.protectedIds.includes(id))]};
}
