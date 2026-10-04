# Home Assistant queue companion

The card selects an ordered list of existing Roborock **routine buttons**, or a [manual cleaning plan](manual-cleaning.md) using native Home Assistant areas and robot settings. This companion executes it in Home Assistant, so closing the dashboard or locking the phone does not stop the sequence. Native Roborock area cleaning does not promise room order; submitting several areas in one command cannot implement an elevator-style queue.

This first version supports **one robot and one queue per Home Assistant instance**, using the native Roborock V1 integration. Other robot platforms and Roborock protocols are not implicitly supported. Room routines must each represent the room named on its tile. A routine may contain multiple internal steps; its final cleaning record must represent the entire routine before this companion can safely chain it. Set up and verify one-room routines in the Roborock app. Their suction, mopping and repetition settings remain owned by that app.

## Installation

1. Copy the `custom_components/robot_cleaner_queue` directory into Home Assistant's `/config/custom_components/` directory.
2. Copy `packages/robot_cleaner_queue.yaml` to your HA packages directory. Include it through your existing `homeassistant.packages` configuration. For example, installations without existing packages can add:

   ```yaml
   homeassistant:
     packages:
       robot_cleaner_queue: !include packages/robot_cleaner_queue.yaml
   ```

   Merge with existing configuration; do not replace another `homeassistant:` or `packages:` section.
3. Check HA configuration, then restart Home Assistant. Installation and restart do not send a robot command.
4. Confirm `sensor.robot_cleaner_queue`, `script.robot_cleaner_queue_control` and the `robot_cleaner_queue.control` action exist. Configure the card's `queue_entity` and room preset buttons.

The frontend card's HACS installation does **not** install the companion Python files. Install the companion manually as above. No Roborock credentials, tokens, new cloud client, extra polling, or native integration modification is required.

## Card/action contract

Prefer calling the fast custom action directly, so validation errors can be shown immediately:

```yaml
action: robot_cleaner_queue.control
data:
  command: start
  vacuum: vacuum.robot
  presets:
    - button.robot_kitchen
    - button.robot_office
    - button.robot_bedroom
```

The optional `script.robot_cleaner_queue_control` wrapper accepts the same fields. Calling it through `script.turn_on` does not propagate validation exceptions to its caller; direct `robot_cleaner_queue.control` is preferred. The service waits for the initial HA command dispatch, then returns. A successful service return does not mean the robot started: `pending_command` remains until physical telemetry acknowledges it.

Other commands:

| Command | Effect |
| --- | --- |
| `pause` | Pause the current cleaning operation when its state supports pausing. During a between-room wait, hold the sequence without sending a robot command. |
| `resume` | Resume a confirmed paused job, or dispatch the next selected room after a between-room pause. |
| `cancel` | Clear the remaining queue only. The current robot operation continues. |
| `return_to_dock` | Clear the remaining queue first, then request docking when the robot's state permits it. Mop servicing and uncertain states are not interrupted. |

For non-start commands, pass the same `vacuum` to protect against a card configured for another robot. An `attention` queue must be cleared with `cancel` before a new queue can start. Clearing an unacknowledged start/resume preserves a safety barrier: another start requires the 60-second window to expire and a new native poll after that window confirming idle/job-off. Cancelling cannot reuse a stale docked state to send duplicate routines. Only an idle/docked robot with no unfinished job can start a new sequence. Starts cannot replace an existing queue or unfinished job.

The service accepts 1–32 distinct preset entity IDs. It verifies that each is an enabled, available native Roborock **routine** button on the selected vacuum's device and config entry. It rejects maintenance-reset buttons and arbitrary entities. An `unknown` routine button state is valid before its first press.

The optional `cleaning_entity`, `status_entity`, `error_entity` and `last_clean_end_entity` service fields are accepted for frontend configuration compatibility. Safety decisions use the matching native Roborock coordinator's coherent cached state, rather than trusting caller-supplied sensor mappings.

`sensor.robot_cleaner_queue` states:

- `idle`: no queue has been started.
- `preparing`: manual settings are being applied and awaiting fresh native readback.
- `starting`: a start/resume command is awaiting observed acknowledgement.
- `running`: the acknowledged routine is active or waiting to return to the dock before the next room.
- `paused`: the queue is paused; check `pending_command` for pause acknowledgement.
- `completed`: every selected routine reported successful completion.
- `cancelled`: remaining rooms were cleared; the robot may still be active.
- `attention`: execution stopped because a fault, restart, conflict or uncertain result requires review.

