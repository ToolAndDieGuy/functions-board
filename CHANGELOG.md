# Changelog

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
