import type {EntityState} from './types';

export interface SequenceProgress {
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
 * Overall progress from the server-owned, frozen execution plan.
 *
 * `completed` is advanced only by a matching successful cleaning record. A
 * vacuum-then-mop room and each repeat already have separate entries in `stages`;
 * counting rooms or expanding their settings again would give the wrong total.
 *
 * The native progress sensor is intentionally not an input. It belongs to one
 * robot job, may retain the preceding job's 100% through dock servicing, and the
 * current queue contract provides no stage identity/freshness for that reading.
 * Thus the bar advances in verified steps and cannot jump backwards at a room
 * transition. Final return and observed dock care count as one additional step,
 * so a sequence is never represented as 100% before the backend confirms it.
 * Passive mop drying is not an active step in the backend lifecycle.
 *
 * Undefined means no trustworthy bound sequence, not zero progress. Do not fall
 * back to a native room percentage while claiming to show sequence progress.
 */
export function sequenceProgress(queue?: EntityState, vacuum?: string): SequenceProgress | undefined {
  if (!queue || !SEQUENCE_PHASES.has(queue.state)) return undefined;
  const attributes = queue.attributes;
  if (attributes.mode !== 'manual' || (vacuum && attributes.vacuum !== vacuum)) return undefined;
  const stages: unknown = attributes.stages;
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > 128) return undefined;
  if (stages.some(stage => !stage || typeof stage !== 'object'
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
  return {
    completedPasses: completed,
    totalPasses,
    completedSteps,
    totalSteps,
    percent: completedSteps / totalSteps * 100,
    label: `${completedSteps} / ${totalSteps} steps`,
    valueText: `${completedSteps} of ${totalSteps} steps; includes final docking. ${passes}; final docking ${complete ? 'confirmed' : 'not yet confirmed'}.`,
    complete,
    finishing,
  };
}
