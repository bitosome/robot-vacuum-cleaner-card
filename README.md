# Robot Vacuum Cleaner Card

A dedicated Home Assistant robot control card with Space Hub's shared tile surfaces, typography and under-tile glow. See what the robot is doing, start a full-home clean, or choose an ordered cleaning sequence with saved presets or your own manual settings.

Tap **Kitchen → Office → Bedroom**. Each tile gets its sequence number. Tap a selected room again to remove it; the remaining draft renumbers. Press **Clean 3 rooms** to start. The committed sequence runs in Home Assistant, even after the dashboard closes.

## Features

- Robot status, battery, current-preset progress, cleaning area and time when those entities are configured.
- Contextual full clean, pause, resume and return-to-dock controls.
- Numbered room selection with visible selected, queued, cleaning and completed states.
- Manual **Vacuum**, **Mop**, **Vacuum & mop**, and **Vacuum then mop** modes, with supported suction, water, mop route and ×1/×2 controls.
- A read-only **Zones & areas** report that shows which Roborock rooms each Home Assistant area claims, which robot rooms no area covers yet, and which mapped areas the robot no longer reports.
- Room-first sequencing: the tiles are the robot's own rooms, each cleaning one room at a time in your order with its own mode, suction, water, mop route and repeat count.
- The [queue integration](https://github.com/bitosome/ha-robot-cleaner-queue) verifies the robot's own successful cleaning record before moving to the next room. Pauses, recharge breaks and mop washing do not finish a room. A room that begins slowly after the robot docks — while the dock is still washing or drying the mop — is waited out rather than abandoned.
- Command acknowledgement, errors, unavailable states and interrupted-queue recovery.
- Touch and keyboard controls, a visual configuration editor, responsive layout, reduced motion and theme support.

## Requirements

**The card alone** shows status and offers full clean, pause, resume and return-to-dock. Ordered room starts are disabled, and blocked outright when `require_queue: true`. To sequence rooms you also need the integration.

**Required for room sequencing, manual setup and saved presets**

- **[Robot Cleaner Queue](https://github.com/bitosome/ha-robot-cleaner-queue)** — add `https://github.com/bitosome/ha-robot-cleaner-queue` as a HACS **Custom repository** of category **Integration**, download it, then restart Home Assistant. The card drives the integration through `robot_cleaner_queue.control` and `get_capabilities`, and never falls back to a browser-driven queue.
- **The native Roborock integration** with a **V1-protocol** robot. Rooms, their names and their floor come from the robot's own map, so nothing has to be mirrored in a Roborock app routine. The companion must accept per-room plans: per-room cleaning and saving a room plan need the version that carries the room contract, and an older companion keeps the legacy routine path working with no room plans.

**Required for manual setup**

- **Mapped Home Assistant areas.** Manual cleaning calls `vacuum.clean_area`, so an area is offered only when every Roborock room it maps to exists on the robot's current map. Map areas to rooms in the vacuum entity's settings. The read-only **Zones & areas** report in the setup sheet shows every robot room, the area that claims it, rooms no area covers yet, and mapped areas the robot no longer reports.

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
full_clean_entity: button.robot_full_cleaning
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

Legacy fallback (only used when the companion cannot report the robot's rooms):

```yaml
rooms:
  - id: kitchen
    name: Kitchen
    preset: button.robot_kitchen
```

Entity names above are examples. `rooms` is **optional and legacy**: it is only used when the queue companion cannot report the robot's own rooms, and each entry then needs an `id`, a `name` and a Roborock routine `preset` button. With a current companion the tiles come from the robot's map, so `rooms` can be left out entirely. Optional `activity_entity` can identify an externally initiated room clean (`cleaning`, `active` or `on`); it never proves completion. The robot's `supported_features` determines available physical controls. `area_overrides` styles a tile by the Home Assistant area id a room is mapped to, or by the robot room id (`0_12`) when it has none.

Configure the optional telemetry entities you have. Missing values are omitted. Cleaning metrics belong to the current job, not the complete multi-room sequence. The robot's current-room reading describes location; a room tile is marked completed only by the queue integration's verified cleaning record.

A configured full-home preset uses the same queue integration when installed. With `require_queue: true`, every control requires the integration, and saved-preset mode requires a full-home preset for **Clean all rooms**. This prevents a missing controller from becoming a default native clean. With this setting omitted or false, standalone native controls remain available. A selected room always requires the integration.

## Manual cleaning setup

Open **Cleaning setup** to choose the settings every room starts from: mode, suction, water, mop route and cleaning count. The same sheet lists the rooms you have selected so any of them can be given its own mode and settings; a room left alone follows the defaults, and **Use the default settings** returns a customised room to them. Nothing is applied until you press **Use settings**, and nothing is sent to the robot until you press Start. A vacuum room never offers water or a mop route, and a mop room never offers suction.

Manual tiles use the robot's existing Home Assistant **Cleaning by area** mapping, read by the queue integration. They can differ from your saved-preset tiles, and an area can contain multiple Roborock rooms. No extra card entity configuration is needed. Preset and manual area selections remain separate.

Manual tiles use their Home Assistant area's icon when one is configured, otherwise `mdi:floor-plan`. To match the room names and icons in your Space Hub cards, set `area_overrides` using the **Home Assistant area IDs** (not preset IDs or Roborock segment numbers):

```yaml
area_overrides:
  living_room:
    name: Living room
    icon: mdi:sofa-outline
  kitchen:
    icon: mdi:stove
```

The visual editor exposes these settings under **Manual area appearance**. Overrides apply only to areas already returned by the integration; they do not add cleaning targets or change the mapped rooms. Preset tiles continue to use each entry's `rooms[].icon`. Display overrides never change the area IDs sent when cleaning starts.

**Vacuum then mop** vacuums every selected area first, then mops them in the same order. **×2** repeats each area twice per pass as separate verified jobs; it may dock or service the mop between jobs. Water and mop route disappear for vacuum-only cleaning; suction disappears for mop-only cleaning. App-only numeric water flow and SmartPlan are not offered.

Manual setup requires the [Robot Cleaner Queue](https://github.com/bitosome/ha-robot-cleaner-queue) integration. Choices apply only on Start, and native settings must be confirmed before cleaning begins. See [manual cleaning behavior and compatibility](https://github.com/bitosome/ha-robot-cleaner-queue/blob/main/docs/manual-cleaning.md).

See [Space Hub controls and migration requirements](docs/space-hub-integration.md) and [named preset scripts for wall switches](docs/switch-presets.md) to use one controller across your dashboards and physical switches. Shared external-job controls require the queue integration.

## Queue behavior

- Selections are a local draft until Start. Only one committed queue runs per HA instance.
- The queue and current position are stored in HA; closing the browser has no effect.
- A second Start cannot replace a running job. The card locks the committed room sequence.
- **Return to dock** cancels remaining rooms before requesting docking. It will not interrupt mop servicing.
- **Clear sequence** after an error or restart clears pending work without moving the robot. Check its state before selecting a new sequence.
- While a command is being confirmed, the movement controls are disabled and the card names the confirmation it is waiting for. After **Stop** this can take up to a minute, because the robot must first report the job as finished; the robot is already idle while that shows.
- HA restarts preserve the saved sequence for inspection and stop automatic progression. There is no unattended restart or automatic command retry.
- The queue integration supports the native Roborock V1 coordinator, verified against HA Core 2026.9.4 / python-roborock 7.4.2. It fails closed when completion cannot be established. Other platforms and protocols require additional compatibility work.
- Rooms are read from the robot's current map, so only the floor the robot is standing on is offered. Multi-floor plans need a map switch, which the queue does not perform yet.

See [completion, cancellation and compatibility details](https://github.com/bitosome/ha-robot-cleaner-queue/blob/main/docs/queue-backend.md). Development checks use simulated Home Assistant states and production-code event traces; they do not claim a physical cleaning test.

## Develop and preview

```sh
npm ci
npm run check
python3 -m http.server 8767 --bind 127.0.0.1
```

`npm run check` typechecks, builds and runs the frontend tests against the shipping bundle. The backend queue suites belong to the [queue integration](https://github.com/bitosome/ha-robot-cleaner-queue) repository.

Open `http://127.0.0.1:8767/preview/`. The interactive preview is entirely local and never connects to a robot. It includes selection, start/pause/resume, room completion, docking, recharging, mop washing, faults and unavailable states, plus dark/light themes and phone widths.

## Design provenance

Space Hub Card is the design reference. Canonical tokens are vendored from its v2.0.83 commit; the shared glow helper and stacking model are reused. See [provenance](src/shared/PROVENANCE.md). There is no runtime dependency on another local checkout. `scripts/sync-design-tokens.py` updates the exact token source at an explicit commit.

This is a public, reusable project. Examples contain no production configuration, household maps or credentials. MIT licensed.

## Robot and dock controls (v0.3.0)

Update the HACS card and the [queue integration](https://github.com/bitosome/ha-robot-cleaner-queue), then restart Home Assistant. The existing card configuration works unchanged. The integration discovers enabled native controls by registry identity, including controls on the separate dock device. The card hides unavailable entities and unsupported features.

- **Stop** stops the current cleaning and cancels the remaining sequence. **Clear sequence** only cancels future work.
- **Find** plays the robot's locate sound.
- **Dock** starts/stops dust emptying, mop washing and drying.
- **Map** shows enabled HA map images, without changing maps or sending movement commands.
- **Settings** includes voice volume, Do Not Disturb and its times, child lock and dust emptying mode.
- **Care** shows available consumable time-left sensors and overdue reminders. It never enables entities or resets counters.

An empty clean-water tank is a dock warning, not a blanket cleaning lock. A plan whose next room is vacuum-only can run with this specific fault, and the full-home preset can be launched; the robot decides whether its mopping steps can proceed. Explicit mopping and combined/two-pass rooms remain blocked until water is restored. Other faults do not receive this exception. Pause, Stop and return-to-dock have action-specific checks. Robot firmware can still reject an operation; the card never bypasses device interlocks or claims success before acknowledgement.

Dock/settings changes use the shared server controller and caller permissions, wait up to 60 seconds for fresh native readback, and never retry automatically. Resolve an active/uncertain queue before changing these controls. A pending cloud command must finish its acknowledgement window before another motion command. Find is independent of cleaning.

The frontend's new controls require `control_version: 3` from the integration; older versions retain their previous conservative behavior. Run the backend suites in the [queue integration](https://github.com/bitosome/ha-robot-cleaner-queue) repository when modifying these controls.

Compatibility fix in v0.3.1: discover Roborock V1 map images whose native unique IDs contain map names, while requiring the same robot device and config entry.

### Hardware preset toggle

Call `robot_cleaner_queue.control` with `command: toggle`, a `vacuum`, and selected `presets`. The controller atomically starts the selection when idle, or cancels all remaining stages and returns an active robot to its dock. Repeated holds during finishing do not restart cleaning. In-flight starts wait for fresh telemetry after the acknowledgement window; mop servicing is allowed to finish before docking, and an unfinished recharge break is stopped. Native dock care remains subject to robot settings, DND and dock supplies; no duplicate washing/emptying/drying commands are sent. Restart, lost telemetry or unacknowledged commands require review instead of retry. An empty preset selection rejects an idle start but can still finish an active job.

### Save a reusable preset

Choose rooms in order, give any of them their own settings, then press **Save preset**. One preset per robot is stored in Home Assistant (`.storage/robot_cleaner_queue_presets`), survives restarts and is shared across browsers — including the wall-switch path, which starts the same rooms with the same per-room settings through `toggle_saved`. Saving replaces the previous saved plan without changing robot settings or starting cleaning. **Load preset** restores the rooms and their settings into the card for review and Start. Plans are checked again at execution; a changed map, a room that is gone, unavailable settings or missing permissions cannot silently redirect cleaning.

For a wall switch use `command: toggle_saved` with the robot entity. It starts the saved preset when idle and cancels/docks when busy. Optional `presets` are a fallback only until a preset is saved; invalid saved plans do not fall back to another clean. No preset is created automatically during installation.
