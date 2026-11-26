# Changelog

Each release of `@yuneta/gobj-ui` reaches this app through gobj-ui's deploy
round, which raises the range and the third number of the app's version, and
builds, tests and deploys it; the line of each round is written here after it.

## 1.0.43 — 2026-11-26

- gobj-ui `^7.32.9`. The icons of a window's title bar (the title's, minimize, maximize,
  close) and of a dialog's header (back, close) are 20px, the size of the toolbar icons.
  No header changes its height.

## 1.0.42 — 2026-11-26

- gobj-ui `^7.32.8`. The icons of the menu entries and of the tabs are 20px, the size of the
  toolbar icons. They took the 16px of their text. No row changes its height.

## 1.0.41 — 2026-11-25

- gobj-ui `^7.32.6`. Every icon is 1em tall: the language, theme, bug and site map icons of
  the bar were drawn smaller than the square ones, and now have the height of the others.
  The paginator of a table takes one line on a phone. This app has no table.

## 1.0.40 — 2026-11-25

- gobj-ui `^7.32.5`. The row count of a table takes the plural of its number. This app has
  no table, so nothing changes on its pages.

## 1.0.39 — 2026-11-25

- gobj-ui `^7.32.4`. A table rule for the admin views (a filter on every column, the
  paginator always, the toolbar in one row), and the module `yui_table_standard.js` that
  applies it. This app has no table, so nothing changes on its pages.

## 1.0.38 — 2026-11-24

- gobj-ui `^7.32.0` 7.32.0. The treedb topics view shows the topics in alphabetical order:
  the cards, the tabs and the site map. The system topics (`__*__`) come first. Up to
  7.31.8 it used the order of the `descs` answer, which changes from one load to the next.
  No change of code here. Tests green, deployed.

## 1.0.37 — 2026-11-22

- gobj-ui `^7.31.8` 7.31.8. `fmt_date_time()` keeps one formatter for each language and zone. One key
  typed in the filter of a table of 10 000 rows took 350 ms, and now takes 16 ms. A click on
  an edge of the JSON graph draws only that edge and its two cards. Also `@yuneta/gobj-js` `^7.31.0`, i18next `^27.2.3` and playwright `^1.65.1`. No change of
  code here. Tests green, deployed.

## 1.0.36 — 2026-11-21

- "Add folder" with the folder that is waiting for its permission takes the place of the
  waiting one. Before, it first compared the new folder with the stored ones
  (`isSameEntry`, `resolve`) without a time limit. On a browser that does not answer the
  stored handle, the app waited for ever after the user chose "Allow". Those comparisons
  now have a 4 s limit. If a waiting folder has the same name, the app re-binds it, unless
  the old handle says outright that it is another folder. Nothing is added twice.
- "Choose again" accepts the folder when its name matches. `isSameEntry` goes to the
  Session log only, and the app does not wait for it. Before, a stored handle that answered
  "not the same" for its own folder gave the notice that the user chose the wrong folder,
  and a handle that did not answer cost 4 s.
- The player also shows the notice for a wrong folder (`VID_WRONGBAR`, `EV_DISMISS_NOTICE`
  in `C_VID_DECK`). "Choose again" is on the player, and from there the notice in Sources
  was not visible.
- `permhang` Act 4: "Add folder" with the waiting folder, with `isSameEntry` and `resolve`
  not answering. On 1.0.35 it is red. Same change as yunomúsica 2.37.31.

## 1.0.35 — 2026-11-21

- On the same phone, the "Authorise" button did nothing: Chrome 158 does not answer
  `requestPermission` either. The folder picker still works, and the folder it returns
  comes with its read permission. So when `queryPermission` gets no answer, the bar and the
  folder's row in Sources offer "Choose again" in place of "Authorise". "Choose again" opens
  the picker. If you choose the same folder, its new handle takes the place of the stored
  one. The source keeps its videos, the lists that hold them, their counts and their
  places. Removing the folder and adding it again loses the counts and the places.
