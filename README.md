# Robot Vacuum Cleaner Card

A dedicated Home Assistant robot control card with Space Hub's shared tile surfaces, typography and under-tile glow. See what the robot is doing, start a full-home clean, or choose an ordered cleaning sequence with saved presets or your own manual settings.

Tap **Kitchen → Office → Bedroom**. Each tile gets its sequence number. Tap a selected room again to remove it; the remaining draft renumbers. Press **Clean 3 rooms** to start. The committed sequence runs in Home Assistant, even after the dashboard closes.

## Features

- Robot status, battery, current-preset progress, cleaning area and time when those entities are configured.
- Contextual full clean, pause, resume and return-to-dock controls.
- Numbered room selection with visible selected, queued, cleaning and completed states.
- Manual **Vacuum**, **Mop**, **Vacuum & mop**, and **Vacuum then mop** modes, with supported suction, water, mop route and ×1/×2 controls.
- Existing Roborock routines retain their suction, mopping and repetition settings.
- A companion queue integration verifies actual successful cleaning records before moving to the next preset. Pauses, recharge breaks and mop washing do not finish a room.
- Command acknowledgement, errors, unavailable states and interrupted-queue recovery.
- Touch and keyboard controls, a visual configuration editor, responsive layout, reduced motion and theme support.

## Install the card

Build with `npm ci && npm run build`, then copy `dist/robot-vacuum-cleaner-card.js` to `/config/www/robot-vacuum-cleaner-card.js`. Register `/local/robot-vacuum-cleaner-card.js` as a JavaScript module in Home Assistant's dashboard resources.

To install through HACS:

1. Open **HACS → Custom repositories** and enter `https://github.com/bitosome/robot-vacuum-cleaner-card`.
2. Select **Dashboard**, add the repository, then download the latest release.
3. Reload the browser and add **Robot Vacuum Cleaner Card** to your dashboard.

HACS downloads `robot-vacuum-cleaner-card.js` from the published GitHub release. The source-only default branch is hidden because its generated `dist/` directory is not committed. HACS installs the frontend only; the separate `robot-cleaner-queue.zip` release asset contains the companion. If adding the repository previously failed before the first release, retry after refreshing HACS.

For room sequencing and manual setup, install the [Home Assistant queue companion](docs/queue-backend.md). This is an additional custom integration and requires an HA restart. Without it, standalone controls remain available unless `require_queue: true` is configured; ordered room starts are always disabled. It never falls back to a browser-driven queue.

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
rooms:
  - id: kitchen
    name: Kitchen
    icon: mdi:stove
    preset: button.robot_kitchen
  - id: office
    name: Office
    icon: mdi:desk
    preset: button.robot_office
  - id: bedroom
    name: Bedroom
    icon: mdi:bed-king-outline
    preset: button.robot_bedroom
```

Entity names above are examples. Use your existing **routine buttons**, not maintenance-reset buttons or area identifiers. Every room needs a unique `id`, `name` and `preset`. Optional `activity_entity` can identify an externally initiated room clean (`cleaning`, `active` or `on`); it never proves completion. The robot's `supported_features` determines available physical controls.

Configure the optional telemetry entities you have. Missing values are omitted. Cleaning metrics belong to the current preset, not the complete multi-room sequence. The robot's current-room reading describes location; a room tile is marked completed only by the companion's successful routine record.

A configured full-home preset uses the same companion when installed. With `require_queue: true`, every control requires the companion, and saved-preset mode requires a full-home preset for **Clean all rooms**. This prevents a missing controller from becoming a default native clean. With this setting omitted or false, standalone native controls remain available. A selected room always requires the companion.

## Manual cleaning setup

Open the **Preset** pill and choose **Manual setup**. Choose a cleaning mode, adjust its available settings, and press **Use settings**. This only saves a local draft. Select areas in order and press **Clean** to apply settings and begin. Without selected areas, the whole current map is cleaned.

Manual tiles use the robot's existing Home Assistant **Cleaning by area** mapping, discovered by the companion. They can differ from your saved-preset tiles, and an area can contain multiple Roborock rooms. No extra card entity configuration is needed. Preset and manual area selections remain separate.

Manual tiles use their Home Assistant area's icon when one is configured, otherwise `mdi:floor-plan`. To match the room names and icons in your Space Hub cards, set `area_overrides` using the **Home Assistant area IDs** (not preset IDs or Roborock segment numbers):

```yaml
area_overrides:
  living_room:
    name: Living room
    icon: mdi:sofa-outline
  kitchen:
    icon: mdi:stove
