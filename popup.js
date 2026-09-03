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
  buttons: Array.from(document.querySelectorAll('button.fmt'))
};

let tabId = null;
let opts = CE.normalizeOpts();

function say(text, tone) {
  els.status.textContent = text;
  els.status.className = tone || '';
}

function setEnabled(on) {
  els.buttons.forEach((b) => { b.disabled = !on; });
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
