import assert from 'node:assert/strict';

export async function settleSettings(card) {
  for(let i=0;i<10;i++){ await card.updateComplete; await Promise.resolve(); }
}
export async function closeSettings(card) {
  card.shadowRoot.querySelector('dialog[open] [aria-label^="Close "]')?.click();
  await settleSettings(card);
}
export async function openSettings(card,id='defaults') {
  const current=card.flow.current;
  if(id==='defaults'?current==='room-defaults':current==='room-settings'&&card.roomSettingsId===id)return;
  await closeSettings(card);
  const button=card.shadowRoot.querySelector(id==='defaults'?'[data-action="room-defaults"]':`[data-open-room="${id}"]`);
  assert.ok(button,`Expected settings opener for ${id}`);
  button.click();await settleSettings(card);
  assert.ok(card.shadowRoot.querySelector('dialog[open]'),'Expected shared settings dialog');
  // HappyDOM selects the wrong initial option in detached Lit fragments. A normal
  // telemetry render applies the select's live value, as existing fixtures require.
  card.requestUpdate();await settleSettings(card);
}
