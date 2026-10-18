# yunovídeo

Live at [yunovideo.com](https://yunovideo.com). The version is the one in
`package.json`, and [`CHANGELOG.md`](CHANGELOG.md) says what each one changed.

A small, offline SPA for watching the videos already on your phone (or your
computer): films, series, clips, recordings. You authorise a folder, it is read
**here, on the device** — nothing is copied and nothing is uploaded — and every
video **remembers where you left it**.

It is [yunomúsica](https://github.com/artgins/yunomusica) for video, and it
keeps that app's philosophy whole: the device is the library, play is explicit,
the queue is yours, nothing leaves, the app says out loud what it does with your
disk, and it works on a plane. What is different is what a video needs that a
song did not: a picture, a place to come back to, subtitles, series.

Built with **Vite + Yuneta (`@yuneta/gobj-ui`)**: the declarative shell
`C_YUI_SHELL` + `C_YUI_NAV` provides the top bar and the menu (a side rail on
desktop, an icon bar at the bottom on mobile); the rest is five app gclasses and
four domain stores. Every DOM callback sends an event, and the work is done in
the FSM actions — the `machine` trace is the execution log.

## The four screens

**Player** (home) — the picture first: the one `<video>` element docked in a
16:9 stage, a scrub bar you can aim at (44 px, the clock inside it), and the
transport — previous, −10 s, play, +10 s, next, then speed, subtitles, mute,
picture-in-picture and fullscreen. Under the picture, the title and what the
name said about it. Then **the queue**: what you put on it, in the order you
want; whether it is a **saved list** (and whether you changed it since) or a
queue put together by hand. The player block does not scroll — only the queue
does. **Whole queue** folds the player away when you are working on the queue
rather than watching it.

**Lists** — *Continue watching* (every video left half-way), the lists you
saved, *Loved* and *Most watched*.

**Library** — three ways of looking at the same videos, with a search box:

| | |
|---|---|
| **Folders** | the disk as it is, one level at a time, with a breadcrumb that offers every rung back. Folders are where people *keep* videos — a camera's DCIM, "Pelis", a course in twelve parts — so this is the view that works for any library, and the one it opens on |
| **Series** | every file whose name says it is an episode, grouped by show and season, in episode order |
| **All** | everything, by title |

**Sources** — the authorised folders, and the only place videos are added from.
This is where the app says what it does with your disk.

## Play is explicit, and there are two lists

Browsing never changes what is on the deck. The same row everywhere:

- **the picture** is the play button — the biggest target on the row;
- **the name** opens the video's card: the whole title, the file name it was
  read from, folder, size, length, picture size, the subtitles found beside it,
  and its numbers. It is the one gesture that only looks;
- **＋** puts it in the queue, **♥** gives it a heart.

Pressing the picture of a row in the library plays the **temporary list**:
what is on the screen, in that order, from that row — a season from its third
episode, a folder, a search. The queue pauses where it was and nothing of it is
replaced, appended or reordered, so nothing is asked. The strip at the bottom
says that what is playing is not the queue, and **Back to the queue** gives it
back — playing only if it was playing when the temporary list took over.

**Play** on a saved list does replace the queue, so that, and only that, asks
first: add, replace, or cancel.

## Where you left it

A film is two hours long. Coming back to it at 0:00 is the one thing a video
player must not do, so **every video remembers the second it was left at** —
not every list, every *video*. It starts there next time, says *"Resumed where
you left it: 1:12:40"*, and offers **Start over** beside it. A video stopped in
its last minutes (5 %, at least 20 s, at most 3 min — the credits) counts as
finished and starts from the beginning.

The place is written **every ten seconds while a video plays**, and at every
pause, and when the page is hidden. Not only on the way out: a phone's system
reclaims a backgrounded app whenever it likes and nothing fires on the way —
yunomúsica learned that from a four-hour DJ set that came back at 0:00. So a
kill costs ten seconds at most. `tests/resume.mjs` reads the place off the disk
**while the first page is still running**, where only the periodic write can
have put it.

*Continue watching* is built from those places and is **sorted by name**, not
by when. Sorting by "most recent" would take a record of *when* each thing was
watched, and this app keeps none: a count and a place per video, shown on the
video, erasable from its card — the rule yunomúsica wrote after deleting its own
listening history.

## One element, that moves

There is **one `<video>` element** for the whole app. A second one would be a
second decoder and a second buffer of a film, on a phone. It is never thrown
away; it **moves**: into the player's stage while that screen shows, into the
strip's box everywhere else — so the film goes on playing, visibly, while you
look at the library. Moving a media element with `appendChild` does not stop
it: the spec pauses one that *leaves the document*, and a move never leaves
it. When no screen shows it, it waits in a 1 px box still inside the document.

The temporary list uses the same element: it loads its own video, and the way
back loads the queue's video again — at the second that video was left, because
every video keeps its own place.

## The pictures

A video file has no cover inside it, and a wall of grey rectangles is a poor
way to find a film. So one frame is taken: the file is opened on a hidden,
muted element, sought to a tenth of the way in (the first frame of most things
is black or a title card), drawn on a canvas and kept as a 320 px JPEG.

It is done the way yunomúsica reads a tag — **only when it has to be**:

- only for a row on screen (an `IntersectionObserver` asks), so a library of
  two thousand videos costs the twenty you can see;
- one at a time, newest request first, so the rows you just scrolled to fill in
  first;
- **once**: the frame goes into IndexedDB with what reading it taught —
  duration and picture size — and every later launch paints it from there
  without touching the file.

Reading a frame is also the first moment the app learns whether **this browser
can play the file at all**. A container is not a codec: an `.mkv` of H.264
plays in Chrome and an `.mkv` of HEVC may not, and the name says nothing about
which. A file the element refuses is remembered, and its row says *"Cannot play
here"* before anybody presses play and gets a black screen. Playing one says
which of the two failures it was: *could not be read* (the file moved) or *this
browser cannot play this video* (`MEDIA_ERR_SRC_NOT_SUPPORTED`: the file is
fine, the decoder is missing — try another browser). A rescan asks again.

The *From the picture* palette (the default) tints the accent with the dominant
colour of the frame of what is playing — and **measures** it: a colour lifted
to glow on near-black is a pale wash on a white page, so it is pushed away from
the page, keeping its hue, until it clears 3:1, and its ink is chosen by
contrast.

## Subtitles

Read from **beside the video**: a `.srt` or `.vtt` in the same folder whose name
starts with the video's — `Film.srt`, `Film.es.srt`, `Film.en.forced.srt` next
to `Film.mkv`. What follows the video's name is the label, and a language code
is shown as the language, in the language of the app (`es` reads *español* in
Spanish, *Spanish* in English). A video alone in its folder takes the subtitle
beside it whatever it is called.

Browsers read WebVTT only, so an `.srt` is converted on the way in. The harder
part is the **encoding**: an `.srt` declares none, and a great many were written
in a Windows code page. The bytes are tried as UTF-8 strictly and read as
windows-1252 when they are not, so "¿qué tal?" does not come out as "�qu� tal?".
The choice is remembered by label for the next video; never chosen, the
subtitles in the app's language are shown if there are any. `C` cycles them.

## Series

A file is an episode when its name says so — `The.Expanse.S02E05.Home.1080p.mkv`,
`Doctor Who - 3x07 - 42.mp4`, `Season 2 Episode 5` — or when it is numbered
inside a season folder (`Fargo/Season 1/04 - Eating the Blame.mkv`,
`Temporada 2/E03.mkv`). The show is the text before the code, or the nearest
folder that is not a season folder; the episode's title is what follows the
code, without the release noise (`1080p`, `WEB-DL`, `x264`, …). A film keeps its
year as a fact (`Arrival (2016)`), and a year that *is* the title (`1917`)
stays the title.

Shows are grouped on the normalised name, labelled with the spelling most of
their episodes carry, and drilled into by that id, never by the label. This is
all read from **names and folders only** — no file is opened to build the
library — and the guess is shown as one: the file name is always on the card
next to what it was read as. The guess is made again on every launch from the
stored path, so a better guess in a later build reaches a library nobody
rescanned.

## What is stored, and what is not

Files are **never copied and never uploaded**. In IndexedDB:

- the **sources**: a `FileSystemDirectoryHandle` per folder (Chromium; one click
  re-authorises it after a launch), or the `File` objects of a pick (every other
  engine: a snapshot, in chunks of 250 per record);
- what a scan learned per path (size, subtitles) — a launch restores the library
  **without walking a folder or opening a file**; a folder is walked when it is
  added and when you press Rescan;
- one **picture** per video, with its duration and size;
- per video: **views**, **hearts** and **the place** — no times, no order;
- the **lists** you saved, as `(source, path)` pairs;
- the **queue**, restored **paused** after a reload.

A snapshot keeps only the videos and subtitles of a pick: a phone's folder is
mostly photos.

## Languages and colours

Ten languages, all bundled: Spanish, English, Chinese, Hindi, Arabic,
Portuguese, Russian, Japanese, German and French. Arabic writes `dir="rtl"` and
the stylesheet mirrors itself through logical properties — **except the player**:
a film and its timeline do not mirror. Counts are plural keys resolved with
`t(key, {count})`, every CLDR category each language has. Every control carries
a translated `title` **and** `aria-label` with their keys, so a language switch
re-translates them in place (`tests/names_dom.mjs`).

Seven palettes — *from the picture*, gold, ice, rose, leaf, aurora, dusk —
carried over from yunomúsica with their measured contrasts; light and dark.

## Also

- **Keyboard**: space / K play-pause, ← → / J L ±10 s, F fullscreen, M mute,
  N / P next / previous, C subtitles. Ignored while typing.
- **Fullscreen** takes the whole player block, picture and controls, and asks
  for landscape on a phone when the video is wide.
- **Picture-in-picture**: also the honest answer to "can it play while I do
  something else?". What a browser does with a video whose page is hidden is
  its own call — Chrome on Android stops decoding the picture.
- **`MediaSession`**: system and headset controls, with the frame as artwork.
- **Speed**: 0.5× to 2×.
- **Installable PWA**, asked about by the app itself, once (Chrome only keeps
  folder permissions for installed apps) — see yunomúsica's "The install
  question" for why the browser's own banner is refused.
- **Offline means the plane**: a service worker precaches the shell, cache
  first; `version.json` is never cached.
- **New-version notice** from `version.json`; the reload waits for the queue to
  be written.
- **Diagnostics** in Sources, and a **black box** (`diag.js`, the *Developer*
  sheet in the "more" menu): heartbeat every 15 s with what was playing and
  where, page-lifecycle events, and on the next launch whether the last one
  ended or was ended.
- **Nothing is added twice**: the same folder, a folder inside one already in,
  or loose files already held are refused or trimmed, and said.

## Development

```bash
npm install      # bulma, i18next and @yuneta/{gobj-js,gobj-ui} from the npm registry
npm run dev      # http://localhost:5173
npm run build    # production bundle in ./dist (prebuild: validate-locales + check-markup)
npm run preview  # serves ./dist locally
```

The Yuneta libraries come from the npm registry, not from a checkout:
`vite.config.js` has no aliases. **The version is bumped on every change**; it
is baked into the bundle, served at `/version.json`, and shown in the help
dialog and the diagnostics.

## Tests

```bash
npm test                # the whole suite
npm test -- resume      # just the ones whose name matches
npm run fixtures        # build the video tree on its own (--force to rebuild)
```

Playwright against the **built bundle**, in the system's Chrome when there is
one (`CHROME_PATH`, default `/usr/bin/google-chrome`) and Playwright's Chromium
otherwise. The fixtures are **generated, not committed** (`tests/fixtures.mjs`,
~1.5 MB, needs `ffmpeg`): WebM (VP8 + Opus), because Playwright's Chromium
carries no H.264 — an `.mp4` would be the "cannot play here" case, which has a
fixture of its own (`broken.mkv`, not a video at all). The picture is ffmpeg's
test card, never black, so a thumbnail test cannot mistake a broken frame for a
good one; and one episode has a Spanish `.srt` beside it.

| Test | What breaks if it goes red |
|---|---|
| `names` | a file name is read as the wrong show, season, episode or year; a subtitle goes with the wrong video; an `.srt` loses its accents |
| `locales` | a translation drops a `{{placeholder}}`, is empty, or was never written |
| `e2e` | the whole walk: add, library in three views, pictures, the broken file said, a video playing with its subtitles, the video moving to the strip and going on, the queue saved, a reload, Arabic |
| `resume` | a video does not come back where it was left after the app is killed |
| `templist` | playing from the library touches the queue, or the way back does not give it back |
| `names_dom` | a control of the app has no `title` or `aria-label`, or they do not change language |
| `fitmobile` | something runs off the side of a 360 px phone, in German or Arabic |
| `offline` | with no network the app does not come up, or cannot play from the device |

Console errors fail the run.

## Deployment

`npm run build` leaves the static site in `./dist`; `deploy_yunovideo.sh` takes a
backup on the host and rsyncs `./dist/` to `yuneta@wattyzer:/yuneta/gui/yunovideo.com`,
then reads back `https://yunovideo.com/version.json`. There is no backend.

```bash
npm run build && ./deploy_yunovideo.sh
```

The vhost should serve `.webmanifest` as `application/manifest+json` and
revalidate `index.html` on every request, so a redeploy is picked up at once.

## Layout

| File | What it is |
|---|---|
| `src/main.js` | start up: registers gclasses and i18n, creates the yuno |
| `src/app_config.json` | the declarative shell: toolbar, menu and the four routes |
| `src/c_yunovideo.js` | root service: shell, strip (mini-player with the video), scan bar, theme, palette, language, keyboard, boot |
| `src/c_vid_deck.js` | **Player**: stage, scrub bar, transport, the queue |
| `src/c_vid_library.js` | **Library**: folders, series, all, search |
| `src/c_vid_lists.js` | **Lists**: continue watching, saved lists, loved, most watched |
| `src/c_vid_sources.js` | **Sources**: authorised folders, permissions, rescan, diagnostics |
| `src/rows.js` | the row of one video, the same on every screen |
| `src/video_card.js` | the card a name opens |
| `src/video_store.js` | domain: library, queue, temporary list, the one element, subtitles |
| `src/sources_store.js` | the authorised sources, their walk, their diagnostics |
| `src/stats_store.js` | views, hearts and the place of each video |
| `src/thumbs.js` | one frame per video, made when it is first on screen |
| `src/playlists_store.js` | the saved lists |
| `src/names.js` | what a file name says: show, season, episode, year; subtitle pairing |
| `src/subtitles.js` | `.srt` → WebVTT, and the encoding |
| `src/screen.js` | fullscreen and picture-in-picture |
| `src/ui.js` | icons, and `named()`: the title + aria-label of every control |
| `src/idb.js`, `src/diag.js`, `src/offline.js`, `src/update_check.js`, `src/install_*.js`, `src/about_dialog.js`, `src/dev_dialog.js`, `src/confirm_replace.js`, `src/plural.js` | carried over from yunomúsica |
| `src/locales/` | `locales.js` plus the ten catalogues |
| `src/video.css` | the app's styling, palettes included |
| `tests/` | the suite, its runner (`run.mjs`) and its fixtures |

## A few things that are expensive to work out twice

- **A moved `<video>` keeps playing; a removed one stops.** `appendChild` into
  another parent is a move. Taking it out of the document "for a moment" is not.
- **`MEDIA_ERR_SRC_NOT_SUPPORTED` (4) is not a broken file.** Retrying it with a
  fresh `File` is pointless and saying "could not be read" is false.
- **A `<track>` only loads when its mode is not `disabled`**, and an `.srt` handed
  to it as is reads as nothing at all.
- **The shell's views are flex items with `shrink: 0`**: a view needs
  `width: 100%` and `height: 100%`, and here each scrolls *inside* itself, which
  is also what lets a repaint keep its scroll position.
- **A position applied before `loadedmetadata` is not a seek**; the place is
  applied when the element knows its duration.
- **`caches.match` by Request compares `Vary`**: the service worker matches with
  `ignoreVary` (content-hashed URLs), or the precached shell is never found.
- Everything else in yunomúsica's README under the same heading applies here
  too; most of it was learned there first.
