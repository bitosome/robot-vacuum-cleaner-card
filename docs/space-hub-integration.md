# Space Hub room-cleaning controls

Space Hub already supports `perform-action`. Integration with this card is a dashboard/controller configuration change; no new Space Hub tile renderer is needed.

## Shared room appearance

Reuse the same `mdi:` icon names from the Space Hub room headers in preset `rooms[].icon` and manual `area_overrides.<area_id>.icon`. The robot card uses Home Assistant's native `ha-icon`, just as Space Hub does. Manual areas also inherit their Home Assistant area icon when available. Overrides only affect appearance; they cannot add areas or change the native cleaning target.

## Route quick cleaning through one controller

Once the queue companion is installed, a quick room-preset tile can use the same queue service as the robot card:

```yaml
tap_action:
  action: perform-action
  perform_action: robot_cleaner_queue.control
  data:
    command: start
    vacuum: vacuum.robot
    presets:
      - button.robot_office
  confirmation:
    text: Start the Office preset? An active or unfinished job will not be replaced.
```

This starts one saved Roborock preset. It does not inherit a browser's unsubmitted manual settings or append to an active sequence. Manual cleaning is a separate explicit plan.

This is a migration example, not an instruction to change a running dashboard before the companion is installed. Existing callers may need a shared wrapper retaining their original script/entity IDs.

## Control and status migration requirements

- Send pause/resume/return-to-dock for a companion-owned active queue through `robot_cleaner_queue.control`, using the same `vacuum` and command. Sending native `vacuum.pause` or `vacuum.start` directly is external intervention and interrupts its ownership of the remaining sequence.
- Companion 0.2.2 also supports pause/resume/return-to-dock for an app-started job when an explicit vacuum is supplied. It uses `mode: external` and `phase: controlling` until a fresh acknowledgement, then returns to idle without inventing or resuming an old room plan. Resume requires a confirmed unfinished paused job.
- Queue mode needs an explicit deployment choice. If its sensor or service is unavailable, stop with a visible error. Do not fall back to a native preset or another controller after rejection, timeout, or a temporary companion failure.
- All starts must enter the queue controller. During `preparing`, the robot can still appear docked with no active job while settings are being applied; that is not permission for a parallel legacy start.
- Preserve checks for active, pending, attention and uncertain prior commands. Remove any claim that a quick tile can replace an unfinished docked job; the queue rejects that operation.
- Read pending/current sequence context from the queue sensor for companion-owned runs. Legacy request helpers may clear between jobs and cannot represent the complete plan.
- Keep actual room-cleaning glows based on physical cleaning telemetry and the reported room. A queue selection or robot location does not prove completed coverage.

Validate the wrapper and dashboard as part of companion installation, using mocked commands first. This repository does not automatically rewrite household dashboards or legacy scripts.

See [named preset scripts for switches](switch-presets.md) for zero-argument wrappers, existing input-button compatibility and an entrypoint audit. Set `require_queue: true` on a robot card participating in this shared control path.
