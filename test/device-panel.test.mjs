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

test('device panel X restores its opener, keeps native dialog semantics and does not send a command',async()=>{
  const {card,calls}=await fixture();
  const root=card.shadowRoot,dialog=root.querySelector('.device-dialog');
  const close=root.querySelector('[title="Close"]');
  assert.equal(dialog.classList.contains('family-dialog'),true);
  assert.equal(close.querySelector('ha-icon').icon,'mdi:close');
  assert.equal(close.title,'Close');
  close.click();await settle(card);
  assert.equal(dialog.open,false);
  assert.equal(root.activeElement,root.querySelector('[data-panel="settings"]'));
  assert.equal(calls.length,0);
});

test('device panel closes on removal and cannot reopen after a pending render',async()=>{
  const {card,calls}=await fixture();
  const root=card.shadowRoot,dialog=root.querySelector('.device-dialog');
  card.remove();await settle(card);
  assert.equal(dialog.open,false);
  document.body.append(card);await settle(card);
  root.querySelector('[data-panel="settings"]').click();card.remove();await settle(card);
  assert.equal(dialog.open,false);
  assert.equal(calls.length,0);
});

test('telemetry keeps the shared dialog and focus stable; a late setting response cannot close a reopened panel',async()=>{
  const {card,calls}=await fixture(false),root=card.shadowRoot;
  const dialog=root.querySelector('dialog'),input=root.querySelector('[data-device="volume"]');
  input.focus();
  card.hass={...card.hass,states:{...card.hass.states,'number.robot_volume':entity('45',{min:0,max:100,step:1})}};
  await settle(card);
  assert.equal(root.querySelector('dialog'),dialog);
  assert.equal(root.activeElement,input);
  let reject;
  card.hass={...card.hass,callService:()=>new Promise((_,no)=>{reject=no;})};
  input.value='80';input.dispatchEvent(new Event('change',{bubbles:true}));await settle(card);
  root.querySelector('dialog [title=Close]').click();await settle(card);
  assert.equal(root.querySelector('dialog'),null);
  root.querySelector('[data-panel="settings"]').click();await settle(card);
  const reopened=root.querySelector('dialog');
  assert.equal(root.querySelector('[data-device="volume"]').disabled,true);
  reject(new Error('Setting refused'));await settle(card);
  assert.equal(root.querySelector('dialog'),reopened);
  assert.equal(root.querySelector('[data-device="volume"]').disabled,false);
  assert.equal(root.querySelector('[data-device="volume"]').value,'45');
  assert.match(reopened.textContent,/Setting refused/);
  assert.equal(calls.length,0);
});
