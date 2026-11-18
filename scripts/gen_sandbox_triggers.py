"""Write Home Assistant's per-entity triggers (light.turned_on, door.opened, ...) into the board's sandbox.

The sandbox follows the same rules as Home Assistant's trigger classes. This reads those classes from an installed
Home Assistant and writes, for each trigger, its kind and settings into the board, between the SBX_ETRIG markers:

    venv/bin/python scripts/gen_sandbox_triggers.py           write them into the board
    venv/bin/python scripts/gen_sandbox_triggers.py --check   only compare (the weekly beta run): fails if
                                                              Home Assistant has triggers the board lacks or
                                                              has differently; ones it dropped are a note

An integration whose trigger module can't be imported here (its packages aren't installed) keeps the entries the
board has for it, and is named, so a missing package never quietly drops triggers.

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
    import sys  # noqa: PLC0415

    from homeassistant.components.cover.trigger import CoverTriggerBase  # noqa: PLC0415

    check = "--check" in sys.argv[1:]
    table: dict[str, dict] = {}
    skipped: list[str] = []
    root = Path(comps.__file__).parent
    for d in sorted(root.iterdir()):
        if not (d / "trigger.py").exists():
            continue
        try:
            mod = importlib.import_module(f"homeassistant.components.{d.name}.trigger")
        except Exception:  # noqa: BLE001 - an integration whose requirements aren't installed
            skipped.append(d.name)
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
    src = BOARD.read_text()
    m = re.search(r"/\* SBX_ETRIG:start \*/(.*?)/\* SBX_ETRIG:end \*/", src, flags=re.S)
    if not m:
        raise SystemExit("SBX_ETRIG markers not found in the board")
    old: dict[str, dict] = json.loads(m.group(1))
    # what couldn't be read here stays as the board has it
    kept = {k: v for k, v in old.items() if k.split(".", 1)[0] in skipped and k not in table}
    table.update(kept)
    if skipped:
        print("couldn't import (packages not installed), kept as the board has them: " + ", ".join(skipped))
    added = sorted(set(table) - set(old))
    changed = sorted(k for k in set(table) & set(old) if table[k] != old[k])
    dropped = sorted(set(old) - set(table))
    if check:
        for k in added:
            print(f"new in Home Assistant: {k} {json.dumps(table[k])}")
        for k in changed:
            print(f"changed: {k} {json.dumps(old[k])} -> {json.dumps(table[k])}")
        if dropped:
            print("note: Home Assistant no longer has (the board keeps them for older versions): " + ", ".join(dropped))
        if added or changed:
            raise SystemExit("The sandbox's per-entity triggers are behind: rerun scripts/gen_sandbox_triggers.py on this version")
        print(f"{len(table)} triggers: the sandbox has them all")
        return
    # writing keeps triggers an older Home Assistant still has, so automations on it still simulate
    table.update({k: old[k] for k in dropped})
    js = json.dumps(table, separators=(",", ":"), sort_keys=True)
    new, n = re.subn(r"(/\* SBX_ETRIG:start \*/).*?(/\* SBX_ETRIG:end \*/)", lambda m: f"{m.group(1)}{js}{m.group(2)}", src, flags=re.S)
    if n != 1:
        raise SystemExit("SBX_ETRIG markers not found in the board")
    BOARD.write_text(new)
    print(f"{len(table)} triggers, {len(js)} bytes")


if __name__ == "__main__":
    main()
