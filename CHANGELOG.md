# Changelog

Each release of `@yuneta/gobj-ui` reaches this app through gobj-ui's deploy
round, which raises the range and the third number of the app's version, and
builds, tests and deploys it; the line of each round is written here after it.

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
