# Presets from wall switches and other dashboards

Use a named Home Assistant script for each saved cleaning preset. A switch that only accepts a service and an entity can then call `script.turn_on`. The script sends the saved Roborock routine button to the same controller as the robot card, preserving its app settings and the queue's busy/uncertainty checks.

This requires companion **0.2.2 or later**. Install and check the companion before switching existing callers. These examples are generic; substitute your own vacuum and routine button entities.

## A zero-argument preset script

```yaml
script:
  robot_clean_office:
    alias: Clean Office preset
    mode: single
    sequence:
      - action: robot_cleaner_queue.control
        data:
          command: start
          vacuum: vacuum.robot
          presets:
            - button.robot_office
```

For a full-home preset, create `script.robot_clean_full_home` with the same structure and the full-home routine button. Put `script:` at package level; in an existing `scripts.yaml`, use only its entries. Never duplicate a top-level `script:` mapping.

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

A saved preset does not use an unsubmitted manual draft from a browser. For a fixed manual plan, create a separate wrapper calling `robot_cleaner_queue.control` with `command: start_manual`, explicit `vacuum`, `rooms` and `setup`; use only capabilities supported by that robot. See [manual cleaning](manual-cleaning.md).

Route pause/resume/dock through the companion too, with an explicit vacuum. Version 0.2.2 can control an existing app-started job without adopting it as an ordered queue. Resume requires a confirmed paused, unfinished job, and every physical command waits for acknowledgement. A failed command is never retried or replaced by native `vacuum.start`.

Set `require_queue: true` in the robot card when all controls must use this shared controller. Missing controller state disables controls instead of falling back to a default clean. In saved-preset mode, configure `full_clean_entity` for the full-home button; manual whole-home cleaning remains available through Manual setup.

## Audit before migration

Inspect loaded packages, scripts, automations, scenes, dashboard actions and ESPHome hold/click configuration. Replace managed direct routine-button presses, `vacuum.start`, old helper toggles and scripts that permit replacement with a shared wrapper or direct queue call. Preserve working aliases by routing them into that same path.

Keep historical backups as history; do not deploy old dashboard snapshots over a fresh live export. Native HA entity controls and the Roborock app remain external controls. The companion detects conflicting HA commands and stops sequence progression; it cannot remove every native control surface or identify every app action from telemetry alone.