```

The visual editor exposes these settings under **Manual area appearance**. Overrides apply only to areas already returned by the companion; they do not add cleaning targets or change the mapped rooms. Preset tiles continue to use each entry's `rooms[].icon`. Display overrides never change the area IDs sent when cleaning starts.

**Vacuum then mop** vacuums every selected area first, then mops them in the same order. **×2** repeats each area twice per pass as separate verified jobs; it may dock or service the mop between jobs. Water and mop route disappear for vacuum-only cleaning; suction disappears for mop-only cleaning. App-only numeric water flow and SmartPlan are not offered.

Manual setup requires both the card and companion at **0.2.0 or later**. Choices apply only on Start, and native settings must be confirmed before cleaning begins. See [manual cleaning behavior and compatibility](docs/manual-cleaning.md).

See [Space Hub controls and migration requirements](docs/space-hub-integration.md) and [named preset scripts for wall switches](docs/switch-presets.md) to use one controller across your dashboards and physical switches. Shared external-job controls require companion 0.2.2 or later.

## Queue behavior

- Selections are a local draft until Start. Only one committed queue runs per HA instance.
- The queue and current position are stored in HA; closing the browser has no effect.
- A second Start cannot replace a running job. The card locks the committed room sequence.
- **Return to dock** cancels remaining rooms before requesting docking. It will not interrupt mop servicing.
- **Clear sequence** after an error or restart clears pending work without moving the robot. Check its state before selecting a new sequence.
- HA restarts preserve the saved sequence for inspection and stop automatic progression. There is no unattended restart or automatic command retry.
- The companion supports the native Roborock V1 coordinator, verified against HA Core 2026.9.4 / python-roborock 7.4.2. It fails closed when completion cannot be established. Other platforms, protocols and unusual multi-job routines require additional compatibility work.

See [completion, cancellation and compatibility details](docs/queue-backend.md). Development checks use simulated Home Assistant states and production-code event traces; they do not claim a physical cleaning test.

## Develop and preview

```sh
npm ci
npm run check
python3 -B test/backend_queue_test.py
python3 -B test/backend_manual_test.py
python3 -B test/backend_controls_test.py
python3 -m http.server 8767 --bind 127.0.0.1
```

Open `http://127.0.0.1:8767/preview/`. The interactive preview is entirely local and never connects to a robot. It includes selection, start/pause/resume, room completion, docking, recharging, mop washing, faults and unavailable states, plus dark/light themes and phone widths.

## Design provenance

Space Hub Card is the design reference. Canonical tokens are vendored from its v2.0.83 commit; the shared glow helper and stacking model are reused. See [provenance](src/shared/PROVENANCE.md). There is no runtime dependency on another local checkout. `scripts/sync-design-tokens.py` updates the exact token source at an explicit commit.

This is a public, reusable project. Examples contain no production configuration, household maps or credentials. MIT licensed.

## Robot and dock controls (v0.3.0)

Update **both** the HACS card and the queue companion, then restart Home Assistant. The existing card configuration works unchanged. The companion discovers enabled native controls by registry identity, including controls on the separate dock device. The card hides unavailable entities and unsupported features.

- **Stop** stops the current cleaning and cancels the remaining sequence. **Clear sequence** only cancels future work.
- **Find** plays the robot's locate sound.
- **Dock** starts/stops dust emptying, mop washing and drying.
- **Map** shows enabled HA map images, without changing maps or sending movement commands.
- **Settings** includes voice volume, Do Not Disturb and its times, child lock and dust emptying mode.
- **Care** shows available consumable time-left sensors and overdue reminders. It never enables entities or resets counters.

An empty clean-water tank is a dock warning, not a blanket cleaning lock. **Manual setup → Vacuum** can run with this specific fault. Mopping, combined/two-pass plans and opaque app presets remain blocked until water is restored. Other faults do not receive this exception. Pause, Stop and return-to-dock have action-specific checks. Robot firmware can still reject an operation; the card never bypasses device interlocks or claims success before acknowledgement.

Dock/settings changes use the shared server controller and caller permissions, wait up to 60 seconds for fresh native readback, and never retry automatically. Resolve an active/uncertain queue before changing these controls. A pending cloud command must finish its acknowledgement window before another motion command. Find is independent of cleaning.

The frontend's new controls require the companion's `control_version: 3`; older companions retain their previous conservative behavior. Run `python3 -B test/backend_device_test.py` alongside the other backend suites when modifying these controls.
