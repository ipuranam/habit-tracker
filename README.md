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
- **Daily habits** — a check-once-a-day list (No smoking, Workout, Eat healthy,
  Fasted, …) with streaks; add your own.
- **Recurring tasks** — repeat on chosen days with optional times and streaks, or
  mark a task **as-needed** (no fixed days, no streak — e.g. watering plants).
- **Work tasks** — ad-hoc Today / This-Week to-do lists; unfinished items carry
  over until done. A summary card on Today plus a full Work tab.
- **Calendar** — month/week views, colored by day rating; tap any day (past *or
  future*) to see and edit its full detail.
- **Stats** — per-habit/task streaks, totals, and 7-/30-day completion %, plus a
  weight/metric trend line and average sleep & day-rating.
- **Sleep & day rating** — log bed/wake times (with a 7-day average) and a 1–5
  quality-of-day rating.
- **Metrics** — log weight (or any number you define) over time with a trend.
- **Meals** — log meals with a time and optional note; plus a free-text daily note.
- **Reminders** — optional in-app nudges for timed tasks (foreground only; see
  in-app note about background/iOS limits).
- **Backup** — export and import your data as a JSON file.
- **Fully editable** — add/edit/remove your own habits, tasks, metrics, eating
  schedule, and day anchors from Settings. Everything is data-driven.

## Run locally

Service workers need `http://`, not `file://`, so use the tiny bundled server:

```sh
node server.js
# then open http://localhost:8765
```

## Google Calendar setup (optional)

The calendar integration is **online-only** and uses a pure client-side OAuth flow:
the app stores only your **public** OAuth Client ID, and events are fetched
**directly between your browser and Google** (no backend, no third party). One-time
setup in the [Google Cloud Console](https://console.cloud.google.com):

1. **Create a project** (e.g. "Habit Tracker").
2. **Enable the API:** APIs & Services → Library → search **Google Calendar API** → Enable.
3. **OAuth consent screen:** User type **External** → fill in app name + your email →
   add your own Google account under **Test users** (leave it in *Testing* mode — no
   Google verification needed for personal use). Add the scope
   `.../auth/calendar.events.readonly` if prompted.
4. **Create credentials:** APIs & Services → Credentials → Create Credentials →
   **OAuth client ID** → Application type **Web application**. Under **Authorized
   JavaScript origins** add both:
   - `https://ipuranam.github.io`
   - `http://localhost:8765` (for local dev)

   Create it and copy the **Client ID** (ends in `.apps.googleusercontent.com`).
5. **In the app:** Settings → Google Calendar → paste the Client ID → **Connect** →
   sign in and grant read-only calendar access.

Notes: the access token lasts the browser session (reconnect when it expires);
events are cached so they still show (stale) offline; scope is read-only.

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
