const api = globalThis.browser || globalThis.chrome;

document.getElementById('doc-css').textContent = globalThis.CE.DOC_CSS;

(async function () {
  const key = new URLSearchParams(location.search).get('k');
  const target = document.getElementById('doc');

  if (!key) {
    target.textContent = 'Nothing to print. Run the export again from the popup.';
    return;
  }

  const store = await api.storage.local.get(key);
  const payload = store[key];
  await api.storage.local.remove(key);

  if (!payload) {
    target.textContent = 'This transcript has already been used. Run the export again.';
    return;
  }

  document.title = payload.title;

  // Parse inert, then import the nodes. CE.buildBody already escapes everything,
  // but DOMParser builds the tree in a detached document where scripts never run
  // and img/src never fetches, so nothing from the transcript is live until after
  // it is a node. Also keeps the AMO linter off the dynamic-innerHTML warning.
  const parsed = new DOMParser().parseFromString(payload.body, 'text/html');
  target.replaceChildren(
    ...Array.from(parsed.body.childNodes, (node) => document.importNode(node, true))
  );

  const root = document.documentElement;
  const CE = globalThis.CE;
  const opts = CE.normalizeOpts(payload.opts);

  if (opts.theme === 'auto') {
    opts.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  const themeBtn = document.getElementById('theme');
  const fontSel = document.getElementById('font');
  const sizeOut = document.getElementById('size');

  Object.keys(CE.FONTS).forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = CE.FONT_LABELS[key];
    fontSel.appendChild(option);
  });

  function apply() {
    root.setAttribute('data-theme', opts.theme);
    root.setAttribute('style', CE.rootStyle(opts));
    themeBtn.textContent = opts.theme === 'dark' ? 'Light paper' : 'Dark paper';
    fontSel.value = opts.font;
    sizeOut.textContent = opts.size;
    api.storage.local.set({ opts });
  }
  apply();

  themeBtn.addEventListener('click', () => {
    opts.theme = opts.theme === 'dark' ? 'light' : 'dark';
    apply();
  });
  fontSel.addEventListener('change', () => { opts.font = fontSel.value; apply(); });
  document.getElementById('minus').addEventListener('click', () => {
    opts.size = Math.max(CE.SIZE_MIN, opts.size - 1); apply();
  });
  document.getElementById('plus').addEventListener('click', () => {
    opts.size = Math.min(CE.SIZE_MAX, opts.size + 1); apply();
  });

  document.getElementById('print').addEventListener('click', () => window.print());

  // Give images and fonts a moment so the first page is not blank.
  await new Promise((r) => setTimeout(r, 400));
  window.print();
})();
