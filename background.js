/* Blob URLs made in a content script are tied to the page, so the download and the
   print view are both created here, in the extension's own context. */
const api = globalThis.browser || globalThis.chrome;

let osPromise;
function platformOs() {
  if (!osPromise) {
    osPromise = Promise.resolve()
      .then(() => api.runtime.getPlatformInfo())
      .then((info) => info.os)
      .catch(() => 'unknown');
  }
  return osPromise;
}

async function saveFile({ filename, mime, text }) {
  const os = await platformOs();
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  try {
    // `saveAs` shows a file picker, which only exists on desktop. Firefox for
    // Android has no picker and rejects the option, so only ask for it off-Android.
    const id = await api.downloads.download({ url, filename, saveAs: os !== 'android' });
    return { ok: true, id };
  } catch (e) {
    // Fallback (seen on Android, where the downloads API can refuse a blob): hand
    // the file to a new tab so the browser's own save/share UI can take it.
    try {
      await api.tabs.create({ url });
      return { ok: true, viaTab: true };
    } catch (e2) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

async function openPrintView({ title, body }) {
  const key = `print:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await api.storage.local.set({ [key]: { title, body } });
  await api.tabs.create({
    url: api.runtime.getURL('print.html') + '?k=' + encodeURIComponent(key)
  });
  return { ok: true };
}

api.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'DOWNLOAD') return saveFile(msg);
  if (msg.type === 'PRINT') return openPrintView(msg);
});

// Drop any print payload that was never picked up (e.g. tab closed early).
api.runtime.onStartup.addListener(async () => {
  const all = await api.storage.local.get(null);
  const stale = Object.keys(all).filter((k) => k.startsWith('print:'));
  if (stale.length) await api.storage.local.remove(stale);
});