- The app accepts the chosen folder only if its name matches, and if the old handle says it
  is the same entry (`isSameEntry`, 4 s limit, the name decides without an answer). A
  different folder changes nothing, and Sources says which folder to choose.
- The bar names one folder at a time, because the picker returns one folder.
- `EV_REPICK` in `C_VID_SOURCES` and `C_VID_DECK`. The action runs inside the click, so the
  picker still has the user gesture.
- The Session log records `repick` and a `requestPermission` that gives no answer in 10 s.
- `permhang` covers "Choose again" with the same folder and with a wrong one. Same change as
  yunomúsica 2.37.30.

## 1.0.34 — 2026-11-21

- A folder whose permission check gets no answer no longer stops the app. On a phone,
  Sources showed no folders, the "authorise" bar did not come up, and Diagnostics stayed
  empty. yunomúsica did the same. That is what a `queryPermission()` that never settles
  does: the start-up waited for it, and Diagnostics waited for it too. Diagnostics on the
  phone confirms the cause: Chrome 158 on Android 10, app installed, `queryPermission: no
  answer in 4 s`, and `storage.persisted` answers. Each browser call that touches a folder now has a time limit: 4 s
  for `queryPermission`, `storage.persisted` and `storage.estimate`, and 10 s to get a file.
  If `queryPermission` does not answer, the folder goes on the "authorise" bar. Its button
  asks with `requestPermission`, which is a different call. The app now checks all folders
  at the same time, so one folder cannot hold back the others.
- If the browser says "granted" and then refuses the read (`NotAllowedError`), the folder
  goes on the "authorise" bar. Before, the player did nothing and showed no message.
- Diagnostics shows each line as soon as it has it, so a slow check is on the screen by
  name. A new line, `handle permissions`, tells if `queryPermission` and
  `requestPermission` exist. The source line tells when `queryPermission` did not answer.
  The Session log records `perm_hang`, `perm_lost` and the answer to the "authorise" button.
- New test `permhang`, the same as in yunomúsica 2.37.29.

## 1.0.33 — 2026-11-20

- gobj-ui `^7.31.7`: new icon `yi-qrcode` (the QR code of Font Awesome Free). No change
  of code. Tests green, deployed.

## 1.0.32 — 2026-11-17

- gobj-ui `^7.31.6`: the treedb admin views show each topic by its own name, untranslated
  (tab, card, info title, the linked-topic choice dialog, the parent-filter chip). Those five
  places translated it and the rest did not, so a `places` shown as "sitios" read as the topic
  `sites`. No change of code. Tests green, deployed.

## 1.0.31 — 2026-11-16

- gobj-ui `^7.31.5`: the JSON graph (`C_YUI_JSON_GRAPH`) lights an edge on a click (the
  line, its two cards and the row of the key it leaves from), has a minimap from 10
  cards and zooms out to 2% (10% before, where a large document did not fit). No change
  of code. Tests green, deployed.

## 1.0.30 — 2026-11-16

- gobj-ui `^7.31.4`: the treedb graph draws its edges at their width before 7.31.3 (1.6px,
  2px for a tree link) and keeps only the wider click area, not drawn. No change of code.
  Tests green, deployed.

## 1.0.29 — 2026-11-16

- gobj-ui `^7.31.3`: in the schema graph and the treedb graph the edges are drawn wider
  (2px; 4px lit) and take a click some 7px either side of the line, where they were hard
  to hit. No change of code. Tests green, deployed.

## 1.0.28 — 2026-11-16

- gobj-ui `^7.31.2`: in the treedb graph and the schema graph a click on an edge lights it
  and its two ends; the schema graph always has a minimap, and the treedb graph shows one
  from 10 nodes. No change of code. Tests green, deployed.

## 1.0.27 — 2026-11-13

- gobj-ui `^7.31.0` (its peer floors: i18next 27, vanilla-jsoneditor 3.13.1), gobj-js
  `^7.30.0`, `i18next` `^27.1.1`, and the tooling (vite 8.3.8, playwright 1.65). The lockfile
  carries `fast-uri` 3.1.9, out of its advisory. i18next 27 changes defaults this app does not
  rely on (it sets `fallbackLng: "en"`). No change of code. Tests green, deployed, clean console.

