# Presets from wall switches and other dashboards

## Card-saved preset (0.4.0+)

Choose the room order and manual settings in the card and press **Save preset**. This persists one preset per robot in Home Assistant. Use a stable zero-argument script for the wall switch:

```yaml
script:
  robot_vacuum_cleaner_preset:
    alias: Robot vacuum cleaner preset
    mode: single
    sequence:
      - action: robot_cleaner_queue.control
        data:
          command: toggle_saved
          vacuum: vacuum.robot
```

Idle starts the saved plan; another hold cancels remaining stages and returns to dock for native care. Repeated holds while finishing do not restart cleaning. A saved plan that is no longer valid is rejected rather than replaced; routines are no longer a fallback. Saving itself never starts cleaning. Existing input-button compatibility automations can call this same script without a firmware flash.

## Fixed room-plan scripts

Use a named Home Assistant script for a plan a switch should always run, rather than relying on the saved preset:

```yaml
script:
  robot_clean_downstairs:
    sequence:
      - action: robot_cleaner_queue.control
        data:
          command: start_manual
          vacuum: vacuum.robot
          rooms:
            - {id: "0_12", mode: vacuum_mop, suction: max, water: high, route: standard}
            - {id: "0_13", mode: mop, water: medium, route: deep}
            - {id: "0_5", mode: vacuum, suction: turbo, repeat: 2}
```

Room ids come from `robot_cleaner_queue.get_capabilities` (`robot_rooms` for the current map), and the mode, suction, water, route and repeat values must be ones that same response offers. A switch that only accepts a service and an entity calls such a script with `script.turn_on`; the plan runs through the same controller as the robot card, so it keeps the queue's busy and uncertainty checks. Substitute your own vacuum and room ids.


## A zero-argument room script

```yaml
script:
  robot_clean_office:
    alias: Clean Office
    mode: single
    sequence:
      - action: robot_cleaner_queue.control
        data:
          command: start_manual
          vacuum: vacuum.robot
          rooms:
            - {id: "0_4", mode: vacuum_mop, suction: max, water: high}
```

For a whole-home script, list every room the companion reports for the current map in `rooms`; omitting the field is not a shortcut, because a plan is always an explicit room list. Put `script:` at package level; in an existing `scripts.yaml`, use only its entries. Never duplicate a top-level `script:` mapping.

The SwitchMan hold-action fields can now be:

```yaml
channel_b_hold_service: "script.turn_on"
channel_b_hold_entity: "script.robot_clean_office"
```

Change the entity to choose another preset. Multiple ordered buttons in the wrapper's `presets` list create a fixed sequence. An active or unfinished job is rejected, not replaced or silently appended to. Script errors are available in HA's script trace; a wall switch cannot display the card's inline error.

## Preserve existing switch firmware

An already-flashed switch that presses an `input_button` can keep doing so. Change the existing HA automation behind that input button to call the named script. A legacy boolean can remain a compatibility input: its ON transition submits once, then resets it to OFF; its OFF transition sends no robot command. Keep helper entity/unique IDs intact.

Use a direct script call from that compatibility automation so errors propagate to its trace. Avoid adding a second listener while retaining the old native-start listener. No firmware flash is needed when the existing input routes through the new controller.

## Manual settings and controls

An unsaved browser draft never changes the wall-switch preset. Use **Save preset** and `toggle_saved` to reuse manual settings. For a fixed manual plan, create a separate wrapper calling `robot_cleaner_queue.control` with `command: start_manual`, explicit `vacuum`, `rooms` and `setup`; use only capabilities supported by that robot. See [manual cleaning](https://github.com/bitosome/ha-robot-cleaner-queue/blob/main/docs/manual-cleaning.md).

Route pause/resume/dock through the companion too, with an explicit vacuum. Version 0.2.2 can control an existing app-started job without adopting it as an ordered queue. Resume requires a confirmed paused, unfinished job, and every physical command waits for acknowledgement. A failed command is never retried or replaced by native `vacuum.start`.

Set `require_queue: true` in the robot card when all controls must use this shared controller. Missing controller state disables controls instead of falling back to a default clean. The card’s **Clean all rooms** action plans every room the companion reports for the current map, in tile order, with the settings chosen in the setup sheet.

## Audit before migration

Inspect loaded packages, scripts, automations, scenes, dashboard actions and ESPHome hold/click configuration. Replace managed direct routine-button presses, `vacuum.start`, old helper toggles and scripts that permit replacement with a shared wrapper or a direct room-plan call. Preserve working aliases by routing them into that same path.

Keep historical backups as history; do not deploy old dashboard snapshots over a fresh live export. Native HA entity controls and the Roborock app remain external controls. The companion detects conflicting HA commands and stops sequence progression; it cannot remove every native control surface or identify every app action from telemetry alone.
