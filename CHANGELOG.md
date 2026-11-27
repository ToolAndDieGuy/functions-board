# Changelog

## 0.14.0 (2026-11-27)

Functions Board **v0.14.0** brings a native zero-build ES module frontend, faster and lighter storage for saved versions and checks, security hardening from the HACS review, Home Assistant 2026.11 `target.exclude` support, and a full round of bug fixes across the sandbox, wiring analyzer, debugger, versions, and notification builder.

> **Upgrade note:** On first startup, `v0.14.0` automatically migrates existing saved versions into a lightweight metadata index (`.storage/functions_board.versions`) with on-demand per-function snapshot files (`.storage/functions_board.versions.<hash>`), and moves saved sandbox checks out of layouts into `.storage/functions_board.checks`. This migration is automatic and preserves all existing data, though downgrading back to `v0.13.1` afterwards will not read the new split files.

### Architecture, Storage & Performance
- **Native ES module frontend:** Split the single ~10,000-line script into 24 zero-build ES modules (`frontend/lib/*`, `frontend/ui/*`, `board-core.js`, and a thin `functions-board.js` entrypoint) served under a disjoint content-hashed path (`/functions_board_static_v/<digest>/`) for atomic cache invalidation across updates and integration reloads, while keeping `/functions_board_static/functions-board.js` working for manual dashboard resources.
- **Lazy dashboard card loader:** When the **Dashboard card** option is enabled, dashboards now load a tiny (~3 KB) admin-gated `card-loader.js` instead of downloading and parsing the full board for non-admin users or views without the card.
- **Split version storage:** Version metadata and active pointers live in `.storage/functions_board.versions` while snapshot payloads load lazily from per-function files, so renaming a version or switching active pointers never rewrites large snapshots.
- **Dedicated saved-checks store:** Saved sandbox checks now live in `.storage/functions_board.checks` (`functions_board/checks`, `functions_board/set_checks`) instead of inside the 200 KB layout store, keeping box drags lightweight and freeing layout space. Checks also sync cleanly on reconnect and restore on Undo after deleting a function.
- **UI polish:** Dropped the `· prototype` suffix from the version label in the sidebar footer and About dialog, and fixed tall read-only dialogs (such as **About** and **Sandbox** intro) scrolling past their title heading on open.

### Security & Privacy Hardening
- **Version restore domain allowlist:** Enforced an explicit allowlist of Home Assistant domains (`automation`, `script`, and UI helper domains) on both backend (`version_save`, `version_overwrite`) and frontend (`_verDiff`, `_verPlan`, `_verRestoreGo`, delete Undo) so stored snapshots can never dispatch WebSocket commands for arbitrary domains.
- **Diagnostics anonymisation:** Offloaded regex compilation and tree anonymisation off Home Assistant's asyncio event loop, made known-name redaction case-insensitive, and prevented short or structural-word label IDs (e.g. `mode`, `on`) from corrupting structural JSON keys/values while still anonymising them in label positions.

### Sandbox & Saved Checks Fixes
- Fixed duration formatting in saved-check steps, the sandbox clock tooltip, and **Jump to** so offsets always format as durations (`M:SS` / `H:MM:SS` / `Nd H:MM:SS`) instead of local wall-clock times (which showed AM/PM timestamps outside UTC).
- Fixed `sbxRewrite()` to tokenize Jinja comments (`{# ... #}`), expression/statement tags (`{{ ... }}`, `{% ... %}`), and quoted string literals so plain text words like `states`, `closest`, or `distance` are never rewritten or misreported as location reads.
- Added explicit saved-check step descriptions for Z-Wave value reports (`zwave`) and device behaviors (`behave`) instead of falling back to "Clock to what's due".
- Fixed MQTT cover position handling for JSON `0`, non-zero `position_closed` offsets, and inverted covers (`position_closed > position_open`).
- Derived helpers now converge across multi-hop helper chains, `script.toggle` cancels an already running script, `time_pattern` scheduling handles DST transitions without skipping or repeating an hour, and manual steps or rewinds clear a previous history-replay banner.
- Fixed a race under slow/jittered connections where sandbox rendering could access the engine before async initialization finished.

### Wiring, Debugger, Problems, Versions & Notification Builder Fixes
- Added Home Assistant 2026.11 `target.exclude` support across the wiring analyzer, board model, and sandbox target resolution.
- Missing targetless services (`s_missing`) now mark the service box and incoming arrow on the board, and their **Show** button in the Problems drawer navigates directly to the service box.
- Fixed a property collision between Trace **Back** navigation and drawer focus restoration so returning from a trace goes back to the Debug or Runs drawer and closing the drawer restores focus cleanly.
- Fixed Z-Wave JS value discovery for multi-endpoint child devices whose registry identifier uses the `home-node-endpoint` format.
- Fixed wiring analysis edge cases for `wait_for_trigger` (`wait` mode), templated action targets, `climate`/`water_heater`/`media_player` `turn_on` actions, Node-RED `target` blocks, and `input_number` float formatting (`pyFloat`).
- Live debugger now captures calls targeting `floor_id` or `label_id` and preserves rapid same-second repeated calls.
- Version snapshots and restores now resolve renamed scripts via their registry `unique_id` and restore customized entity IDs when recreating deleted helpers.
- Notification Builder now matches `mobile_app` devices renamed via `name_by_user` (or unmatched devices via entity slugs), skips disabled script IDs when choosing a new script ID, and rejects blank button titles.
- Backend cleanup: deleting the last version removes empty label buckets, MQTT switch discovery checks explicit `None` for falsy payloads (`""`, `0`), and `functions_board/set` validates layouts via `_layout_problem`.

### Testing & CI
- Fixed all weekly CI regressions (`mutants`, `jitter`, and `diff` random write-write races), added `include-hidden-files: true` to artifact uploads, expanded unit/board/backend/E2E coverage (including `card-loader.js` and `CHECK_OPS` invariants), and remapped all 319 mutants to the modular frontend.

## 0.13.1 (2026-11-23)

The sandbox's controls are in sections now, each under a header: **Change something**, **Send an event**, **Run and
replay**, **Time** and **Settings**. Clicking a header folds its section away, and it stays folded the next time you open
the sandbox (a setting of yours only). On a phone, where the controls filled the screen, fold the ones you don't use.

