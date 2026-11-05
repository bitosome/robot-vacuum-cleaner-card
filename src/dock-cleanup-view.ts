import {html,nothing} from 'lit';
import {formatHassDateTime,pendingIndicator,type FormatHass} from './shared/card-primitives';
import {DOCK_ACTIONS,cleanupActions,cleanupComplete,cleanupLabel,cleanupSkipped,type DockCleanup} from './dock-cleanup';

export function renderDockCleanup(cleanup:DockCleanup,options:{hass?:FormatHass;retry?():void;disabled?:boolean;pending?:boolean;skip?():void;skipDisabled?:boolean;skipping?:boolean}={}) {
  const format=(value:number)=>formatHassDateTime(options.hass,value*1000,{year:false});
  return html`<section class="dock-cleanup" aria-label="Dock care" data-cleanup-state=${cleanup.state}>
    <div class="dock-cleanup-heading"><ha-icon .icon=${cleanupComplete(cleanup)?'mdi:check-circle-outline':cleanupSkipped(cleanup)?'mdi:debug-step-over':cleanup.state==='attention'?'mdi:alert-circle-outline':'mdi:progress-clock'} aria-hidden="true"></ha-icon><strong>${cleanupLabel(cleanup)}</strong></div>
    <div class="dock-cleanup-steps">${cleanupActions(cleanup).map(key=>{
      const step=cleanup.actions[key],copy=DOCK_ACTIONS[key],done=step?.state==='completed';
      return html`<div class="dock-cleanup-step ${done?'completed':''}" data-cleanup-action=${key}><ha-icon .icon=${copy.icon} aria-hidden="true"></ha-icon><span>${done?copy.done:copy.label}<small>${done&&step.completed_at?html`<time datetime=${new Date(step.completed_at*1000).toISOString()}>${format(step.completed_at)}</time>`:done?'Confirmed':cleanupSkipped(cleanup)?'Skipped':step?.state==='running'?'In progress':step?.state==='commanded'?'Waiting for confirmation':'Not yet confirmed'}</small></span><ha-icon class="dock-step-state" .icon=${done?'mdi:check-circle-outline':cleanupSkipped(cleanup)?'mdi:minus-circle-outline':['running','commanded'].includes(step?.state??'')?'mdi:progress-clock':'mdi:clock-outline'} aria-hidden="true"></ha-icon></div>`;
    })}</div>
    ${cleanup.reason&&!cleanupComplete(cleanup)?html`<p class="hint" role="status">${cleanup.reason}</p>`:nothing}
    ${options.retry&&cleanup.armed&&cleanup.state==='attention'?html`<button class="family-action primary" data-action="resume-dock-cleanup" aria-busy=${options.pending?'true':'false'} ?disabled=${options.disabled||!cleanup.retry_allowed} @click=${options.retry}>${options.pending?pendingIndicator():html`<ha-icon icon="mdi:restart" aria-hidden="true"></ha-icon>`}${options.pending?'Resuming…':'Resume dock care'}</button>`:nothing}
    ${options.skip&&!cleanupComplete(cleanup)&&!cleanupSkipped(cleanup)?html`<button class="family-action quiet" data-action="skip-dock-cleanup" aria-busy=${options.skipping?'true':'false'} ?disabled=${options.skipDisabled} @click=${options.skip}>${options.skipping?pendingIndicator():html`<ha-icon icon="mdi:debug-step-over" aria-hidden="true"></ha-icon>`}${options.skipping?'Skipping…':'Skip dock care'}</button><p class="hint">Skipping releases the robot for new cleaning. It does not stop the dock or mark the bin and mops as clean.</p>`:nothing}
  </section>`;
}
