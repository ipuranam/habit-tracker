/* ============================================================
   gcal.js — optional Google Calendar integration (online-only).

   Pure client-side OAuth via Google Identity Services (GIS). No
   backend, no client secret: the app holds only your PUBLIC OAuth
   Client ID, and the calendar is fetched directly browser↔Google.
   GIS is loaded lazily — we don't contact Google at all until you
   actually connect. Everything here is guarded so the rest of the
   app keeps working offline if Google is unavailable.

   Access tokens are short-lived (~1h) and kept in sessionStorage;
   fetched events are cached in localStorage so they still show
   (stale) when offline.
   ============================================================ */
window.HT = window.HT || {};

HT.gcal = (function () {
  // calendar (read events) + drive.appdata (private per-app sync folder)
  const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/drive.appdata";
  const TOKEN_KEY = "ht.gcal.token";
  const CACHE_PREFIX = "ht.gcal.cache.";

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;

  // Restore a still-valid token from this browser session.
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null");
    if (t && Date.now() < t.tokenExpiry) { accessToken = t.accessToken; tokenExpiry = t.tokenExpiry; }
  } catch (e) { /* ignore */ }

  function gconf() { return HT.store.getConfig().google || {}; }
  function isConfigured() { return !!gconf().clientId; }
  function isConnected() { return !!accessToken && Date.now() < tokenExpiry; }

  // Load the GIS client script once, on demand.
  function loadGis() {
    return new Promise((resolve, reject) => {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn't load Google sign-in (are you offline?)."));
      document.head.appendChild(s);
    });
  }

  async function connect(opts) {
    const g = gconf();
    if (!g.clientId) throw new Error("Add your Google OAuth Client ID in Settings first.");
    await loadGis();
    const silent = !!(opts && opts.silent);
    return new Promise((resolve, reject) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: g.clientId,
        scope: SCOPE,
        callback: (resp) => {
          if (resp && resp.error) { reject(new Error(resp.error)); return; }
          accessToken = resp.access_token;
          tokenExpiry = Date.now() + ((resp.expires_in ? resp.expires_in * 1000 : 3600000) - 60000);
          try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken, tokenExpiry })); } catch (e) {}
          resolve(accessToken);
        },
        error_callback: (err) => reject(new Error((err && err.type) || "auth_failed")),
      });
      // Empty prompt = silent (no popup) if the Google session already consented.
      tokenClient.requestAccessToken({ prompt: silent ? "" : (accessToken ? "" : "consent") });
    });
  }

  function getAccessToken() { return isConnected() ? accessToken : null; }
  // Return a valid token, connecting if needed. silent=true never shows a popup.
  async function ensureToken(silent) {
    if (isConnected()) return accessToken;
    return connect({ silent });
  }

  function disconnect() {
    accessToken = null; tokenExpiry = 0;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  function cacheEvents(dateKey, events) {
    try { localStorage.setItem(CACHE_PREFIX + dateKey, JSON.stringify({ at: Date.now(), events })); } catch (e) {}
  }
  function cachedEvents(dateKey) {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_PREFIX + dateKey) || "null");
      return c ? c.events : null;
    } catch (e) { return null; }
  }

  // Fetch a single local day's events, normalize, and cache them.
  async function fetchEvents(dateKey) {
    if (!isConnected()) throw new Error("not connected");
    const start = HT.util.keyToDate(dateKey);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const calId = encodeURIComponent(gconf().calendarId || "primary");
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`
      + `?singleEvents=true&orderBy=startTime`
      + `&timeMin=${encodeURIComponent(start.toISOString())}`
      + `&timeMax=${encodeURIComponent(end.toISOString())}`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
    if (res.status === 401) { disconnect(); throw new Error("Google sign-in expired — reconnect."); }
    if (!res.ok) throw new Error("Calendar API error " + res.status);
    const data = await res.json();
    const events = (data.items || []).map(ev => ({
      id: ev.id,
      title: ev.summary || "(no title)",
      start: ev.start.dateTime || ev.start.date,
      end: ev.end.dateTime || ev.end.date,
      allDay: !ev.start.dateTime,
    }));
    cacheEvents(dateKey, events);
    return events;
  }

  return { isConfigured, isConnected, connect, disconnect, fetchEvents, cachedEvents, getAccessToken, ensureToken };
})();