## 0.13.0 (2026-11-23)

In the sandbox, the **Press** row lists every trigger of the function's devices, as Home Assistant lists them for its
automation editor, not only those the function's automations use: a remote's other buttons, a keypad's other scenes.
Where Home Assistant offers a choice for a trigger (a scene button pressed, held, released, pressed twice), a dropdown
beside it picks one, and a press starts every trigger it satisfies, so one set to held doesn't start on a press, and
one with no choice set starts on any. Triggers the automations use are listed first, with their choice in the name.

An MQTT device trigger is now what Home Assistant makes of it: an MQTT trigger on its topic and payload. Pressing one
sends that message in the sandbox, so everything on the topic hears it (the remote's event entity, an MQTT trigger on
the topic), and a message sent on the MQTT row with its payload starts it. Where its value template reads the payload
from JSON (`{{ value_json.action }}`), the message is that JSON. Nothing is published.

A **Z-Wave** row in the sandbox reports a value of the function's Z-Wave devices, as the node would: a lock's mode,
a door's state, a battery level, picked from the states the value can take. Automations with a Z-Wave **value
updated** trigger on it start, with From and To read as Home Assistant reads them, and the entities that show the value
follow (the lock locks, the door's binary sensor turns on), which starts the automations on those. The values the
automations listen for are listed first. The values come from the Z-Wave JS integration as it holds them, through a new
read-only command; nothing is sent to the node.

A Z-Wave scene button pressed in the sandbox is now what Home Assistant makes of it: the `zwave_js_value_notification`
event, which event triggers on it hear too, and the scene's event entity shows the key. A door's state reported is a
value only, as in Z-Wave JS, so a trigger waiting for a Notification event doesn't start on it; one the automations use
can be pressed on the Press row.

A Z-Wave device with hundreds of settings (its Configuration parameters) no longer crowds out the rest: a device's
values are listed with its settings last, up to 600 of them, so the values automations listen for are always there.

On a phone, a box can be moved again. Holding one picked it up only after a second, but the phone's own long-press
buzz comes at half a second, so a finger that moved then panned the whole board instead. A box is now picked up at half
a second, or as soon as the phone reports its long-press, and the buzz then is Home Assistant's own: the companion app
buzzes as it does for Home Assistant's buttons.

## 0.12.0 (2026-11-22)

A notification builder. In a function, **Recipes → Notification** (in the toolbar) writes an ordinary Home Assistant
script that sends a notification. Recipes is the home for purpose-built scripts like it. You pick:
- who gets it: people's phones (only when they're away, if you like), phones themselves, and speakers through
  text-to-speech when someone's home;
- how urgent it is (normal, time-sensitive or critical, sent the way each phone's app understands it);
- quiet hours, when phones get it silently and nothing is spoken;
- a tag, so a new one replaces the last;
- up to three buttons, each running a script, a scene or any actions, with what to do if nobody answers in time.

Each run's buttons have ids of their own, so a button on an old notification doesn't answer a new one, and once
answered the notification is cleared from every phone. **Edit** on the script's box opens it in the builder again
while it's what the builder made; once it's edited by hand, it opens in Home Assistant's editor. **Try in sandbox**
runs it there, saved or not, with its buttons to press; nothing is sent. Saving needs Full manager.

In the sandbox, every run has a context, as in Home Assistant (templates can read `context.id`). An event trigger in
`wait_for_trigger` has its templates rendered with the run's variables, and the buttons of a notification the
sandbox sent are there to press, by the ids it was sent with.

Versions are made active rather than restored. The version the function is now is pinned at the top of the Versions
drawer, marked active, with **Save** and **Save as copy**: active means its automations, scripts, helpers and layout
are all the same as what's there now. Change anything, boxes moved included, and the top row says **Unsaved changes**,
with **Save** (over the version the changes came from, after asking; the newest when none is known) and **Save as
copy** (a new version). The open drawer follows changes made elsewhere. Deleting a version lists what only it has (an
automation, script or helper still in Home Assistant but in no function, no other version, and used by nothing else),
each unticked; a ticked one is deleted from Home Assistant too (Full manager). A saved version now changes only when you save
over it on purpose. **Make active** (Full manager, where Restore was) makes the function what a version is; every
version stays as it was. If what's there now isn't saved anywhere, saving it first as a new version is ticked, so
nothing is lost unless you untick it. Before, going back to a good version from a throwaway could leave the good one
not marked active: Home Assistant writes a config back a little differently from how it was saved, so the two didn't
match exactly. The board now notes which version it made the function from, and that one is active.

In the sandbox, MQTT entities follow their topics. A message on a sensor's state topic (sent by you, or by an
automation's `mqtt.publish`) changes the sensor through its own value template, as Home Assistant would: binary
sensors, switches, locks, covers, selects, numbers, texts, device trackers, event entities and lights, with
availability topics, JSON attributes, `off_delay` and `expire_after`. Home Assistant's own order is kept (its MQTT
triggers hear a message before the entities on that topic change), and so are its quirks: a sensor that expects a
number and gets text keeps its state until a number comes.

On the board, an MQTT entity follows its topic there too. An automation that publishes to a topic now points to
that topic's box (it pointed to a box for the `mqtt.publish` action), and the topic's box points to each MQTT entity
on the board that follows it. The board asks Home Assistant which topics an MQTT entity follows whether or not the
entity is in the function, so the sandbox moves it when a message comes, wherever it sits on the board.

In the sandbox, an automation in single mode is no longer started twice where Home Assistant starts it once. A run
that waits for something goes on only after what's in hand is done, as in Home Assistant. There are three such
waits: the end of a delay, an `mqtt.publish` waiting for the broker's answer, and a restart waiting for the old run
to stop. Before, the sandbox let such a run finish at once, so it could start again when:
- its own `for:` trigger came due the second its delay ended;
- a group or min/max helper following the same change started it again after it published;
- two triggers of one event both restarted it (it toggled twice).

Home Assistant drops the second start in the first two cases and runs only once in the third, and now so does the
sandbox.

