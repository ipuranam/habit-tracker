/* ============================================================
   sync.js — cross-device sync via Google Drive's appDataFolder.

   Reuses the Google sign-in (HT.gcal). Stores ONE JSON file
   ("tracker-data.json") in the private per-app folder — invisible
   in the user's normal Drive, readable only by this app.

   Strategy: last-write-wins on the whole dataset, keyed by a
   `meta.lastModified` timestamp.
     - pull(): if remote is newer than local, adopt it.
     - push(): upload local snapshot.
   Online-only and guarded so failure never breaks the app. Concurrent
   edits on two devices in the same window can lose one side's changes
   (acceptable for a single user); each device pulls on open + pushes on
   change, which avoids it in normal use.
   ============================================================ */
window.HT = window.HT || {};

HT.sync = (function () {
  const FILE_NAME = "tracker-data.json";
  const DRIVE = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

  function enabled() { return !!(HT.store.getConfig().syncEnabled); }

  async function findFile(token) {
    const url = `${DRIVE}/files?spaces=appDataFolder`
      + `&q=${encodeURIComponent("name='" + FILE_NAME + "'")}&fields=files(id,name)`;
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) throw new Error("Drive list failed (" + res.status + ")");
    const data = await res.json();
    return (data.files && data.files[0]) || null;
  }

  async function download(token, id) {
    const res = await fetch(`${DRIVE}/files/${id}?alt=media`, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) throw new Error("Drive download failed (" + res.status + ")");
    return res.json();
  }

  async function upload(token, fileId, body) {
    const json = JSON.stringify(body);
    if (fileId) {
      const res = await fetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
        method: "PATCH",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: json,
      });
      if (!res.ok) throw new Error("Drive update failed (" + res.status + ")");
    } else {
      const boundary = "ht-sync-boundary";
      const meta = { name: FILE_NAME, parents: ["appDataFolder"] };
      const multipart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
      const res = await fetch(`${UPLOAD}/files?uploadType=multipart`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      });
      if (!res.ok) throw new Error("Drive create failed (" + res.status + ")");
    }
  }

  function localSnapshot() {
    const data = HT.store.exportAll();
    data.meta = { lastModified: HT.store.getLastModified() };
    return data;
  }

  // Adopt remote if it's newer. Returns { pulled, reason }.
  async function pull(silent) {
    const token = await HT.gcal.ensureToken(silent);
    const file = await findFile(token);
    if (!file) return { pulled: false, reason: "no-remote" };
    const remote = await download(token, file.id);
    const R = (remote.meta && remote.meta.lastModified) || 0;
    const L = HT.store.getLastModified();
    if (R > L) { HT.store.importAll(remote); return { pulled: true }; }
    return { pulled: false, reason: "local-newer-or-equal" };
  }

  async function push(silent) {
    const token = await HT.gcal.ensureToken(silent);
    const file = await findFile(token);
    await upload(token, file && file.id, localSnapshot());
    stampSynced();
    return { pushed: true };
  }

  // Pull first; if we didn't adopt remote (local newer / no remote), push.
  async function syncNow(silent) {
    const p = await pull(silent);
    if (!p.pulled) await push(silent);
    else stampSynced();
    return p;
  }

  function stampSynced() { try { localStorage.setItem("ht.lastSynced", JSON.stringify(Date.now())); } catch (e) {} }
  function lastSynced() { try { return JSON.parse(localStorage.getItem("ht.lastSynced") || "0"); } catch (e) { return 0; } }

  return { enabled, pull, push, syncNow, lastSynced };
})();
