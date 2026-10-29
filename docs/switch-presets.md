# Shared room plans from wall switches and other dashboards

The integration owns the shared plan, sequence execution and safety checks. The card
saves the idle room selection, order and per-room settings automatically in Home
Assistant. Saving never starts cleaning. A failed or pending save does not change the
plan used by a wall switch.

## Native cleaning-plan button

After the first plan is saved, the integration creates a button for that robot, for
example `button.robot_cleaning_plan`. Use the actual entity shown in Home Assistant:

```yaml
action: button.press
target:
  entity_id: button.robot_cleaning_plan
```

For SwitchMan hold-action fields:

```yaml
channel_b_hold_service: "button.press"
channel_b_hold_entity: "button.robot_cleaning_plan"
```

The button calls `robot_cleaner_queue.control` with `command: toggle_saved` internally.
Idle starts the shared plan; another hold cancels remaining stages and returns to the
dock for required care. Repeated holds while finishing do not restart cleaning.
A missing, empty or invalid saved plan is rejected instead of substituting a routine
or a whole-home clean. The button uses the same permissions, locking and recovery
checks as the card. No script, helper or compatibility automation is required.

## Explicit plans from other dashboards

For a fixed plan with explicit settings, call the integration directly:

```yaml
action: robot_cleaner_queue.control
data:
  command: start_manual
  vacuum: vacuum.robot
  rooms:
    - {id: "0_12", mode: vacuum_mop, suction: max, water: high, route: standard}
    - {id: "0_13", mode: mop, water: medium, route: deep}
```

Room IDs and allowed settings come from `robot_cleaner_queue.get_capabilities` for
that robot's current map. The integration rejects an active or unfinished job;
an explicit fixed plan does not replace the shared saved plan. The card never
submits a whole-home fallback when the integration is unavailable.

## Migrating legacy entrypoints

The current card calls the integration directly for every cleaning or movement
control. Old `queue_script` and `require_queue` configuration keys are accepted but
ignored. There is no script or native-vacuum fallback after rejection, timeout or
missing integration state.

Before removing an old script, helper or automation, inspect dashboards, scenes,
automations, script callers and ESPHome configuration **and flashed firmware**.
Update callers to the native cleaning-plan button or direct integration actions.
Then remove unused aliases and request-only helpers. Editing an ESPHome YAML file
alone does not update the firmware running on a wall switch, so keep any verified
old-firmware compatibility entrypoint until that firmware is updated.

Keep the native Roborock integration and its telemetry/settings entities. They
supply the device connection and measured state; they are not redundant helpers.
No lifecycle or cleanup automation is needed for the integration's queue,
preferences, run history or dock-care tracking.
