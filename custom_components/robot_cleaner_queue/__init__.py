"""An HA-owned ordered routine queue, independent of any browser connection."""
from __future__ import annotations

import asyncio
from datetime import timedelta
import logging
import time
from uuid import uuid4

import voluptuous as vol
from homeassistant.const import EVENT_CALL_SERVICE, EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Context, HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.discovery import async_load_platform
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store

from .adapter import is_competing_command, routine_matches, snapshot
from .engine import ACTIVE, Queue, Snapshot

DOMAIN = "robot_cleaner_queue"
_LOGGER = logging.getLogger(__name__)
CONFIG_SCHEMA = vol.Schema({DOMAIN: vol.Schema({})}, extra=vol.ALLOW_EXTRA)
SERVICE_SCHEMA = vol.Schema({
    vol.Required("command"): vol.In(["start", "pause", "resume", "cancel", "return_to_dock"]),
    vol.Optional("presets", default=[]): vol.All(cv.ensure_list, [cv.entity_id]),
    vol.Optional("vacuum", default=""): str,
    # Accepted for card configuration compatibility; safety comes from native data.
    vol.Optional("cleaning_entity", default=""): str,
    vol.Optional("status_entity", default=""): str,
    vol.Optional("error_entity", default=""): str,
    vol.Optional("last_clean_end_entity", default=""): str,
})


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    manager = Manager(hass)
    hass.data[DOMAIN] = manager
    await manager.setup()
    hass.services.async_register(DOMAIN, "control", manager.control, schema=SERVICE_SCHEMA)
    hass.async_create_task(async_load_platform(hass, "sensor", DOMAIN, {}, config))
    return True


