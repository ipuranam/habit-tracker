/* ============================================================
   config.js — the DEFAULT configuration.

   This is the "data-driven" heart of the app. Habits, recurring
   tasks, the eating schedule, and fixed anchors are all described
   here as plain data. Adding a new tracked item = adding an entry,
   not writing new logic.

   On first run this default is copied into localStorage. After that
   the SAVED copy (which you can edit in-app) is the source of truth,
   so changing this file later only affects a fresh install.

   Weekday numbers everywhere: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu,
   5=Fri, 6=Sat. Times are local "HH:MM"; "24:00" means midnight
   (end of day).
   ============================================================ */
window.HT = window.HT || {};

HT.DEFAULT_CONFIG = {
  version: 5,
  weekStartDow: 1, // Monday — resets weekly drinking count & weekly views
  fastGoalHours: 16, // target length for the manual start/stop fasting timer

  // Optional passcode gate. A PBKDF2 hash (hex) of the passcode, baked into the
  // deployed app so EVERY visitor (incl. strangers on a fresh browser) must enter
  // it before the app shows. Empty = no gate. Set via Settings → Privacy (generate
  // the hash) and deploy it here. Deterrent only — see the note in Settings.
  lockHash: "83f81e7c7a0a0e609cb4c93fb5f504a13376f8f91d74f85253ae70de5f23e559",
  remindersEnabled: false, // in-app reminders while the app is open (see note in Settings)

  // Google Calendar (optional, online-only). clientId comes from your own
  // Google Cloud OAuth setup; calendar data is fetched browser↔Google directly.
  google: { clientId: "", calendarId: "primary" },

  // Cross-device sync via your private Google Drive app folder (reuses the
  // Google sign-in). Off by default; enable in Settings → Sync.
  syncEnabled: false,

  // Eating windows per weekday. Each day is a list of {start,end} windows
  // (a list so a day could have more than one window later). Anything
  // outside these windows is a fasting window.
  eatingSchedule: {
    0: [{ start: "12:00", end: "20:00" }], // Sunday
    1: [{ start: "12:00", end: "20:00" }], // Monday
    2: [{ start: "12:00", end: "20:00" }], // Tuesday
    3: [{ start: "12:00", end: "20:00" }], // Wednesday
    4: [{ start: "12:00", end: "20:00" }], // Thursday
    5: [{ start: "12:00", end: "24:00" }], // Friday — flexible, runs to midnight
    6: [{ start: "20:00", end: "24:00" }], // Saturday — one meal: 8pm–midnight
  },

  // Habits. `type` selects which engine handles it:
  //   "daily-check"  -> check once/day; track streak, lifetime total, and
  //                     completion % over recent windows. Add your own freely.
  //   "weekly-limit" -> allowed N days/week; flag when exceeded; log details
  habits: [
    { id: "no-smoking",  name: "No smoking",  icon: "🚭", type: "daily-check" },
    { id: "workout",     name: "Workout",     icon: "🏋️", type: "daily-check" },
    { id: "eat-healthy", name: "Eat healthy", icon: "🥗", type: "daily-check" },
    { id: "fasted",      name: "Fasted",      icon: "⏱️", type: "daily-check" },
    { id: "drinking",    name: "Drinking",    icon: "🍷", type: "weekly-limit",
      limitPerWeek: 1, logFields: ["what", "amount"] },
  ],

  // Recurring tasks. `mode` controls how a task behaves:
  //   "scheduled" (default) -> repeats on `days`; tracks a streak over those days.
  //   "asNeeded"            -> shows every day; no fixed days, no streak. Tracks
  //                            "last done N days ago" + a lifetime count. Good for
  //                            things you do irregularly (e.g. watering plants —
  //                            skip it when it rains, no guilt).
  // Fully user-editable from inside the app.
  recurring: [
    { id: "treadmill", name: "Treadmill walk at the gym", mode: "scheduled", days: [1,2,3,4], time: "18:30" },
    { id: "journal",   name: "Journal",                    mode: "scheduled", days: [0],       time: null },
    { id: "mealprep",  name: "Meal prep",                  mode: "scheduled", days: [0],       time: null },
    { id: "grocery",   name: "Grocery shop",               mode: "scheduled", days: [6],       time: null },
    { id: "water-plants", name: "Water plants",            mode: "asNeeded",  days: [],        time: null },
  ],

  // Fixed anchors: shown on the daily timeline for context, not tracked.
  anchors: [
    { id: "work", name: "Work", days: [1,2,3,4,5], start: "09:00", end: "18:30" },
  ],

  // Numeric metrics logged over time (weight, etc.). Each: id, name, unit.
  // Add/remove your own in Settings. Shown with a trend line on the Stats tab.
  metrics: [
    { id: "weight", name: "Weight", unit: "lb" },
    { id: "steps",  name: "Steps",  unit: "steps" },
  ],
};
