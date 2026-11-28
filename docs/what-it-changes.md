# What it changes in your Home Assistant, and privacy

Back to the [README](../README.md) or the [guide](guide.md).

## What it changes

Read this before installing. The integration starts in **Organise only** mode:

- Creating a function creates a **label**. When importing, it also files pieces that don't have a category under a **category** with the function's name (you can untick this).
- Adding or removing a piece adds or removes that label. Items keep their other labels and stay where they are.
- **Pause** and **Resume** turn the function's automations off and on, and **Turn off** on a quiet automation in the problems list turns that one off (Undo turns it back on).
- It **never edits or deletes** automations, scripts, helpers or devices. All editing happens in Home Assistant's own editors.

**Full manager**, an option in the integration's settings, also lets the board:

- **Delete** a function (its label and layout), a function together with its automations, scripts and helpers, or a single item, after a second step that lists what goes and what still uses it. Devices are never deleted. Deleting a function with its items never deletes what's shared: a piece also in another function, used by something outside this one (an automation, script, group, helper or Node-RED flow), or set up together with something outside it stays where it is and only leaves the function.
- **Edit the wiring:** adding or removing an arrow rewrites that automation's or script's config the way Home Assistant's own editor does, so `automations.yaml` and `scripts.yaml` are rewritten and YAML comments in them are lost.
- **Run tests,** which change your home for real: whatever reacts to the change runs. The first test of a session asks first, and every test is written to the logbook.
- **Delete a saved version, with what only it has** (Full manager, ticked one by one, unticked to start): an automation, script or helper the version holds that's still in Home Assistant but in no function, no other version, and used by nothing else, deleted through Home Assistant's own APIs.
- **Save a notification** from the notification builder: the script it makes is written through Home Assistant's own config API (so `scripts.yaml` is rewritten) and added to the function. Saving it again writes over the same script; Undo puts it back as it was, or deletes it if it was new.
- **Save from Template Studio or a recipe**: a template helper is made through Home Assistant's own helper setup (a Template helper, as under **Settings → Devices & services → Helpers**), an automation recipe through its config API (so `automations.yaml` is rewritten), and either is added to the function. Saving again writes over the same one; Undo takes it back.
- **Make a saved version active**: its automations' and scripts' configs and its UI helpers' settings are written back through Home Assistant's own config APIs (so `automations.yaml` and `scripts.yaml` are rewritten), items it had get the function's label again, and for each automation, script or helper added since you choose per item whether to turn it off (automations), remove it from the function while leaving it on/as is, or delete it (other items added since just lose the label). What was added since and is shared (also in another function, or used by something outside this one) is never turned off or deleted: it only loses the label. When what's written back is shared, the dialog warns that it changes there too. A dialog lists every change first, and saves what's there as a new version before anything is written when it isn't saved anywhere (unless you untick that). A device its steps used that's been replaced can be swapped for the new one in the same dialog. Items defined in YAML can't be written this way and are listed as such.

Every change is shown before it happens, and **Undo** takes it back, except tests and deleting a helper that an integration set up.

In either mode:

- The debugger, Watch triggers, monitor boxes, the live checks on arrows and the problems check only read. Watching a trigger never runs the automation.
- The sandbox only reads: your states once when it opens, and templates it asks Home Assistant to render. It never calls a service, fires an event or sets a state. Saved checks run in the board, in the sandbox, whenever the function changes while it's open.
- **Template Studio** only reads until you save: the templates it explains and the values you try are rendered by Home Assistant, pointed at a copy of your states as in the sandbox.
- **Where used**, **Compare** and the quiet automations list only read.
- **Share as YAML package** makes its file in your browser; nothing is sent anywhere. Names are swapped for stand-ins unless you untick that.
- **Versions:** saving one reads the function through Home Assistant's own APIs (configs, helper settings, members, the devices its steps use, its layout) and keeps the metadata in `.storage/functions_board.versions` with snapshots in `.storage/functions_board.versions.<hash>` (at most 50 per function, 1 MB each). Saving, renaming, deleting, opening a version in a tab and trying it in the sandbox change nothing in Home Assistant.
- **Show Node-RED flows** reads your Node-RED app's flows in your browser, through the app's page in Home Assistant, only while it's switched on. That page opens to the board once you've opened Node-RED from the sidebar (or with the board's **Open Node-RED** button); until then the board shows the flows last read on any device, marked with when. The integration keeps that summary (group and tab names and the entity IDs they use, no flow code) so every board shares it. The board never signs itself in to the app.
- The board's own data (which labels are functions, box positions, frames, notes and test buttons) is kept in `.storage/functions_board` and shared between administrators. Saved sandbox checks are kept in `.storage/functions_board.checks`, the Node-RED flow summary (when you use Node-RED flows) in `.storage/functions_board.nodered`, and saved versions in `.storage/functions_board.versions` (and `.storage/functions_board.versions.<hash>`). Your view (zoom, whether the list is open) is kept per user.
- Nothing leaves your Home Assistant: no network calls, no external libraries, no telemetry. See [Privacy](#privacy) for how that's tested.

Removing the integration takes the page out of the sidebar. Labels and categories stay; they are ordinary Home Assistant labels you can delete under **Settings → Areas, labels & zones → Labels**.

## Privacy

The board talks to your Home Assistant and nothing else, and what it keeps stays in Home Assistant's own storage (`.storage/functions_board*`). It has no network code of its own, adds no outside Python libraries (it uses only what comes with Home Assistant) and sends no telemetry. What other integrations do with data is up to them: if a test step or making a version active calls a cloud service, that's the service you chose.

**Diagnostics** are a file you download and decide what to do with. In the board's **About** dialog, **Diagnostics…** makes you choose every time, with nothing ticked to start with:

- **Anonymised:** names, IDs, addresses, keys and free text are replaced with stand-ins, the same one wherever a thing appears (`light.kitchen` is `light.e3` in the layout, the triggers and the templates alike), so the shape of the problem is still there.
- **With real names and IDs**, as they are in Home Assistant, with a reminder to look through the file before posting it anywhere public.

You can add a snapshot of the open function as it is now and any of its saved versions (each version in the Versions drawer has its own download button). Home Assistant's own **Download diagnostics** (Settings → Devices & services) can't ask, so it's always anonymised.

**How it's held to this.** Every push runs these checks, and each one has been shown to fail when its rule is broken:

- *The board's code:* no way to reach another computer (no WebSocket, XHR, beacons, workers or outside images, fonts or scripts); its one `fetch` (Node-RED's flows) must be a path on your Home Assistant; the only outside address is the project page, as a plain link; every message it sends Home Assistant is on a list, and the ones that act (pausing automations, a logbook note, your own test steps, the Supervisor only asked) are tied to their places.
- *The integration's Python:* no HTTP client, socket, mail, DNS or cloud module, and none of Home Assistant's web sessions; no packages to install.
- *With marker data* in every field: anonymised diagnostics hold none of it; the log never holds the board's notes, layouts or snapshots; the backend tests run with the network blocked.
- *On a real Home Assistant:* every request the board's page makes during a tour of everything it does goes to that Home Assistant; no connection or name lookup comes from the integration (each one is logged with the code behind it); the marker data is stored only in the integration's own files, never in `www/` (served without a login), the database or the log; nothing of it can be read without logging in, or by someone who isn't an administrator.
