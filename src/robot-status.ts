/** Native dock work is distinct from floor cleaning and passive mop drying. */
const DOCK_SERVICE_LABELS: Record<string,string> = {
  washing_the_mop:'Washing mops',
  washing_the_mop_2:'Washing mops',
  emptying_the_bin:'Emptying dustbin',
  attaching_the_mop:'Attaching mops',
  detaching_the_mop:'Detaching mops',
  air_drying_stopping:'Finishing mop drying',
};
export function dockServiceLabel(status:string):string { return DOCK_SERVICE_LABELS[status] ?? ''; }
export function returningToDock(status:string):boolean {
  return ['returning','returning_home','docking','going_to_wash_the_mop','back_to_dock_washing_duster'].includes(status);
}
export function passiveMopDrying(status:string):boolean { return ['drying','drying_the_mop','air_drying'].includes(status); }
