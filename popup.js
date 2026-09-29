const api = globalThis.browser || globalThis.chrome;
const CE = globalThis.CE;

const els = {
  loaded: document.getElementById('loaded'),
  title: document.getElementById('title'),
  status: document.getElementById('status'),
  loadAll: document.getElementById('loadAll'),
  theme: document.getElementById('theme'),
  font: document.getElementById('font'),
  size: document.getElementById('size'),
  minus: document.getElementById('minus'),
  plus: document.getElementById('plus'),
  copy: document.getElementById('copy'),
  buttons: Array.from(document.querySelectorAll('button.fmt'))
};

let tabId = null;
let isAndroid = false;
let opts = CE.normalizeOpts();

function say(text, tone) {
  els.status.textContent = text;
  els.status.className = tone || '';
}

function setEnabled(on) {
  els.buttons.forEach((b) => { b.disabled = !on; });
  els.copy.disabled = !on;
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for engines without the async clipboard API.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

function paint(save) {
  Array.from(els.theme.children).forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.theme === opts.theme));
  });
  els.font.value = opts.font;
  els.size.textContent = opts.size;
  els.minus.disabled = opts.size <= CE.SIZE_MIN;
  els.plus.disabled = opts.size >= CE.SIZE_MAX;
  if (save) api.storage.local.set({ opts });
}

Object.keys(CE.FONTS).forEach((key) => {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = CE.FONT_LABELS[key];
  els.font.appendChild(option);
});

els.theme.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-theme]');
  if (!button) return;
  opts.theme = button.dataset.theme;
  paint(true);
});

els.font.addEventListener('change', () => { opts.font = els.font.value; paint(true); });
els.minus.addEventListener('click', () => { opts.size = Math.max(CE.SIZE_MIN, opts.size - 1); paint(true); });
els.plus.addEventListener('click', () => { opts.size = Math.min(CE.SIZE_MAX, opts.size + 1); paint(true); });
els.loadAll.addEventListener('change', () => api.storage.local.set({ loadAll: els.loadAll.checked }));

(async function init() {
  // userAgent is the reliable signal in the popup; getPlatformInfo has been seen
  // to not report android here, so fall back to it only if the UA is inconclusive.
  isAndroid = /Android/i.test(navigator.userAgent);
  if (!isAndroid) {
    try { isAndroid = (await api.runtime.getPlatformInfo()).os === 'android'; } catch { /* desktop */ }
  }

  const saved = await api.storage.local.get(['opts', 'loadAll']);
  opts = CE.normalizeOpts(saved.opts);
  if (typeof saved.loadAll === 'boolean') els.loadAll.checked = saved.loadAll;
  paint(false);

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url || '')) {
    els.title.textContent = 'Not a ChatGPT tab.';
    say('Open a conversation on chatgpt.com and try again.');
    return;
  }
  tabId = tab.id;

  try {
    const info = await api.tabs.sendMessage(tabId, { type: 'PING' });
    els.loaded.textContent = String(info.loaded);
    els.title.textContent = info.title;
    setEnabled(true);
    say('Everything runs in this browser.');
  } catch {
    els.title.textContent = 'Extension not loaded in this tab.';
    say('Reload the ChatGPT tab, then reopen this popup.', 'bad');
  }
})();

els.buttons.forEach((button) => {
  button.addEventListener('click', async () => {
    // On Android the popup is its own tab; keeping it open backgrounds the
    // ChatGPT tab, which then can't scroll or render. Hand off and close so the
    // content script runs in the foreground; it reports progress with a toast.
    if (isAndroid) {
      api.tabs.sendMessage(tabId, {
        type: 'EXPORT',
        format: button.dataset.format,
        opts,
        loadAll: els.loadAll.checked,
        androidToast: true
      }).catch(() => {});
      // Bring the ChatGPT tab to the front; this dismisses the popup and lets the
      // page render + scroll. More reliable than window.close() on Android.
      api.tabs.update(tabId, { active: true });
      return;
    }

    setEnabled(false);
    say(els.loadAll.checked ? 'Scrolling back through the thread\u2026' : 'Reading the thread\u2026');

    try {
      const result = await api.tabs.sendMessage(tabId, {
        type: 'EXPORT',
        format: button.dataset.format,
        opts,
        loadAll: els.loadAll.checked
      });

      if (result && result.ok) {
        els.loaded.textContent = String(result.count);
        say(`${result.note} \u00b7 ${result.count} messages`, 'good');
      } else {
        say((result && result.error) || 'Export failed.', 'bad');
      }
    } catch (err) {
      say(String(err && err.message ? err.message : err), 'bad');
    } finally {
      setEnabled(true);
    }
  });
});

els.copy.addEventListener('click', async () => {
  // Android: the content script must write the clipboard itself, because the
  // popup closes so the ChatGPT tab can come to the foreground and scroll.
  if (isAndroid) {
    api.tabs.sendMessage(tabId, {
      type: 'EXPORT',
      format: 'markdown',
      deliver: 'clipboard-self',
      opts,
      loadAll: els.loadAll.checked,
      androidToast: true
    }).catch(() => {});
    api.tabs.update(tabId, { active: true });
    return;
  }

  setEnabled(false);
  say(els.loadAll.checked ? 'Scrolling back through the thread\u2026' : 'Reading the thread\u2026');

  try {
    const result = await api.tabs.sendMessage(tabId, {
      type: 'EXPORT',
      format: 'markdown',
      deliver: 'clipboard',
      opts,
      loadAll: els.loadAll.checked
    });

    if (result && result.ok && typeof result.text === 'string') {
      await copyText(result.text);
      els.loaded.textContent = String(result.count);
      say(`Copied ${result.count} messages to the clipboard`, 'good');
    } else {
      say((result && result.error) || 'Copy failed.', 'bad');
    }
  } catch (err) {
    say(String(err && err.message ? err.message : err), 'bad');
  } finally {
    setEnabled(true);
  }
});
