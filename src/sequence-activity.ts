import {html,nothing} from 'lit';
import {MODE_ICONS,MODE_LABELS} from './manual-setup';
import {runRooms,runStateLabel,stageStateLabel,stageTime,type CleaningRun} from './run-history';

interface ActivityOptions {
  runs:CleaningRun[]; selectedRunId?:string; locale?:string; timeZone?:string;
  /** Current observed activity refines an active run without rewriting its history. */
  liveState?:{runId:string;stageIndex:number;label:string;stageLabel:string};
  roomName(id:string,name?:string):string; roomIcon(id:string):string;
  select(id:string):void;
}
/** A compact, read-only execution log separate from the editable next plan. */
export function renderSequenceActivity(options:ActivityOptions) {
  if(!options.runs.length) return nothing;
  const run=options.runs.find(item=>item.run_id===options.selectedRunId)??options.runs[0];
  const rooms=runRooms(run),done=rooms.filter(room=>room.completed).length;
  const count=run.stages.filter(stage=>stage.state==='completed').length;
  const liveFor=(item:CleaningRun)=>!item.previous && item.run_id===options.liveState?.runId && ['running','paused'].includes(item.state)?options.liveState:undefined;
  const live=liveFor(run);
  const edits=run.edits??[];
  const stateLabel=(item:CleaningRun)=>liveFor(item)?.label??runStateLabel(item);
  const format=(at:number,full=false)=>{
    const settings:Intl.DateTimeFormatOptions={day:'numeric',month:full?'long':'short',...(full?{year:'numeric' as const}:{}),hour:'2-digit',minute:'2-digit',...(options.timeZone?{timeZone:options.timeZone}: {})};
    try{return new Intl.DateTimeFormat(options.locale,settings).format(new Date(at*1000));}
    catch{return new Intl.DateTimeFormat('en', {...settings,timeZone:'UTC'}).format(new Date(at*1000));}
  };
  const time=(at:number|undefined,label:string)=>at?html`<time datetime=${new Date(at*1000).toISOString()} title=${`${label}: ${format(at,true)}`} aria-label=${`${label}: ${format(at,true)}`}>${format(at)}</time>`:nothing;
  const statusIcon=(state:string)=>state==='completed'?'mdi:check-circle-outline':['attention','paused'].includes(state)?'mdi:pause-circle-outline':state==='cancelled'?'mdi:stop-circle-outline':['preparing','starting','running'].includes(state)?'mdi:progress-clock':'mdi:clock-outline';
  return html`<details class="surface sequence-activity" data-run-id=${run.run_id} ?open=${['attention','paused'].includes(run.state)}>
    <summary><ha-icon icon="mdi:clipboard-text-clock-outline" aria-hidden="true"></ha-icon><span class="activity-heading"><strong>${run.previous?'Earlier sequence':'Sequence activity'}</strong><span>${done} / ${rooms.length} ${rooms.length===1?'room':'rooms'} · ${stateLabel(run)}</span></span><ha-icon class="activity-chevron" icon="mdi:chevron-down" aria-hidden="true"></ha-icon></summary>
    <div class="activity-body">
      ${options.runs.length>1?html`<label class="activity-run-select"><span class="sr-only">Choose a cleaning sequence</span><select aria-label="Choose a cleaning sequence" .value=${run.run_id} @change=${(event:Event)=>options.select((event.target as HTMLSelectElement).value)}>${options.runs.map((item,index)=>html`<option value=${item.run_id} ?selected=${item.run_id===run.run_id}>${index===0?'Latest':'Earlier'} · ${item.assigned_at?format(item.assigned_at):'Time unavailable'} · ${runRooms(item).length} rooms · ${stateLabel(item)}</option>`)}</select></label>`:nothing}
      <div class="activity-meta"><span>${count} / ${run.stages.length} ${run.stages.length===1?'pass':'passes'} confirmed</span>${time(run.assigned_at,'Sequence assigned')}</div>
      <ol class="activity-rooms">${rooms.map((room,index)=>html`<li class="activity-room" data-history-room=${room.id}><div class="activity-room-heading"><span class="activity-order">${index+1}</span><ha-icon .icon=${options.roomIcon(room.id)} aria-hidden="true"></ha-icon><strong>${room.id?options.roomName(room.id,room.name):'Whole home'}</strong>${room.completed?html`<ha-icon class="activity-room-done" icon="mdi:check-circle-outline" title="All passes confirmed" aria-label="All passes confirmed"></ha-icon>`:nothing}</div>
        <div class="activity-stages">${room.stages.map(stage=>{
          const when=stageTime(stage),same=room.stages.filter(item=>item.mode===stage.mode),number=same.indexOf(stage)+1;
          const label=`${MODE_LABELS[stage.mode]}${same.length>1?` ${number}/${same.length}`:''}`;
          const current=live?.stageIndex===stage.index && ['running','paused'].includes(stage.state);
          const state=current?live.stageLabel:stageStateLabel(stage,run);
          return html`<span class="activity-stage ${current?'paused':stage.state}" data-history-stage=${stage.index} title=${current?`${label}: ${state}`:stage.reason??`${label}: ${state}`}><ha-icon .icon=${MODE_ICONS[stage.mode]} aria-hidden="true"></ha-icon><span class="activity-stage-text"><span>${label} · ${state}</span>${when?time(when.at,when.label):stage.state==='completed'?html`<span class="activity-time-unknown">Time unavailable</span>`:nothing}</span><ha-icon class="activity-status-icon" .icon=${current?'mdi:battery-charging':statusIcon(stage.state)} aria-hidden="true"></ha-icon></span>`;
        })}</div>
      </li>`)}</ol>
      ${run.stages.every(stage=>stage.state==='completed') && run.state!=='completed'?html`<p class="activity-note">Floor cleaning is confirmed. Final docking and dock care are not yet confirmed.</p>`:nothing}
      ${edits.length?html`<details class="activity-interruptions activity-edits"><summary><ha-icon icon="mdi:playlist-edit" aria-hidden="true"></ha-icon>Queue changes · ${edits.length}<ha-icon icon="mdi:chevron-down" aria-hidden="true"></ha-icon></summary><ol>${edits.map(entry=>{
        const changes:string[]=[];
        if(entry.removed_rooms.length)changes.push(`Removed: ${entry.removed_rooms.map(room=>options.roomName(room.id,room.name)).join(', ')}`);
        if(entry.added_room_ids.length)changes.push(`Added: ${entry.added_room_ids.map(id=>options.roomName(id,run.rooms.find(room=>room.id===id)?.name)).join(', ')}`);
        const before=entry.before_room_ids.filter(id=>entry.after_room_ids.includes(id));
        const after=entry.after_room_ids.filter(id=>entry.before_room_ids.includes(id));
        if(before.join('\0')!==after.join('\0'))changes.push('Room order changed');
        return html`<li>${time(entry.at,'Queue updated')}<span>${changes.join(' · ')||'Remaining room settings updated'}</span></li>`;
      })}</ol></details>`:nothing}
      ${run.interruptions.length?html`<details class="activity-interruptions"><summary><ha-icon icon="mdi:alert-circle-outline" aria-hidden="true"></ha-icon>${run.interruptions.length} ${run.interruptions.length===1?'interruption':'interruptions'}<ha-icon icon="mdi:chevron-down" aria-hidden="true"></ha-icon></summary><ol>${run.interruptions.map(entry=>html`<li>${time(entry.at,'Interrupted')}<span>${entry.reason}</span></li>`)}</ol></details>`:nothing}
      ${run.legacy?html`<p class="activity-note">This companion reports completed passes without timestamps. Update it to keep activity after clearing or starting another sequence.</p>`:nothing}
    </div>
  </details>`;
}
