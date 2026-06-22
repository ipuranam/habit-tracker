/* ============================================================
   util.js — small date/time helpers used across the app.
   Everything uses the device's LOCAL time/timezone.
   Exposed on the global  HT.util  namespace.
   ============================================================ */
window.HT = window.HT || {};

HT.util = (function () {
  const DAY_NAMES   = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const DAY_SHORT   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Local YYYY-MM-DD key for a Date (NOT UTC — that's the whole point).
  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Parse a YYYY-MM-DD key back into a local Date (at midnight).
  function keyToDate(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function todayKey() { return dateKey(new Date()); }

  // 0 = Sunday … 6 = Saturday, for a date key.
  function weekdayOf(key) { return keyToDate(key).getDay(); }

  // "HH:MM" -> minutes since midnight. "24:00" -> 1440 (used for midnight end).
  function hmToMinutes(hm) {
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + (m || 0);
  }

  // minutes -> "8:00pm" style label
  function minutesToLabel(mins) {
    mins = ((mins % 1440) + 1440) % 1440;
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? "pm" : "am";
    h = h % 12; if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, "0")}${ampm}`;
  }

  // Humanize a duration in minutes -> "3h 12m"
  function humanDuration(mins) {
    mins = Math.max(0, Math.round(mins));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  // "Sunday, Jun 21"
  function prettyDate(key) {
    const d = keyToDate(key);
    return `${DAY_NAMES[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
  }

  // Whole days from key `a` to key `b` (b - a). Same day = 0.
  function daysBetween(a, b) {
    return Math.round((keyToDate(b) - keyToDate(a)) / 86400000);
  }

  // Shift a date key by N days (negative = past).
  function addDays(key, n) {
    const d = keyToDate(key);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }

  // The Monday-start week key (the date key of the Monday) a date falls in.
  // weekStartDow: 1 = Monday (configurable later).
  function weekKeyOf(key, weekStartDow) {
    weekStartDow = (weekStartDow == null) ? 1 : weekStartDow;
    const d = keyToDate(key);
    const dow = d.getDay();
    const diff = (dow - weekStartDow + 7) % 7;
    d.setDate(d.getDate() - diff);
    return dateKey(d);
  }

  return {
    DAY_NAMES, DAY_SHORT, MONTH_SHORT,
    dateKey, keyToDate, todayKey, weekdayOf,
    hmToMinutes, minutesToLabel, humanDuration,
    prettyDate, addDays, daysBetween, weekKeyOf,
  };
})();
