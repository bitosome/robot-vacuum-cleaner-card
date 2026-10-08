import assert from 'node:assert/strict';
import {after, afterEach, test} from 'node:test';
import {Window} from 'happy-dom';

// Exercise the shipped card using mock HA state only: no physical robot commands.
const browser = new Window({url: 'http://device-panel.test/'});
for (const key of ['window','document','HTMLElement','Element','ShadowRoot','Document','CSSStyleSheet','customElements','Event','CustomEvent','MutationObserver','Node','HTMLInputElement','HTMLSelectElement','KeyboardEvent']) {
  Object.defineProperty(globalThis, key, {configurable:true, value:key==='window' ? browser : browser[key]});
}
await import('../dist/robot-vacuum-cleaner-card.js');
const entity = (state, attributes={}) => ({state,attributes});
const caps = {
  supported:true, current_map:0, robot_rooms:[{id:'0_1',name:'Living room',segment:1}], room_targets:[],
  modes:[{value:'vacuum',label:'Vacuum'}], suction:['quiet','max'], water:[], routes:[], repeats:[1],
  defaults:{mode:'vacuum',suction:'quiet',repeat:1},
  device_entities:{volume:'number.robot_volume',selected_map:'select.robot_map',dnd_start:'time.robot_dnd_start'},
};
const settle = async card => {
  for (let i=0;i<8;i++) { await card.updateComplete; await Promise.resolve(); }
};
async function fixture(reject=true) {
  const calls=[];
  const card=document.createElement('robot-vacuum-cleaner-card');
  card.setConfig({type:'custom:robot-vacuum-cleaner-card',entity:'vacuum.robot'});
  card.hass={
    services:{robot_cleaner_queue:{control:{},get_capabilities:{},device_control:{}}},
    states:{
      'vacuum.robot':entity('docked'),
      'sensor.robot_cleaner_queue':entity('idle',{control_version:5}),
      'number.robot_volume':entity('40',{min:0,max:100,step:1}),
      'select.robot_map':entity('Ground floor',{options:['Ground floor','Upstairs']}),
      'time.robot_dnd_start':entity('22:00:00'),
    },
    callWS:async()=>({response:structuredClone(caps)}),
    callService:async(domain,service,data)=>{
      calls.push({domain,service,data:structuredClone(data)});
      if (reject) throw new Error('The robot rejected this setting.');
    },
  };
  document.body.append(card); await settle(card);
  card.shadowRoot.querySelector('[data-panel="settings"]').click(); await settle(card);
  return {card,calls};
}
afterEach(()=>{for(const card of [...document.body.children]) card.remove();});
after(async()=>{await browser.happyDOM.abort();browser.close();});

for (const [control,changed,expected] of [
  ['selected_map','Upstairs','Ground floor'],
  ['volume','80','40'],
  ['dnd_start','23:30','22:00'],
]) test(`a rejected ${control} change restores the confirmed setting`,async()=>{
  const {card,calls}=await fixture();
  const input=card.shadowRoot.querySelector(`[data-device="${control}"]`);
  input.value=changed; input.dispatchEvent(new Event('change',{bubbles:true})); await settle(card);
  assert.equal(calls.length,1);
  assert.equal(calls[0].domain,'robot_cleaner_queue');
  assert.equal(calls[0].service,'device_control');
  assert.equal(calls[0].data.control,control);
  assert.equal(calls[0].data.value,control==='volume'?Number(changed):changed);
  assert.equal(input.value,expected);
  assert.match(card.shadowRoot.querySelector('.device-dialog').textContent,/robot rejected/);
});

test('a setting changes its display only when Home Assistant confirms the new value',async()=>{
  const {card,calls}=await fixture(false);
  const input=card.shadowRoot.querySelector('[data-device="selected_map"]');
  input.value='Upstairs';input.dispatchEvent(new Event('change',{bubbles:true}));await settle(card);
  assert.equal(calls.length,1);
  assert.equal(input.value,'Ground floor');
  card.hass={...card.hass,states:{...card.hass.states,'select.robot_map':entity('Upstairs',{options:['Ground floor','Upstairs']})}};
  await settle(card);
  assert.equal(input.value,'Upstairs');
});
