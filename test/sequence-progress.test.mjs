import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import ts from 'typescript';

// Pure contract tests, compiled with the project's TypeScript dependency. No
// browser timers, native calls, or live Home Assistant data are involved.
const source = await readFile(new URL('../src/sequence-progress.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext}});
const {sequenceProgress} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const vacuum = 'vacuum.rover';
const pass = (target, mode = 'vacuum', repeat_index = 0) => ({target, mode, room_index: 0, pass_index: mode === 'mop' ? 1 : 0, repeat_index});
const twoRooms = [pass('0_1'), {...pass('0_2'), room_index: 1}];
const state = (phase = 'running', completed = 0, stages = twoRooms, attributes = {}) => ({state: phase,
  attributes: {vacuum, mode: 'manual', stages, completed, current_index: completed, ...attributes}});

test('overall progress counts verified floor passes and final docking as explicit steps', () => {
  const progress = sequenceProgress(state('running', 1), vacuum);
  assert.equal(progress.completedPasses, 1);
  assert.equal(progress.totalPasses, 2);
  assert.equal(progress.completedSteps, 1);
  assert.equal(progress.totalSteps, 3);
  assert.ok(Math.abs(progress.percent - 100 / 3) < 1e-10);
  assert.equal(progress.label, '1 / 3 steps');
  assert.equal(progress.valueText, '1 of 3 steps; includes final docking. 1 of 2 cleaning passes confirmed; final docking not yet confirmed.');
});

test('vacuum then mop and repeats use the frozen stage list without double-expansion', () => {
  const stages = [pass('0_1'), pass('0_1', 'mop'), pass('0_1', 'vacuum', 1), pass('0_1', 'mop', 1), pass('0_2', 'vacuum_mop')];
  const progress = sequenceProgress(state('running', 3, stages, {targets: ['0_1', '0_2'], setup: {mode: 'vacuum_then_mop', repeat: 2}}));
  assert.equal(progress.totalPasses, 5);
  assert.equal(progress.totalSteps, 6);
  assert.equal(progress.percent, 50);
});

test('stale room percentages and stage indices cannot move the overall bar', () => {
  for (const phase of ['running', 'preparing', 'starting', 'paused']) {
    for (const progress of [0, 75, 100, NaN]) {
      const result = sequenceProgress(state(phase, 1, twoRooms, {progress, current_index: 99, waiting_for_dock: true, dock_status: 'washing_the_mop'}));
      assert.equal(result.completedSteps, 1);
      assert.ok(Math.abs(result.percent - 100 / 3) < 1e-10);
    }
  }
});

test('100% requires both the completed state and every successful pass', () => {
  const finishing = sequenceProgress(state('finishing', 2, twoRooms, {floor_cleaning_complete: true}));
  assert.ok(Math.abs(finishing.percent - 200 / 3) < 1e-10);
  assert.equal(finishing.finishing, true);
  assert.equal(finishing.complete, false);
  for (const phase of ['running', 'paused', 'cancelled', 'attention']) {
    assert.ok(sequenceProgress(state(phase, 2)).percent < 100);
  }
  assert.equal(sequenceProgress(state('completed', 1)), undefined);
  const completed = sequenceProgress(state('completed', 2, twoRooms, {dock_drying: true}));
  assert.equal(completed.percent, 100);
  assert.equal(completed.complete, true);
  assert.equal(completed.valueText, '3 of 3 steps; includes final docking. 2 of 2 cleaning passes confirmed; final docking confirmed.');
});

test('floor-complete hints and a docked robot alone cannot create progress', () => {
  const result = sequenceProgress(state('running', 0, twoRooms, {floor_cleaning_complete: true, dock_status: 'charging', robot_activity: 'docked'}));
  assert.equal(result.percent, 0);
});

test('verified steps survive room transitions, errors, pauses and a dashboard reload', () => {
  const samples = [['preparing', 0], ['starting', 0], ['running', 0], ['running', 1], ['preparing', 1], ['starting', 1], ['paused', 1], ['recovering', 1], ['attention', 1], ['finishing', 2], ['completed', 2]];
  let previous = 0;
  for (const [phase, completed] of samples) {
    const snapshot = state(phase, completed);
    const first = sequenceProgress(snapshot);
    assert.ok(first.percent >= previous);
    assert.deepEqual(sequenceProgress(structuredClone(snapshot)), first, 'No in-browser history is needed');
    previous = first.percent;
  }
  assert.equal(sequenceProgress(state('starting', 0, twoRooms, {run_id: 'new-run'})).percent, 0);
});

test('whole-home mode still counts its explicit floor passes', () => {
  const result = sequenceProgress(state('running', 1, [pass('', 'vacuum'), pass('', 'mop')], {targets: []}));
  assert.equal(result.totalPasses, 2);
  assert.equal(result.totalSteps, 3);
});

test('no sequence progress is shown for a different robot or a device/external operation', () => {
  assert.equal(sequenceProgress(undefined, vacuum), undefined);
  assert.equal(sequenceProgress(state(), 'vacuum.other'), undefined);
  for (const phase of ['idle', 'unknown', 'unavailable', 'not_a_phase']) assert.equal(sequenceProgress(state(phase)), undefined);
  for (const mode of ['external', 'device', 'preset', undefined]) assert.equal(sequenceProgress(state('running', 0, twoRooms, {mode})), undefined);
});

test('missing, invalid and inconsistent execution data never fabricates a percentage', () => {
  for (const count of [undefined, null, '', '1', -1, 0.5, NaN, Infinity, 3, true]) assert.equal(sequenceProgress(state('running', 0, twoRooms, {completed: count})), undefined);
  for (const stages of [undefined, null, 'rooms', [], [null], [{}], [pass('0_1', 'vacuum_then_mop')], Array.from({length: 129}, () => pass('0_1'))]) {
    assert.equal(sequenceProgress(state('running', 0, twoRooms, {stages})), undefined);
  }
  assert.equal(sequenceProgress(state('completed', 2, twoRooms, {stages: []})), undefined);
});

test('the maximum accepted execution plan still waits for the final dock step', () => {
  const stages = Array.from({length: 128}, (_, index) => pass(`0_${index}`));
  const finishing = sequenceProgress(state('finishing', 128, stages));
  assert.equal(finishing.totalSteps, 129);
  assert.ok(finishing.percent < 100);
  assert.equal(sequenceProgress(state('completed', 128, stages)).percent, 100);
});