In the sandbox, the sun moves at sunrise and sunset only when something in the function reads it (an automation, a
script or a helper). Before, it moved every day whatever the function was, so a run of a few days filled the timeline
with sun changes nothing heard. The explorer also ran each of its tries on until nothing was due, and the sun is always
due, so each try ran a month ahead and **Show** replayed that month. Each try now stops a day after it starts, as the
explorer says.

Scenes and groups no longer draw arrows to the lights and devices they set or hold. Before, they drew arrows only
to the ones that happened to be on the board for other reasons, so a scene that sets a dozen lights looked as if it
set two. A scene's box now says how many it sets and a group's how many members it has; click one to see them. Their
arrows are the ones into what triggers on them or reads them (an automation started by the scene, a helper that
tracks it).

In the sandbox, an action on a device shows on that device's box. Before, the board showed the device as one box but
the sandbox looked for its entities, so it drew a temporary box marked "Not on this board" for something that was on
it. When a step reaches a device's entities, or the lights of an area, it says over that box what it did: the action,
which of the entities, and with what ("climate.set_fan_mode → Hall thermostat (fan_mode: on)"), or which of them
changed to what. The words stay over the box until a later step there says more, and while the run plays, a step with words
waits long enough to read them.

A state trigger that starts both ways is a new problem (amber). A trigger with From and no To starts on any change
away from the states it lists, so `from: [off, on]` starts the automation when the stove turns on and again when it
turns off. It's listed with the function's problems, and the sandbox's timeline says so when it happens, with Dismiss
beside it, in case it's meant.

The sandbox can now drive every kind of trigger. Every field is a list of what fits the function, with Other… to
type anything else:

- **Set** lists every entity the automations read first (including ones reached through an area or a device), and
  its values say why: "1101 · above 1100: CO2 high". An attribute a trigger reads, a light's brightness say, can be
  set beside the state, and an event entity can be pressed with the event type its trigger waits for.
- **Device triggers** made in the editor are followed: one on an entity (motion, opened, turned on, a sensor's value)
  as the state trigger it stands for, with device conditions and actions too. A device's own buttons (ZHA, Z-Wave,
  Hue, deCONZ, MQTT) are pressed from a new **Press** row, which also fires any other trigger the sandbox can't see
  coming (Z-Wave value updated, geo location).
- **Zones and the sun** are followed: a person entering or leaving a zone, sunrise and sunset with their offsets
  (sun.sun rises and sets on the sandbox clock), and zone and sun conditions, which were asked before.
- **Home Assistant starting or stopping, webhooks, tags, calendars and Assist sentences** each get a row when the
  function has one.
- **Scenes** set what they hold, **timers** fire Home Assistant's timer triggers, and a **script's fields** can be
  given when you run it.
- **The clock** shows the day and the time to the second. Advance by 1 second to a week, jump to what's due,
  sunrise, sunset, a time trigger or the edge of a time condition, or type a time; each thing coming up is a
  button that runs the clock to it.
- Saved checks keep and replay all of it.

Any problem can now be ignored for good. It leaves the count and isn't listed under Dismissed either, even if it goes
away and comes back. The problems list says how many are ignored for good and can bring them back as dismissed.

The sandbox is now a debugger. Its drawer has four tabs:

- **Timeline**, as before, with a plain sentence over each thing you did ("Motion turned on: Hall light on, timer
  started"). Click any line to see the run's variables at that moment (`trigger`, `repeat`, `wait`, a response).
  **Undo** takes back your last step and **Again** repeats it.
- **States**: every entity in the sandbox with its state and attributes, the ones that changed first, each one
  editable in place.
- **Explore** tries everything the function can be given, one thing at a time from the same start (a day passing,
  every value Set offers, every button, webhook, tag and sentence), and reports what never happens, conditions that
  are never true, two automations fighting over one entity, and loops.
- **Coverage** marks on the board what ran and what didn't: triggers never fired, conditions only ever true or only
  ever false, choose options and else branches never taken.

**Step** runs one step at a time: each run waits before every condition and action until you press Continue.
**Pause here** on a box's bar makes runs of that automation wait at each step. **How a device answers** makes a
device slow (a cover is opening first), fail (a lock jams) or go unavailable. **What if** has ready-made situations:
everyone leaves or comes home, a power cut and power back, sunset, sunrise, the night, a morning, a day, a week. The
clock can run by itself, from real time to 600 times faster. A box's bar suggests values to set, and Enter in a value
sets it.

The sandbox now does what Home Assistant does in places it didn't. Every case below was found by a new test that runs
the same homes in the sandbox and in Home Assistant itself, step by step, and compares them:

- An automation's conditions are checked when it's triggered, before its mode. A restart-mode automation whose
  conditions fail no longer cancels the run it already has going, and a queued run keeps what its conditions said
  when it was triggered.
- When one change starts several runs, they go in Home Assistant's order: each run goes as far as it can at once
  before the next trigger is looked at, and a change a run makes meanwhile waits its turn. So two triggers of one
  automation on the same change both run; an automation that turns on what it triggers on runs again once it has
  finished (but is "already running" if it changes it after a delay); and a wait doesn't hear the change that
  started its own run. In the garage example, opening the door now also runs "restart timer when reopened", as it
  does in Home Assistant: the timer the first automation just started is already active when its condition is
  checked.
- Queued mode's maximum counts the runs waiting in the queue, as Home Assistant's does.
- A paused timer started again goes on from where it was paused. Before, it started over with the wrong time.
- Setting a number outside its range, or a select to an option it doesn't have, stops the run with Home Assistant's
  error. Before, the sandbox clamped the number or set the option and carried on.
- `automation.trigger` waits for the run it starts, as a script call does.

Helpers that follow what they read now do so in the sandbox: template sensors and binary sensors, min/max sensors,
threshold sensors, and binary sensor, light and switch groups. They use Home Assistant's own rules (a min/max's
rounding, a threshold's hysteresis, a group's "all"), and they change before any automation hears the change. The
drawer lists them when it opens, and each change says what it followed. Saved checks replay them the same way.
Other helpers worked out from something (a derivative, a utility meter, statistics) stay as they are unless you set
them. The integration's `functions_board/sources` answer now carries each helper's rule for this.

