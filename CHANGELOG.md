# Changelog

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
