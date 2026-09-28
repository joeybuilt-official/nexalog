// SPDX-License-Identifier: AGPL-3.0-only
// Nexalog Bookmarks — service worker.
// Two save paths, both carrying the user's session cookie:
//   * a URL save POSTs JSON {url} to /api/bookmarks — a saved link IS a
//     bookmark, and that route is the one that parses JSON;
//   * a text/highlight save POSTs multipart FormData to /api/capture — the
//     note intake, which reads form fields, not a JSON body.
// Nexalog classifies server-side (video / article / reference / social /
// other) and routes it to the right place. We never decide here.

const BASE = "https://nexalog.com";

// A request is "unauthenticated" when the server says 401, OR when the
// session-cookie middleware redirected us to /login (a GET-only page route),
// in which case a POST lands as a 405 on a redirected response.
function isAuthFailure(res) {
  if (res.status === 401) return true;
  if (res.redirected && /\/login(\?|$|#)/i.test(res.url)) return true;
  return false;
}

function hopperLabel(kind) {
  switch (kind) {
    case "video": return "Videos";
    case "article": return "Articles";
    case "reference": return "Reference";
    case "social": return "Social";
    default: return "Bookmarks";
  }
}

// POST one URL to the bookmark front door as JSON. Returns a normalized result
// the popup and the context-menu path both understand.
// POST /api/bookmarks: 201 {ok, duplicate:false, bookmark} on a save,
// 200 {ok, duplicate:true, bookmark} when the link was already there.
async function saveBookmark(url) {
  const base = BASE;
  let res;
  try {
    res = await fetch(`${base}/api/bookmarks`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch (e) {
    return { ok: false, error: "network", base };
  }

  if (isAuthFailure(res)) return { ok: false, error: "auth", base };
  if (!res.ok) return { ok: false, error: "server", status: res.status, base };

  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }

  // The bookmark row is the response's `bookmark`; its id is the capture id
  // every Nexalog surface links by, and it is present for a duplicate too.
  const bookmark = data?.bookmark ?? null;
  const captureId = bookmark?.id ?? null;

  if (data.duplicate) return { ok: true, duplicate: true, captureId, base };

  const kind = bookmark?.kindClassified ?? null;
  return { ok: true, kind, label: hopperLabel(kind), captureId, base };
}

// Save selected text as a Nexalog note, tagged with its source page.
// /api/capture parses multipart form data, so the body is a real FormData and
// NO Content-Type is set by hand: a hand-written header omits the multipart
// boundary, and the route's `formData()` throws on it.
async function saveHighlight(text, sourceUrl) {
  const content = sourceUrl ? `${text}\n\nSource: ${sourceUrl}` : text;
  const form = new FormData();
  form.append("text", content);
  form.append("source", "bookmarklet");
  try {
    const res = await fetch(`${BASE}/api/capture`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (isAuthFailure(res)) return { ok: false, error: "auth" };
    if (!res.ok) return { ok: false, error: "server", status: res.status };

    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }

    return { ok: true, captureId: data?.captureId ?? null, status: res.status };
  } catch {
    return { ok: false, error: "network" };
  }
}

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
  });
}

// Used by the context menu + keyboard command (no popup is open to render
// the result, so we give feedback via badge + notification).
async function saveAndAnnounce(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    notify("Nexalog", "Can only save http(s) links.");
    return;
  }
  const r = await saveBookmark(url);
  if (r.ok) {
    flashBadge("✓", "#16a34a");
    notify("Saved to Nexalog", r.duplicate ? "Already in your library." : `Filed under ${r.label}.`);
  } else if (r.error === "auth") {
    flashBadge("!", "#dc2626");
    notify("Sign in to Nexalog", "Open Nexalog and sign in, then try again.");
    chrome.tabs.create({ url: `${r.base}/login` });
  } else {
    flashBadge("!", "#dc2626");
    notify("Nexalog", r.error === "network" ? "Couldn't reach Nexalog." : `Save failed (${r.status || "error"}).`);
  }
}

async function saveHighlightAndAnnounce(text, sourceUrl) {
  const t = (text || "").trim();
  if (!t) { notify("Nexalog", "No text selected."); return; }
  const r = await saveHighlight(t, sourceUrl);
  if (r.ok) {
    flashBadge("✓", "#16a34a");
    notify("Highlight saved", "Saved to your Nexalog notes.");
  } else if (r.error === "auth") {
    flashBadge("!", "#dc2626");
    notify("Sign in to Nexalog", "Open Nexalog and sign in, then try again.");
    chrome.tabs.create({ url: `${BASE}/login` });
  } else {
    flashBadge("!", "#dc2626");
    notify("Nexalog", r.error === "network" ? "Couldn't reach Nexalog." : `Save failed (${r.status || "error"}).`);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "nexalog-save-page", title: "Save page to Nexalog", contexts: ["page"] });
  chrome.contextMenus.create({ id: "nexalog-save-link", title: "Save link to Nexalog", contexts: ["link"] });
  chrome.contextMenus.create({ id: "nexalog-save-media", title: "Save video to Nexalog", contexts: ["video", "audio"] });
  chrome.contextMenus.create({ id: "nexalog-save-highlight", title: "Save highlight to Nexalog", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "nexalog-save-highlight") {
    saveHighlightAndAnnounce(info.selectionText, info.pageUrl || tab?.url);
    return;
  }
  const url = info.linkUrl || info.srcUrl || info.pageUrl || tab?.url;
  saveAndAnnounce(url);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-current-page") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  saveAndAnnounce(tab?.url);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "save") {
    saveBookmark(msg.url).then(sendResponse);
    return true;
  }
});

// --- Omnibox: type "nx <query>" in the address bar to search Nexalog ---
function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function resultUrl(r) {
  return r.kind === "note"
    ? `${BASE}/app/notes/${r.id}`
    : `${BASE}/app/bookmarks/${r.id}/reader`;
}
if (chrome.omnibox) {
  chrome.omnibox.setDefaultSuggestion({ description: "Search Nexalog for: %s" });

  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const q = text.trim();
    if (q.length < 2) return;
    try {
      const res = await fetch(`${BASE}/api/search`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, limit: 6 }),
      });
      if (!res.ok) return;
      const data = await res.json();
      suggest((data.results || []).slice(0, 6).map((r) => ({
        content: resultUrl(r),
        description: `${escapeXml(`[${r.kind}]`)} <match>${escapeXml((r.title || r.url || "Untitled").slice(0, 90))}</match>`,
      })));
    } catch { /* ignore */ }
  });

  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    const url = /^https?:\/\//i.test(text) ? text : `${BASE}/app/bookmarks`;
    if (disposition === "currentTab") chrome.tabs.update({ url });
    else chrome.tabs.create({ url, active: disposition !== "newBackgroundTab" });
  });
}