**Whole home** (a box in the sandbox's intro and its Home row) also runs the automations outside the function that
start from what it reads or changes, and the ones those reach in turn. Opening the garage door then also turns on
the porch light, if another automation does that. They run in the sandbox only, show beside the board as not on it,
and are left out of the function's coverage. A check saved this way keeps them and replays them. The choice is kept
with your display settings.

**Replay** in the sandbox replays a period from Home Assistant's history: last night (18:00 to 08:00), or the last 6,
12 or 24 hours. The sandbox starts from your home as it was then and gets the real changes of everything the function
reads, in order. Afterwards it shows how that compares with what really happened: when each of the function's
automations ran in your home and in the sandbox, and what the function changed on its own. Anything that differs is
listed with when. It only reads the history, and the replay can be saved as a check.

The sandbox knows a few integrations better. A **Notification** row lists the buttons the function's notifications
would have. Pressing one fires the event your phone's companion app does (`mobile_app_notification_action`, or the old
iOS one if that's what the function listens to), so the automation answering it runs. A link button isn't listed.
The MQTT row now suggests a Zigbee2MQTT button's action as the JSON it really sends (`{"action": "single"}` for a
trigger reading `value_json.action`). For Frigate's topics it offers what Frigate sends: a person or a car seen and
gone, a label's count on a camera, and motion.

Saved checks can be edited and shared. **Edit** changes a check's name, moves its steps earlier or later, changes
what a step sets or how long it lets pass, takes a step or an expectation out, and adds an expectation ("Garage
Door ends as closed", "Close garage runs to the end"). **Share** gives the check as text to copy, and **Import**
adds one pasted from another board. An imported check keeps only what a check can hold, and runs at once on this
function's configs.

## 0.11.0 (2026-11-20)

Import finds more of the systems you've built, and lets you decide where one ends and the next begins.

It now groups more than automations that share a helper or a script. It also groups automations that start from
the same device (a garage door's sensors, a generator, a switch's buttons), with the few that operate it, and
automations whose names say they belong together ("Generator: …", "Mailbox opened", "Mailbox emptied"). An
automation that only turns other automations on and off joins them, and a scene several automations turn on
links them. A helper or script shared by systems with different names joins only the one named like it, as one
filed under different categories already did.

When two groups may be one system, the import offers to merge them and says why: one turns the other's
automations on and off, uses or checks one of its helpers, changes what it starts from, both start from the
same device, or both are filed under one category. A merged group lists the groups it's made from and can be
separated again, and **Merge into** joins any two. Nothing is merged unless you choose it, so a bedtime button
that also arms the night alerts can be imported with them, or on its own. The "Also join automations that meet
at a device" checkbox is gone: that's now an offer to merge.

While the board reads Node-RED, the import also reads your flows: the scripts a flow runs and the helpers it uses
are grouped with it, and a flow's tabs named alike go together. The flow is listed with its group; it can't
carry a label, so it isn't added to the function.

A Node-RED flow on a disabled tab now shows as disabled on its box, and a disabled node no longer counts.

**Delete function and its items** never deletes what's shared. A piece that's also in another function, that
something outside the function uses (an automation, script, group, helper or Node-RED flow), or that was set up
together with something outside it, stays where it is: the dialog says why, and it only leaves the function. It
stays in its other functions until nothing else has it. Before, the dialog warned about such pieces but deleted them
unless you unticked them.

Restoring a saved version works the same way. An automation, script or helper added since the version was saved
that's also in another function, or that something outside this function uses, is never turned off or deleted:
it's only taken out of the function you're restoring, and the dialog lists it apart with the reason. And when
restoring writes back an automation, script or helper that's also in another function or used elsewhere, the dialog
warns that it changes there too, and names where.

## 0.10.0 (2026-11-19)

The board's insides are rebuilt. Nothing it shows or does is meant to look different, and your saved functions,
layouts and versions are kept as they are (0.9.2 reads anything this version saves). What changes is how sure it
is of what it knows, and what it does when something goes wrong.

Fixed: an automation turned off, or a device gone unavailable, after you opened a function didn't show as a
problem until you opened the function again. It now shows as soon as Home Assistant says so.

Fixed: a configuration read just before you saved it could come back after the save and be shown, for up to a
minute, as if it were the saved one. And a restore planned right after something was deleted in Home Assistant
now sees the deletion.

Fixed: a board you'd left (another sidebar entry opened, a dashboard view left) went on counting problems in the
background, and could show a message, for up to a minute afterwards. Everything it waits on now stops when you
leave and starts again when you're back.

Fixed: a dashboard card you came back to, or a board left open while Home Assistant restarted or the connection
dropped, didn't hear what changed meanwhile: an automation saved in the meantime kept its old arrows, and a
function made or deleted on another board didn't show, until something else changed. It now reads it all again
when it's back.

When the board asks Home Assistant the same thing twice and the answers come back out of order, the older one no
longer wins. Every call now has a time limit, and a call that fails is no longer dropped without a trace: the
Diagnostics file lists what failed since the board opened (anonymised, only the kind of call and the error code).

The list, header, boxes and side drawer now update what's on the screen instead of drawing it again, so the
keyboard focus stays where it was when they change.

Behind it, for anyone working on the board: the board's code is in parts (a clock for every timer, one link to
Home Assistant, a store of what it knows with the time it asked, one table of actions per view, drawing in place,
and parts that don't reach into each other's state), each held to its rules by the tests. Every view is kept as
a snapshot, and every board test also runs with Home Assistant answering late and out of turn.

## 0.9.2 (2026-11-19)

Fixed: a function another admin made could be deleted from the shared store. If you left the board and came back to
it within ten minutes in the same browser tab, the board reused the lists of labels and entities it had fetched
before you left. A function made on another device in the meantime wasn't in those lists, so the board dropped it
from the list of functions and deleted its layout for everyone. The board now fetches the lists again whenever the
old ones don't know every function in the shared store.

## 0.9.1 (2026-11-18)

Fixed: the sandbox got **and**, **or** and **not** conditions wrong (since 0.7.0). An "and" passed as soon as its
first condition was true, an "or" passed even when none was, and a "not" let the run go on when what it held was
true. So in the sandbox, and in saved checks, an automation could run when it wouldn't in Home Assistant, or stop
when it would run. Plain lists of conditions, and choose and if blocks, were right. If a saved check passed only
because of this, it now fails, and shows on the board as a problem.

