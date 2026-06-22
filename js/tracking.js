/* ============================================================
   tracking.js — habit/task data operations + streak math.

   Pure-ish logic on top of HT.store. No DOM. Covers:
     - tap-streak habits (e.g. "No smoking"): toggle, current streak, lifetime total
     - recurring tasks: toggle, streak over SCHEDULED days only, total
     - weekly-limit habits (e.g. "Drinking"): log, count this week, over-limit
     - meals: add / remove
   ============================================================ */
window.HT = window.HT || {};

HT.tracking = (function () {
  const { todayKey, addDays, weekdayOf, weekKeyOf, dateKey } = HT.util;
  const store = HT.store;

  /* ---------- small lookups ---------- */
  function isDone(map, id) { return !!(map && map[id] && map[id].done); }
  function dayHabitDone(key, id) { return isDone(store.getDay(key).habits, id); }
  function dayTaskDone(key, id)  { return isDone(store.getDay(key).recurring, id); }

  /* ---------- tap-streak habits (No smoking) ---------- */
  function toggleHabit(key, id) {
    return store.updateDay(key, rec => {
      if (isDone(rec.habits, id)) delete rec.habits[id];
      else rec.habits[id] = { done: true, at: Date.now() };
    });
  }

  // Consecutive days ending at today (or yesterday if today not yet done).
  function habitStreak(id) {
    const today = todayKey();
    let cursor = dayHabitDone(today, id) ? today : addDays(today, -1);
    let n = 0;
    // hard cap so a corrupt store can't loop forever
    for (let i = 0; i < 4000 && dayHabitDone(cursor, id); i++) {
      n++; cursor = addDays(cursor, -1);
    }
    return n;
  }

  // Lifetime count of days the habit was marked done.
  function habitTotal(id) {
    return store.allDayKeys().reduce((sum, k) => sum + (dayHabitDone(k, id) ? 1 : 0), 0);
  }

  // How many of the last `days` days (ending today) the habit was done.
  function habitDoneLastDays(id, days) {
    const today = todayKey();
    let n = 0;
    for (let i = 0; i < days; i++) if (dayHabitDone(addDays(today, -i), id)) n++;
    return n;
  }

  /* ---------- recurring tasks ---------- */
  function toggleTask(key, id) {
    return store.updateDay(key, rec => {
      if (isDone(rec.recurring, id)) delete rec.recurring[id];
      else rec.recurring[id] = { done: true, at: Date.now() };
    });
  }

  function taskById(cfg, id) { return (cfg.recurring || []).find(t => t.id === id); }
  function isScheduled(cfg, id, key) {
    const t = taskById(cfg, id);
    return !!t && t.days.includes(weekdayOf(key));
  }
  function prevScheduled(cfg, id, key) {
    let k = key;
    for (let i = 0; i < 4000; i++) {
      k = addDays(k, -1);
      if (isScheduled(cfg, id, k)) return k;
    }
    return null;
  }

  // Streak over scheduled occurrences only. Today not-yet-done is a grace,
  // not a break.
  function taskStreak(cfg, id) {
    const today = todayKey();
    // most recent scheduled day on or before today
    let cursor = today;
    for (let i = 0; i < 4000 && !isScheduled(cfg, id, cursor); i++) cursor = addDays(cursor, -1);
    if (!isScheduled(cfg, id, cursor)) return 0;
    // if that day is today and not done yet, don't count it against the streak
    if (cursor === today && !dayTaskDone(cursor, id)) cursor = prevScheduled(cfg, id, cursor);

    let n = 0;
    for (let i = 0; i < 4000 && cursor && dayTaskDone(cursor, id); i++) {
      n++; cursor = prevScheduled(cfg, id, cursor);
    }
    return n;
  }

  function taskTotal(id) {
    return store.allDayKeys().reduce((sum, k) => sum + (dayTaskDone(k, id) ? 1 : 0), 0);
  }

  // Over the last `days` days: how many were SCHEDULED and how many DONE.
  // (For scheduled tasks — rate is over scheduled occurrences, not calendar days.)
  function taskRateLastDays(cfg, id, days) {
    const today = todayKey();
    let scheduled = 0, done = 0;
    for (let i = 0; i < days; i++) {
      const k = addDays(today, -i);
      if (isScheduled(cfg, id, k)) { scheduled++; if (dayTaskDone(k, id)) done++; }
    }
    return { scheduled, done };
  }
  // For as-needed tasks: how many of the last `days` days it was done.
  function taskDoneLastDays(id, days) {
    const today = todayKey();
    let n = 0;
    for (let i = 0; i < days; i++) if (dayTaskDone(addDays(today, -i), id)) n++;
    return n;
  }

  // For as-needed tasks: the most recent day STRICTLY BEFORE `beforeKey` the
  // task was done (so we can say "last watered N days ago"). null if never.
  function lastTaskDoneBefore(id, beforeKey) {
    let best = null;
    store.allDayKeys().forEach(k => {
      if (k < beforeKey && dayTaskDone(k, id) && (best === null || k > best)) best = k;
    });
    return best;
  }

  /* ---------- weekly-limit habit (Drinking) ---------- */
  function logDrink(key, fields) {
    return store.updateDay(key, rec => {
      rec.habits["drinking"] = { done: true, at: Date.now(), log: fields || {} };
    });
  }
  function clearDrink(key) {
    return store.updateDay(key, rec => { delete rec.habits["drinking"]; });
  }
  function drinkLog(key) {
    const h = store.getDay(key).habits["drinking"];
    return h && h.done ? (h.log || {}) : null;
  }
  // How many drinking days fall in the week containing `key`.
  function drinkDaysInWeek(cfg, key) {
    const wk = weekKeyOf(key, cfg.weekStartDow);
    let n = 0, days = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(wk, i);
      if (dayHabitDone(d, "drinking")) { n++; days.push(d); }
    }
    return { count: n, weekStart: wk, days };
  }

  /* ---------- actual fasting timer ---------- */
  function activeFast() { return store.getActiveFast(); }
  function startFast() {
    if (store.getActiveFast()) return;            // already running
    store.setActiveFast({ start: Date.now() });
  }
  function stopFast() {
    const a = store.getActiveFast();
    if (!a) return null;
    const f = { start: a.start, end: Date.now() };
    const list = store.getFasts();
    list.push(f);
    store.saveFasts(list);
    store.setActiveFast(null);
    return f;
  }
  function setFastStart(ts) {
    const a = store.getActiveFast();
    if (a) store.setActiveFast({ ...a, start: ts });
  }
  function completedFasts() { return store.getFasts(); }
  function lastCompletedFast() {
    const l = store.getFasts();
    return l.length ? l[l.length - 1] : null;
  }

  /* ---------- meals ---------- */
  function addMeal(key, meal) {
    return store.updateDay(key, rec => {
      rec.meals = rec.meals || [];
      rec.meals.push({ at: meal.at || Date.now(), note: meal.note || "" });
      rec.meals.sort((a, b) => a.at - b.at);
    });
  }
  function removeMeal(key, at) {
    return store.updateDay(key, rec => {
      rec.meals = (rec.meals || []).filter(m => m.at !== at);
    });
  }

  /* ---------- sleep ---------- */
  // A night's sleep is stored on the day you WOKE UP, as {bed, wake} timestamps.
  function getSleep(key) { return store.getDay(key).sleep || null; }
  function setSleep(key, bed, wake) {
    return store.updateDay(key, rec => { rec.sleep = { bed, wake }; });
  }
  function clearSleep(key) {
    return store.updateDay(key, rec => { delete rec.sleep; });
  }
  function sleepDurationMin(key) {
    const s = getSleep(key);
    return s ? (s.wake - s.bed) / 60000 : null;
  }
  // Average sleep over the `days` days ending at (and including) `key`.
  function avgSleepMin(key, days) {
    let sum = 0, n = 0;
    for (let i = 0; i < days; i++) {
      const m = sleepDurationMin(addDays(key, -i));
      if (m != null && m > 0) { sum += m; n++; }
    }
    return n ? sum / n : null;
  }

  /* ---------- quality-of-day rating (1–5) ---------- */
  function getRating(key) { return store.getDay(key).rating || null; }
  function setRating(key, n) {
    return store.updateDay(key, rec => {
      if (rec.rating === n) delete rec.rating; // tapping the same value clears it
      else rec.rating = n;
    });
  }
  function avgRating(key, days) {
    let sum = 0, n = 0;
    for (let i = 0; i < days; i++) {
      const r = getRating(addDays(key, -i));
      if (r) { sum += r; n++; }
    }
    return n ? sum / n : null;
  }

  /* ---------- daily note ---------- */
  function getNote(key) { return store.getDay(key).note || ""; }
  function setNote(key, text) {
    return store.updateDay(key, rec => {
      if (text && text.trim()) rec.note = text;
      else delete rec.note;
    });
  }

  /* ---------- numeric metrics (weight, etc.) ---------- */
  function getMetric(key, id) {
    const m = store.getDay(key).metrics;
    return m && m[id] != null ? m[id] : null;
  }
  function setMetric(key, id, value) {
    return store.updateDay(key, rec => {
      rec.metrics = rec.metrics || {};
      if (value == null || value === "" || isNaN(value)) delete rec.metrics[id];
      else rec.metrics[id] = Number(value);
      if (!Object.keys(rec.metrics).length) delete rec.metrics;
    });
  }
  // Logged points over the last `days` days, oldest → newest (for a trend line).
  function metricSeries(id, days) {
    const today = todayKey();
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = addDays(today, -i);
      const v = getMetric(k, id);
      if (v != null) out.push({ key: k, value: v });
    }
    return out;
  }
  // Most recent logged value (scans all stored days), or null.
  function metricLatest(id) {
    const keys = store.allDayKeys(); // newest first
    for (const k of keys) { const v = getMetric(k, id); if (v != null) return { key: k, value: v }; }
    return null;
  }

  /* ---------- work to-dos (ad-hoc, scope: "day" | "week") ----------
     Carry-over model: an unfinished item always shows in its list; a finished
     one shows only during the period it was completed in (today / this week),
     so completed items drop off afterward but open ones never get lost. */
  function addWorkTodo(scope, text, meta) {
    const list = store.getWorkTodos();
    const item = {
      id: "w-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      text: (text || "").trim(), scope, done: false, created: Date.now(), doneAt: null,
    };
    if (meta && meta.evtId) item.evtId = meta.evtId; // link to a calendar event for dedup
    list.push(item);
    store.saveWorkTodos(list);
  }

  // Bulk-import calendar events as today's work to-dos. Dedups by event id
  // against the whole list, so re-importing never creates doubles. Returns
  // how many were newly added.
  function importCalendarEvents(events) {
    if (!events || !events.length) return 0;
    const list = store.getWorkTodos();
    const seen = new Set(list.map(t => t.evtId).filter(Boolean));
    let added = 0;
    events.forEach(ev => {
      if (ev.id && seen.has(ev.id)) return;
      list.push({
        id: "w-" + Date.now().toString(36) + (added++) + Math.floor(Math.random() * 1e4).toString(36),
        text: ev.title || "(no title)", scope: "day", done: false, created: Date.now(), doneAt: null,
        evtId: ev.id,
      });
      if (ev.id) seen.add(ev.id);
    });
    if (added) store.saveWorkTodos(list);
    return added;
  }
  function toggleWorkTodo(id) {
    const list = store.getWorkTodos();
    const t = list.find(x => x.id === id);
    if (!t) return;
    t.done = !t.done; t.doneAt = t.done ? Date.now() : null;
    store.saveWorkTodos(list);
  }
  function removeWorkTodo(id) {
    store.saveWorkTodos(store.getWorkTodos().filter(x => x.id !== id));
  }
  function visibleWork(scope, weekStartDow) {
    const today = todayKey();
    const wk = weekKeyOf(today, weekStartDow);
    return store.getWorkTodos()
      .filter(t => t.scope === scope)
      .filter(t => {
        if (!t.done || !t.doneAt) return true;          // open items always show
        const dk = dateKey(new Date(t.doneAt));
        return scope === "day" ? dk === today : weekKeyOf(dk, weekStartDow) === wk;
      })
      .sort((a, b) => (a.done !== b.done) ? (a.done ? 1 : -1)   // open first
        : (a.done ? b.doneAt - a.doneAt : a.created - b.created));
  }
  function openWorkCount(scope, weekStartDow) {
    return visibleWork(scope, weekStartDow).filter(t => !t.done).length;
  }

  return {
    dayHabitDone, dayTaskDone,
    addWorkTodo, toggleWorkTodo, removeWorkTodo, visibleWork, openWorkCount, importCalendarEvents,
    toggleHabit, habitStreak, habitTotal, habitDoneLastDays,
    toggleTask, isScheduled, taskStreak, taskTotal, taskById, lastTaskDoneBefore,
    taskRateLastDays, taskDoneLastDays,
    logDrink, clearDrink, drinkLog, drinkDaysInWeek,
    addMeal, removeMeal,
    activeFast, startFast, stopFast, setFastStart, completedFasts, lastCompletedFast,
    getSleep, setSleep, clearSleep, sleepDurationMin, avgSleepMin,
    getRating, setRating, avgRating,
    getNote, setNote,
    getMetric, setMetric, metricSeries, metricLatest,
  };
})();
