# Robot Vacuum Cleaner Card

A dedicated Home Assistant robot control card with Space Hub's shared tile surfaces, typography and under-tile glow. See what the robot is doing, clean every room on the robot's current map, or choose an ordered sequence of its rooms with settings per room.

Tap **Kitchen → Office → Bedroom**. Each tile gets its sequence number. Tap a selected room again to remove it; the remaining draft renumbers. Press **Start sequence · 3 rooms** to start. The committed sequence runs in Home Assistant, even after the dashboard closes.

## Features

- Robot status, battery, current-room progress, cleaning area and time when those entities are configured.
- Explicit room selection, pause, resume, stop and return-to-dock controls.
- Numbered room selection with visible selected, queued, cleaning and completed states.
- Manual **Vacuum**, **Mop**, **Vacuum & mop**, and **Vacuum then mop** modes, with supported suction, water, mop route and ×1/×2 controls.
- A read-only **Zones & areas** report that shows which Roborock rooms each Home Assistant area claims, which robot rooms no area covers yet, and which mapped areas the robot no longer reports.
- Room-first sequencing: the tiles are the robot's own rooms, each cleaning one room at a time in your order with its own mode, suction, water, mop route and repeat count.
- The [queue integration](https://github.com/bitosome/ha-robot-cleaner-queue) verifies the robot's own successful cleaning record before moving to the next room. Pauses, recharge breaks and mop washing do not finish a room. A room that begins slowly after the robot docks — while the dock is still washing or drying the mop — is waited out rather than abandoned.
- Command acknowledgement, errors, unavailable states and interrupted-queue recovery.
- Touch and keyboard controls, a visual configuration editor, responsive layout, reduced motion and theme support.

## Requirements

Room starts and saved plans require the [Robot Cleaner Queue](https://github.com/bitosome/ha-robot-cleaner-queue) integration with `control_version: 5` or newer and the native Roborock integration. Install the card and companion separately through HACS (Dashboard and Integration respectively), include the companion's YAML package, then restart Home Assistant.

Native robot rooms need no Home Assistant area mapping. Area mappings supply shared room names/icons and are shown in **Zones & areas**. Older companions that report only `room_targets` can still run mapped-area plans with common settings; update the companion for settings per robot room. An unavailable companion never turns an empty selection into a whole-home clean.

**Optional**

- Status, battery, progress, area, time, error and dock-error entities. They only affect what is displayed; safety decisions always use the native coordinator's own state, not your sensor mapping. The robot's `supported_features` decides which physical controls appear.

**Compatibility**

- Verified against **Home Assistant Core 2026.9.4** and python-roborock 7.4.2. Untested cores, other robot platforms and other Roborock protocols are not claimed to work; the integration fails closed rather than guessing.
- The card and the integration are versioned and installed independently. The card detects capabilities at runtime, so an older integration keeps working, and a newer card says so when a capability response is incomplete.

## Install the card

Build with `npm ci && npm run build`, then copy `dist/robot-vacuum-cleaner-card.js` to `/config/www/robot-vacuum-cleaner-card.js`. Register `/local/robot-vacuum-cleaner-card.js` as a JavaScript module in Home Assistant's dashboard resources.

To install through HACS:

1. Open **HACS → Custom repositories** and enter `https://github.com/bitosome/robot-vacuum-cleaner-card`.
2. Select **Dashboard**, add the repository, then download the latest release.
3. Reload the browser and add **Robot Vacuum Cleaner Card** to your dashboard.

HACS downloads `robot-vacuum-cleaner-card.js` from the published GitHub release. The source-only default branch is hidden because its generated `dist/` directory is not committed. If adding the repository previously failed before the first release, retry after refreshing HACS.

This repository ships the frontend only. The [Robot Cleaner Queue](https://github.com/bitosome/ha-robot-cleaner-queue) integration is a separate install — see [Requirements](#requirements).

## Configure

```yaml
type: custom:robot-vacuum-cleaner-card
entity: vacuum.robot
name: Robot
battery_entity: sensor.robot_battery
status_entity: sensor.robot_status
cleaning_entity: binary_sensor.robot_cleaning
current_room_entity: sensor.robot_current_room
progress_entity: sensor.robot_cleaning_progress
area_entity: sensor.robot_cleaning_area
time_entity: sensor.robot_cleaning_time
error_entity: sensor.robot_vacuum_error
dock_error_entity: sensor.robot_dock_error
require_queue: true
queue_entity: sensor.robot_cleaner_queue
queue_script: script.robot_cleaner_queue_control
```

Rooms, their names and their floors come from the robot, so there is no room list to maintain. The only per-room configuration left is optional appearance:

```yaml
area_overrides:
  kitchen: {name: Kitchen, icon: mdi:stove}   # by Home Assistant area id
  "0_13": {name: Dining area, icon: mdi:table-chair}   # or by robot room id
```

Entity names above are examples. `rooms` and `full_clean_entity` are **read but unused**: routine buttons are no longer part of any plan, so a configuration that still carries them keeps loading and simply ignores them. Without robot rooms the card falls back to Home Assistant's mapped areas (`room_targets`), which is the only other plan the companion can run. Optional `activity_entity` can identify an externally initiated room clean (`cleaning`, `active` or `on`); it never proves completion. The robot's `supported_features` determines available physical controls. `area_overrides` styles a tile by the Home Assistant area id a room is mapped to, or by the robot room id (`0_12`) when it has none.

Configure the optional telemetry entities you have. Missing values are omitted. Cleaning metrics belong to the current job, not the complete multi-room sequence. The robot's current-room reading describes location; a room tile is marked completed only by the queue integration's verified cleaning record.

## Plan on the main screen

Every room shows its mode, suction, water, route and repeat count. Expand the settings row inside a tile to edit it, even before selecting the room. Only relevant native options appear: vacuum omits water/route; mop omits suction. **Use defaults** removes a room override. **Default room settings** affects rooms without overrides. Editing sends no robot command.

Tap rooms in cleaning order. A selected room shows its position; tapping again removes it and renumbers the remaining rooms. **Start sequence · N rooms** starts exactly that order. **Select all** explicitly includes every room on the current map. No selection means Start is disabled.

Each native room finishes all its passes before the next room. **Vacuum then mop ×2** vacuums that room twice, then mops it twice, then advances. Completion counts cleaning stages internally; room tiles only say Completed after all that room's stages finish.

**Save plan** stores the selection and exact per-room settings in Home Assistant for the wall switch, without starting cleaning. **Load plan** restores it for review. One plan is stored per robot and survives restarts/browser changes. A retired Roborock routine plan must be replaced explicitly; it never falls back to full-house cleaning. Missing rooms, map changes and unsupported settings are rejected rather than silently substituted.

## Reliability and recovery

Execution lives in the companion, not in a browser timer. It applies settings, waits for native readback, sends one start, and requires the robot's successful cleaning record before advancing. Pauses, recharging and dock care are not completion. Deferred settings resume only where no command was attempted; uncertain physical commands are never replayed. Restarted or interrupted queues require review.

The card shows committed settings while a sequence runs. Acknowledgement windows disable motion while still allowing a new draft to be edited or saved. **Stop** cancels remaining work and stops; **Return to dock** returns the robot and cancels remaining work. **Clear sequence** clears queue state; it does not stop the robot.

A specific empty clean-water warning permits vacuum-only work. Mopping still needs water; a mixed plan can begin with a vacuum-only room, but later mopping cannot bypass the dock checks. Firmware may refuse an otherwise available action.

## Robot feature coverage

Only enabled, available native Home Assistant entities are offered. The card never enables entities automatically.

| Feature | Support |
| --- | --- |
| Vacuum, mop, simultaneous vacuum/mop, sequential vacuum then mop | Per room, with supported suction/water/route and ×1/×2 |
| Ordered rooms, repeat passes, saved plan, hardware toggle | Home Assistant queue integration |
| Pause/resume/stop/dock/find | Native supported features and live state |
| Dust emptying, mop washing/drying | Dock panel; action-specific readiness and supplies |
| Map display and map selection | View-only map image; native map selector in Settings while idle; no automatic map switching between rooms |
| Volume, DND and quiet hours, child lock, emptying mode | Native controls in Settings |
| Off-peak charging and times | Conditional on native entities being enabled and available |
| Mop/water-box attachment, tank warnings, drying time, last clean, lifetime totals | Read-only Details, when native entities exist |
| Consumable time remaining | Care panel; reset counters after servicing in the Roborock app |
| Map editing, no-go zones, virtual walls, obstacle photos, camera, SmartPlan/AI cleaning, custom numeric water flow | Not implemented: no verified safe native control contract; use Roborock app |
| Scheduled starts | Home Assistant automations can call the saved-plan service; no schedule editor in this card |

This is not complete Roborock app parity. Coverage depends on robot model, firmware and the native integration. See the [official Roborock integration documentation](https://www.home-assistant.io/integrations/roborock/) and the companion's [execution contract](https://github.com/bitosome/ha-robot-cleaner-queue/blob/main/docs/queue-backend.md). Offline tests verify commands and recovery, not physical cleaning.

## Hardware toggle

Call `robot_cleaner_queue.control` with `{command: toggle_saved, vacuum: vacuum.robot}`. When idle it runs the saved room plan. Holding again while busy cancels future rooms, stops the unfinished job when necessary and returns to the dock. Native dock care follows the robot's own settings, DND and supplies; no duplicate wash/dry/empty commands are added. Legacy service/storage names containing `preset` remain for compatibility, but no Roborock routine is executed.

## Develop and preview

```sh
npm ci
npm run check
python3 -m http.server 8767 --bind 127.0.0.1
```

`npm run check` typechecks, builds and runs the frontend tests against the shipping bundle. The backend queue suites belong to the [queue integration](https://github.com/bitosome/ha-robot-cleaner-queue) repository.

Open `http://127.0.0.1:8767/preview/`. The interactive preview is entirely local and never connects to a robot. It includes selection, start/pause/resume, room completion, docking, recharging, mop washing, faults and unavailable states, plus dark/light themes and phone widths.

## Design provenance

Space Hub Card is the design reference; the inline room controls follow the NIBE dashboard’s compact surfaces and progressive disclosure. Canonical tokens are vendored from its v2.0.83 commit; the shared glow helper and stacking model are reused. See [provenance](src/shared/PROVENANCE.md). There is no runtime dependency on another local checkout. `scripts/sync-design-tokens.py` updates the exact token source at an explicit commit.

This is a public, reusable project. Examples contain no production configuration, household maps or credentials. MIT licensed.

### Shared room settings

With queue companion v0.9.0+, edit **Default room settings** and each room’s inline
controls, then press **Save room settings**. This saves defaults and all current-map
room overrides, including unselected rooms, in Home Assistant. They survive browser
refreshes and HA restarts and are shared by all authorized users. Other dashboards
refresh automatically. Unsaved edits stay local; conflicting saves require **Reload
shared settings** so one user cannot silently overwrite another. **Use defaults**
removes a room override when you save. Other floors retain their preferences.

**Save plan** remains separate: it freezes the selected room order and settings for
the wall switch. Updating preferences never alters that saved sequence or an active
clean, and saving either kind of data never starts the robot.
