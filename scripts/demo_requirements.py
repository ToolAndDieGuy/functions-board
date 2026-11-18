"""Print the Python requirements of Home Assistant's demo integration and everything it sets up.

The demo's manifest lists few of them: it sets up platforms (camera, image_processing, ...) whose integrations
bring their own requirements, and imports numpy without listing it. On a fresh install Home Assistant installs
those while it starts, in a race that has left CI without the test entities. tests/setup.sh installs these first.
"""
import json
import os

import homeassistant

BASE = os.path.join(os.path.dirname(homeassistant.__file__), "components")
todo = ["demo"] + [f[:-3] for f in os.listdir(os.path.join(BASE, "demo")) if f.endswith(".py") and not f.startswith("_")]
seen, reqs = set(), {"numpy"}
while todo:
    d = todo.pop()
    if d in seen:
        continue
    seen.add(d)
    path = os.path.join(BASE, d, "manifest.json")
    if not os.path.exists(path):
        continue
    with open(path, encoding="utf-8") as f:
        m = json.load(f)
    reqs |= set(m.get("requirements", []))
    todo += m.get("dependencies", []) + m.get("after_dependencies", [])
print("\n".join(sorted(reqs)))