Manual queues also expose `mode: manual`, ordered `targets` (HA area IDs), `setup` (chosen settings), and `stages` (target, cleaning mode, zero-based room/pass/repeat indices). `current_index` and `completed` count stages, while `room_index + 1` preserves the displayed area sequence. Empty targets represent whole-home cleaning. Preset queues expose `mode: preset`.

Attributes: `vacuum`, ordered `presets`, zero-based `current_index`, `completed` count, `pending_command`, `error`, `run_id`, and `waiting_for_dock`, and `command_barrier_until` (UTC epoch seconds or null). The tile order shown to a person is `index + 1`. `completed` reports successful routine records; robot location alone never proves room coverage.

## Completion and interruption rules

A normal room transition requires all of these:

1. A preset was sent once and the robot acknowledged a preparing, washing or cleaning state within 60 seconds. An active job must subsequently be observed; initial mop preparation can take up to ten minutes without being mistaken for completion.
2. The job-active flag is now off. Pauses, mop washing and low-battery charging breaks remain part of the same job while that flag is on.
3. The native cached cleaning record is newer than the pre-command record and began no earlier than three seconds before the command (to allow whole-second timestamps).
4. The record explicitly says `complete == 1`, `error == 0`, and its finish reason is successful when present. Missing/unknown completion fields, a manual interruption, an unreachable area or a washing failure stop the queue.
5. Before another preset is dispatched, the robot is healthy and idle/docked rather than returning, washing, emptying or charging for an unfinished job.

The companion waits up to three minutes after job-off for the corresponding completion record. It never infers completion from the current-room sensor, a stale percentage, a generic docked state, or `last_clean_end` alone. The native end timestamp is also updated for unsuccessful records.

The initiating Home Assistant user's control permission is checked on the vacuum and every selected preset before the queue changes. The caller's user ID is retained in HA's private queue storage and propagated to native commands. Permissions are fetched again before each later dispatch, so deleting/deactivating a user or revoking entity access stops progression. This does not grant additional access; automations without a user context retain normal HA system behavior.

No automatic retries are sent. Faults and lost telemetry stop progression for review. HA commands from other controls stop this queue to avoid competing writers. App/device interruption is caught by the cleaning record's completion/finish reason; changes that produce indistinguishable successful records cannot be attributed to a particular caller. A single-room routine that internally ends and starts another independent job is unsuitable for automatic chaining and must be simplified in the app.

Pause/resume and return-to-dock also require observed acknowledgement within 60 seconds. Queued presets and position are persisted in HA's storage before dispatch. An HA restart or shutdown preserves the sequence for inspection and changes it to `attention`; it never resumes cleaning automatically. Clear and reselect the desired remaining rooms after checking the robot. Cancelling or docking clears progression before sending another robot action.

## Compatibility and validation

The read-only adapter was reviewed against **Home Assistant Core 2026.9.4** and **python-roborock 7.4.2**. It reads the existing coordinator's `data.clean_summary.last_clean_record` (`begin`, `end`, `complete`, `error`, `finish_reason`) because those completion fields are not exposed by standard HA entities. This is an internal compatibility boundary; check it when upgrading HA. An incompatible model or unavailable structure fails closed. A real device run has not been performed during development.

References: [HA Roborock documentation](https://www.home-assistant.io/integrations/roborock/), [HA sensor implementation](https://github.com/home-assistant/core/blob/2026.9.4/homeassistant/components/roborock/sensor.py), [HA coordinator](https://github.com/home-assistant/core/blob/2026.9.4/homeassistant/components/roborock/coordinator.py), [Roborock cleaning records](https://github.com/Python-roborock/python-roborock/blob/v7.4.2/roborock/data/v1/v1_containers.py), [finish reasons](https://github.com/Python-roborock/python-roborock/blob/v7.4.2/roborock/data/v1/v1_code_mappings.py).

Run the offline production-code trace tests without HA or a robot:

```sh
python3 -B test/backend_queue_test.py
python3 -B test/backend_manual_test.py
```

These test ordered success, low-battery/wash breaks, interrupted records, faults, missing acknowledgements, stale records, pause/resume, cancellation, return-to-dock, concurrent starts, restart behavior and routine validation. They do not prove physical operation or native HA runtime compatibility.

To remove the companion, first clear its queue, remove the package include and custom component, then restart HA. Card resources and the native Roborock integration are independent. Removing this queue does not issue a robot command.