## 1.0.26 — 2026-11-12

- **The queue is always in reach at 100% zoom.** On a short screen (a
  laptop's window, a phone) the picture and the transport took nearly all of
  the Player screen and the queue, which scrolled only inside what was left,
  got sixteen pixels: not one row could be reached. The queue now keeps a
  floor of its own (20rem) and the whole screen scrolls instead; where there is
  room for both, nothing changes. New test: `queuereach`.

## 1.0.25 — 2026-11-12

- Tests: the phone-sized ones (`fitmobile`) hung in `setFiles`. Chrome
  does not open a file dialog in a window under 400x300: it cancels the
  input and logs that it suppressed the chooser. `add_source` widens the
  window to 400 for the pick and puts it back. No change to the app.

## 1.0.24 — 2026-11-12

- **Adding a source no longer cues it on the deck**, not even an empty one:
  it stays in Sources and the Library, and what goes to the player is the
  user's call (Sources' *Add to queue*, the Library, a list).
- **The player's controls are never below the fold.** The picture was capped at
  `56vh`, which ignored the toolbar above and the icon-bar below: on a short
  window the transport ended up under the bar and the browser had to be zoomed
  out to reach it. The centre zone is now a size container, the player is
  capped at the height the zone has, and the picture is what shrinks
  (`min-height: 7rem`); the scrub bar and the transport keep theirs.
- **Lists**: the saved lists are boxes, as in yunomúsica — the name (with its
  chevron) unfolds it, *Play*, *Add to queue* and *Delete* with their words
  beside it. *Continue watching* is gone, with its "forget every place": every
  video and every saved list already comes back where it was left. Five keys
  left the ten catalogues.
- Tests: `cue_source()` puts a source on the deck the way a user does; e2e
  checks that adding one leaves the deck empty and navigates nowhere;
  `resume` reads the place off the library row. `fitmobile` still times out in
  `setFiles` (folder picker under mobile emulation) — it does on 1.0.23 too.

## 1.0.23 — 2026-10-25

- gobj-ui `^7.28.1`: a chart's Y axis is as wide as its labels (uPlot's fixed
  50px cut every value past five digits). This app draws no chart, so its
  bundle does not change in behaviour. Deployed on yunovideo.com, console clean.

## 1.0.22 — 2026-10-25

- **`licenses.txt` beside the bundle**, written at build time by gobj-ui
  7.28.0's `yunetaLicensesPlugin`: the license of every package with code in
  the bundle, with the Font Awesome attribution (CC BY 4.0) that minifying
  dropped. Served at `/licenses.txt`. gobj-js `^7.28.0` (`jwtDecode()` /
  `jwt2json()` removed, unused here) and gobj-ui `^7.28.0`.
  Deployed on yunovideo.com, `licenses.txt` read back.

## 1.0.21 — 2026-10-22

- tabulator-tables 6.7.1 in the lockfile (through gobj-ui): 1.0.20 said so and still carried 6.7.0, because gobj-ui's peer range was already met and `npm install` left it. Tabulator 6.7.1 fixes Enter moving two rows with `selectableRange` (not used). Tests pass; deployed; serves the new bundle, console clean.

## 1.0.20 — 2026-10-22

- i18next `^26.5.6` (range caught up within its major; tabulator-tables stayed at 6.7.0 in the lockfile, see the next version). Nothing the app uses changes: i18next 26.5.5/26.5.6 deep-copies the store of `cloneInstance({forkResourceStore: true})` and keeps literal a `{{placeholder}}` inside an unescaped `{{- var}}` value; neither is used. `npm audit` clean; 12 of 12 tests pass. Deployed; serves the new bundle, console clean.

## 1.0.19 — 2026-10-22

- gobj-ui `^7.27.34` (deploy round): the gobj tree's gclass viewer no longer stays locked when a newer trace set overtakes its read. No code change in this app.

