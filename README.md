# Habit & Health Tracker

A personal, single-user habit and health tracker. Plain HTML/CSS/JavaScript —
no framework, no build step. All data is stored locally in the browser
(`localStorage`); nothing is sent anywhere. Installable as a PWA and works offline.

## Features

- **Fasting / eating windows** — live status (eating vs fasting), time elapsed in
  the current state, countdown to the next transition, a 24-hour rhythm timeline,
  and a history of past fasts.
- **No smoking** — one tap per day; tracks current streak and lifetime total.
- **Drinking** — a weekly limit (e.g. 1 day/week) with an over-limit flag; log what
  and how much.
- **Recurring tasks** — repeat on chosen days with optional times and streaks, or
  mark a task **as-needed** (no fixed days, no streak — e.g. watering plants).
- **Calendar** — month/week views; tap any day to see and edit its full detail.
- **Meals** — log meals with a time and optional note.
- **Fully editable** — add/edit/remove your own habits, tasks, eating schedule, and
  day anchors from the Settings screen. Everything is data-driven.

## Run locally

Service workers need `http://`, not `file://`, so use the tiny bundled server:

```sh
node server.js
# then open http://localhost:8765
```

## Configuration

Defaults live in [`js/config.js`](js/config.js), but on first run they're copied into
`localStorage` and the in-app **Settings** screen becomes the source of truth.
Use **Settings → Data → Export** to back up everything to a JSON file.

## Project structure

| File | Role |
|------|------|
| `index.html` | App shell |
| `css/style.css` | Styles (calm, mobile-first, auto light/dark) |
| `js/util.js` | Date/time helpers (all local time) |
| `js/config.js` | Default configuration (data-driven core) |
| `js/store.js` | `localStorage` layer, organized by date |
| `js/fasting.js` | Eating/fasting engine |
| `js/tracking.js` | Habit/task operations + streak math |
| `js/app.js` | UI: navigation, screens, events |
| `manifest.json`, `sw.js` | PWA: installable + offline |

> Updating the deployed app? Bump `CACHE_VERSION` in `sw.js` so phones fetch the
> new files instead of the cached old ones.
