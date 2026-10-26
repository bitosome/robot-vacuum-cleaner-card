import {html,nothing} from 'lit';
import {DOCK_ACTIONS,cleanupActions,cleanupComplete,cleanupLabel,type DockCleanup} from './dock-cleanup';

export function renderDockCleanup(cleanup:DockCleanup,options:{locale?:string;timeZone?:string;retry?():void;disabled?:boolean;pending?:boolean}={}) {
  const format=(value:number)=>{
    try{return new Intl.DateTimeFormat(options.locale,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',...(options.timeZone?{timeZone:options.timeZone}:{})}).format(new Date(value*1000));}
    catch{return new Date(value*1000).toISOString();}
  };
  return html`<section class="dock-cleanup" aria-label="Dock care" data-cleanup-state=${cleanup.state}>
    <div class="dock-cleanup-heading"><ha-icon .icon=${cleanupComplete(cleanup)?'mdi:check-circle-outline':cleanup.state==='attention'?'mdi:alert-circle-outline':'mdi:progress-clock'} aria-hidden="true"></ha-icon><strong>${cleanupLabel(cleanup)}</strong></div>
    <div class="dock-cleanup-steps">${cleanupActions(cleanup).map(key=>{
      const step=cleanup.actions[key],copy=DOCK_ACTIONS[key],done=step?.state==='completed';
      return html`<div class="dock-cleanup-step ${done?'completed':''}" data-cleanup-action=${key}><ha-icon .icon=${copy.icon} aria-hidden="true"></ha-icon><span>${done?copy.done:copy.label}<small>${done&&step.completed_at?html`<time datetime=${new Date(step.completed_at*1000).toISOString()}>${format(step.completed_at)}</time>`:done?'Confirmed':step?.state==='running'?'In progress':step?.state==='commanded'?'Waiting for confirmation':'Not yet confirmed'}</small></span><ha-icon class="dock-step-state" .icon=${done?'mdi:check-circle-outline':['running','commanded'].includes(step?.state??'')?'mdi:progress-clock':'mdi:clock-outline'} aria-hidden="true"></ha-icon></div>`;
    })}</div>
    ${cleanup.reason&&!cleanupComplete(cleanup)?html`<p class="hint" role="status">${cleanup.reason}</p>`:nothing}
    ${options.retry&&cleanup.armed&&cleanup.state==='attention'?html`<button class="action family-action primary" data-action="resume-dock-cleanup" ?disabled=${options.disabled||!cleanup.retry_allowed} @click=${options.retry}><ha-icon icon="mdi:restart" aria-hidden="true"></ha-icon>${options.pending?'Resuming…':'Resume dock care'}</button>`:nothing}
  </section>`;
}
