"""Allowlisted manual settings and HA-area plans from the native Roborock cache.

No discovery, polling, raw commands, map switching, credentials, or preset presses.
Compatibility: Home Assistant 2026.9.4 / python-roborock 7.4.2.
"""
from __future__ import annotations
from typing import Any

MODES = {"vacuum": "vacuum", "vacuum_mop": "vac_and_mop", "mop": "mop"}
LABELS = {"vacuum": "Vacuum", "vacuum_mop": "Vacuum & mop", "mop": "Mop", "vacuum_then_mop": "Vacuum then mop"}
SELECT_KEYS = {"mode": "cleaning_mode", "water": "water_box_mode", "route": "mop_mode"}
EXCLUDE = {"off", "off_raise_main_brush", "gentle", "smart_mode", "custom", "custom_water_flow"}


def cached_settings(coordinator: Any) -> dict[str, str]:
    status = getattr(getattr(coordinator, "properties_api", None), "status", None)
    properties = {"mode": "current_cleaning_mode_name", "suction": "fan_speed_name", "water": "water_mode_name", "route": "mop_route_name"}
    return {key: value for key, prop in properties.items() if isinstance(value := getattr(status, prop, None), str)}


def controls(entries, vacuum_entry, coordinator, states) -> dict[str, str]:
    """Resolve exact native select identities, including user-renamed entity IDs."""
    result = {}
    for entry in entries:
        if (entry.platform != "roborock" or entry.domain != "select" or entry.disabled_by
                or entry.device_id != vacuum_entry.device_id or entry.config_entry_id != vacuum_entry.config_entry_id):
            continue
        for key, native in SELECT_KEYS.items():
            state = states.get(entry.entity_id)
            if entry.unique_id == f"{native}_{coordinator.duid_slug}" and state and state.state not in {"unknown", "unavailable"}:
                result[key] = entry.entity_id
    return result


def current_map(coordinator) -> tuple[int | None, set[str]]:
    api = getattr(coordinator, "properties_api", None)
    flag = getattr(getattr(api, "maps", None), "current_map", None)
    info = getattr(getattr(api, "home", None), "current_map_data", None)
    if not isinstance(flag, int) or isinstance(flag, bool) or info is None or getattr(info, "map_flag", None) != flag:
        return None, set()
    segments = {f"{flag}_{r.segment_id}" for r in getattr(info, "rooms", []) if isinstance(getattr(r, "segment_id", None), int)}
    return flag, segments


def room_targets(vacuum_entry, coordinator, area_registry) -> dict[str, dict]:
    _, known = current_map(coordinator)
    mapping = getattr(vacuum_entry, "options", {}).get("vacuum", {}).get("area_mapping", {})
    if not isinstance(mapping, dict):
        return {}
    result = {}
    for area_id, segments in mapping.items():
        area = area_registry.async_get_area(area_id)
        if area is None or not isinstance(segments, list) or not segments or not all(isinstance(s, str) and s in known for s in segments):
            continue
        if len(set(segments)) != len(segments):
            continue
        result[area_id] = {"id": area_id, "name": area.name, "segments": list(segments)}
        if isinstance(icon := getattr(area, "icon", None), str) and icon.strip():
            result[area_id]["icon"] = icon
    return result


def capabilities(vacuum_entry, coordinator, entries, states, area_registry) -> tuple[dict, dict[str, str], dict]:
    selected = controls(entries, vacuum_entry, coordinator, states)
    current = cached_settings(coordinator)
    status = getattr(getattr(coordinator, "properties_api", None), "status", None)
    def native_options(prop, display=False):
        return {getattr(v, "display_name" if display else "value", v) for v in (getattr(status, prop, None) or [])}
    def options(key, native_prop, display=False):
        state = states.get(selected.get(key, ""))
        exposed = state.attributes.get("options", []) if state else []
        native = native_options(native_prop, display)
        return [v for v in exposed if isinstance(v, str) and v in native and v not in EXCLUDE]
    water = options("water", "water_mode_options")
    routes = options("route", "mop_route_options", True)
    mode_state = states.get(selected.get("mode", ""))
    native_modes = native_options("cleaning_mode_options")
    modes = set(mode_state.attributes.get("options", []) if mode_state else []) & native_modes
    vac_state = states.get(vacuum_entry.entity_id)
    native_fan = native_options("fan_speed_options")
    suction = [v for v in (vac_state.attributes.get("fan_speed_list", []) if vac_state else []) if isinstance(v, str) and v in native_fan and v not in EXCLUDE]
    offered = [key for key, native in MODES.items() if native in modes and (key == "mop" or suction) and (key == "vacuum" or water)]
    if "vacuum" in offered and "mop" in offered:
        offered.append("vacuum_then_mop")
    targets = room_targets(vacuum_entry, coordinator, area_registry)
    flag, _ = current_map(coordinator)
    healthy = bool(getattr(coordinator, "last_update_success", False)) and vac_state is not None and vac_state.state not in {"unknown", "unavailable"}
    supported = bool(offered and healthy and flag is not None)
    def default(key, values, preferred):
        return current.get(key) if current.get(key) in values else preferred if preferred in values else values[0] if values else None
    current_mode = next((k for k, v in MODES.items() if v == current.get("mode")), None)
    defaults = {"mode": current_mode if current_mode in offered else offered[0] if offered else None, "repeat": 1}
    for key, vals, preferred in [("suction", suction, "balanced"), ("water", water, "medium"), ("route", routes, "standard")]:
        if (value := default(key, vals, preferred)) is not None:
            defaults[key] = value
    routes_by_mode = {"vacuum": [], "vacuum_mop": [r for r in routes if r in {"standard", "fast"}], "mop": routes, "vacuum_then_mop": routes}
    valid_routes = routes_by_mode.get(defaults["mode"], [])
    if defaults.get("route") not in valid_routes:
        defaults.pop("route", None)
        if valid_routes:
            defaults["route"] = "standard" if "standard" in valid_routes else valid_routes[0]
    result = {"supported": supported, "modes": [{"value": v, "label": LABELS[v]} for v in offered],
              "suction": suction, "water": water, "routes": routes, "routes_by_mode": routes_by_mode,
              "repeats": [1, 2], "room_targets": [{k: t[k] for k in ("id", "name", "icon") if k in t} for t in targets.values()], "defaults": defaults}
    if not supported:
        result["error"] = "Manual cleaning requires an available native Roborock robot, supported cleaning-mode controls, and a known current map."
    return result, selected, targets


