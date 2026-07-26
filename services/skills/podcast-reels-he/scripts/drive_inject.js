// Drive upload injector — run via Claude in Chrome `javascript_tool`.
// Usage (in two steps):
//
//  STEP A (install patch + start fetching files):
//    window.__drive_inject({
//      "01_clip.mp4": "https://files.catbox.moe/abc.mp4",
//      "02_clip.mp4": "https://files.catbox.moe/def.mp4"
//    })
//
//  STEP B (after polling window.__fetch_status shows all done, dedupe and
//          trigger "New > Upload files" via a REAL user click in Drive UI):
//    window.__drive_dedupe()    // returns count
//
// Notes:
//  - libcurl/Chrome must already be on https://drive.google.com/drive/u/X/folders/<ID>
//  - This file is meant to be eval'd as a single block via the Chrome MCP
//    javascript_tool, not loaded as a module.

window.__pending_files = window.__pending_files || [];
window.__fetch_status  = window.__fetch_status  || {};
window.__intercept_log = window.__intercept_log || [];

if (!window.__patched_input_click) {
  const orig = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === "file") {
      try {
        const dt = new DataTransfer();
        for (const f of window.__pending_files) dt.items.add(f);
        Object.defineProperty(this, "files", { value: dt.files, configurable: true });
        this.dispatchEvent(new Event("change", { bubbles: true }));
        window.__intercept_log.push({ when: Date.now(), count: window.__pending_files.length });
      } catch (e) {
        window.__intercept_log.push({ err: e.message });
      }
      return;
    }
    return orig.call(this);
  };
  window.__patched_input_click = true;
}

window.__drive_inject = function (mapping) {
  const t0 = Date.now();
  for (const [name, url] of Object.entries(mapping)) {
    if (window.__fetch_status[name] && window.__fetch_status[name] !== "pending") continue;
    window.__fetch_status[name] = "pending";
    fetch(url)
      .then((r) => r.blob())
      .then((blob) => {
        window.__pending_files.push(new File([blob], name, { type: "video/mp4" }));
        window.__fetch_status[name] = `done ${blob.size}B in ${((Date.now() - t0) / 1000).toFixed(1)}s`;
      })
      .catch((e) => {
        window.__fetch_status[name] = "ERR " + e.message;
      });
  }
  return "started " + Object.keys(mapping).length + " fetches";
};

window.__drive_dedupe = function () {
  const seen = new Set();
  window.__pending_files = window.__pending_files.filter((f) => {
    if (seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  });
  return window.__pending_files.length;
};

"injector ready";
