/* ============================================================
   fasting.js — the eating/fasting engine.

   Pure logic, no DOM. Given the config and "now", it answers:
     - Am I in an EATING or FASTING window right now?
     - When did this window start (so we can show elapsed time)?
     - When is the next transition (countdown)?
   It also exposes the day's windows for drawing a timeline.

   Approach: the eating schedule is per-weekday. We expand it into
   absolute time intervals for the days around "now" (yesterday →
   tomorrow), merge any that touch, then locate "now" among them.
   Whatever isn't an eating interval is, by definition, fasting.
   ============================================================ */
window.HT = window.HT || {};

HT.fasting = (function () {
  const { keyToDate, hmToMinutes, addDays, dateKey } = HT.util;

  // The configured eating windows for one weekday, as {startMin, endMin}
  // minute offsets. An end <= start is treated as crossing midnight.
  function windowsForDate(cfg, key) {
    const dow = keyToDate(key).getDay();
    const raw = (cfg.eatingSchedule && cfg.eatingSchedule[dow]) || [];
    return raw.map(w => {
      let s = hmToMinutes(w.start);
      let e = hmToMinutes(w.end);
      if (e <= s) e += 1440;        // crosses midnight
      return { startMin: s, endMin: e };
    });
  }

  // Expand the schedule into absolute {start,end} timestamps (ms) for a
  // span of days around `centerKey`, then sort and merge touching ones.
  function absoluteIntervals(cfg, centerKey, spanDays) {
    spanDays = spanDays || 2;
    const out = [];
    for (let d = -spanDays; d <= spanDays; d++) {
      const key = addDays(centerKey, d);
      const midnight = keyToDate(key).getTime();
      windowsForDate(cfg, key).forEach(w => {
        out.push({
          start: midnight + w.startMin * 60000,
          end:   midnight + w.endMin   * 60000,
        });
      });
    }
    out.sort((a, b) => a.start - b.start);

    // Merge windows that touch or overlap (e.g. a window ending at midnight
    // and the next starting at midnight = one continuous eating period).
    const merged = [];
    for (const iv of out) {
      const last = merged[merged.length - 1];
      if (last && iv.start <= last.end) {
        last.end = Math.max(last.end, iv.end);
      } else {
        merged.push({ ...iv });
      }
    }
    return merged;
  }

  // The live status at time `now` (a Date). Returns:
  //   { state: "eating"|"fasting", sinceTs, nextTs, nextState }
  function getStatus(cfg, now) {
    now = now || new Date();
    const t = now.getTime();
    const ivs = absoluteIntervals(cfg, dateKey(now));

    const cur = ivs.find(iv => t >= iv.start && t < iv.end);
    if (cur) {
      return { state: "eating", sinceTs: cur.start, nextTs: cur.end, nextState: "fasting" };
    }

    // Fasting: started when the previous eating window ended; ends when the
    // next one begins.
    let prevEnd = null, nextStart = null;
    for (const iv of ivs) {
      if (iv.end <= t)  prevEnd   = iv.end;                    // last one before now
      if (iv.start > t && nextStart === null) nextStart = iv.start; // first after now
    }
    return { state: "fasting", sinceTs: prevEnd, nextTs: nextStart, nextState: "eating" };
  }

  // Eating windows for a single calendar day (clipped to that day), used to
  // draw the day timeline. Returns minute offsets 0..1440 within the day.
  function dayEatingSegments(cfg, key) {
    const midnight = keyToDate(key).getTime();
    const dayStart = midnight;
    const dayEnd = midnight + 1440 * 60000;
    return absoluteIntervals(cfg, key, 1)
      .map(iv => ({ start: Math.max(iv.start, dayStart), end: Math.min(iv.end, dayEnd) }))
      .filter(iv => iv.end > iv.start)
      .map(iv => ({
        startMin: Math.round((iv.start - midnight) / 60000),
        endMin:   Math.round((iv.end   - midnight) / 60000),
      }));
  }

  // Completed fasting periods (the gaps between eating windows) ending on or
  // before `now`, most recent first. Schedule-derived history of past fasts.
  function recentFasts(cfg, now, count) {
    now = now || new Date();
    count = count || 12;
    const ivs = absoluteIntervals(cfg, dateKey(now), 18); // ~5+ weeks of context
    const t = now.getTime();
    const fasts = [];
    for (let i = 0; i < ivs.length - 1; i++) {
      const start = ivs[i].end, end = ivs[i + 1].start;
      if (end > start && end <= t) {
        fasts.push({ start, end, durationMin: (end - start) / 60000 });
      }
    }
    return fasts.slice(-count).reverse();
  }

  return { windowsForDate, absoluteIntervals, getStatus, dayEatingSegments, recentFasts };
})();