Fixed: closing a dialog or the side drawer could leave the keyboard focus on a box instead of the button that
opened it, when the board had redrawn that button in the meantime (the function list redraws whenever a count
changes). Focus now goes back to that button. And a box that has focus keeps it when the board is drawn again
around it.

Fixed: since 0.9.0, the bar that follows a run on the board (from Runs or the debugger) showed every step as
"Clock to what's due" instead of what happened (Garage Door → Open, ran Garage: left open …). The saved checks'
steps had taken over its wording.

Fixed: a state set with Test → Simulate a state could lose its "simulated" mark on the box at once, when Home
Assistant's word of the new state reached the board after its answer to setting it (more likely on a busy Home
Assistant). The mark now stays until the device or its integration really reports again.

Fixed: when you draw an arrow, the choices of what it means (a light turned on, turned off …) came in whatever
order Home Assistant listed them, which changes from one start to the next. They now come in the same order every
time.

For contributors: the test system was rebuilt as a whole; `tests/README.md` explains it. One runner
(`sh tests/run.sh`) whose result comes from the reports, with a self-test proving a failure can't pass unseen; a
fresh, isolated Home Assistant for every run; the board tested on a fake Home Assistant, in parallel, kept honest
by a contract test against the real one; mutants (`tests/mutants.json`) proving each check can fail, which found
the bugs above; flaky tests reported rather than hidden; and weekly runs against Home Assistant's beta, every
mutant, a strict run with the size budget, and the README's pictures (retaken for this release).

## 0.9.0 (2026-11-18)

Improved: **accessibility.** The board was checked with the axe-core accessibility rules (WCAG 2.2 AA) in every
view, in dark and light mode, and with the keyboard alone, and what turned up is fixed:
- Text is readable in light mode: red, amber and blue labels, links, white text on coloured buttons and badges,
  and the boxes the sandbox fades are darker or reworked where they were too faint (4.5:1 or better).
- A box's spoken name now says everything it shows, including its problems; the list's count is read as
  "2 problems", not just "2".
- The side drawer (debugger, runs, sandbox, an editor) is a named region: focus moves into it when it opens and
  goes back to the box or button you came from when it closes.
- The find box and notes show where the focus is.
- If your system asks for less motion, flows on the board show their last step at once instead of playing, the
  dots along the arrows and the pulses stop, and the view jumps rather than glides.

