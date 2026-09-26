// SPDX-License-Identifier: AGPL-3.0-only
// Karakeep-style: clicking the toolbar icon opens this popup, which fires
// the save immediately (no Save button). The server picks the hopper.
const BASE = "https://nexalog.com";

const $ = (id) => document.getElementById(id);
let currentTab = null;

function showStatus(cls, html) {
  const el = $("status");
  el.className = `status ${cls}`;
  el.innerHTML = html;
  el.hidden = false;
}

// Render the saved/duplicate result with a link into Nexalog.
function renderSaved(res) {
  const lead = res.duplicate
    ? "Already bookmarked"
    : `Saved &middot; filed under <span class="hopper">${res.label}</span>`;
  const link = res.captureId
    ? `${res.base}/app/bookmarks/${res.captureId}/reader`
    : `${res.base}/app/bookmarks`;
  showStatus("ok", `${lead}. <a id="open-bm" href="#">Open in Nexalog &rarr;</a>`);
  const a = $("open-bm");
  if (a) a.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: link });
    window.close();
  });
}

async function doSave() {
  $("retry").hidden = true;
  $("auth").hidden = true;
  showStatus("pending", "Saving…");

  const res = await chrome.runtime.sendMessage({ type: "save", url: currentTab.url });

  if (res?.ok) {
    renderSaved(res);
    return;
  }

  if (res?.error === "auth") {
    $("status").hidden = true;
    $("auth").hidden = false;
    return;
  }

  showStatus("err", res?.error === "network"
    ? "Couldn't reach Nexalog."
    : `Save failed (${res?.status || "error"}).`);
  $("retry").hidden = false;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  currentTab = tab;
  $("title").textContent = tab?.title || "Untitled";
  $("url").textContent = tab?.url || "";

  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
    showStatus("err", "This page can't be saved.");
    return;
  }
  doSave();
}

$("retry").addEventListener("click", doSave);

$("signin").addEventListener("click", () => {
  chrome.tabs.create({ url: `${BASE}/login` });
  window.close();
});

init();
