/* ============================================================
   app.js — UI shell: navigation, screens, and event handling.

   Pattern notes for future-you:
   - Screens are functions that return HTML strings. We set innerHTML,
     then a SINGLE set of delegated listeners on #view handles every
     click/change/submit by reading data-action attributes. That means
     re-rendering never loses event handlers.
   - All data goes through HT.tracking / HT.store; all schedule logic
     through HT.fasting. This file is "just UI".
   ============================================================ */
(function () {
  const { util, store, fasting, tracking } = HT;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Weekday display order, Monday-first (data uses 0=Sun..6=Sat).
  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

  const TABS = [
    { id: "home",     icon: "📊", label: "Home" },
    { id: "today",    icon: "📅", label: "Today" },
    { id: "work",     icon: "💼", label: "Work" },
    { id: "history",  icon: "🗓️", label: "Calendar" },
    { id: "settings", icon: "⚙️", label: "Settings" },
  ];

  // Daily yes/no habits (No smoking, Workout, Eat healthy, Fasted, …).
  // "tap-streak" kept for backward compatibility with older saved configs.
  function isDailyCheck(h) { return h.type === "daily-check" || h.type === "tap-streak"; }

  const state = {
    tab: "home", histDate: util.todayKey(),
    calMode: "month", calAnchor: util.todayKey(),  // calendar view state
    editTaskId: null, addingTask: false,
    editFastId: null, addingFast: false,           // past-fast editor state
  };
  let cfg = null;

  function saveCfg() { store.saveConfig(cfg); }
  function rerender() { renderTabbar(); render(); }

  /* ============================================================
     Navigation
     ============================================================ */
  function renderTabbar() {
    const bar = document.getElementById("tabbar");
    bar.innerHTML = TABS.map(t =>
      `<button data-action="go" data-tab="${t.id}" class="${t.id === state.tab ? "active" : ""}">
         <span class="tab-icon">${t.icon}</span>${t.label}
       </button>`).join("");
  }

  function render() {
    const view = document.getElementById("view");
    if (state.tab === "home")         view.innerHTML = renderHome();
    else if (state.tab === "today")   view.innerHTML = renderToday();
    else if (state.tab === "work")    view.innerHTML = renderWork();
    else if (state.tab === "history") view.innerHTML = renderHistory();
    else                              view.innerHTML = renderSettings();
    if (state.tab === "home") { updateFastingLive(); paintTimeline(); }
    window.scrollTo(0, 0);
  }

  /* ============================================================
     Shared day sections (used by Today and History)
     ============================================================ */
  // Unified checklist of all daily yes/no habits.
  function dailyCard(key) {
    const habits = cfg.habits.filter(isDailyCheck);
    if (!habits.length) return "";
    const rows = habits.map(h => {
      const done = tracking.dayHabitDone(key, h.id);
      const streak = tracking.habitStreak(h.id);
      return `
        <label class="checkrow">
          <input type="checkbox" ${done ? "checked" : ""} data-action="toggle-habit" data-id="${h.id}" data-key="${key}">
          <span class="checkrow-main">
            <span class="checkrow-name ${done ? "is-done" : ""}">${h.icon || ""} ${esc(h.name)}</span>
          </span>
          <span class="checkrow-streak" title="current streak">🔥 ${streak}</span>
        </label>`;
    }).join("");
    return `<div class="card"><h2>Daily</h2>${rows}</div>`;
  }

  function isAsNeeded(t) { return t.mode === "asNeeded"; }

  function taskRow(t, key) {
    const done = tracking.dayTaskDone(key, t.id);
    // "Due" flag: today only, a timed task whose time has passed and isn't done.
    let due = false;
    if (key === util.todayKey() && t.time && !isAsNeeded(t) && !done) {
      const now = new Date();
      due = (now.getHours() * 60 + now.getMinutes()) >= util.hmToMinutes(t.time);
    }
    const timeHtml = t.time
      ? `<span class="checkrow-time ${due ? "is-due" : ""}">${util.minutesToLabel(util.hmToMinutes(t.time))}${due ? " · due" : ""}</span>`
      : "";
    let badge;
    if (isAsNeeded(t)) {
      // "last done" info instead of a streak.
      let info;
      if (done) info = "today";
      else {
        const last = tracking.lastTaskDoneBefore(t.id, key);
        info = last ? util.daysBetween(last, key) + "d ago" : "—";
      }
      badge = `<span class="checkrow-streak" title="last done">💧 ${info}</span>`;
    } else {
      badge = `<span class="checkrow-streak" title="current streak">🔥 ${tracking.taskStreak(cfg, t.id)}</span>`;
    }
    return `
      <label class="checkrow">
        <input type="checkbox" ${done ? "checked" : ""} data-action="toggle-task" data-id="${t.id}" data-key="${key}">
        <span class="checkrow-main">
          <span class="checkrow-name ${done ? "is-done" : ""}">${esc(t.name)}</span>
          ${timeHtml}
        </span>
        ${badge}
      </label>`;
  }

  function tasksCard(key, isToday) {
    const dow = util.weekdayOf(key);
    const scheduled = cfg.recurring.filter(t => !isAsNeeded(t) && t.days.includes(dow));
    const asNeeded  = cfg.recurring.filter(isAsNeeded);
    const title = isToday ? "Today’s tasks" : "Tasks this day";
    if (!scheduled.length && !asNeeded.length)
      return `<div class="card"><h2>${title}</h2><p class="muted">Nothing scheduled.</p></div>`;

    let body = scheduled.map(t => taskRow(t, key)).join("");
    if (asNeeded.length) {
      body += `<div class="checkrow-sub muted">As needed</div>` + asNeeded.map(t => taskRow(t, key)).join("");
    }
    return `<div class="card"><h2>${title}</h2>${body}</div>`;
  }

  function drinkingCard(key) {
    const h = cfg.habits.find(x => x.type === "weekly-limit");
    if (!h) return "";
    const limit = h.limitPerWeek || 1;
    const info = tracking.drinkDaysInWeek(cfg, key);
    const over = info.count > limit;
    const log = tracking.drinkLog(key);
    const loggedToday = !!log;

    const counter = `
      <div class="drink-count ${over ? "is-over" : ""}">
        <span class="drink-num">${info.count}/${limit}</span>
        <span class="drink-lbl">drinking days this week ${over ? "· over limit!" : ""}</span>
      </div>`;

    let body;
    if (loggedToday) {
      body = `
        <div class="drink-logged">
          <div><strong>Logged:</strong> ${esc(log.what || "—")}${log.amount ? " · " + esc(log.amount) : ""}</div>
          <button class="btn" data-action="clear-drink" data-key="${key}">Remove</button>
        </div>`;
    } else {
      body = `
        <form data-action="save-drink" data-key="${key}" class="drink-form">
          <input name="what" placeholder="What did you drink?" autocomplete="off">
          <input name="amount" placeholder="Amount (e.g. 2 beers)" autocomplete="off">
          <button class="btn btn-accent" type="submit">Log a drinking day</button>
        </form>`;
    }
    return `<div class="card"><h2>${h.icon || ""} ${esc(h.name)}</h2>${counter}${body}</div>`;
  }

  function mealsCard(key) {
    const rec = store.getDay(key);
    const meals = (rec.meals || []).slice().sort((a, b) => a.at - b.at);
    const list = meals.length
      ? meals.map(m => {
          const d = new Date(m.at);
          const label = util.minutesToLabel(d.getHours() * 60 + d.getMinutes());
          return `<li class="meal-item">
              <span class="meal-time">${label}</span>
              <span class="meal-note">${esc(m.note) || '<span class="muted">no note</span>'}</span>
              <button class="iconbtn" data-action="remove-meal" data-key="${key}" data-at="${m.at}" title="Remove">✕</button>
            </li>`;
        }).join("")
      : `<li class="muted">No meals logged.</li>`;
    return `
      <div class="card">
        <h2>🍽️ Meals</h2>
        <ul class="meal-list">${list}</ul>
        <form data-action="add-meal" data-key="${key}" class="meal-form">
          <input type="time" name="time" class="meal-timein">
          <input name="note" placeholder="Optional note" autocomplete="off">
          <button class="btn btn-accent" type="submit">Add</button>
        </form>
      </div>`;
  }

  function sleepCard(key) {
    const s = tracking.getSleep(key);
    const avg = tracking.avgSleepMin(key, 7);
    let body;
    if (s) {
      body = `
        <div class="sleep-logged">
          <div class="sleep-dur">${util.humanDuration(tracking.sleepDurationMin(key))}</div>
          <div class="muted">${labelTime(new Date(s.bed))} → ${labelTime(new Date(s.wake))}</div>
          <button class="btn" data-action="clear-sleep" data-key="${key}">Edit / clear</button>
        </div>`;
    } else {
      body = `
        <form data-action="save-sleep" data-key="${key}" class="sleep-form">
          <label class="sleep-field"><span class="muted">Bedtime</span><input type="time" name="bed" value="23:00"></label>
          <label class="sleep-field"><span class="muted">Wake</span><input type="time" name="wake" value="07:00"></label>
          <button class="btn btn-accent" type="submit">Log sleep</button>
        </form>`;
    }
    const avgLine = avg ? `<div class="muted" style="font-size:.8rem;margin-top:10px">7-day average: ${util.humanDuration(avg)}</div>` : "";
    return `<div class="card"><h2>😴 Sleep</h2>${body}${avgLine}</div>`;
  }

  const RATING_LABELS = { 1: "Rough", 2: "Meh", 3: "Okay", 4: "Good", 5: "Great" };
  function ratingCard(key) {
    const r = tracking.getRating(key);
    const dots = [1, 2, 3, 4, 5].map(n =>
      `<button class="rate-dot r${n} ${r && n <= r ? "on" : ""} ${r === n ? "sel" : ""}"
               data-action="set-rating" data-key="${key}" data-val="${n}">${n}</button>`).join("");
    const lbl = r ? `<div class="rate-label">${RATING_LABELS[r]}</div>`
                  : `<div class="rate-label muted">Tap to rate</div>`;
    return `<div class="card center"><h2>How was today?</h2><div class="rate-row">${dots}</div>${lbl}</div>`;
  }

  function metricsCard(key) {
    const metrics = cfg.metrics || [];
    if (!metrics.length) return "";
    const rows = metrics.map(m => {
      const v = tracking.getMetric(key, m.id);
      const latest = tracking.metricLatest(m.id);
      const hint = (v == null && latest) ? `last: ${latest.value} ${esc(m.unit || "")}` : "";
      return `
        <div class="metric-row">
          <label class="metric-name">${esc(m.name)}</label>
          <span class="metric-input">
            <input type="number" inputmode="decimal" step="any" data-action="save-metric"
                   data-id="${m.id}" data-key="${key}" value="${v == null ? "" : v}" placeholder="—">
            <span class="metric-unit muted">${esc(m.unit || "")}</span>
          </span>
          ${hint ? `<span class="metric-hint muted">${hint}</span>` : ""}
        </div>`;
    }).join("");
    return `<div class="card"><h2>📏 Metrics</h2>${rows}</div>`;
  }

  function noteCard(key) {
    const note = tracking.getNote(key);
    return `
      <div class="card">
        <h2>📝 Note</h2>
        <textarea class="note-area" data-action="save-note" data-key="${key}"
                  placeholder="Anything about today…">${esc(note)}</textarea>
      </div>`;
  }

  /* ---------- Work to-dos (shared by Today card and Work tab) ---------- */
  function workList(scope) {
    const items = tracking.visibleWork(scope, cfg.weekStartDow);
    const rows = items.map(t => `
      <label class="checkrow">
        <input type="checkbox" ${t.done ? "checked" : ""} data-action="toggle-work" data-id="${t.id}">
        <span class="checkrow-main"><span class="checkrow-name ${t.done ? "is-done" : ""}">${esc(t.text)}</span></span>
        <button class="iconbtn" data-action="remove-work" data-id="${t.id}" title="Delete">✕</button>
      </label>`).join("") || `<p class="muted" style="margin:6px 0 0">Nothing here yet.</p>`;
    const form = `
      <form class="work-add" data-action="add-work" data-scope="${scope}">
        <input name="text" placeholder="${scope === "day" ? "Add a task for today…" : "Add a task for this week…"}" autocomplete="off" required>
        <button class="btn btn-accent" type="submit">Add</button>
      </form>`;
    return rows + form;
  }
  function openBadge(scope) {
    const n = tracking.openWorkCount(scope, cfg.weekStartDow);
    return n ? ` <span class="muted" style="font-size:.8rem;font-weight:400">${n} to do</span>` : "";
  }

  // Compact summary card shown on the Today screen.
  function workTodayCard() {
    const wkOpen = tracking.openWorkCount("week", cfg.weekStartDow);
    return `
      <div class="card">
        <h2>💼 Work today${openBadge("day")}</h2>
        ${workList("day")}
        <button class="linkbtn" data-action="go" data-tab="work" style="margin-top:12px">
          This week: ${wkOpen} open · open Work tab →
        </button>
      </div>`;
  }

  /* ---------- Work tab ---------- */
  function renderWork() {
    return `<div class="card"><h2>Today${openBadge("day")}</h2>${workList("day")}</div>`
      + `<div class="card"><h2>This week${openBadge("week")}</h2>${workList("week")}</div>`;
  }

  /* ---------- Google Calendar: today's events (Today screen) ---------- */
  function eventsCard() {
    const g = cfg.google || {};
    if (!g.clientId) return ""; // not set up — configured from Settings
    const today = util.todayKey();
    const connected = HT.gcal.isConnected();
    const cached = HT.gcal.cachedEvents(today);
    let body;
    if (!connected && !cached) {
      body = `<button class="btn btn-accent" data-action="gcal-connect">Connect Google Calendar</button>`;
    } else {
      const events = cached || [];
      body = events.length
        ? events.map(ev => {
            const time = ev.allDay ? "All day" : labelTime(new Date(ev.start));
            return `<div class="evt-row">
                <span class="evt-time muted">${time}</span>
                <span class="evt-title">${esc(ev.title)}</span>
                <button class="iconbtn" data-action="event-to-work" data-title="${esc(ev.title)}" data-evtid="${esc(ev.id)}" title="Add to Work">＋</button>
              </div>`;
          }).join("")
        : `<p class="muted" style="margin:4px 0 0">No events today.</p>`;
      if (events.length) body += `<button class="btn" data-action="import-events" style="margin-top:12px">Import all to Work</button>`;
      if (!connected) body += `<p class="muted" style="font-size:.76rem;margin:8px 0 0">Showing saved events · <button class="linkbtn" data-action="gcal-connect">refresh</button></p>`;
    }
    return `<div class="card"><h2>📆 Today’s events</h2>${body}</div>`;
  }

  function googleCalendarEditor() {
    const g = cfg.google || {};
    const connected = HT.gcal.isConnected();
    const status = !g.clientId ? "Not set up. Paste your OAuth Client ID below (steps are in the project README)."
      : connected ? "Connected." : "Client ID saved — tap Connect to sign in.";
    return `
      <div class="card">
        <h2>Google Calendar</h2>
        <p class="muted" style="font-size:.84rem;margin-top:0">${status}</p>
        <label class="muted" style="font-size:.8rem">OAuth Client ID</label>
        <input style="width:100%;margin-top:4px" name="gcal-clientid" data-action="save-gcal-clientid"
               placeholder="…apps.googleusercontent.com" value="${esc(g.clientId || "")}" autocomplete="off">
        <div class="form-line" style="margin-top:10px">
          <label class="muted" style="font-size:.8rem">Calendar ID</label>
          <input name="gcal-calid" data-action="save-gcal-calid" value="${esc(g.calendarId || "primary")}" style="width:170px" autocomplete="off">
        </div>
        <div class="form-actions" style="margin-top:12px">
          ${connected ? `<button class="btn" data-action="gcal-disconnect">Disconnect</button>`
                      : `<button class="btn btn-accent" data-action="gcal-connect">Connect</button>`}
        </div>
        <p class="muted" style="font-size:.76rem;margin-bottom:0">Online-only. Your calendar is fetched directly between your browser and Google — it doesn’t pass through any other server.</p>
      </div>`;
  }

  function timeAgo(ts) {
    if (!ts) return "";
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  function syncEditor() {
    const g = cfg.google || {};
    const on = !!cfg.syncEnabled;
    const synced = HT.sync.lastSynced();
    let status;
    if (!g.clientId) status = "Connect Google Calendar first — sync reuses the same Google sign-in.";
    else if (on) status = synced ? `On · last synced ${timeAgo(synced)}` : "On.";
    else status = "Off. Turn on to sync this device with your other devices via your private Google Drive folder.";
    const btns = !g.clientId ? "" : (on
      ? `<div class="form-actions"><button class="btn btn-accent" data-action="sync-now">Sync now</button><button class="btn" data-action="sync-off">Turn off</button></div>`
      : `<button class="btn btn-accent" data-action="sync-enable">Enable Drive sync</button>`);
    return `
      <div class="card">
        <h2>Sync (Google Drive)</h2>
        <p class="muted" style="font-size:.84rem;margin-top:0">${status}</p>
        ${btns}
        <p class="muted" style="font-size:.76rem;margin-bottom:0">Stored in a private per-app Drive folder (hidden from your normal Drive). Online-only; last save wins, so avoid editing two devices at the exact same time.</p>
      </div>`;
  }

  function enableSync() {
    HT.gcal.connect()
      .then(() => { cfg.syncEnabled = true; saveCfg(); return HT.sync.push(false); })
      .then(() => { flash("Sync on"); render(); })
      .catch(e => { alert("Couldn't enable sync: " + e.message); render(); });
  }
  function doSyncNow() {
    flash("Syncing…");
    HT.sync.syncNow(false)
      .then(p => { cfg = store.getConfig(); flash(p.pulled ? "Pulled latest" : "Synced"); render(); })
      .catch(e => alert("Sync failed: " + e.message));
  }

  function gcalConnect() {
    HT.gcal.connect()
      .then(() => { flash("Connected"); gcalRefresh(); render(); })
      .catch(e => { alert("Couldn’t connect: " + e.message); render(); });
  }
  // Fetch today's events in the background, then re-render if it changes the view.
  function gcalRefresh() {
    if (!(cfg.google && cfg.google.clientId) || !HT.gcal.isConnected()) return;
    HT.gcal.fetchEvents(util.todayKey())
      .then(() => { if (state.tab === "today") render(); })
      .catch(e => console.warn("[gcal] refresh failed:", e.message));
  }

  /* ============================================================
     Today screen
     ============================================================ */
  function renderToday() {
    const key = util.todayKey();
    return eventsCard()
      + dailyCard(key)
      + tasksCard(key, true)
      + workTodayCard()
      + drinkingCard(key)
      + mealsCard(key)
      + sleepCard(key)
      + metricsCard(key)
      + ratingCard(key)
      + noteCard(key);
  }

  function fastGoalHours() { return cfg.fastGoalHours || 16; }

  // Format a timestamp as a LOCAL "YYYY-MM-DDTHH:MM" for <input type=datetime-local>.
  function toLocalInputValue(ts) {
    const d = new Date(ts), p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // The manual start/stop fasting timer (the hero). Tracks ACTUAL fasts.
  function fastingCard() {
    const af = tracking.activeFast();
    if (af) {
      const mins = (Date.now() - af.start) / 60000;
      return `
        <div class="card fasting-card" id="fasting-card">
          <div class="fasting-state"><span class="fasting-dot is-fast"></span><span>Fasting</span></div>
          <div class="fasting-elapsed" id="fasting-elapsed">${util.humanDuration(mins)} <span class="muted" style="font-size:.55em;font-weight:400">so far</span></div>
          <div class="fasting-next muted" id="fasting-next"></div>
          <div class="fasting-bar"><div class="fasting-bar-fill is-fast" id="fasting-bar-fill"></div></div>
          <button class="btn btn-accent fasting-action" data-action="end-fast">End fast</button>
          <div class="fasting-since">
            <span class="muted">Started</span>
            <input type="datetime-local" class="fast-start-input" data-action="edit-fast-start"
                   value="${toLocalInputValue(af.start)}" max="${toLocalInputValue(Date.now())}">
          </div>
          <div class="muted" style="font-size:.74rem;margin-top:4px">Backdate this if you started earlier.</div>
        </div>`;
    }
    const last = tracking.lastCompletedFast();
    const lastLine = last
      ? `Last fast: <strong>${util.humanDuration((last.end - last.start) / 60000)}</strong>`
      : "No fasts logged yet";
    return `
      <div class="card fasting-card" id="fasting-card">
        <div class="fasting-state"><span class="fasting-dot"></span><span>Not fasting</span></div>
        <button class="btn btn-accent fasting-action" data-action="start-fast" style="margin-top:8px">Start fast</button>
        <div class="muted fasting-since">${lastLine}</div>
      </div>`;
  }

  // Rolling-window timeline: a slice of the day around "now" instead of a full
  // 24h bar, so the relevant blocks aren't squashed. Filled by paintTimeline().
  const TL_HOURS_BEFORE = 3;   // how much recent past to show
  const TL_HOURS_AFTER  = 9;   // how much of the upcoming day to show

  function timelineCard() {
    return `
      <div class="card">
        <h2>Today’s rhythm <span class="tl-range muted" id="tl-range"></span></h2>
        <div class="timeline" id="timeline"></div>
        <div class="tl-legend muted">
          <span><i class="sw eat"></i>Eating</span>
          <span><i class="sw fast"></i>Fasting</span>
          <span><i class="sw anchor"></i>Work</span>
          ${(cfg.google && cfg.google.clientId) ? '<span><i class="sw evt"></i>Events</span>' : ""}
        </div>
      </div>`;
  }

  // Draw the rolling window using absolute time, so it crosses midnight cleanly.
  function paintTimeline() {
    const el = document.getElementById("timeline");
    if (!el) return;
    const now = Date.now();
    const winStart = now - TL_HOURS_BEFORE * 3600000;
    const winEnd   = now + TL_HOURS_AFTER  * 3600000;
    const span = winEnd - winStart;
    const pct = t => ((t - winStart) / span) * 100;
    const clip = (s, e) => ({ s: Math.max(s, winStart), e: Math.min(e, winEnd) });

    let html = "";

    // Your live fast (actual) highlighted under everything else.
    const af = tracking.activeFast();
    if (af) {
      const { s, e } = clip(af.start, now);
      if (e > s) html += `<div class="tl-fast" style="left:${pct(s)}%;width:${pct(e) - pct(s)}%"></div>`;
    }

    // Eating windows (absolute intervals already span across midnight).
    fasting.absoluteIntervals(cfg, util.todayKey()).forEach(iv => {
      const { s, e } = clip(iv.start, iv.end);
      if (e > s) html += `<div class="tl-eat" style="left:${pct(s)}%;width:${pct(e) - pct(s)}%"></div>`;
    });

    // Anchors (e.g. work) for any date the window touches.
    const dates = [util.addDays(util.todayKey(), -1), util.todayKey(), util.addDays(util.todayKey(), 1)];
    (cfg.anchors || []).forEach(a => dates.forEach(dk => {
      if (!a.days.includes(util.weekdayOf(dk))) return;
      const mid = util.keyToDate(dk).getTime();
      const { s, e } = clip(mid + util.hmToMinutes(a.start) * 60000, mid + util.hmToMinutes(a.end) * 60000);
      if (e > s) html += `<div class="tl-anchor" style="left:${pct(s)}%;width:${pct(e) - pct(s)}%" title="${esc(a.name)}"></div>`;
    }));

    // Google Calendar events (timed only) as bands, if connected.
    if (cfg.google && cfg.google.clientId) {
      (HT.gcal.cachedEvents(util.todayKey()) || []).forEach(ev => {
        if (ev.allDay) return;
        const { s, e } = clip(new Date(ev.start).getTime(), new Date(ev.end).getTime());
        if (e > s) html += `<div class="tl-evt" style="left:${pct(s)}%;width:${pct(e) - pct(s)}%" title="${esc(ev.title)}"></div>`;
      });
    }

    // Hour ticks every 3 hours within the window.
    const t0 = new Date(winStart); t0.setMinutes(0, 0, 0);
    for (let t = t0.getTime(); t <= winEnd; t += 3600000) {
      const d = new Date(t);
      if (t >= winStart && d.getHours() % 3 === 0) {
        html += `<div class="tl-tick" style="left:${pct(t)}%"><span>${util.minutesToLabel(d.getHours() * 60)}</span></div>`;
      }
    }

    // "Now" marker (sits at a fixed fraction since the window follows now).
    html += `<div class="tl-now" style="left:${pct(now)}%"></div>`;
    el.innerHTML = html;

    const range = document.getElementById("tl-range");
    if (range) {
      const f = ms => { const d = new Date(ms); return util.minutesToLabel(d.getHours() * 60 + d.getMinutes()); };
      range.textContent = `${f(winStart)} – ${f(winEnd)}`;
    }
  }

  function updateFastingLive() {
    if (state.tab !== "home") return;
    const now = new Date();

    // Live update the manual timer while a fast is running.
    const af = tracking.activeFast();
    const elapsedEl = document.getElementById("fasting-elapsed");
    if (af && elapsedEl) {
      const mins = (now.getTime() - af.start) / 60000;
      elapsedEl.innerHTML = `${util.humanDuration(mins)} <span class="muted" style="font-size:.55em;font-weight:400">so far</span>`;
      const goalMin = fastGoalHours() * 60;
      const fill = document.getElementById("fasting-bar-fill");
      if (fill) fill.style.width = Math.max(0, Math.min(100, (mins / goalMin) * 100)) + "%";
      const next = document.getElementById("fasting-next");
      if (next) {
        const remain = goalMin - mins;
        next.textContent = remain > 0
          ? `${util.humanDuration(remain)} to your ${fastGoalHours()}h goal`
          : `🎉 ${fastGoalHours()}h goal reached`;
      }
    }

    // Repaint the rolling timeline once per minute (it shifts slowly with now).
    const curMin = now.getHours() * 60 + now.getMinutes();
    if (curMin !== lastTimelineMin) { lastTimelineMin = curMin; paintTimeline(); }
  }
  let lastTimelineMin = -1;

  /* ============================================================
     History screen — scrub past days + fast history
     ============================================================ */
  // One-line summary of a day's eating windows (for planning future days).
  function eatingSummary(key) {
    const segs = fasting.dayEatingSegments(cfg, key);
    if (!segs.length) return "🍽️ Fasting all day";
    return "🍽️ Eat " + segs.map(s =>
      `${util.minutesToLabel(s.startMin)}–${util.minutesToLabel(s.endMin)}`).join(", ");
  }

  function renderHistory() {
    const key = state.histDate;
    const today = util.todayKey();
    const isToday = key === today;
    const rel = isToday ? "Today"
      : (key > today ? `in ${util.daysBetween(today, key)}d` : `${util.daysBetween(key, today)}d ago`);
    const nav = `
      <div class="card daynav">
        <button class="iconbtn" data-action="hist-prev">‹</button>
        <div class="daynav-mid">
          <div class="daynav-date">${util.prettyDate(key)}</div>
          <div class="muted" style="font-size:.78rem">${eatingSummary(key)}</div>
          ${isToday ? '<div class="muted" style="font-size:.78rem">Today</div>'
                    : `<button class="linkbtn" data-action="hist-today" style="margin-top:2px">${rel} · jump to today</button>`}
        </div>
        <button class="iconbtn" data-action="hist-next">›</button>
      </div>`;

    return calendarCard()
      + nav
      + dailyCard(key)
      + tasksCard(key, isToday)
      + drinkingCard(key)
      + mealsCard(key)
      + sleepCard(key)
      + metricsCard(key)
      + ratingCard(key)
      + noteCard(key)
      + fastHistoryCard();
  }

  /* ---------- Calendar ---------- */
  // Does a day have anything logged? (used for the activity dot)
  function hasActivity(key) {
    const r = store.getDay(key);
    return (r.habits && Object.keys(r.habits).length) ||
           (r.recurring && Object.keys(r.recurring).length) ||
           (r.meals && r.meals.length) || r.sleep || r.rating || r.note ||
           (r.metrics && Object.keys(r.metrics).length);
  }

  function calCell(key) {
    if (!key) return `<div class="cal-cell empty"></div>`;
    const d = util.keyToDate(key);
    const today = util.todayKey();
    const cls = ["cal-cell"];
    if (key === today) cls.push("today");
    if (key === state.histDate) cls.push("sel");
    if (key > today) cls.push("future"); // future days are dimmed but navigable
    // Dot is colored by the day's rating (mood map); neutral if only other activity.
    let dot = "";
    const r = tracking.getRating(key);
    if (r) dot = `<span class="cal-dot r${r}"></span>`;
    else if (hasActivity(key)) dot = `<span class="cal-dot"></span>`;
    return `<button class="${cls.join(" ")}" data-action="cal-day" data-key="${key}">
        <span class="cal-num">${d.getDate()}</span>${dot}
      </button>`;
  }

  function calLabels() {
    return DOW_ORDER.map(d => `<div class="cal-lbl">${util.DAY_SHORT[d][0]}</div>`).join("");
  }

  function monthGrid() {
    const a = util.keyToDate(state.calAnchor);
    const year = a.getFullYear(), month = a.getMonth();
    const firstDow = new Date(year, month, 1).getDay();
    const lead = (firstDow - cfg.weekStartDow + 7) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < lead; i++) cells += calCell(null);
    for (let dn = 1; dn <= daysInMonth; dn++) cells += calCell(util.dateKey(new Date(year, month, dn)));
    return `<div class="cal-grid">${calLabels()}${cells}</div>`;
  }

  function weekStrip() {
    const wk = util.weekKeyOf(state.calAnchor, cfg.weekStartDow);
    let cells = "";
    for (let i = 0; i < 7; i++) cells += calCell(util.addDays(wk, i));
    return `<div class="cal-grid">${calLabels()}${cells}</div>`;
  }

  function calTitle() {
    if (state.calMode === "month") {
      const d = util.keyToDate(state.calAnchor);
      return `${util.MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
    }
    const wk = util.weekKeyOf(state.calAnchor, cfg.weekStartDow);
    const end = util.addDays(wk, 6);
    const a = util.keyToDate(wk), b = util.keyToDate(end);
    return `${util.MONTH_SHORT[a.getMonth()]} ${a.getDate()} – ${util.MONTH_SHORT[b.getMonth()]} ${b.getDate()}`;
  }

  function calendarCard() {
    const grid = state.calMode === "month" ? monthGrid() : weekStrip();
    return `
      <div class="card">
        <div class="cal-head">
          <button class="iconbtn" data-action="cal-prev">‹</button>
          <div class="cal-title">${calTitle()}</div>
          <button class="iconbtn" data-action="cal-next">›</button>
        </div>
        ${grid}
        <div class="cal-foot">
          <button class="linkbtn" data-action="cal-mode">${state.calMode === "month" ? "Week view" : "Month view"}</button>
          <span class="cal-foot-hint muted"><span class="cal-dot static"></span> has activity</span>
        </div>
      </div>`;
  }

  // Shared add/edit form for a logged fast. `fast` null = adding a new one.
  function fastForm(fast) {
    const isEdit = !!fast;
    const startVal = toLocalInputValue(isEdit ? fast.start : Date.now() - fastGoalHours() * 3600000);
    const endVal = toLocalInputValue(isEdit ? fast.end : Date.now());
    const maxNow = toLocalInputValue(Date.now());
    return `
      <form class="fast-form" data-action="${isEdit ? "save-fast" : "create-fast"}" ${isEdit ? `data-id="${fast.id}"` : ""}>
        <label class="fast-form-row"><span class="muted">Start</span>
          <input type="datetime-local" name="start" value="${startVal}" max="${maxNow}"></label>
        <label class="fast-form-row"><span class="muted">End</span>
          <input type="datetime-local" name="end" value="${endVal}" max="${maxNow}"></label>
        <div class="form-actions">
          <button class="btn btn-accent" type="submit">${isEdit ? "Save" : "Add fast"}</button>
          <button class="btn" type="button" data-action="cancel-fast-edit">Cancel</button>
        </div>
      </form>`;
  }

  function fastHistoryCard() {
    const fasts = tracking.completedFasts().slice().sort((a, b) => b.end - a.end).slice(0, 30);
    const rows = fasts.length ? fasts.map(f => {
      if (state.editFastId === f.id) return `<li class="fast-item-edit">${fastForm(f)}</li>`;
      const s = new Date(f.start), e = new Date(f.end);
      return `<li class="fast-item">
          <span class="fast-dur">${util.humanDuration((f.end - f.start) / 60000)}</span>
          <span class="muted fast-when">${util.MONTH_SHORT[s.getMonth()]} ${s.getDate()}, ${labelTime(s)} → ${labelTime(e)}</span>
          <button class="iconbtn" data-action="edit-fast" data-id="${f.id}" title="Edit">✎</button>
          <button class="iconbtn" data-action="delete-fast" data-id="${f.id}" title="Delete">🗑</button>
        </li>`;
    }).join("") : `<li class="muted">No fasts logged yet. Use the Start/End fast timer on Home.</li>`;
    const add = state.addingFast ? fastForm(null)
      : `<button class="btn" data-action="add-fast-toggle" style="margin-top:10px">+ Add a past fast</button>`;
    return `<div class="card"><h2>Past fasts</h2><ul class="fast-list">${rows}</ul>${add}</div>`;
  }
  function labelTime(d) { return util.minutesToLabel(d.getHours() * 60 + d.getMinutes()); }

  /* ============================================================
     Stats screen — streaks, totals, completion %
     ============================================================ */
  function statBar(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `
      <div class="statrow">
        <div class="statbar"><div class="statbar-fill" style="width:${pct}%"></div></div>
        <span class="statval">${done}/${total} · ${pct}%</span>
      </div>`;
  }

  function renderStats() {
    return dailyStatsCard() + taskStatsCard() + metricsStatsCard() + reflectionStatsCard();
  }

  // Simple inline SVG trend line from logged metric points.
  function sparkline(points) {
    if (points.length < 2) return '<span class="muted" style="font-size:.8rem">log 2+ days for a trend</span>';
    const w = 150, h = 38, pad = 3;
    const vals = points.map(p => p.value);
    const min = Math.min(...vals), max = Math.max(...vals), range = (max - min) || 1;
    const step = (w - 2 * pad) / (points.length - 1);
    const coords = points.map((p, i) =>
      `${(pad + i * step).toFixed(1)},${(h - pad - ((p.value - min) / range) * (h - 2 * pad)).toFixed(1)}`);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <polyline points="${coords.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>
      </svg>`;
  }

  function metricsStatsCard() {
    const metrics = cfg.metrics || [];
    if (!metrics.length) return "";
    const items = metrics.map(m => {
      const series = tracking.metricSeries(m.id, 30);
      const latest = tracking.metricLatest(m.id);
      let change = "";
      if (series.length >= 2) {
        const d = series[series.length - 1].value - series[0].value;
        change = `<span class="muted" style="font-size:.78rem">${d > 0 ? "+" : ""}${(+d.toFixed(1))} over ${series.length} logs</span>`;
      }
      return `
        <div class="statitem">
          <div class="statitem-head">
            <span>${esc(m.name)}</span>
            <span class="muted">${latest ? latest.value + " " + esc(m.unit || "") : "—"}</span>
          </div>
          <div class="metric-trend">${sparkline(series)}${change}</div>
        </div>`;
    }).join("");
    return `<div class="card"><h2>Metrics (last 30 days)</h2>${items}</div>`;
  }

  function dailyStatsCard() {
    const habits = cfg.habits.filter(isDailyCheck);
    if (!habits.length) return "";
    const items = habits.map(h => {
      const streak = tracking.habitStreak(h.id);
      const total = tracking.habitTotal(h.id);
      const d7 = tracking.habitDoneLastDays(h.id, 7);
      const d30 = tracking.habitDoneLastDays(h.id, 30);
      return `
        <div class="statitem">
          <div class="statitem-head">
            <span>${h.icon || ""} ${esc(h.name)}</span>
            <span class="muted">🔥 ${streak} · ${total} total</span>
          </div>
          <div class="statwin"><span class="statwin-lbl muted">7d</span>${statBar(d7, 7)}</div>
          <div class="statwin"><span class="statwin-lbl muted">30d</span>${statBar(d30, 30)}</div>
        </div>`;
    }).join("");
    return `<div class="card"><h2>Daily habits</h2>${items}</div>`;
  }

  function taskStatsCard() {
    if (!cfg.recurring.length) return "";
    const items = cfg.recurring.map(t => {
      if (isAsNeeded(t)) {
        const c30 = tracking.taskDoneLastDays(t.id, 30);
        const last = tracking.lastTaskDoneBefore(t.id, util.addDays(util.todayKey(), 1));
        const lastTxt = last ? (last === util.todayKey() ? "today" : util.daysBetween(last, util.todayKey()) + "d ago") : "never";
        return `
          <div class="statitem">
            <div class="statitem-head"><span>${esc(t.name)}</span><span class="muted">as needed</span></div>
            <div class="statline muted">${c30}× in last 30 days · last: ${lastTxt}</div>
          </div>`;
      }
      const streak = tracking.taskStreak(cfg, t.id);
      const r30 = tracking.taskRateLastDays(cfg, t.id, 30);
      return `
        <div class="statitem">
          <div class="statitem-head"><span>${esc(t.name)}</span><span class="muted">🔥 ${streak}</span></div>
          <div class="statwin"><span class="statwin-lbl muted">30d</span>${statBar(r30.done, r30.scheduled)}</div>
        </div>`;
    }).join("");
    return `<div class="card"><h2>Recurring tasks</h2><p class="muted" style="font-size:.78rem;margin-top:0">Scheduled tasks are rated over their scheduled days.</p>${items}</div>`;
  }

  function reflectionStatsCard() {
    const today = util.todayKey();
    const s7 = tracking.avgSleepMin(today, 7), s30 = tracking.avgSleepMin(today, 30);
    const r7 = tracking.avgRating(today, 7), r30 = tracking.avgRating(today, 30);
    const drink30 = tracking.habitDoneLastDays("drinking", 30);
    const row = (lbl, a, b) => `
      <div class="reflect-row">
        <span>${lbl}</span>
        <span class="muted">7d: <strong>${a}</strong> · 30d: <strong>${b}</strong></span>
      </div>`;
    return `
      <div class="card">
        <h2>Reflections</h2>
        ${row("😴 Avg sleep", s7 != null ? util.humanDuration(s7) : "—", s30 != null ? util.humanDuration(s30) : "—")}
        ${row("⭐ Avg day rating", r7 != null ? r7.toFixed(1) : "—", r30 != null ? r30.toFixed(1) : "—")}
        <div class="reflect-row"><span>🍷 Drinking days</span><span class="muted">last 30d: <strong>${drink30}</strong></span></div>
      </div>`;
  }

  /* ============================================================
     Home dashboard — at-a-glance charts (offline SVG, no libs)
     ============================================================ */
  function chartCard(title, sub, inner, caption) {
    return `
      <div class="card">
        <div class="chart-head"><h2>${title}</h2>${sub ? `<span class="chart-sub muted">${sub}</span>` : ""}</div>
        ${inner}
        ${caption ? `<div class="chart-cap muted">${caption}</div>` : ""}
      </div>`;
  }

  // Bar chart from [{value, dim?}]. Optional avg line.
  function barChartSvg(data, opts) {
    opts = opts || {};
    const W = 320, H = 110, padT = 8, padB = 6;
    const n = data.length || 1;
    const max = Math.max(opts.max || 0, ...data.map(d => d.value), 1);
    const bw = W / n;
    const y = v => H - padB - (v / max) * (H - padT - padB);
    const bars = data.map((d, i) =>
      `<rect x="${(i * bw + bw * 0.16).toFixed(1)}" y="${y(d.value).toFixed(1)}" width="${(bw * 0.68).toFixed(1)}"
             height="${Math.max(0, H - padB - y(d.value)).toFixed(1)}" rx="2" fill="var(--accent)" opacity="${d.dim ? 0.4 : 0.9}"></rect>`).join("");
    const avg = (opts.avg != null && opts.avg > 0)
      ? `<line x1="0" y1="${y(opts.avg).toFixed(1)}" x2="${W}" y2="${y(opts.avg).toFixed(1)}" stroke="var(--good)" stroke-width="1.5" stroke-dasharray="4 3"></line>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none">${avg}${bars}</svg>`;
  }

  // Line chart from [{value}] oldest→newest. opts.area fills under the line.
  function lineChartSvg(points, opts) {
    opts = opts || {};
    const W = 320, H = 110, padT = 8, padB = 6;
    const vals = points.map(p => p.value);
    const min = opts.min != null ? opts.min : Math.min(...vals);
    const max = Math.max(...vals, min + 1);
    const range = (max - min) || 1;
    const step = W / Math.max(1, points.length - 1);
    const xy = (p, i) => `${(i * step).toFixed(1)},${(H - padB - ((p.value - min) / range) * (H - padT - padB)).toFixed(1)}`;
    const coords = points.map(xy).join(" ");
    const area = opts.area ? `<polygon points="0,${H - padB} ${coords} ${W},${H - padB}" fill="var(--accent)" opacity="0.12"></polygon>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none">${area}<polyline points="${coords}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"></polyline></svg>`;
  }

  function sleepChartCard() {
    const today = util.todayKey();
    const data = [];
    for (let i = 13; i >= 0; i--) {
      const m = tracking.sleepDurationMin(util.addDays(today, -i));
      data.push({ value: m ? m / 60 : 0, dim: !m });
    }
    if (!data.some(d => d.value > 0)) return chartCard("😴 Sleep", "", `<p class="muted" style="margin:0">Log sleep on Today to see your trend.</p>`);
    const avg = tracking.avgSleepMin(today, 7);
    return chartCard("😴 Sleep", avg != null ? `7-day avg ${util.humanDuration(avg)}` : "",
      barChartSvg(data, { avg: avg != null ? avg / 60 : null }), "Last 14 nights · green line = 7-day avg");
  }

  function stepsChartCard() {
    if (!(cfg.metrics || []).some(m => m.id === "steps")) return "";
    const today = util.todayKey();
    const data = []; let sum = 0, c = 0;
    for (let i = 13; i >= 0; i--) {
      const v = tracking.getMetric(util.addDays(today, -i), "steps") || 0;
      data.push({ value: v, dim: !v });
      if (i < 7 && v) { sum += v; c++; }
    }
    if (!data.some(d => d.value > 0)) return chartCard("👟 Steps", "", `<p class="muted" style="margin:0">Log steps on Today (Metrics) to see your trend.</p>`);
    const avg = c ? Math.round(sum / c) : null;
    return chartCard("👟 Steps", avg != null ? `7-day avg ${avg.toLocaleString()}` : "",
      barChartSvg(data, { avg }), "Last 14 days · green line = 7-day avg");
  }

  function fastingChartCard() {
    const today = util.todayKey();
    // Sum your ACTUAL logged fasts (by the day each one ended) over 30 days.
    const winStart = util.keyToDate(util.addDays(today, -29)).getTime();
    const perDay = {};
    tracking.completedFasts().forEach(f => {
      if (f.end >= winStart) {
        const k = util.dateKey(new Date(f.end));
        perDay[k] = (perDay[k] || 0) + (f.end - f.start) / 3600000;
      }
    });
    const pts = []; let cum = 0, any = false;
    for (let i = 29; i >= 0; i--) {
      const k = util.addDays(today, -i);
      if (perDay[k]) any = true;
      cum += (perDay[k] || 0);
      pts.push({ value: cum });
    }
    if (!any) {
      return chartCard("⏱️ Cumulative fasting", "0h yet",
        `<p class="muted" style="margin:0">Use the Start/End fast timer on Home and this builds up.</p>`);
    }
    return chartCard("⏱️ Cumulative fasting", `${Math.round(cum)}h in last 30 days`,
      lineChartSvg(pts, { min: 0, area: true }), "Running total of your actual logged fasts");
  }

  function walkingChartCard() {
    const t = cfg.recurring.find(r => /treadmill|walk/i.test(r.name));
    if (!t) return "";
    const today = util.todayKey();
    const data = [];
    for (let w = 5; w >= 0; w--) {
      const wkStart = util.addDays(util.weekKeyOf(today, cfg.weekStartDow), -7 * w);
      let count = 0;
      for (let d = 0; d < 7; d++) {
        const k = util.addDays(wkStart, d);
        if (k <= today && tracking.dayTaskDone(k, t.id)) count++;
      }
      data.push({ value: count, dim: w !== 0 && count === 0 });
    }
    const thisWeek = data[data.length - 1].value;
    return chartCard("🚶 Walking", `${thisWeek} this week`,
      barChartSvg(data, { max: Math.max(4, ...data.map(d => d.value)) }), `${esc(t.name)} · last 6 weeks`);
  }

  function weightChartCard() {
    const m = (cfg.metrics || []).find(x => x.id === "weight");
    if (!m) return "";
    const series = tracking.metricSeries("weight", 30);
    const latest = tracking.metricLatest("weight");
    const sub = latest ? `${latest.value} ${esc(m.unit || "")}` : "";
    if (series.length < 2) return chartCard("⚖️ Weight", sub, `<p class="muted" style="margin:0">Log weight on 2+ days for a trend.</p>`);
    return chartCard("⚖️ Weight", sub, lineChartSvg(series.map(p => ({ value: p.value })), {}), "Last 30 days");
  }

  function renderHome() {
    return fastingCard() + timelineCard()
      + sleepChartCard() + stepsChartCard() + fastingChartCard() + walkingChartCard() + weightChartCard()
      + dailyStatsCard() + taskStatsCard() + reflectionStatsCard();
  }

  /* ============================================================
     Settings screen — editable, data-driven config
     ============================================================ */
  function renderSettings() {
    return dailyHabitsEditor() + recurringEditor() + metricsEditor() + scheduleEditor()
      + drinkingLimitEditor() + remindersEditor() + googleCalendarEditor() + syncEditor() + privacyEditor() + anchorsEditor() + dataCard();
  }

  function metricsEditor() {
    const rows = (cfg.metrics || []).map(m =>
      `<div class="edit-row">
         <div class="edit-row-main">${esc(m.name)} <span class="muted">(${esc(m.unit || "")})</span></div>
         <button class="iconbtn" data-action="delete-metric" data-id="${m.id}" title="Delete">🗑</button>
       </div>`).join("");
    const form = `
      <form class="taskform" data-action="create-metric">
        <div class="form-line" style="gap:8px">
          <input name="name" placeholder="Metric name (e.g. Weight)" autocomplete="off" required style="flex:1">
          <input name="unit" placeholder="unit" autocomplete="off" style="width:84px">
        </div>
        <div class="form-actions"><button class="btn btn-accent" type="submit">+ Add metric</button></div>
      </form>`;
    return `<div class="card"><h2>Metrics</h2>${rows || '<p class="muted">None.</p>'}${form}</div>`;
  }

  function remindersEditor() {
    const supported = typeof Notification !== "undefined";
    const perm = supported ? Notification.permission : "unsupported";
    let status;
    if (!supported) status = "Notifications aren’t supported in this browser.";
    else if (perm === "denied") status = "Blocked. Enable notifications for this site in your browser settings, then try again.";
    else if (perm === "granted") status = cfg.remindersEnabled
      ? "On — you’ll get a nudge for timed tasks while the app is open."
      : "Allowed. Turn on below.";
    else status = "Allow notifications to get nudges for your timed tasks.";
    const on = cfg.remindersEnabled && perm === "granted";
    const btn = on
      ? `<button class="btn" data-action="reminders-off">Turn off</button>`
      : (supported && perm !== "denied"
          ? `<button class="btn btn-accent" data-action="reminders-on">Enable reminders</button>` : "");
    return `
      <div class="card">
        <h2>Reminders</h2>
        <p class="muted" style="font-size:.84rem;margin-top:0">${status}</p>
        ${btn}
        <p class="muted" style="font-size:.76rem;margin-bottom:0">Heads up: these fire only while the app is open. Reliable alarms when the app is closed need a server (which this offline app doesn’t use) and aren’t dependable on iPhone — for hard alarms, also set one in your phone’s Reminders/Clock app.</p>
      </div>`;
  }

  function dailyHabitsEditor() {
    const rows = cfg.habits.filter(isDailyCheck).map(h =>
      `<div class="edit-row">
         <div class="edit-row-main">${h.icon || ""} ${esc(h.name)}</div>
         <button class="iconbtn" data-action="delete-habit" data-id="${h.id}" title="Delete">🗑</button>
       </div>`).join("");
    const form = `
      <form class="taskform" data-action="create-daily-habit">
        <div class="form-line" style="gap:8px">
          <input name="icon" placeholder="🙂" maxlength="2" style="width:60px;text-align:center">
          <input name="name" placeholder="New daily habit" autocomplete="off" required style="flex:1">
        </div>
        <div class="form-actions"><button class="btn btn-accent" type="submit">+ Add daily habit</button></div>
      </form>`;
    return `<div class="card"><h2>Daily habits</h2>${rows || '<p class="muted">None yet.</p>'}${form}</div>`;
  }

  function dayToggleRow(selectedDays, namePrefix) {
    return `<div class="daypick">` + DOW_ORDER.map(d =>
      `<label class="daypick-day">
         <input type="checkbox" name="${namePrefix}" value="${d}" ${selectedDays.includes(d) ? "checked" : ""}>
         <span>${util.DAY_SHORT[d]}</span>
       </label>`).join("") + `</div>`;
  }

  function recurringEditor() {
    const rows = cfg.recurring.map(t => {
      if (state.editTaskId === t.id) return taskForm(t);
      const days = isAsNeeded(t) ? "as needed"
        : DOW_ORDER.filter(d => t.days.includes(d)).map(d => util.DAY_SHORT[d]).join(" ");
      return `
        <div class="edit-row">
          <div class="edit-row-main">
            <div>${esc(t.name)}</div>
            <div class="muted" style="font-size:.8rem">${days || "no days"}${t.time ? " · " + util.minutesToLabel(util.hmToMinutes(t.time)) : ""}</div>
          </div>
          <button class="iconbtn" data-action="edit-task" data-id="${t.id}" title="Edit">✎</button>
          <button class="iconbtn" data-action="delete-task" data-id="${t.id}" title="Delete">🗑</button>
        </div>`;
    }).join("");
    const addBtn = state.addingTask ? taskForm(null)
      : `<button class="btn btn-accent" data-action="add-task" style="margin-top:8px">+ Add a task</button>`;
    return `<div class="card"><h2>Recurring tasks</h2>${rows || '<p class="muted">None yet.</p>'}${addBtn}</div>`;
  }

  // Shared add/edit form for a recurring task. `task` null = adding.
  function taskForm(task) {
    const isEdit = !!task;
    const asNeeded = task ? isAsNeeded(task) : false;
    const days = task ? task.days : [];
    return `
      <form class="taskform" data-action="${isEdit ? "save-task" : "create-task"}" ${isEdit ? `data-id="${task.id}"` : ""}>
        <input name="name" placeholder="Task name" value="${task ? esc(task.name) : ""}" autocomplete="off" required>
        <label class="form-line asneeded-toggle">
          <span>As needed <span class="muted" style="font-size:.8rem">(no set days, no streak)</span></span>
          <input type="checkbox" name="asneeded" ${asNeeded ? "checked" : ""}>
        </label>
        <div class="days-wrap" ${asNeeded ? 'style="display:none"' : ""}>
          ${dayToggleRow(days, "days")}
        </div>
        <div class="form-line">
          <label class="muted" style="font-size:.85rem">Time (optional)</label>
          <input type="time" name="time" value="${task && task.time ? task.time : ""}">
        </div>
        <div class="form-actions">
          <button class="btn btn-accent" type="submit">${isEdit ? "Save" : "Add task"}</button>
          <button class="btn" type="button" data-action="cancel-task">Cancel</button>
        </div>
      </form>`;
  }

  function scheduleEditor() {
    const rows = DOW_ORDER.map(d => {
      const win = (cfg.eatingSchedule[d] || [])[0] || { start: "", end: "" };
      const endVal = win.end === "24:00" ? "00:00" : win.end; // midnight shown as 00:00
      return `
        <div class="sched-row">
          <span class="sched-day">${util.DAY_NAMES[d]}</span>
          <input type="time" data-sched="${d}" data-edge="start" value="${win.start}">
          <span class="muted">→</span>
          <input type="time" data-sched="${d}" data-edge="end" value="${endVal}">
        </div>`;
    }).join("");
    return `
      <div class="card">
        <h2>Eating schedule</h2>
        <p class="muted" style="font-size:.82rem;margin-top:0">End at 12:00am means midnight. Anything outside a window is fasting.</p>
        ${rows}
        <button class="btn btn-accent" data-action="save-schedule" style="margin-top:10px">Save schedule</button>
      </div>`;
  }

  function drinkingLimitEditor() {
    const h = cfg.habits.find(x => x.type === "weekly-limit");
    if (!h) return "";
    return `
      <div class="card">
        <h2>Drinking limit</h2>
        <div class="form-line">
          <label class="muted">Allowed drinking days per week</label>
          <input type="number" min="0" max="7" value="${h.limitPerWeek || 1}" data-action="save-limit" style="width:64px">
        </div>
      </div>`;
  }

  function anchorsEditor() {
    const rows = (cfg.anchors || []).map(a => {
      const days = DOW_ORDER.filter(d => a.days.includes(d)).map(d => util.DAY_SHORT[d]).join(" ");
      return `<div class="edit-row">
          <div class="edit-row-main">
            <div>${esc(a.name)}</div>
            <div class="muted" style="font-size:.8rem">${days} · ${util.minutesToLabel(util.hmToMinutes(a.start))}–${util.minutesToLabel(util.hmToMinutes(a.end))}</div>
          </div>
        </div>`;
    }).join("");
    return `<div class="card"><h2>Day anchors</h2>${rows || '<p class="muted">None.</p>'}
        <p class="muted" style="font-size:.8rem">Shown on the Today timeline for context (e.g. your work block).</p></div>`;
  }

  function privacyEditor() {
    const locked = !!cfg.lockHash;
    return `
      <div class="card">
        <h2>Privacy / passcode</h2>
        <p class="muted" style="font-size:.84rem;margin-top:0">${locked
          ? "A passcode is required to open this app."
          : "No passcode set. Generate a hash below and send it to me to turn the lock on."}</p>
        <label class="muted" style="font-size:.8rem">Choose a passphrase</label>
        <div class="form-line" style="margin-top:4px;gap:8px">
          <input type="text" id="lock-gen-input" placeholder="e.g. a few words you'll remember" style="flex:1" autocomplete="off">
          <button class="btn" data-action="lock-generate" type="button">Generate</button>
        </div>
        <div id="lock-gen-out" class="lock-gen-out muted"></div>
        ${locked ? `<div class="form-actions" style="margin-top:12px"><button class="btn" data-action="lock-now">Lock now (this device)</button></div>` : ""}
        <p class="muted" style="font-size:.76rem;margin-bottom:0">Deterrent, not strong security: the hash ships in the app’s public code, so use a real passphrase (not a 4-digit PIN). Your data is already private to your devices regardless.</p>
      </div>`;
  }

  function dataCard() {
    return `
      <div class="card">
        <h2>Data</h2>
        <div class="form-actions">
          <button class="btn" data-action="export">Export backup (.json)</button>
          <label class="btn">Import backup
            <input type="file" accept="application/json,.json" data-action="import-file" hidden>
          </label>
          <button class="btn" data-action="reset">Reset everything</button>
        </div>
        <p class="muted" style="font-size:.8rem">Everything is stored only in this browser. Export makes a backup file; Import restores one (replacing current data) — also how you’d move data to another device for now.</p>
      </div>`;
  }

  /* ============================================================
     Event handling (delegated)
     ============================================================ */
  function handleClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    const key = el.dataset.key, id = el.dataset.id;

    switch (a) {
      case "go":
        state.tab = el.dataset.tab;
        state.editFastId = null; state.addingFast = false; // close any open fast editor
        rerender();
        break;

      case "toggle-habit": /* handled in change (checkbox) */ break;
      case "toggle-task":  /* handled in change (checkbox) */ break;
      case "delete-habit":
        if (confirm("Delete this daily habit? Its past check-offs stay in storage but it stops appearing.")) {
          cfg.habits = cfg.habits.filter(h => h.id !== id); saveCfg(); render();
        }
        break;

      case "clear-drink":  tracking.clearDrink(key); render(); break;
      case "remove-meal":  tracking.removeMeal(key, Number(el.dataset.at)); render(); break;
      case "set-rating":   tracking.setRating(key, Number(el.dataset.val)); render(); break;
      case "clear-sleep":  tracking.clearSleep(key); render(); break;
      case "start-fast":   tracking.startFast(); render(); break;
      case "end-fast": {
        const f = tracking.stopFast();
        if (f) flash(`Fast saved · ${util.humanDuration((f.end - f.start) / 60000)}`);
        render();
        break;
      }
      case "edit-fast":   state.editFastId = id; state.addingFast = false; render(); break;
      case "add-fast-toggle": state.addingFast = true; state.editFastId = null; render(); break;
      case "cancel-fast-edit": state.editFastId = null; state.addingFast = false; render(); break;
      case "delete-fast":
        if (confirm("Delete this fast?")) { tracking.removeFast(id); render(); }
        break;
      case "remove-work":  tracking.removeWorkTodo(id); render(); break;

      case "hist-prev":  state.histDate = util.addDays(state.histDate, -1); state.calAnchor = state.histDate; render(); break;
      case "hist-next":  state.histDate = util.addDays(state.histDate, 1);  state.calAnchor = state.histDate; render(); break;
      case "hist-today": state.histDate = util.todayKey(); state.calAnchor = state.histDate; render(); break;

      case "cal-day":   state.histDate = el.dataset.key; render(); break;
      case "cal-prev":  shiftCal(-1); break;
      case "cal-next":  shiftCal(1); break;
      case "cal-mode":  state.calMode = state.calMode === "month" ? "week" : "month"; render(); break;

      case "add-task":    state.addingTask = true; state.editTaskId = null; render(); break;
      case "edit-task":   state.editTaskId = id; state.addingTask = false; render(); break;
      case "cancel-task": state.addingTask = false; state.editTaskId = null; render(); break;
      case "delete-task":
        if (confirm("Delete this task? Its history stays but it stops appearing.")) {
          cfg.recurring = cfg.recurring.filter(t => t.id !== id); saveCfg(); render();
        }
        break;
      case "save-schedule": saveSchedule(); break;
      case "export": exportData(); break;
      case "reset":  resetAll(); break;

      case "lock-generate": generateLockHash(); break;
      case "lock-now": localStorage.removeItem("ht.unlock"); location.reload(); break;

      case "delete-metric":
        if (confirm("Delete this metric? Its logged values stay in storage but it stops appearing.")) {
          cfg.metrics = (cfg.metrics || []).filter(m => m.id !== id); saveCfg(); render();
        }
        break;
      case "reminders-on":  enableReminders(); break;
      case "reminders-off": cfg.remindersEnabled = false; saveCfg(); render(); break;

      case "gcal-connect":    gcalConnect(); break;
      case "gcal-disconnect": HT.gcal.disconnect(); render(); break;
      case "sync-enable": enableSync(); break;
      case "sync-now":    doSyncNow(); break;
      case "sync-off":    cfg.syncEnabled = false; saveCfg(); render(); break;
      case "event-to-work":   tracking.addWorkTodo("day", el.dataset.title, { evtId: el.dataset.evtid }); flash("Added to Work"); render(); break;
      case "import-events": {
        const n = tracking.importCalendarEvents(HT.gcal.cachedEvents(util.todayKey()) || []);
        flash(n ? `Added ${n} to Work` : "Already in Work");
        render();
        break;
      }
    }
  }

  // Move the calendar by one month (month view) or one week (week view).
  function shiftCal(dir) {
    if (state.calMode === "month") {
      const d = util.keyToDate(state.calAnchor);
      state.calAnchor = util.dateKey(new Date(d.getFullYear(), d.getMonth() + dir, 1));
    } else {
      state.calAnchor = util.addDays(state.calAnchor, dir * 7);
    }
    render();
  }

  function handleChange(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    if (e.target.name === "asneeded") {
      // Live-hide the day picker when a task is marked as-needed.
      const wrap = e.target.closest("form").querySelector(".days-wrap");
      if (wrap) wrap.style.display = e.target.checked ? "none" : "";
      return;
    }
    const act = el.dataset.action;
    if (act === "save-note") {
      // Save quietly on blur — NO re-render, or the textarea would lose focus.
      tracking.setNote(el.dataset.key, e.target.value);
      return;
    }
    if (act === "save-metric") {
      tracking.setMetric(el.dataset.key, el.dataset.id, e.target.value); render(); return;
    }
    if (act === "edit-fast-start") {
      if (!e.target.value) return;
      let ts = new Date(e.target.value).getTime(); // datetime-local parses as local time
      if (isNaN(ts)) return;
      if (ts > Date.now()) { ts = Date.now(); flash("Can't start in the future"); }
      tracking.setFastStart(ts);
      render();
      return;
    }
    if (act === "save-gcal-clientid") {
      cfg.google = cfg.google || {}; cfg.google.clientId = e.target.value.trim(); saveCfg(); return;
    }
    if (act === "save-gcal-calid") {
      cfg.google = cfg.google || {}; cfg.google.calendarId = e.target.value.trim() || "primary"; saveCfg(); return;
    }
    if (act === "import-file") {
      const file = e.target.files && e.target.files[0];
      if (file) importFromFile(file);
      return;
    }
    if (el.dataset.action === "toggle-task") {
      tracking.toggleTask(el.dataset.key, el.dataset.id); render();
    } else if (el.dataset.action === "toggle-habit") {
      tracking.toggleHabit(el.dataset.key, el.dataset.id); render();
    } else if (el.dataset.action === "toggle-work") {
      tracking.toggleWorkTodo(el.dataset.id); render();
    } else if (el.dataset.action === "save-limit") {
      const h = cfg.habits.find(x => x.type === "weekly-limit");
      h.limitPerWeek = Math.max(0, Math.min(7, Number(el.value) || 0)); saveCfg();
    }
  }

  function handleSubmit(e) {
    const form = e.target.closest("form[data-action]");
    if (!form) return;
    e.preventDefault();
    const a = form.dataset.action;
    const data = Object.fromEntries(new FormData(form).entries());

    if (a === "save-drink") {
      tracking.logDrink(form.dataset.key, { what: data.what || "", amount: data.amount || "" });
      render();
    } else if (a === "add-meal") {
      const at = timeInputToTs(form.dataset.key, data.time);
      tracking.addMeal(form.dataset.key, { at, note: data.note || "" });
      render();
    } else if (a === "save-sleep") {
      const { bed, wake } = sleepTimesToTs(form.dataset.key, data.bed || "23:00", data.wake || "07:00");
      tracking.setSleep(form.dataset.key, bed, wake);
      render();
    } else if (a === "create-task" || a === "save-task") {
      saveTaskFromForm(form, a === "save-task" ? form.dataset.id : null);
    } else if (a === "save-fast" || a === "create-fast") {
      const v = readFastForm(form);
      if (!v) return;
      if (a === "save-fast") tracking.updateFast(form.dataset.id, v.start, v.end);
      else tracking.addFast(v.start, v.end);
      state.editFastId = null; state.addingFast = false; render();
    } else if (a === "create-daily-habit") {
      const name = (data.name || "").trim();
      if (!name) return;
      cfg.habits.push({ id: "habit-" + Date.now().toString(36), name, icon: (data.icon || "").trim(), type: "daily-check" });
      saveCfg(); render();
    } else if (a === "create-metric") {
      const name = (data.name || "").trim();
      if (!name) return;
      cfg.metrics = cfg.metrics || [];
      cfg.metrics.push({ id: "metric-" + Date.now().toString(36), name, unit: (data.unit || "").trim() });
      saveCfg(); render();
    } else if (a === "add-work") {
      const text = (data.text || "").trim();
      if (!text) return;
      tracking.addWorkTodo(form.dataset.scope, text);
      render();
    }
  }

  // Convert a <input type=time> on a given day into a timestamp (defaults to now).
  function timeInputToTs(key, hhmm) {
    const base = util.keyToDate(key);
    if (hhmm && /^\d{2}:\d{2}$/.test(hhmm)) {
      const [h, m] = hhmm.split(":").map(Number);
      base.setHours(h, m, 0, 0);
      return base.getTime();
    }
    return Date.now();
  }

  // Read + validate the start/end of a fast form. Returns {start,end} or null.
  function readFastForm(form) {
    const fd = new FormData(form);
    const start = new Date(fd.get("start")).getTime();
    const end = new Date(fd.get("end")).getTime();
    if (isNaN(start) || isNaN(end)) { flash("Enter a start and end"); return null; }
    if (end <= start) { flash("End must be after start"); return null; }
    if (end > Date.now() + 60000) { flash("End can't be in the future"); return null; }
    return { start, end };
  }

  // Turn bedtime/wake "HH:MM" into timestamps for the night that ends on `key`.
  // If bedtime is later in the clock than wake (e.g. 23:00 vs 07:00), bedtime
  // belongs to the previous evening.
  function sleepTimesToTs(key, bedHM, wakeHM) {
    const [bh, bm] = bedHM.split(":").map(Number);
    const [wh, wm] = wakeHM.split(":").map(Number);
    const wake = util.keyToDate(key); wake.setHours(wh, wm, 0, 0);
    const bed = util.keyToDate(key); bed.setHours(bh, bm, 0, 0);
    if (util.hmToMinutes(bedHM) > util.hmToMinutes(wakeHM)) bed.setDate(bed.getDate() - 1);
    return { bed: bed.getTime(), wake: wake.getTime() };
  }

  function saveTaskFromForm(form, existingId) {
    const fd = new FormData(form);
    const name = (fd.get("name") || "").toString().trim();
    if (!name) return;
    const asNeeded = fd.get("asneeded") != null;
    const mode = asNeeded ? "asNeeded" : "scheduled";
    const days = asNeeded ? [] : fd.getAll("days").map(Number).sort();
    const time = (fd.get("time") || "").toString() || null;
    if (existingId) {
      const t = cfg.recurring.find(x => x.id === existingId);
      Object.assign(t, { name, mode, days, time });
    } else {
      cfg.recurring.push({ id: "task-" + Date.now().toString(36), name, mode, days, time });
    }
    state.editTaskId = null; state.addingTask = false; saveCfg(); render();
  }

  function saveSchedule() {
    document.querySelectorAll("[data-sched]").forEach(inp => {
      const d = inp.dataset.sched, edge = inp.dataset.edge;
      const win = (cfg.eatingSchedule[d] && cfg.eatingSchedule[d][0]) || { start: "12:00", end: "20:00" };
      let val = inp.value || (edge === "start" ? "12:00" : "20:00");
      if (edge === "end" && val === "00:00") val = "24:00"; // midnight
      win[edge] = val;
      cfg.eatingSchedule[d] = [win];
    });
    saveCfg(); render();
    flash("Schedule saved");
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tracker-backup-${util.todayKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function enableReminders() {
    if (typeof Notification === "undefined") { flash("Notifications not supported"); return; }
    Notification.requestPermission().then(p => {
      cfg.remindersEnabled = (p === "granted");
      saveCfg();
      if (p === "granted") { flash("Reminders on"); checkReminders(); }
      render();
    });
  }

  function importFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { alert("Couldn't read that file — it isn't valid JSON."); return; }
      if (!confirm("Replace ALL current data in this browser with this backup?")) return;
      try {
        store.importAll(data);
        cfg = store.getConfig();
        state.histDate = util.todayKey();
        rerender();
        flash("Backup imported");
        if (cfg.syncEnabled) HT.sync.push(true).catch(() => {});
      } catch (e) { alert("Import failed: " + e.message); }
    };
    reader.readAsText(file);
  }

  // Foreground-only reminders: while the app is open, nudge once when a timed
  // task's time has arrived and it's still unchecked. (Background alarms aren't
  // possible in a serverless PWA — documented in Settings.)
  function checkReminders() {
    if (!cfg.remindersEnabled || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const today = util.todayKey();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const dow = util.weekdayOf(today);
    cfg.recurring.forEach(t => {
      if (isAsNeeded(t) || !t.time || !t.days.includes(dow)) return;
      const tm = util.hmToMinutes(t.time);
      if (nowMin >= tm && nowMin < tm + 60 && !tracking.dayTaskDone(today, t.id)) {
        const flag = "ht.notified." + today + "." + t.id;
        if (!localStorage.getItem(flag)) {
          localStorage.setItem(flag, "1");
          try { new Notification("Reminder: " + t.name, { body: "Scheduled for " + util.minutesToLabel(tm), tag: flag }); } catch (e) {}
        }
      }
    });
  }

  function generateLockHash() {
    const input = document.getElementById("lock-gen-input");
    const out = document.getElementById("lock-gen-out");
    const pass = (input && input.value || "").trim();
    if (!pass) { if (out) out.textContent = "Type a passphrase first."; return; }
    if (pass.length < 6 && out) out.innerHTML = `<span style="color:var(--warn)">Tip: longer is much safer.</span> `;
    hashPasscode(pass).then(h => {
      out.innerHTML = `Send me this line to turn on the lock:
        <code class="lock-hash">lockHash: "${h}"</code>
        <span style="font-size:.74rem">Then everyone (including you, once per new device) must enter “${esc(pass)}” to open the app.</span>`;
    });
  }

  function resetAll() {
    if (!confirm("This erases ALL tracked data and settings in this browser. Continue?")) return;
    Object.keys(localStorage).filter(k => k.startsWith("ht.")).forEach(k => localStorage.removeItem(k));
    cfg = store.getConfig();
    state.histDate = util.todayKey();
    rerender();
  }

  function flash(msg) {
    let f = document.getElementById("flash");
    if (!f) { f = document.createElement("div"); f.id = "flash"; f.className = "flash"; document.body.appendChild(f); }
    f.textContent = msg; f.classList.add("show");
    setTimeout(() => f.classList.remove("show"), 1400);
  }

  /* ============================================================
     Boot
     ============================================================ */
  function startApp() {
    cfg = store.getConfig();
    document.getElementById("header-date").textContent = util.prettyDate(util.todayKey());
    const view = document.getElementById("view");
    // Clicks are handled at the document level so the bottom tab bar
    // (which lives outside #view) shares the same delegated handler.
    document.addEventListener("click", handleClick);
    view.addEventListener("change", handleChange);
    view.addEventListener("submit", handleSubmit);
    renderTabbar();
    render();
    setInterval(updateFastingLive, 1000);
    checkReminders();
    setInterval(checkReminders, 60000); // re-check timed tasks each minute while open
    gcalRefresh(); // refresh calendar events if already connected this session

    // Auto-push (debounced) whenever data changes, if sync is on.
    let pushTimer = null;
    store.onChange(() => {
      if (!cfg.syncEnabled) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => HT.sync.push(true).catch(() => {}), 3000);
    });
    // Auto-pull on open (silent — no popup); adopt + re-render if newer.
    if (cfg.syncEnabled) {
      HT.sync.pull(true).then(p => {
        if (p.pulled) { cfg = store.getConfig(); render(); flash("Synced from another device"); }
      }).catch(() => {});
    }
  }

  // Derive a PBKDF2-SHA256 hex hash of a passcode (slows brute-force; fixed app
  // salt). Used by both the lock screen and the Settings hash generator.
  async function hashPasscode(pass) {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: enc.encode("habit-tracker-lock-v1"), iterations: 150000, hash: "SHA-256" }, km, 256);
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // Full-screen lock overlay shown before the app boots when a passcode is set.
  function showLockScreen(expectedHash, onUnlock) {
    const ov = document.createElement("div");
    ov.className = "lockscreen";
    ov.innerHTML = `
      <form class="lockbox" id="lockform">
        <div class="lock-emoji">🔒</div>
        <div class="lock-title">Enter passcode</div>
        <input type="password" id="lock-input" placeholder="Passcode" autocomplete="current-password" autofocus>
        <button class="btn btn-accent" type="submit">Unlock</button>
        <div class="lock-err" id="lock-err"></div>
      </form>`;
    document.body.appendChild(ov);
    const input = ov.querySelector("#lock-input");
    const err = ov.querySelector("#lock-err");
    ov.querySelector("#lockform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const h = await hashPasscode(input.value);
      if (h === expectedHash) {
        localStorage.setItem("ht.unlock", expectedHash); // stays unlocked on this device
        ov.remove();
        onUnlock();
      } else {
        err.textContent = "Wrong passcode";
        input.value = ""; input.focus();
      }
    });
    setTimeout(() => input.focus(), 50);
  }

  function boot() {
    const c = store.getConfig();
    if (c.lockHash && localStorage.getItem("ht.unlock") !== c.lockHash) {
      showLockScreen(c.lockHash, startApp);
    } else {
      startApp();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
