export const DOCK_ACTIONS = {
  dust_emptying:{label:'Empty bin',start:'Start bin emptying',stop:'Stop bin emptying',icon:'mdi:delete-variant',running:'Emptying bin',done:'Bin emptied'},
  mop_washing:{label:'Wash mops',start:'Start mop washing',stop:'Stop mop washing',icon:'mdi:water-sync',running:'Washing mops',done:'Mops washed'},
  mop_drying:{label:'Dry mops',start:'Start mop drying',stop:'Stop mop drying',icon:'mdi:weather-windy',running:'Drying mops',done:'Mops dried'},
} as const;
export type DockAction = keyof typeof DOCK_ACTIONS;
export type CleanupAction = Exclude<DockAction,'mop_drying'>;
export interface DockControl {supported:boolean;available:boolean;state:string;can_start:boolean;can_stop:boolean;reason?:string;reason_code?:string;entity_id?:string;}
export type DockControls = Partial<Record<DockAction,DockControl>>;
export interface DockCleanup {
  version:1;run_id:string;revision:number;armed:boolean;
  state:'pending'|'returning'|'waiting'|'running'|'attention'|'completed';
  required:Record<CleanupAction,boolean>;
  actions:Partial<Record<CleanupAction,{state:'pending'|'commanded'|'running'|'completed';started_at?:number;completed_at?:number}>>;
  reason:string;retry_allowed:boolean;
}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const at=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<8640000000000?value:undefined;
export const cleanupActions=(cleanup:DockCleanup):CleanupAction[]=>
  (['dust_emptying','mop_washing'] as const).filter(key=>cleanup.required[key]);
export const cleanupComplete=(cleanup:DockCleanup)=>cleanup.state==='completed'&&cleanupActions(cleanup).every(key=>cleanup.actions[key]?.state==='completed');

/** All completion evidence belongs to the integration, never to a docked icon. */
export function readDockCleanup(value:unknown):DockCleanup|undefined {
  if(!record(value)||value.version!==1||typeof value.run_id!=='string'||!value.run_id||!Number.isInteger(value.revision)||Number(value.revision)<0||!record(value.required)||!record(value.actions)
    ||!['pending','returning','waiting','running','attention','completed'].includes(String(value.state)))return undefined;
  const required={dust_emptying:value.required.dust_emptying===true,mop_washing:value.required.mop_washing===true};
  if(!required.dust_emptying&&!required.mop_washing)return undefined;
  const actions:DockCleanup['actions']={};
  for(const key of ['dust_emptying','mop_washing'] as const) {
    const action=value.actions[key];
    if(record(action))actions[key]={state:action.state==='completed'?'completed':action.state==='running'?'running':action.state==='commanded'?'commanded':'pending',started_at:at(action.started_at),completed_at:at(action.completed_at)};
  }
  const cleanup:DockCleanup={version:1,run_id:value.run_id,revision:Number(value.revision),armed:value.armed===true,state:value.state as DockCleanup['state'],required,actions,
    reason:typeof value.reason==='string'?value.reason:'',retry_allowed:value.retry_allowed===true};
  if(cleanup.state==='completed'&&!cleanupComplete(cleanup)) {
    cleanup.state='attention';cleanup.retry_allowed=false;cleanup.reason='Dock care completion has not been confirmed.';
  }
  return cleanup;
}
export function cleanupLabel(cleanup:DockCleanup):string {
  if(cleanupComplete(cleanup))return 'Dock care complete';
  if(!cleanup.armed)return 'Care after cleaning';
  if(cleanup.state==='attention')return 'Dock care needs attention';
  if(cleanup.state==='returning')return 'Returning for dock care';
  const running=cleanupActions(cleanup).find(key=>cleanup.actions[key]?.state==='running');
  return running?DOCK_ACTIONS[running].running:'Dock care pending';
}