## 1.0.18 — 2026-10-22

- gobj-ui `^7.27.33` (deploy round): an element looked up by a name that comes from data no longer goes through a CSS selector; the schema graph applies the drag patch. No code change in this app.

## 1.0.17 — 2026-10-22

- gobj-ui `^7.27.32` (deploy round): G6's built-in behaviors are replaced without the two "has been registered before" console warnings. No code change in this app. Console clean on load.

## 1.0.16 — 2026-10-22

- gobj-ui `^7.27.31` (deploy round): review fixes in the library (a gclass viewer reopened during a trace set opens locked; a `C_YUI_NODE` tree ignores a route of another stage). No code change in this app.

## 1.0.15 — 2026-10-22

- gobj-ui `^7.27.30` (deploy round): review fixes in the library (a `keep_alive` tree tells its content once, the gobj tree's camera at any zoom, the gclass viewer). No code change in this app. Console clean.

## 1.0.14 — 2026-10-21

- gobj-ui `^7.27.29` (deploy round): the library adds `C_YUI_UPDATE_WATCH`, "a new version is available"; this app keeps its own notice. `deploy_yunovideo.sh` uploads with `rsync --delete-after --delay-updates`, so a page loaded during the upload never gets an `index.html` whose chunks are not there yet. Console clean.

## 1.0.13 — 2026-10-21

- i18next `^26.5.4`, vite `^8.3.5` (ranges caught up within their majors; tabulator-tables 6.7.0 in the lockfile, through gobj-ui). Nothing the app uses changes: i18next 26.5.4 keeps a `{{placeholder}}` that arrives inside an interpolated value literal; vite 8.3.5 is a build and dev-server patch. `npm audit` clean; 12 of 12 tests pass. Console clean.

## 1.0.12 — 2026-10-19

- gobj-ui `^7.27.28` (deploy round): the trace notes of the gobj tree say what the yuno keeps (SDK 7.27.3): a service's traces survive a restart, any other gobj's end with the yuno. 12 of 12 tests pass inside the round; console clean.

## 1.0.11 — 2026-10-19

- gobj-ui `^7.27.27` (deploy round): in the gobj tree of the Developer window each trace scope is set where it belongs (a card: this gobj; the gclass viewer: every gobj of the gclass; *traces of the yuno*: the whole yuno), and the gclass viewer lays itself out by its own width, short zones first. 12 of 12 tests pass inside the round; console clean.

## 1.0.10 — 2026-10-19

- gobj-ui `^7.27.26` (deploy round): the gobj tree of the Developer window has a minimap from 20 cards on, and a running gobj with nothing to play (no `mt_play` or `mt_pause` in its gclass) reads `● running`, not `‖ running (paused)`. 12 of 12 tests pass inside the round; console clean.

## 1.0.9 — 2026-10-19

- Deploy round: the ranges of `package.json` caught up with what was installed (`ncu -u`): `npm update` had left them behind. Same code as the deployed bundle; the bundle carries `package.json`, so it is a new one. 12 of 12 tests pass.

## 1.0.8 — 2026-10-19

- gobj-ui `^7.27.25` (deploy round, the first one with yunovídeo on its
  list). 12 of 12 tests pass inside the round. `npm audit`: 0
  vulnerabilities.

## 1.0.7 — 2026-10-19

- gobj-ui `^7.27.23`. The Developer window has a **Line** view of the
  traffic again; its two new keys are added in the ten languages.
- `npm test -- offline` fixed (tests only, same app). It failed on 1.0.6
  too: after the network is cut, this Playwright Chromium reports
  `navigator.onLine === true` for any document loaded afterwards (reload,
  goto or a new page), so `update_check.js` asked for `version.json` and
  Chrome logged the failed load. The test now makes the page say what a
  browser on a plane says (`false`) and checks it. Removing the app's guard
  still fails the test (checked by mutation). 12 of 12 pass.

## 1.0.6 — 2026-10-18

- A size and its unit are separated by a real space ("740 MB", "1.23 Go"):
  the gap was drawn by CSS, so the text read, copied and heard was "740MB".

## 1.0.5 — 2026-10-18

- `package-lock.json` is committed: it was ignored, so two builds of the same
  commit could get different libraries within the `^` ranges.
- The chunk size warning is set to 700 kB instead of 9000 (which silenced it):
  today's bundle is ~530 kB, and the warning speaks if it grows by a third.

## 1.0.4 — 2026-10-18

- **What happens outside the machine is no blind spot.** The stores are plain
  modules close to the browser, and some of what they do never crosses an
  automaton: the calls the gobjs make to them, the channels they emit, the
  browser callbacks they answer directly (the video element, a write timer,
  the thumbnails' observer, the file picker, the black box). All of it is
  now a line of the trace under the root's user level `stores` (the clock,
  four a second, under `stores-time`), switched from the developer sheet's
  Traces tab and kept across launches by the yuno (`set-gclass-trace
  gclass_name=C_YUNOVIDEO level=stores`). Off, a call costs a bit test.
- **The dialogs answer through the machine**: welcome/help, install, the
  replace question and the developer sheet send `EV_DIALOG` to the gobj that
  opened them, and its action answers (the replace question no longer
  resolves a promise from its button). Late answers — the traces panel
  loaded, the clipboard done, the browser's install offer — are events too.
- **The questions are states**: "Empty the queue?" and the list name being
  typed (player), "Forget every…?" / "Delete this list?" (lists) and "Remove
  this source?" (sources). Their yes and no exist only in that state, so one
  arriving at any other moment fails loudly.
- "Take a heart back" has its own icon, a broken heart.
- Nothing animates: the scan ring is still, and a read with no total yet is
  a hatched bar; the ticking clock beside it says the read is alive.
- Sizes say their unit in the language in force ("Go", "ГБ").
- The diagnostics' "not video" line counts what a pick left out again (it
  always said "none"); the file picker offers every extension the app reads
  (.ts, .mts, .m2ts, .wmv, .flv…); the service worker precaches from the
  server, never from the HTTP cache; a first deploy to a new host no longer
  stops at the backup.