class Manager:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.queue = Queue()
        self.store = Store(hass, 1, DOMAIN)
        self.lock = asyncio.Lock()
        self.listeners = []
        self.unsubs = []
        self.contexts: set[str] = set()
        self.closing = False
        self.coordinator = None
        self.coordinator_unsub = None
        self.last_published = None

    async def setup(self) -> None:
        self.queue = Queue.restore(await self.store.async_load())
        await self.store.async_save(self.queue.dump())
        self.unsubs.extend([
            async_track_time_interval(self.hass, self.tick, timedelta(seconds=5)),
            self.hass.bus.async_listen(EVENT_CALL_SERVICE, self.external_command),
            self.hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, self.shutdown),
        ])

    @callback
    def subscribe(self, listener):
        self.listeners.append(listener)
        return lambda: self.listeners.remove(listener)

    async def publish(self) -> None:
        data = self.queue.dump()
        if data == self.last_published:
            return
        # Persist before sending a new physical command or exposing the transition.
        await self.store.async_save(data)
        self.last_published = data
        for listener in list(self.listeners):
            listener()

    def resolve(self, vacuum: str):
        registry = er.async_get(self.hass)
        entry = registry.async_get(vacuum)
        if entry is None or entry.platform != "roborock" or entry.domain != "vacuum":
            raise ValueError("Choose a vacuum from the native Roborock integration.")
        config_entry = self.hass.config_entries.async_get_entry(entry.config_entry_id)
        runtime = getattr(config_entry, "runtime_data", None)
        coordinators = runtime.values() if hasattr(runtime, "values") else []
        coordinator = next((c for c in coordinators if getattr(c, "duid_slug", None) == entry.unique_id), None)
        if coordinator is None or not hasattr(getattr(coordinator, "properties_api", None), "clean_summary"):
            raise ValueError("This Roborock model does not expose the cached cleaning records needed for safe sequencing.")
        return registry, entry, coordinator

    def current_snapshot(self, vacuum: str) -> Snapshot:
        _, _, coordinator = self.resolve(vacuum)
        if coordinator is not self.coordinator:
            if self.coordinator_unsub:
                self.coordinator_unsub()
            self.coordinator = coordinator
            self.coordinator_unsub = coordinator.async_add_listener(self.schedule_tick)
        state = self.hass.states.get(vacuum)
        return snapshot(coordinator, state.state if state else "unavailable")

    @callback
    def schedule_tick(self) -> None:
        if not self.closing:
            self.hass.async_create_task(self.tick())

    async def control(self, call: ServiceCall) -> None:
        async with self.lock:
            if self.closing:
                raise ServiceValidationError("Home Assistant is stopping.")
            command = call.data["command"]
            vacuum = call.data.get("vacuum") or self.queue.vacuum
            if command not in {"start", "cancel"} and not self.queue.vacuum:
                raise ServiceValidationError("No robot queue has been started.")
            if command != "start" and self.queue.vacuum and vacuum != self.queue.vacuum:
                raise ServiceValidationError("This command targets a different vacuum than the current queue.")
            try:
                if command == "cancel":
                    effect = self.queue.command(command, Snapshot(), time.time())
                else:
                    current = self.current_snapshot(vacuum)
                    if command == "start":
                        registry, entry, coordinator = self.resolve(vacuum)
                        presets = call.data["presets"]
                        for preset in presets:
                            state = self.hass.states.get(preset)
                            if not routine_matches(registry.async_get(preset), entry, coordinator) or state is None or state.state == "unavailable":
                                raise ValueError("Every room must be an available routine button belonging to the selected robot.")
                        effect = self.queue.start(vacuum, presets, current, time.time(), uuid4().hex)
                    else:
                        effect = self.queue.command(command, current, time.time())
            except ValueError as err:
                # Rejected starts must not interrupt an existing valid queue.
                raise ServiceValidationError(str(err)) from err
            await self.publish()
            if effect:
                await self.execute(effect, call.context)

    async def execute(self, effect: tuple[str, str], parent: Context | None = None) -> None:
        kind, target = effect
        # Saving state yields to HA. A concurrent external command or shutdown may
        # have invalidated this effect while persistence was in progress.
        if self.closing or (kind == "preset" and (
            self.queue.phase != "starting" or self.queue.pending_command != "start"
        )) or (kind == "vacuum" and not self.queue.pending_command):
            return
        context = Context(parent_id=parent.id if parent else None)
        self.contexts.add(context.id)
        # Bound bookkeeping; service events are emitted synchronously at dispatch.
        if len(self.contexts) > 128:
            self.contexts = {context.id}
        try:
            if kind == "preset":
                # Revalidate immediately before each dispatch, including later rooms.
                registry, entry, coordinator = self.resolve(self.queue.vacuum)
                state = self.hass.states.get(target)
                if not routine_matches(registry.async_get(target), entry, coordinator) or state is None or state.state == "unavailable":
                    raise ValueError("The next room preset is unavailable or no longer belongs to this robot.")
                await self.hass.services.async_call("button", "press", {"entity_id": target}, blocking=True, context=context)
            else:
                await self.hass.services.async_call("vacuum", target, {"entity_id": self.queue.vacuum}, blocking=True, context=context)
        except Exception:
            # Service implementations can include private payloads in exceptions.
            # Surface a fixed message and never log raw integration responses.
            self.queue.attention("The command failed or could not be confirmed. Check the robot before retrying; no automatic retry was sent.")
            await self.publish()
            _LOGGER.warning("Robot queue command failed; queue stopped without retry")

    async def tick(self, _now=None) -> None:
        if self.closing or not self.queue.vacuum or self.queue.phase not in ACTIVE and not self.queue.pending_command:
            return
        async with self.lock:
            try:
                current = self.current_snapshot(self.queue.vacuum)
            except ValueError:
                current = Snapshot()
            effect = self.queue.observe(current, time.time())
            await self.publish()
            if effect:
                await self.execute(effect)

    @callback
    def external_command(self, event) -> None:
        if self.closing or self.queue.phase not in ACTIVE or event.context.id in self.contexts:
            return
        domain, service = event.data.get("domain"), event.data.get("service")
        data = event.data.get("service_data", {})
        def is_routine(entity_id):
            try:
                registry, entry, coordinator = self.resolve(self.queue.vacuum)
                return routine_matches(registry.async_get(entity_id), entry, coordinator)
            except ValueError:
                return False
        affected = is_competing_command(domain, service, data, self.queue.vacuum, is_routine)
        if affected:
            # Set synchronously before a waiting tick can start another preset.
            self.queue.attention("Another Home Assistant control changed the robot. The queue was stopped to avoid conflicting commands.")
            self.hass.async_create_task(self.persist_interruption())

    async def persist_interruption(self) -> None:
        async with self.lock:
            await self.publish()

    async def shutdown(self, _event) -> None:
        self.closing = True
        for unsub in self.unsubs:
            unsub()
        if self.coordinator_unsub:
            self.coordinator_unsub()
        if self.queue.phase in ACTIVE or self.queue.pending_command:
            self.queue.attention("Home Assistant stopped. The queue will not restart automatically.")
        await self.publish()