def build_plan(rooms: list[str], setup: dict, caps: dict, targets: dict, map_id: int) -> tuple[dict, list[dict]]:
    """Validate caller input and freeze settings, map and area mappings for each job."""
    if not caps.get("supported"):
        raise ValueError(caps.get("error", "Manual cleaning is not supported by this robot."))
    if not isinstance(rooms, list) or len(rooms) > 32 or any(not isinstance(r, str) for r in rooms) or len(set(rooms)) != len(rooms):
        raise ValueError("Select at most 32 distinct mapped areas.")
    if any(r not in targets for r in rooms):
        raise ValueError("Every selected area must be mapped to existing rooms on the robot's current map.")
    segments = [s for room in rooms for s in targets[room]["segments"]]
    if len(set(segments)) != len(segments):
        raise ValueError("Selected areas overlap on the robot map. Select each physical room only once.")
    if not isinstance(setup, dict) or set(setup) - {"mode", "suction", "water", "route", "repeat"}:
        raise ValueError("Unknown manual cleaning settings.")
    mode = setup.get("mode")
    if mode not in {m["value"] for m in caps["modes"]}:
        raise ValueError("Choose a supported manual cleaning mode.")
    repeat = setup.get("repeat", 1)
    if isinstance(repeat, bool) or not isinstance(repeat, int) or repeat not in caps["repeats"]:
        raise ValueError("Choose one or two cleaning runs per area.")
    normalized = {"mode": mode, "repeat": repeat}
    for key, relevant in [("suction", mode != "mop"), ("water", mode != "vacuum"), ("route", mode != "vacuum")]:
        values = caps["routes_by_mode"][mode] if key == "route" else caps[key]
        if not relevant:
            if key in setup:
                raise ValueError(f"{key.title()} is not a setting for the selected cleaning mode.")
            continue
        value = setup.get(key, caps["defaults"].get(key))
        if not values:
            if key in setup:
                raise ValueError(f"The robot does not expose {key} for this mode.")
            continue
        if key not in setup and value not in values:
            value = "standard" if key == "route" and "standard" in values else values[0]
        if value not in values:
            raise ValueError(f"Choose a supported {key} option for this cleaning mode.")
        normalized[key] = value
    phases = ["vacuum", "mop"] if mode == "vacuum_then_mop" else [mode]
    stages = []
    for pass_index, phase in enumerate(phases):
        for room_index, target in enumerate(rooms or [""]):
            for repeat_index in range(repeat):
                settings = {"mode": MODES[phase]}
                if phase != "mop" and "suction" in normalized:
                    settings["suction"] = normalized["suction"]
                if phase != "vacuum":
                    settings.update({k: normalized[k] for k in ("water", "route") if k in normalized})
                stages.append({"target": target, "mode": phase, "room_index": room_index, "pass_index": pass_index,
                               "repeat_index": repeat_index, "settings": settings, "map_id": map_id,
                               "segments": list(targets[target]["segments"]) if target else []})
    return normalized, stages


def validate_stage(stage: dict, caps: dict, targets: dict, map_id: int | None) -> None:
    """Never silently clean a changed map or a different area mapping."""
    if not caps.get("supported") or map_id is None or map_id != stage.get("map_id"):
        raise ValueError("The robot map or manual-cleaning capabilities changed. Review the cleaning plan.")
    target = stage["target"]
    if target and (target not in targets or targets[target]["segments"] != stage.get("segments")):
        raise ValueError("A selected area's room mapping changed. Review the cleaning plan.")
    mode = stage["mode"]
    if mode not in {m["value"] for m in caps["modes"]}:
        raise ValueError("The planned cleaning mode is no longer available.")
    for key, value in stage["settings"].items():
        options = [MODES[mode]] if key == "mode" else caps["routes_by_mode"][mode] if key == "route" else caps[key]
        if value not in options:
            raise ValueError("A planned manual setting is no longer available.")
