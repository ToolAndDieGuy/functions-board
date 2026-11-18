"""Write Home Assistant's per-entity triggers (light.turned_on, door.opened, ...) into the board's sandbox.

The sandbox follows the same rules as Home Assistant's trigger classes. This reads those classes from an installed
Home Assistant and writes, for each trigger, its kind and settings into the board, between the SBX_ETRIG markers:

    venv/bin/python scripts/gen_sandbox_triggers.py

Kinds: target (to a state), transition (from one set of states to another), origin (away from a state), stateless
(any update: buttons, events), num_changed / num_crossed (a number, with options.threshold), cover (opened/closed,
by is_closed for covers and on/off for binary sensors). Per domain: attr, the attribute tracked instead of the
state; dc, the device classes it applies to; tv, the cover family's target value. A few triggers with rules of their
own are written by hand in the board (SBX_ETRIG_OWN).
"""

from __future__ import annotations

import importlib
import inspect
import json
from pathlib import Path
import re

import homeassistant.components as comps
from homeassistant.helpers.trigger import entity_trigger as et

BOARD = Path(__file__).resolve().parent.parent / "custom_components" / "functions_board" / "frontend" / "functions-board.js"
KINDS = [
    (et.EntityTargetStateTriggerBase, "target"),
    (et.EntityTransitionTriggerBase, "transition"),
    (et.EntityOriginStateTriggerBase, "origin"),
    (et.StatelessEntityTriggerBase, "stateless"),
    (et.EntityNumericalStateChangedTriggerBase, "num_changed"),
    (et.EntityNumericalStateCrossedThresholdTriggerBase, "num_crossed"),
]


def _dcs(spec) -> list[str] | None:
    dc = getattr(spec, "device_class", None)
    if dc is None or type(dc).__name__.startswith("AnyDeviceClass"):
        return None
    return sorted(str(x) for x in (dc if isinstance(dc, (set, frozenset, list, tuple)) else [dc]))


def _vals(v):
    if v is None:
        return None
    return [v] if isinstance(v, (str, bool)) else sorted(v, key=str)


def main() -> None:
    from homeassistant.components.cover.trigger import CoverTriggerBase  # noqa: PLC0415

    table: dict[str, dict] = {}
    root = Path(comps.__file__).parent
    for d in sorted(root.iterdir()):
        if not (d / "trigger.py").exists():
            continue
        try:
            mod = importlib.import_module(f"homeassistant.components.{d.name}.trigger")
        except Exception:  # noqa: BLE001 - an integration whose requirements aren't installed
            continue
        for verb, cls in (getattr(mod, "TRIGGERS", None) or {}).items():
            if not inspect.isclass(cls) or not issubclass(cls, et.EntityTriggerBase):
                continue
            key = d.name if verb == "_" else f"{d.name}.{verb}"
            if issubclass(cls, CoverTriggerBase):
                kind = "cover"
            else:
                kind = next((k for base, k in KINDS if issubclass(cls, base)), None)
            if kind is None:
                continue  # rules of its own: SBX_ETRIG_OWN in the board, or not simulated
            doms = {}
            for dom, spec in (getattr(cls, "_domain_specs", None) or {}).items():
                e = {}
                if getattr(spec, "value_source", None):
                    e["attr"] = str(spec.value_source)
                if dcs := _dcs(spec):
                    e["dc"] = dcs
                if kind == "cover":
                    e["tv"] = spec.target_value
                doms[dom] = e
            entry: dict = {"k": kind, "d": doms}
            if (to := _vals(getattr(cls, "_to_states", None))) is not None:
                entry["to"] = to
            if (fr := _vals(getattr(cls, "_from_states", None) or getattr(cls, "_from_state", None))) is not None:
                entry["from"] = fr
            table[key] = entry
    js = json.dumps(table, separators=(",", ":"), sort_keys=True)
    src = BOARD.read_text()
    new, n = re.subn(r"(/\* SBX_ETRIG:start \*/).*?(/\* SBX_ETRIG:end \*/)", lambda m: f"{m.group(1)}{js}{m.group(2)}", src, flags=re.S)
    if n != 1:
        raise SystemExit("SBX_ETRIG markers not found in the board")
    BOARD.write_text(new)
    print(f"{len(table)} triggers, {len(js)} bytes")


if __name__ == "__main__":
    main()
