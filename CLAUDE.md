# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repo.

## ⚠️ First step: read the yunetas CLAUDE.md

**Before doing anything in this repo, read the yunetas SDK's `CLAUDE.md`**
(`/yuneta/development/yunetas/CLAUDE.md`; standalone: `github.com/artgins/yunetas`).
It carries the framework-wide rules that govern this code: always-braces, no
silent errors, gobj-js gotchas, the JS GUI conventions (every action through the
FSM, plain-JSON kw, logical DOM class names, no transitions, `title` +
`aria-label` on every control, i18n that can change language), and the
registry model of `@yuneta/gobj-ui` / `@yuneta/gobj-js`. This file only adds
what is particular to yunovídeo.

## This repo

- Yunovídeo: yunomúsica's philosophy for video. Read yunomúsica's README for the
  reasoning behind the shared parts (sources, no duplicates, install question,
  offline, black box); this README covers what is particular to video.
- **Every DOM callback sends an event to its gobj**, with a plain-JSON kw (a
  `uid`, never the video object), and the FSM action does the work. Store
  notifications enter the machine as `EV_STORE {channel}`. Keep it that way.
- **One `<video>` element** (`video_store.js`): it is moved with
  `dock_video($host)`, never recreated or removed from the document.
- Every control is built with `named(key)` (`src/ui.js`): `title` and
  `aria-label` through `t()`, with their `data-i18n-*` keys.
- Locales: ten catalogues in `src/locales/`, the same key set
  (`validate-locales` runs at prebuild). A new key goes into all ten, with every
  plural category its language has.
- **The version is bumped on every change** (`package.json`, third number for a
  deploy round of gobj-ui), with its line in `CHANGELOG.md`.
- Validate with `npm install && npm run build && npm test` (needs `ffmpeg` for
  the fixtures). Deploy with `npm run build && ./deploy_yunovideo.sh`
  (wattyzer, `/yuneta/gui/yunovideo.com`).