New: **saved checks.** Do something in the sandbox (open the garage door, let the clock run), then **Save as a
check**: the board keeps the steps, the states and the time they started from, and what came of it, which you
tick (the door ends closed, "Close garage" runs to the end, an automation is stopped by its conditions or doesn't
run at all). The check is replayed on the function's current configs every time they change, and when you open
the function. If it stops passing, the function shows it as a problem, saying what happened instead ("Garage Door
ends closed (got open)"). **Replay** plays it in the sandbox, step by step on the board. Answers you gave the
sandbox (is it after sunset?) are given again; a question it hasn't been asked before makes the check unsure
rather than passing. Checks are kept with the function's layout and shared like everything else on the board.

Fixed: anonymised diagnostics now also replace the IDs of areas, floors, labels and devices that Home Assistant no
longer knows (an automation still pointing at a deleted area), which were left as they were.

Fixed: anonymised diagnostics now also replace the names inside MQTT topics (`home/kitchen/light` keeps its
shape and protocol words like `zigbee2mqtt` and `set`, not the names).

New: **problems.** Home Assistant doesn't warn when something an automation uses is renamed or removed; the
automation just stops doing its job. The board now finds what each function's automations and scripts point at
that isn't there or can't work: an entity that doesn't exist (renamed or removed), one no integration provides,
a device, area, floor or label that's gone, an action whose integration isn't set up, an automation that couldn't
be set up. Those are red. Unavailable or disabled things and automations that are off are amber, since they may
be on purpose (not while the function is paused). Each function in the list shows how many; the header has a
**problems** chip that opens the list, with what each one is in, **Show** and **Edit**; and the boxes and arrows
involved are marked on the board. It replaces the list's old "something is unavailable" dot.

New: **dismiss a problem** you know about (a device unplugged for the winter). It leaves the count, the list's
badge and the marks on the board; when it was the only one, the problems chip goes too. A **Dismissed** button in
the header lists what you've dismissed, with **Bring back**, and the toast after dismissing has Undo. Dismissals are
kept with the function and shared between administrators, and one is forgotten once its problem has been gone for
a day, so a problem that comes back later shows again.

## 0.8.2 (2026-11-18)

New: **Diagnostics… in the About dialog.** It makes a file for an issue or a forum post, and you choose every time,
with nothing ticked to start with: **anonymised** (names, IDs, addresses, keys and free text replaced with
stand-ins, the same one wherever a thing appears, so the problem's shape is still there) or **with real names**.
You can add a snapshot of the open function as it is now and any of its saved versions; each version in the
Versions drawer has its own download button. The file is made in your browser and saved on your device; nothing
is sent anywhere. Home Assistant's own Download diagnostics is now anonymised too, with the board's layouts and
settings in it instead of only sizes.

New: **privacy checks** on every push, each shown to fail when its rule is broken: the board's code can reach
nothing but your Home Assistant; the integration's Python has no network code; anonymised diagnostics hold none
of the test data put in every field, and the log never holds the board's notes, layouts or snapshots; on a real
Home Assistant, every request the board makes goes to that Home Assistant, no connection comes from the
integration, and its data is stored only in its own files and can't be read without logging in as an
administrator. The README's new **Privacy** section has the details.

Changed: the board now refuses to open, or fetch from, anything but a path on your Home Assistant (the drawer's
pages and Node-RED's flows), so a bad address from elsewhere can't send it somewhere else.


## 0.8.1 (2026-11-18)

Changed: **restoring a version no longer saves a backup copy every time.** The restore dialog has a box, unticked
unless you tick it, to save what's there now as a version first, and it says whether what's there now is already
one of your saved versions. Switching back and forth between versions no longer leaves a "Before restoring …"
copy behind each time. When there's no backup, Undo goes back to the saved version the function matched, if any.

Fixed: in the **Key**, "simulated state" could wrap onto a line of its own, away from its mark. It now has its
own line, with its mark.

The README's pictures are new: the sandbox playing a run on the board, a version open in a tab, a function
flowing top to bottom, and everything else as the board looks now.

## 0.8.0 (2026-11-17)

New: **versions** of a function, to save it as it is, compare, try one in the sandbox, and switch back.

- **Versions** in a function's toolbar saves a named snapshot, with a description: the configs of its automations
  and scripts, its helpers' settings, what's in it, the devices its steps use, and its layout. The drawer marks the
  version the function matches right now. Saving changes nothing in Home Assistant; versions are kept by the
  integration (`.storage/functions_board.versions`, at most 50 per function).
- **Open a version in a tab** beside **Now**, which stays marked as the active one. The version's board is drawn
  from its saved configs, with what's changed since or only in that version marked, and it can't change anything.
  Open it in a new window to see both side by side.
- **Try a version in the sandbox** without restoring it.
- **Restore** (Full manager) puts the function back, through Home Assistant's own config APIs. A dialog lists every
  change first; what's there now is saved as a version of its own; you choose whether automations added since are
  turned off or deleted; and a device its steps used that's been replaced can be swapped for the new one with
  Home Assistant's device picker. Items defined in YAML are listed as not restorable.

Changed: the **sandbox's fields are lists** of what fits, so you don't need to know what to type. Set offers the
states the entity can take (its current one marked "now", plus unavailable and unknown), Event the event types the
function listens for and the data its triggers look for, MQTT its topics and the payloads its triggers wait for.
Each list ends with **Other…** for anything else.

## 0.7.2 (2026-11-17)

Shared lines are easier to follow.

- **Point at a box to trace its arrows.** When arrows share a line, pointing at a box draws its arrows on top, end
  to end through the shared part, and fades the other arrows on that line. On a touch screen, select the box: its
  arrows stay traced until you select something else.
- **No more coloured dots** at branch points and on the boxes' points: matching sixteen colours across the board
  didn't work. Where an arrow leaves a shared line there's a small plain dot, so a branch reads as a join, not a
  crossing (crossings hop).
- **The sandbox's flow follows the steps.** If a whole run reads at a comfortable size it's framed at once;
  otherwise the board glides to each step as it plays (or as you step through), zooming out only when one step
  doesn't fit, instead of zooming out to fit everything.

For contributors: the test kit keeps a separate login for the test and demo Home Assistants (starting the demo
one no longer loses the test one's password), `apitest.py` finds the running instance's config folder on its
own, and `setup.sh` installs the demo integration's requirements before Home Assistant first starts (they're
read from Home Assistant's manifests; installed during startup, they raced it and CI sometimes started without
the test entities).

## 0.7.1 (2026-11-17)

New: the sandbox **plays what you set off on the board**, step by step, so you can follow it on the wiring and
not only in the list.

- **One flow per thing you do.** Set a state, fire an event, run an automation or move the clock, and everything
  it sets off is played on the board one step at a time: the arrow each step goes along lights up and a dot runs
  along it, each step gets a **number** (on the board and beside its row in the drawer), and the box it reaches
  pulses. What the flow doesn't touch stays readable, a little dimmed.
- **Checks on their arrows.** A condition the flow checked shows ✓ or ✕ on the arrow from what it read, with why
  on hover.
- **Temporary boxes** for what isn't on the board: the event or sensor a run stood in for, an MQTT topic a script
  publishes to, a notification, an event an action fires. They're dashed amber, placed next to what they touch,
  and gone when you clear the flow or close the sandbox. A message to `…/set` goes to the topic's box if the
  board has it.
- **Step through it.** The bar under the board names each step (who runs what, who checks what, who waits) with
  ◀ ▶ to step, **Replay**, and **Clear**. Clicking a row in the drawer, a step number or a temporary box goes to
  that step.
- **What's waiting:** a box with a delay or timer running shows how long is left, on the sandbox's clock.

## 0.7.0 (2026-11-17)

New: a **sandbox**, to try a function out without anything changing in your home, and functions that can flow
**top to bottom**.

### Sandbox

- **Sandbox**, in a function's toolbar, runs the function on a copy of its states with its own clock. Set a
  state, fire an event, send an MQTT message or run an automation, and the drawer lists what the function does,
  step by step: what triggers, which conditions pass or fail and why, what each action changes, and what that
  sets off next. The chain lights up on the board, boxes show the sandbox's states, and what the sandbox changed
  is marked in amber. Closing it puts the board back to your home's states.
- **Nothing reaches your home.** The sandbox reads your states once when it opens and asks Home Assistant to
  render templates. It never calls a service, fires an event, publishes to MQTT or sets a state, and it works in
  Organise only mode too. While it's open, test buttons and the Test dialog act on the sandbox, and Pause is off.
- **A dialog when it opens** explains what it's for and nine things it can't show you (only the board's
  automations run, devices don't answer, and so on). Tick **Don't show this again** to skip it; the **i** in the
  sandbox's title bar shows it any time.
- **Its own clock.** Delays, timers, `for:` durations, time triggers and time patterns run on the sandbox clock:
  +1 min, +10 min, +1 h, or **Next** to jump to the next thing due.
- **Real templates.** Home Assistant renders them, reading the sandbox's states and clock: `states()`,
  `is_state()`, `state_attr()`, `is_state_attr()`, `has_value()`, `states.x.y`, `states[...]`, whole domains,
  `states | ...`, `expand()`, `now()`, `utcnow()` and `today_at()`, as functions, filters and tests. Templates
  that read locations (`closest()`, `distance()`) are marked partly real.
- **Triggers:** state, numeric state, event, MQTT, time, time pattern and template triggers (with `for:`), and
  Home Assistant's per-entity triggers (`light.turned_on`, `door.opened`, `lock.unlocked`, `event.received`,
  thresholds and the rest, with `behavior` and `for`) by the same rules as Home Assistant's own. Triggers it
  can't follow (zone, sun, start, webhook, device) are named when it opens; **Run** an automation as if any one
  of its triggers fired, so `trigger.id` conditions and `trigger.` templates work.
- **Conditions and actions:** state, numeric state, template, time, trigger and and/or/not conditions; service
  calls on helpers, lights, switches, covers, locks, climate, timers, counters, selects and more; scripts,
  `choose`, `if`, `repeat`, `parallel`, `variables`, `wait_template`, `wait_for_trigger`, `stop`, `mqtt.publish`;
  run modes (single, restart, queued, parallel). One change that leads to more than 2,000 steps is stopped as a
  loop.
- **What it can't know, it asks:** a sun, zone or device condition, or a template Home Assistant couldn't render.
  Notifications, TTS and log messages are listed as messages; any other call it doesn't know the effect of is
  listed as one it would make.

### Top to bottom

- The **Auto-arrange** button opens a menu: Auto-arrange, Flow left to right, Flow top to bottom. Each function
  keeps its own direction; left to right stays the default.
- Top to bottom, what sets things off is at the top, arrows leave a box by its bottom edge and enter the next by
  its top, and the dots for connecting sit on those edges. The same rules hold both ways: arrows 16 px apart,
  none through a box, a hop at every crossing. Rows that would get too wide wrap: inputs move up a row and end
  points down a row.
- Switching direction lays the function out again and lets go of boxes kept in place, and says so. Undo puts
  the direction, the places and the kept boxes back.

### For contributors

- The test setup is in the repository: `sh tests/setup.sh all` builds a throwaway Home Assistant, the demo
  setup and the test tools; `sh tests/run-all.sh --e2e` runs every suite. A new suite checks the layout of large
  functions in both directions. GitHub runs all of it on every push. `CLAUDE.md` describes the code, the tests
  and the conventions.

## 0.6.2 (2026-11-17)

- Node-RED flows: the board no longer signs itself in to the Node-RED app. Before, when the app's page didn't
  answer, it asked the Supervisor for an ingress session and wrote that session's cookie itself. Now it reads
  the flows only once Home Assistant has let your browser in, which it does when you open Node-RED from the
  sidebar. Until then, the Key says so, with an **Open Node-RED** button that opens it in the board's drawer;
  closing the drawer reads the flows again.
- The flows last read are kept by the integration, so every board on every device (the phone app included)
  still shows them when Node-RED's page isn't open to it, marked "as of" the time they were read. A read on
  any device updates the others. What's kept is the summary the board draws from: group and tab names and the
  entity IDs they use, no flow code. A kept flow box opens Node-RED through Home Assistant's own page.
- Node-RED is still read only while Node-RED flows is switched on in the Key: when a function opens, and again
  when you close Node-RED in the drawer.

## 0.6.1 (2026-11-16)

- Every place two arrows cross without meeting now gets a hop. Before, a crossing within about 20 px of a turn,
  or closer than 14 px to another hop on the same line, was drawn without one (about 40% of crossings on a busy
  board). Crossings close together now share one wider arch, and a turn right beside a hop is drawn a little
  tighter to make room for it.

## 0.6.0 (2026-11-16)

New arrows and a new automatic layout.

- Arrows are coloured by what they do: orange for what sets something off, blue for what it changes, aqua for
  running a script. Checks stay grey dashed and template reads grey dotted. The colours were checked for colour
  blindness in both the light and the dark theme. The Key shows them.
- Arrows run square-cornered with rounder turns, always left to right: out of a box's right side, into the next
  one's left side, in lanes in the gaps between columns. One that goes back runs round the outside of the boxes.
- Each side of a box has three points, shown as small dots, where arrows leave and enter. Up to three arrows on a
  side each have a point of their own and their own line. More than three share the three points (split by kind
  and by where they go): the arrows at a point run as one line that branches, with a dot at each branch. Where two
  lines cross without meeting, one hops over the other, so a dot always means a branch and a hop a crossing.
- Each arrow on a shared line has a colour of its own (sixteen, used in turn across the function), on the dot
  where it branches off and on the point at its own end, ringed in the colour of its kind; where the shared line
  just splits, the dot is plain.
- Arrows running back (right to left) carry small arrowheads along the way, so their direction reads at a glance.
- In Full manager, drag from a box's right-hand point to another box to draw an arrow out of it, or from a
  left-hand point to draw one into it.
- A short step up or down in the middle of a level run is straightened out where that's clear.
- No two arrows run alongside each other closer than 16 px. The automatic layout widens each gap between
  columns to fit the arrows that turn in it, and a last pass moves any run that is still too close to the nearest
  clear spot.
- Boxes line up with what they connect to, so a chain runs straight across instead of zigzagging.
- Separate chains in one function are laid out on their own and packed together, the big one first, the others
  beside or under it, instead of being spread through one set of columns with gaps between.
- A function too wide for a screen folds into rows, cut where the fewest arrows cross.
- Arrows > Style > Curved arrows brings back the curved arrows, which take the shortest way between facing sides.
- Arrange is now Auto-arrange: one click lays the function out automatically, for functions you made as well as
  imported ones, boxes you moved by hand included, and Undo puts your own arrangement back. It no longer asks
  first.
- Keep in place, in a box's bar, leaves that box where it is through Auto-arrange (it shows a pin); the rest is
  laid out together, clear of the kept boxes. Let Auto-arrange move it takes the pin off.
- An import runs Auto-arrange on each function it makes or adds to, so new pieces don't land in odd places; boxes
  kept in place stay put.
- Moving a box by hand keeps all the others where they are from then on, until Auto-arrange. Before, the boxes
  still placed automatically could shift round the one you moved.

## 0.5.5 (2026-11-16)

- Nothing changes in the board. The Marketplace (HACS) checks now run in full, with nothing skipped, which the
  Marketplace's default list requires; this is the release made after that clean run.

## 0.5.4 (2026-11-15)

- Phone app: Edit, Traces, new automations, scripts, scenes and helpers, and a device's page open Home Assistant's
  own page full screen instead of in the drawer, where the app's sign-in can't reach and the editors never loaded.
  The app's Back and the editor's own back arrow return to the board, and anything created there still joins the
  function.
- Coming back to the board from an editor is quicker: the new board draws with the registries and trigger and
  condition descriptions the last one loaded, then checks the registries again behind the scenes and redraws
  only if something changed while it was away.
- Touch: a box, frame or note moves only after it has been held still for a second; it lifts to show it's picked
  up. A finger that moves sooner pans the board, so swiping across boxes no longer drags them.

## 0.5.3 (2026-11-15)

- A box's bar wraps onto a second line when it doesn't fit beside an open drawer or on a narrow screen, instead
  of running under the drawer.
- Debugger: Clear keeps what happened before it out of the list, also when the runs are read again.
- README: a tour with screenshots of the board, menus, debugger, tests and the arrow editor, and credits.
  `tests/e2e/screens.js` takes the screenshots on the test setup.

## 0.5.2 (2026-11-15)

- Helpers and scenes have Edit in their bar, like automations and scripts: a helper opens on its settings (where
  its options are, and a template helper's template), a scene in the scene editor. Double-click and Enter do
  the same. Something set up in YAML without a unique ID says why it can't be edited from the UI.

## 0.5.1 (2026-11-15)

Ready for translations, and one false loop fewer.

- Every text the board shows is in one table, `STR.en`, keyed by id. A translation is one more table named by
  Home Assistant's language code; ids it leaves out stay English, and `pt-BR` falls back to `pt`. Counts take the
  plural forms the language needs. The board follows the user's language, also when it changes while the page
  is open. A table can be tried from the browser console before it goes into the file.
- An automation that turns a light off when its brightness crosses a threshold is no longer marked as a loop:
  a light that is off has no brightness, so turning it off can't fire the trigger again.
- README: the Full manager, the developer tools, Node-RED, the card option and what the arrows follow now.

## 0.5.0 (2026-11-15)

Developer tools on the board, an arrow editor and Node-RED flows.

- Test (Full manager): a helper changes through its own actions, any other entity gets a simulated state that
  stays marked until its device reports, events are fired with the data their trigger expects, automations
  run with or without their conditions, scripts with their fields, notifications are sent with their
  templates filled in. A test can be kept on the board as a button. The first test of a session asks first;
  every test is written to the logbook and can't be undone.
- Live checks: a tick or a cross on each check arrow says whether that condition passes right now. Hovering
  an arrow that comes from a template shows its value now.
- Watch triggers arms an automation's triggers without running it: its trigger arrows pulse whenever one
  would fire, even while it is off. Pause plus Watch is a dry run.
- Monitor boxes list the last 10 events of one type, or MQTT messages on a topic, while the function is open.
- Debug panel: what happened to the function in the last 15 minutes and from now on (the logbook, the action
  history and the traces), with what caused each step. Picking a step lights the chain that led to it, one
  step at a time. Selecting an automation says why it did or didn't run, down to the condition that failed.
- A run from the Runs list or the debugger lights the arrows it actually used, with its trace in a bar.
- Notification boxes: Messages lists what they sent lately, from the traces.
- Arrow editor (Full manager): drag from a box's handle onto another box to add a trigger, a check, an
  action or a script call, chosen from Home Assistant's own lists, with the YAML shown and checked before it
  is saved. Click an arrow to remove what it stands for. Every change is on the undo stack.
- Node-RED flows (off until switched on in the Key): each wired group in a flow tab is a box wired to the
  pieces it triggers on, reads, changes and runs. Read in the browser; nothing is stored.
- Keyboard and screen readers: boxes are named buttons that say what they are wired to, the arrow keys move
  along the arrows, dialogs keep the focus.
- Trigger-based template sensors show what they read.

## 0.4.0 (2026-11-15)

A full manager, more of the wiring, and arrow tools.

- Storage: one layout per write with a revision each, so two boards editing different functions never
  overwrite each other; saves no longer go into the recorder database. Store version 1.2 (v0.3 still loads it).
- Integration options: Organise only (default) or Full manager, and a switch that makes the board
  available as a dashboard card without adding a resource by hand. The page's address carries a hash of the
  board file, so browsers always load the current one.
- Full manager: Delete function, Delete function and its items, and Delete on a box (automations, scripts,
  scenes, helpers made in the UI, helpers set up by integrations), with a second step listing what goes and
  what still uses it. Undo brings back everything except helpers set up by integrations.
- Arrows for area, floor and label targets, purpose-specific triggers (light.turned_on, door.opened...),
  what template and other derived helpers read, scenes and groups, notification buttons and the automations
  that answer them. Loop detection understands all of these and no longer flags setting the state that
  triggered you.
- Arrows menu: highlight modes (chain, upstream, downstream, both, with a reach of 1 to 6 arrows) and filters
  per arrow type. Arrows attach to the facing sides of their boxes, spread out, and route around boxes.
- Each function has its own address; Back and reload work. Find anything from the top of the list.
- Import shows what is left over and how much is covered; optionally joins automations that meet at a device.
- Unwired pieces say why; new boxes appear next to their most connected neighbour.
- Diagnostics download; backend unit tests; end-to-end tests in the repo.

## 0.3.1 (2026-11-15)

Fixes from the first week on a real setup, plus undo.

- Pause remembers which automations were on; Resume turns only those back on. Resume shows while the
  function is paused, even if one was switched back on by hand.
- Running boxes keep their shape (their class clashed with the Runs list rows).
- Existing always adds to the function on screen, names it on the Add button, and doesn't jump away.
- Items made in the editor drawer keep the function's label after Home Assistant's save dialog rewrites
  labels and categories, and show near the middle of the board.
- Saving an automation or script redraws its arrows at once.
- "Take off the board" is now Hide from board. Creating a function with a name that's taken explains why and
  offers to put the hidden function back with its layout.
- Helper opens a menu of helper types (and Scene); each opens Home Assistant's create dialog directly.
- Undo and redo (Ctrl+Z, Ctrl+Shift+Z, toolbar) for moves, Arrange, frames, notes, adding and removing items,
  imports, new functions, hiding, Pause and Resume. Toasts offer Undo.
- Import skips pieces without a unique ID (YAML automations without id:), says why, and still finishes.
- Fit zooms out to show a wide system whole on a second press; the action bar stays on screen.
- On a phone, leaving the page no longer leaves the board re-fitting itself in the background.
- Stored colours, ids and positions are checked before they reach the page; layouts of deleted labels are
  pruned; a change made just before leaving is saved.

## 0.3.0 (2026-11-14)

First version as a Home Assistant integration: a Functions page in the sidebar, layouts shared between
administrators, an import manager that finds the functions already in a setup, live states and runs.