- Tests: `dialogs` and `trace` (new).

## 1.0.3 — 2026-10-18

- **A rescan leaves the queue as it was.** It used to take that source's
  videos off the queue, stop the one playing and, the queue left empty,
  pour the whole folder onto it in walk order. Now the queue keeps its
  videos, order and place, playing on; only what left the folder leaves it.
- **Every row's buttons are named by the row** for a screen reader — "Play
  Arrival", "Open folder Season 1", "Rescan Films" — instead of the same
  "Play" or "Open the card" two thousand times. The control is labelled by
  itself and by the row's text (`aria-labelledby`), as gobj-ui names a
  control with its badge, so it changes language with everything else.
- **The card's counts agree with their figure**: "1 view", "1 Heart",
  "2 просмотра", in the ten languages.
- **Fullscreen on an iPhone** goes to the system player (the only
  fullscreen it has for a video); where there is none the button is hidden.
- **The library no longer gets stuck** in a source that was removed while
  it was open there.
- **What the video element says enters the machine**: its metadata, ready,
  end and error, the system's media keys (headset, lock screen), the root's
  timers and the accent picture's load are all events now, answered in an
  action — the machine trace shows them. The end of a video is counted in
  the stats before the next one loads, in that order, by the action.
- **No silent failures**: play() refusals, fullscreen/PiP refusals, seeks,
  subtitle reads, permission queries, the folder picker, a scan that threw,
  the diagnostics and the replace question are all logged. An IndexedDB
  write now answers when its transaction completes, so a quota refusal is a
  failure and not a success; opening the database and its failures are
  logged. The developer sheet's Copy no longer sticks on "Copied", and says
  when the copy failed.
