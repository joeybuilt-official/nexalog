// SPDX-License-Identifier: AGPL-3.0-only
const BASE = "https://nexalog.com";
const $ = (id) => document.getElementById(id);

function denylistFromText(t) {
  return t.split(/[\n,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function load() {
  // Server is authoritative; fall back to local mirror if signed out.
  try {
    const res = await fetch(`${BASE}/api/settings`, { credentials: "include" });
    if (res.ok) {
      const s = await res.json();
      $("enabled").checked = !!s.savePageVisits;
      $("denylist").value = (s.historyDenylist || []).join("\n");
      $("retention").value = s.historyRetentionDays || 90;
      await chrome.storage.local.set({
        histEnabled: !!s.savePageVisits,
        histDenylist: s.historyDenylist || [],
      });
      return;
    }
  } catch { /* fall through to local */ }
  const { histEnabled = false, histDenylist = [] } =
    await chrome.storage.local.get(["histEnabled", "histDenylist"]);
  $("enabled").checked = histEnabled;
  $("denylist").value = histDenylist.join("\n");
}

async function save() {
  const enabled = $("enabled").checked;
  const denylist = denylistFromText($("denylist").value);
  const retention = Number($("retention").value) || 90;

  // Mirror into the extension (drives the capture gate) and the server.
  await chrome.storage.local.set({ histEnabled: enabled, histDenylist: denylist });
  try {
    await fetch(`${BASE}/api/settings`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ savePageVisits: enabled, historyDenylist: denylist, historyRetentionDays: retention }),
    });
  } catch { /* local mirror still applied */ }

  const s = $("saved");
  s.hidden = false;
  setTimeout(() => (s.hidden = true), 2000);
}

async function importPast() {
  const granted = await chrome.permissions.request({ permissions: ["history"] });
  if (!granted) { $("import-status").textContent = "Permission denied."; return; }
  $("import-status").textContent = "Importing…";
  const res = await chrome.runtime.sendMessage({ type: "importHistory" });
  $("import-status").textContent = res?.ok
    ? `Imported ${res.imported} pages.`
    : "Import failed.";
}

$("save").addEventListener("click", save);
$("enabled").addEventListener("change", save);
$("import").addEventListener("click", importPast);
load();
