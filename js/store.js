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
  const K_WORK   = "ht.worktodos"; // ad-hoc work to-do list (day/week scoped)
  const K_LASTMOD = "ht.lastModified";

  // Keys whose changes count as "data" worth syncing (excludes caches, the
  // unlock token, the lastModified stamp itself, etc.).
  const SYNC_PREFIXES = [K_CONFIG, K_DAY, K_FASTS, "ht.activeFast", K_WORK];
  function isSyncable(key) { return SYNC_PREFIXES.some(p => key === p || key.startsWith(p)); }

  let changeCb = null;     // notified after a syncable change (for auto-push)
  let suppress = false;    // pause change tracking during bulk import

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
    if (!suppress && isSyncable(key)) {
      try { localStorage.setItem(K_LASTMOD, JSON.stringify(Date.now())); } catch (e) {}
      if (changeCb) changeCb();
    }
  }

  function getLastModified() { return read(K_LASTMOD, 0); }
  function setLastModified(ts) { try { localStorage.setItem(K_LASTMOD, JSON.stringify(ts)); } catch (e) {} }
  function onChange(cb) { changeCb = cb; }

  /* ---- Config ---- */
  function getConfig() {
    const saved = read(K_CONFIG, null);
    if (saved) return migrate(saved);
    // First run: seed from the default (deep copy so we never mutate the default).
    const seed = JSON.parse(JSON.stringify(HT.DEFAULT_CONFIG));
    write(K_CONFIG, seed);
    return seed;
  }

  // One-time, version-gated upgrades to an already-saved config. Runs once per
  // version bump, so it won't re-add things you intentionally deleted later.
  function migrate(cfg) {
    let changed = false;
    if (!cfg.version) cfg.version = 1;
    if (cfg.version < 2) {
      cfg.habits = cfg.habits || [];
      // Old "tap-streak" habits are now "daily-check".
      cfg.habits.forEach(h => { if (h.type === "tap-streak") h.type = "daily-check"; });
      // Add the new daily-check habits if they aren't present.
      const additions = [
        { id: "workout",     name: "Workout",     icon: "🏋️", type: "daily-check" },
        { id: "eat-healthy", name: "Eat healthy", icon: "🥗", type: "daily-check" },
        { id: "fasted",      name: "Fasted",      icon: "⏱️", type: "daily-check" },
      ];
      const insertAt = cfg.habits.findIndex(h => h.type === "weekly-limit");
      additions.forEach(a => {
        if (!cfg.habits.some(h => h.id === a.id)) {
          if (insertAt >= 0) cfg.habits.splice(insertAt, 0, a); else cfg.habits.push(a);
        }
      });
      cfg.version = 2;
      changed = true;
    }
    if (cfg.version < 3) {
      if (!cfg.metrics) cfg.metrics = [{ id: "weight", name: "Weight", unit: "lb" }];
      if (cfg.remindersEnabled === undefined) cfg.remindersEnabled = false;
      cfg.version = 3;
      changed = true;
    }
    if (cfg.version < 4) {
      if (!cfg.google) cfg.google = { clientId: "", calendarId: "primary" };
      cfg.version = 4;
      changed = true;
    }
    if (cfg.version < 5) {
      cfg.metrics = cfg.metrics || [];
      if (!cfg.metrics.some(m => m.id === "steps")) cfg.metrics.push({ id: "steps", name: "Steps", unit: "steps" });
      cfg.version = 5;
      changed = true;
    }
    // The passcode hash is a DEPLOY-level setting, not user data: always mirror
    // whatever is baked into the shipped config, so changing it applies to every
    // install (new and existing) on next load.
    const wantLock = HT.DEFAULT_CONFIG.lockHash || "";
    if ((cfg.lockHash || "") !== wantLock) { cfg.lockHash = wantLock; changed = true; }

    if (changed) write(K_CONFIG, cfg);
    return cfg;
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

  /* ---- Fast history (actual logged fasts) ---- */
  function getFasts() { return read(K_FASTS, []); }
  function saveFasts(list) { write(K_FASTS, list); }
  // The currently-running fast, { start }, or null.
  function getActiveFast() { return read("ht.activeFast", null); }
  function setActiveFast(obj) {
    if (obj) write("ht.activeFast", obj);
    else localStorage.removeItem("ht.activeFast");
  }

  /* ---- Work to-dos (live list, not date-bound) ---- */
  function getWorkTodos() { return read(K_WORK, []); }
  function saveWorkTodos(list) { write(K_WORK, list); }

  /* ---- Export / import (groundwork for future sync/backup) ---- */
  function exportAll() {
    const out = { config: getConfig(), fasts: getFasts(), activeFast: getActiveFast(), worktodos: getWorkTodos(), days: {} };
    allDayKeys().forEach(k => { out.days[k] = getDay(k); });
    return out;
  }

  // Restore from an exported backup. Replaces everything. Throws on bad input.
  function importAll(data) {
    if (!data || typeof data !== "object" || (!data.config && !data.days)) {
      throw new Error("This doesn't look like a tracker backup file.");
    }
    suppress = true;
    try {
      const unlock = localStorage.getItem("ht.unlock"); // keep the device unlocked across an import
      Object.keys(localStorage).filter(k => k.startsWith("ht.")).forEach(k => localStorage.removeItem(k));
      if (unlock) localStorage.setItem("ht.unlock", unlock);
      if (data.config) write(K_CONFIG, data.config);
      if (data.fasts) write(K_FASTS, data.fasts);
      if (data.activeFast) write("ht.activeFast", data.activeFast);
      if (data.worktodos) write(K_WORK, data.worktodos);
      if (data.days) Object.keys(data.days).forEach(k => write(K_DAY + k, data.days[k]));
    } finally {
      suppress = false;
    }
    // Sync imports carry the source timestamp; a manual file import is "now".
    setLastModified((data.meta && data.meta.lastModified) || Date.now());
  }

  return {
    getConfig, saveConfig,
    getDay, saveDay, updateDay, allDayKeys, emptyDay,
    getFasts, saveFasts, getActiveFast, setActiveFast,
    getWorkTodos, saveWorkTodos,
    exportAll, importAll,
    getLastModified, setLastModified, onChange,
  };
})();
