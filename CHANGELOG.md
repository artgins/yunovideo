# Changelog

Each release of `@yuneta/gobj-ui` reaches this app through gobj-ui's deploy
round, which raises the range and the third number of the app's version, and
builds, tests and deploys it; the line of each round is written here after it.

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
