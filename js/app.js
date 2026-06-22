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
    { id: "today",    icon: "📅", label: "Today" },
    { id: "history",  icon: "🗓️", label: "Calendar" },
    { id: "settings", icon: "⚙️", label: "Settings" },
  ];

  const state = {
    tab: "today", histDate: util.todayKey(),
    calMode: "month", calAnchor: util.todayKey(),  // calendar view state
    editTaskId: null, addingTask: false,
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
    if (state.tab === "today")        view.innerHTML = renderToday();
    else if (state.tab === "history") view.innerHTML = renderHistory();
    else                              view.innerHTML = renderSettings();
    if (state.tab === "today") updateFastingLive();
    window.scrollTo(0, 0);
  }

  /* ============================================================
     Shared day sections (used by Today and History)
     ============================================================ */
  function noSmokingCard(key, isToday) {
    const h = cfg.habits.find(x => x.type === "tap-streak");
    if (!h) return "";
    const done = tracking.dayHabitDone(key, h.id);
    const streak = tracking.habitStreak(h.id);
    const total = tracking.habitTotal(h.id);
    return `
      <div class="card">
        <h2>${h.icon || ""} ${esc(h.name)}</h2>
        <button class="tapbtn ${done ? "is-done" : ""}" data-action="toggle-habit"
                data-id="${h.id}" data-key="${key}">
          ${done ? "✓ Done" + (isToday ? " today" : "") : (isToday ? "Tap to mark today" : "Mark this day")}
        </button>
        <div class="stat-row">
          <div class="stat"><span class="stat-num">${streak}</span><span class="stat-lbl">day streak</span></div>
          <div class="stat"><span class="stat-num">${total}</span><span class="stat-lbl">days total</span></div>
        </div>
      </div>`;
  }

  function isAsNeeded(t) { return t.mode === "asNeeded"; }

  function taskRow(t, key) {
    const done = tracking.dayTaskDone(key, t.id);
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
          ${t.time ? `<span class="checkrow-time">${util.minutesToLabel(util.hmToMinutes(t.time))}</span>` : ""}
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

  /* ============================================================
     Today screen
     ============================================================ */
  function renderToday() {
    const key = util.todayKey();
    return fastingCard() + timelineCard(key)
      + noSmokingCard(key, true)
      + tasksCard(key, true)
      + drinkingCard(key)
      + mealsCard(key);
  }

  function fastingCard() {
    return `
      <div class="card fasting-card" id="fasting-card">
        <div class="fasting-state">
          <span class="fasting-dot" id="fasting-dot"></span>
          <span id="fasting-label">…</span>
        </div>
        <div class="fasting-elapsed" id="fasting-elapsed">—</div>
        <div class="fasting-next muted" id="fasting-next">—</div>
        <div class="fasting-bar"><div class="fasting-bar-fill" id="fasting-bar-fill"></div></div>
      </div>`;
  }

  function timelineCard(key) {
    const segs = fasting.dayEatingSegments(cfg, key);
    const pct = m => (m / 1440) * 100;
    const eating = segs.map(s =>
      `<div class="tl-eat" style="left:${pct(s.startMin)}%;width:${pct(s.endMin - s.startMin)}%"
            title="Eating ${util.minutesToLabel(s.startMin)}–${util.minutesToLabel(s.endMin)}"></div>`).join("");
    const dow = util.weekdayOf(key);
    const anchors = (cfg.anchors || []).filter(a => a.days.includes(dow)).map(a => {
      const s = util.hmToMinutes(a.start), e = util.hmToMinutes(a.end);
      return `<div class="tl-anchor" style="left:${pct(s)}%;width:${pct(e - s)}%"
                   title="${esc(a.name)} ${util.minutesToLabel(s)}–${util.minutesToLabel(e)}"></div>`;
    }).join("");
    const ticks = [6, 12, 18].map(h =>
      `<div class="tl-tick" style="left:${pct(h * 60)}%"><span>${util.minutesToLabel(h * 60)}</span></div>`).join("");
    return `
      <div class="card">
        <h2>Today’s rhythm</h2>
        <div class="timeline">${eating}${anchors}${ticks}<div class="tl-now" id="tl-now"></div></div>
        <div class="tl-legend muted">
          <span><i class="sw eat"></i>Eating</span>
          <span><i class="sw fast"></i>Fasting</span>
          <span><i class="sw anchor"></i>Work</span>
        </div>
      </div>`;
  }

  function updateFastingLive() {
    if (state.tab !== "today") return;
    const now = new Date();
    const st = fasting.getStatus(cfg, now);
    const eating = st.state === "eating";
    const label = document.getElementById("fasting-label");
    if (!label) return;
    document.getElementById("fasting-dot").className = "fasting-dot " + (eating ? "is-eat" : "is-fast");
    label.textContent = eating ? "Eating window" : "Fasting";

    const sinceMin = st.sinceTs != null ? (now - st.sinceTs) / 60000 : null;
    const remainMin = st.nextTs != null ? (st.nextTs - now) / 60000 : null;
    document.getElementById("fasting-elapsed").innerHTML = sinceMin != null
      ? `${util.humanDuration(sinceMin)} <span class="muted" style="font-size:.55em;font-weight:400">so far</span>` : "—";

    const next = document.getElementById("fasting-next");
    if (st.nextTs != null) {
      const d = new Date(st.nextTs);
      const at = util.minutesToLabel(d.getHours() * 60 + d.getMinutes());
      next.textContent = `${eating ? "Fast begins" : "Eating begins"} in ${util.humanDuration(remainMin)} · at ${at}`;
    } else next.textContent = "";

    const fill = document.getElementById("fasting-bar-fill");
    if (st.sinceTs != null && st.nextTs != null) {
      const frac = (now - st.sinceTs) / (st.nextTs - st.sinceTs);
      fill.style.width = Math.max(0, Math.min(100, frac * 100)) + "%";
      fill.className = "fasting-bar-fill " + (eating ? "is-eat" : "is-fast");
    }
    const marker = document.getElementById("tl-now");
    if (marker) marker.style.left = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100 + "%";
  }

  /* ============================================================
     History screen — scrub past days + fast history
     ============================================================ */
  function renderHistory() {
    const key = state.histDate;
    const isToday = key === util.todayKey();
    const nav = `
      <div class="card daynav">
        <button class="iconbtn" data-action="hist-prev">‹</button>
        <div class="daynav-mid">
          <div class="daynav-date">${util.prettyDate(key)}</div>
          ${isToday ? '<div class="muted" style="font-size:.8rem">Today</div>'
                    : `<button class="linkbtn" data-action="hist-today">Jump to today</button>`}
        </div>
        <button class="iconbtn" data-action="hist-next" ${isToday ? "disabled" : ""}>›</button>
      </div>`;

    return calendarCard()
      + nav
      + noSmokingCard(key, isToday)
      + tasksCard(key, isToday)
      + drinkingCard(key)
      + mealsCard(key)
      + fastHistoryCard();
  }

  /* ---------- Calendar ---------- */
  // Does a day have anything logged? (used for the activity dot)
  function hasActivity(key) {
    const r = store.getDay(key);
    return (r.habits && Object.keys(r.habits).length) ||
           (r.recurring && Object.keys(r.recurring).length) ||
           (r.meals && r.meals.length);
  }

  function calCell(key) {
    if (!key) return `<div class="cal-cell empty"></div>`;
    const d = util.keyToDate(key);
    const today = util.todayKey();
    const cls = ["cal-cell"];
    if (key === today) cls.push("today");
    if (key === state.histDate) cls.push("sel");
    const future = key > today;
    if (future) cls.push("future");
    const dot = !future && hasActivity(key) ? '<span class="cal-dot"></span>' : "";
    return `<button class="${cls.join(" ")}" data-action="cal-day" data-key="${key}" ${future ? "disabled" : ""}>
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

  function fastHistoryCard() {
    const fasts = fasting.recentFasts(cfg, new Date(), 10);
    if (!fasts.length) return `<div class="card"><h2>Past fasts</h2><p class="muted">No completed fasts yet.</p></div>`;
    const rows = fasts.map(f => {
      const s = new Date(f.start), e = new Date(f.end);
      return `<li class="fast-item">
          <span class="fast-dur">${util.humanDuration(f.durationMin)}</span>
          <span class="muted">${util.MONTH_SHORT[s.getMonth()]} ${s.getDate()}, ${labelTime(s)} → ${labelTime(e)}</span>
        </li>`;
    }).join("");
    return `<div class="card"><h2>Past fasts</h2><ul class="fast-list">${rows}</ul></div>`;
  }
  function labelTime(d) { return util.minutesToLabel(d.getHours() * 60 + d.getMinutes()); }

  /* ============================================================
     Settings screen — editable, data-driven config
     ============================================================ */
  function renderSettings() {
    return recurringEditor() + scheduleEditor() + drinkingLimitEditor() + anchorsEditor() + dataCard();
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

  function dataCard() {
    return `
      <div class="card">
        <h2>Data</h2>
        <div class="form-actions">
          <button class="btn" data-action="export">Export backup (.json)</button>
          <button class="btn" data-action="reset">Reset everything</button>
        </div>
        <p class="muted" style="font-size:.8rem">Everything is stored only in this browser. Export makes a backup file.</p>
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
      case "go": state.tab = el.dataset.tab; rerender(); break;

      case "toggle-habit": tracking.toggleHabit(key, id); render(); break;
      case "toggle-task":  /* handled in change */ break;

      case "clear-drink":  tracking.clearDrink(key); render(); break;
      case "remove-meal":  tracking.removeMeal(key, Number(el.dataset.at)); render(); break;

      case "hist-prev":  state.histDate = util.addDays(state.histDate, -1); state.calAnchor = state.histDate; render(); break;
      case "hist-next":
        if (state.histDate < util.todayKey()) { state.histDate = util.addDays(state.histDate, 1); state.calAnchor = state.histDate; render(); }
        break;
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
    if (el.dataset.action === "toggle-task") {
      tracking.toggleTask(el.dataset.key, el.dataset.id); render();
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
    } else if (a === "create-task" || a === "save-task") {
      saveTaskFromForm(form, a === "save-task" ? form.dataset.id : null);
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
  function boot() {
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
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
