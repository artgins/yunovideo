# Changelog

Each release of `@yuneta/gobj-ui` reaches this app through gobj-ui's deploy
round, which raises the range and the third number of the app's version, and
builds, tests and deploys it; the line of each round is written here after it.

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
