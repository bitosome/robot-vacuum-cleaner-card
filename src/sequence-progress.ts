import type {EntityState} from './types';

export interface SequenceProgress {
  completedRooms: number;
  totalRooms: number;
  roomPercent: number;
  dockLabel: string;
  completedPasses: number;
  totalPasses: number;
  /** Every verified floor pass plus one final, verified return/dock-care step. */
  completedSteps: number;
  totalSteps: number;
  /** Confirmed steps, not elapsed time, floor coverage, or an ETA estimate. */
  percent: number;
  label: string;
  valueText: string;
  complete: boolean;
  finishing: boolean;
}

const SEQUENCE_PHASES = new Set([
  'preparing', 'starting', 'running', 'paused', 'cancelling', 'finishing',
  'completed', 'cancelled', 'attention', 'recovering',
]);

/**
 * Verified progress from the server-owned execution plan. The visible bar uses
 * roomPercent: a room is done only when every assigned pass/repeat is confirmed.
 * Whole-home jobs use passes because they have no named room targets.
 * Final docking stays separate from floor completion. The weighted step fields
 * retain the full lifecycle measure; they are not the visible room percentage.
 * Native per-job percentages and unverified floor-complete hints are never used.
 * Undefined means no trustworthy bound sequence, not zero progress.
 */
export function sequenceProgress(queue?: EntityState, vacuum?: string): SequenceProgress | undefined {
  if (!queue || !SEQUENCE_PHASES.has(queue.state)) return undefined;
  const attributes = queue.attributes;
  if (attributes.mode !== 'manual' || (vacuum && attributes.vacuum !== vacuum)) return undefined;
  const stages: unknown = attributes.stages;
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > 128) return undefined;
  if (stages.some(stage => !stage || typeof stage !== 'object'
    || typeof stage.target !== 'string'
    || !['vacuum', 'mop', 'vacuum_mop'].includes(stage.mode))) return undefined;
  const completed: unknown = attributes.completed;
  if (typeof completed !== 'number' || !Number.isInteger(completed) || completed < 0 || completed > stages.length) return undefined;
  // Do not manufacture successful passes from a terminal state or from the
  // floor_cleaning_complete hint when the authoritative count disagrees.
  if (queue.state === 'completed' && completed !== stages.length) return undefined;

  const complete = queue.state === 'completed';
  const finishing = queue.state === 'finishing';
  const totalPasses = stages.length;
  const totalSteps = totalPasses + 1;
  const completedSteps = completed + Number(complete);
  const passes = `${completed} of ${totalPasses} cleaning ${totalPasses === 1 ? 'pass' : 'passes'} confirmed`;
  const rooms = new Set(stages.map(stage => stage.target));
  const unfinished = new Set(stages.slice(completed).map(stage => stage.target));
  const completedRooms = rooms.size - unfinished.size;
  const wholeHome = rooms.size === 1 && rooms.has('');
  return {
    completedRooms,
    totalRooms: rooms.size,
    roomPercent: wholeHome ? completed / totalPasses * 100 : completedRooms / rooms.size * 100,
    dockLabel: complete ? 'Final docking confirmed' : completed === totalPasses ? 'Final docking pending' : '',
    completedPasses: completed,
    totalPasses,
    completedSteps,
    totalSteps,
    percent: completedSteps / totalSteps * 100,
    label: wholeHome ? `${completed} / ${totalPasses} passes` : `${completedRooms} / ${rooms.size} rooms`,
    valueText: `${wholeHome ? 'Whole home' : `${completedRooms} of ${rooms.size} rooms completed`}. ${passes}; final docking ${complete ? 'confirmed' : 'not yet confirmed'}.`,
    complete,
    finishing,
  };
}