- Tests: `rescan` (new, in node), `names_dom` (row names, in Spanish),
  `focus` (the card's singular).

## 1.0.2 — 2026-10-18

- **No screen rebuilds itself while a video plays.** The stats move every
  few seconds then, and the library, the lists and the card were rebuilt
  whole for each move — the library and the lists even while hidden. That
  took the focus from rows and buttons, sent the library's scroll back to
  the top, and kept every old row alive waiting for a picture never made
  (memory that grew for as long as a film played). Now a hidden screen
  draws nothing until it is shown; on screen, the facts and the watched
  bar are written into the rows already there, and the lists rebuild only
  when the numbers change which rows they hold. The card keeps the focus
  on the button pressed, and its updates go through the opener's machine.
  Sources writes a folder read's progress in place instead of rebuilding
  every ~120 ms. Boxes waiting for a picture that left the page are let go.
- **"Cannot play here" only when the browser says so.** A thumbnail read
  that timed out or failed for any reason but "no decoder" (code 4) was
  stored as unplayable for good; now it is tried again later and never
  stored, and a video seen playing loses the mark. Removing a source stops
  its pending reads, which stored orphan rows.
- **Names**: an underscore no longer keeps a dotted name's dots
  (`The.Expanse_S02E05`); release tags that are words (`Proper`, `Internal`,
  `Multi`…) are cut only in the tail; a bare number ending a name with
  spaces (`Death Race 2000`) or a year to come (`Blade Runner 2049`) stays
  in the title; `DDP5.1x264` is not episode 264; `S01E01-E02`; subtitles
  pair case-insensitively and with `_` / `-` (`movie.en`, `Movie_es`); a
  small `.ts` is TypeScript.
- **Subtitles**: UTF-16 files (Notepad's "Unicode") are read; short hours
  and milliseconds are padded to valid WebVTT; a line of spaces ends a cue;
  two reads of the same video's subtitles no longer leave orphan tracks.
- **Texts**: names with `&`, `<` or quotes are no longer HTML-escaped in
  notices; music leftovers in es, ja, pt, hi, ru, fr, de, zh, ar (曲,
  "sonaba", "no encontrada", "silent for"…).
- Tests: `names` (the cases above), `focus` (library, card, hidden, scroll).

## 1.0.1 — 2026-10-18

- **Saving the queue as a list while a video plays keeps the focus in the
  name box.** The stats move every few seconds then (a view counted, the
  place written), and the queue was rebuilt whole for each of them, so the
  box lost the focus mid-word and the keyboard closed on a phone. The stats
  and the pictures now write the facts and the watched bar into the rows
  that are there. New test: `focus`.

## 1.0.0 — 2026-10-18

First version: yunomúsica's philosophy, for video.

- **Player**: one `<video>` element, docked in the player's stage and moved
  into the strip on every other screen, where it goes on playing. Scrub bar
  with the clock inside, ±10 s, speed, subtitles, mute, picture-in-picture,
  fullscreen of the whole player block, keyboard, `MediaSession`.
- **Every video remembers where it was left**, written every ten seconds while
  it plays, and starts there next time with a "start over" beside it.
  *Continue watching* lists them, by name.
- **Library**: folders as on the disk, series grouped by show and season from
  the file names, all; search.
- **Pictures**: one frame per video, made when its row is first on screen, kept
  in IndexedDB with its duration; a file this browser cannot decode is said to
  be so on its row.
- **Subtitles** read from the `.srt` / `.vtt` beside each video, converted to
  WebVTT, UTF-8 or windows-1252.
- **Two lists**: the queue (saved lists, edited or not) and the temporary list
  the library plays, with the way back on the strip.
- **Lists**: continue watching, saved lists, loved, most watched — views, hearts
  and places erasable from each video's card.
- **Sources**: folders and loose files, nothing added twice, rescan, look
  inside, diagnostics; nothing copied, nothing uploaded.
- Ten languages, seven palettes (the default takes the accent from the picture,
  measured for contrast), light and dark, right-to-left.
- Installable PWA that works offline; new-version notice; the black box and
  the developer sheet.
- Tests: names, locales, e2e, resume, templist, names_dom, fitmobile, offline.
