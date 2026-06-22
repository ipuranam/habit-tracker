/* ============================================================
   store.js — the localStorage persistence layer.

   The rest of the app talks to HT.store, never to localStorage
   directly. Data is organized by DATE. Keeping this boundary clean
   means we can later swap in cloud sync without touching features.

   Storage keys:
     ht.config            -> the (editable) configuration object
     ht.day.<YYYY-MM-DD>  -> one record per day
     ht.fasts             -> completed fast history (appended over time)
   ============================================================ */
window.HT = window.HT || {};

HT.store = (function () {
  const K_CONFIG = "ht.config";
  const K_DAY    = "ht.day.";     // + dateKey
  const K_FASTS  = "ht.fasts";

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.warn("store.read failed for", key, e);
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error("store.write failed for", key, e);
    }
  }

  /* ---- Config ---- */
  function getConfig() {
    const saved = read(K_CONFIG, null);
    if (saved) return saved;
    // First run: seed from the default (deep copy so we never mutate the default).
    const seed = JSON.parse(JSON.stringify(HT.DEFAULT_CONFIG));
    write(K_CONFIG, seed);
    return seed;
  }
  function saveConfig(cfg) { write(K_CONFIG, cfg); }

  /* ---- Per-day records ----
     Shape of a day record (fields fill in as features land):
       {
         date: "YYYY-MM-DD",
         habits:    { "no-smoking": { done: true, at: <ts> }, ... },
         drinking:  { drank: true, what: "...", amount: "...", at: <ts> },
         recurring: { "treadmill": { done: true, at: <ts> }, ... },
         meals:     [ { at: <ts>, note: "..." }, ... ]
       }
  */
  function emptyDay(dateKey) {
    return { date: dateKey, habits: {}, recurring: {}, meals: [] };
  }
  function getDay(dateKey) {
    return read(K_DAY + dateKey, null) || emptyDay(dateKey);
  }
  function saveDay(rec) {
    if (!rec || !rec.date) throw new Error("saveDay needs a record with a date");
    write(K_DAY + rec.date, rec);
  }
  // Convenience: load a day, mutate it via fn, save it, return it.
  function updateDay(dateKey, fn) {
    const rec = getDay(dateKey);
    fn(rec);
    saveDay(rec);
    return rec;
  }
  // Every date key that has a saved record, newest first.
  function allDayKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(K_DAY)) keys.push(k.slice(K_DAY.length));
    }
    return keys.sort().reverse();
  }

  /* ---- Fast history ---- */
  function getFasts() { return read(K_FASTS, []); }
  function saveFasts(list) { write(K_FASTS, list); }

  /* ---- Export / import (groundwork for future sync/backup) ---- */
  function exportAll() {
    const out = { config: getConfig(), fasts: getFasts(), days: {} };
    allDayKeys().forEach(k => { out.days[k] = getDay(k); });
    return out;
  }

  return {
    getConfig, saveConfig,
    getDay, saveDay, updateDay, allDayKeys, emptyDay,
    getFasts, saveFasts,
    exportAll,
  };
})();
