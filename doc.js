/* The look of the exported HTML / PDF transcript.
 * Loaded by the content script (to build documents) and by print.html (for the CSS).
 */
(function () {
  const CE = (globalThis.CE = globalThis.CE || {});

  CE.FONTS = {
    serif: '"Charter", "Iowan Old Style", "Source Serif Pro", Georgia, serif',
    book: '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", Georgia, serif',
    sans: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, monospace'
  };

  CE.FONT_LABELS = { serif: 'Serif', book: 'Book', sans: 'Sans', mono: 'Mono' };
  CE.SIZE_MIN = 13;
  CE.SIZE_MAX = 21;
  CE.DEFAULTS = { theme: 'auto', font: 'serif', size: 16 };

  CE.normalizeOpts = function (o) {
    // Accept a bare theme string as well as a full option object.
    const given = typeof o === 'string' ? { theme: o } : (o || {});
    const opts = Object.assign({}, CE.DEFAULTS, given);
    if (opts.theme !== 'light' && opts.theme !== 'dark') opts.theme = 'auto';
    if (!CE.FONTS[opts.font]) opts.font = 'serif';
    const n = Number(opts.size);
    opts.size = Number.isFinite(n) ? Math.min(CE.SIZE_MAX, Math.max(CE.SIZE_MIN, Math.round(n))) : 16;
    return opts;
  };

  CE.rootStyle = function (opts) {
    const o = CE.normalizeOpts(opts);
    return `--body-size:${o.size}px;--body-font:${CE.FONTS[o.font]}`;
  };

  const LIGHT = `
    --paper: #ffffff;
    --raised: #f6f8f8;
    --ink: #1b1f21;
    --muted: #6c757b;
    --rule: #e2e7e9;
    --rule-soft: #ebeff0;
    --pine: #2c6b67;
    --clay: #8a4b39;
    --code-bg: #f5f7f8;
  `;

  const DARK = `
    --paper: #15181b;
    --raised: #1c2125;
    --ink: #e3e7e9;
    --muted: #8d969b;
    --rule: #2a3135;
    --rule-soft: #232a2d;
    --pine: #7cc5bc;
    --clay: #d9947c;
    --code-bg: #1b2125;
  `;

  CE.DOC_CSS = `
:root, :root[data-theme="light"] { ${LIGHT} }
:root[data-theme="dark"] { ${DARK} }
@media (prefers-color-scheme: dark) {
  :root[data-theme="auto"] { ${DARK} }
}

:root {
  --body-size: 16px;
  --body-font: ${CE.FONTS.serif};
  --ui-font: ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, monospace;
}

* { box-sizing: border-box; }

/* Firefox forces ELEMENT backgrounds to print with print-color-adjust, but the
   root background propagates to the page canvas, which is not an element and is
   dropped. So <body> has to paint the page. html keeps a background too, which
   covers the canvas for anyone who ticks "Print backgrounds". */
html {
  background: var(--paper);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

body {
  margin: 0;
  padding: 3.5rem 1.5rem 4rem;
  background: var(--paper);
  color: var(--ink);
  font: 400 var(--body-size)/1.7 var(--body-font);
  -webkit-font-smoothing: antialiased;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.sheet { max-width: 46rem; margin: 0 auto; }

/* Table head and foot repeat on every printed page. With a zero page margin the
   body covers the whole sheet, and these gutters supply the top and bottom space
   that body padding can only give the first and last page. */
.frame { width: 100%; border-collapse: collapse; border-spacing: 0; }
.frame td { padding: 0; border: 0; }
.frame td.gutter { height: 0; }
.frame td.page { vertical-align: top; }

header.doc { margin-bottom: 2.75rem; }
header.doc h1 {
  font-size: 1.85em;
  line-height: 1.2;
  margin: 0 0 .85rem;
  font-weight: 600;
  letter-spacing: -0.015em;
}
header.doc .stamp {
  display: flex;
  flex-wrap: wrap;
  gap: .35rem .9rem;
  align-items: baseline;
  padding-top: .85rem;
  border-top: 2px solid var(--ink);
  font: 500 11px/1.5 var(--ui-font);
  letter-spacing: .06em;
  color: var(--muted);
  text-transform: uppercase;
}
header.doc .src {
  display: block;
  width: 100%;
  margin-top: .1rem;
  font: 400 10.5px/1.5 var(--ui-font);
  letter-spacing: 0;
  text-transform: none;
  color: var(--muted);
  overflow-wrap: anywhere;
}
header.doc .src a { color: inherit; text-decoration: none; }

.turn { margin: 0 0 1.9rem; }

.who {
  display: flex;
  align-items: center;
  gap: .5rem;
  margin: 0 0 .55rem;
  font: 500 12px/1 var(--ui-font);
  letter-spacing: .04em;
}
.who .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.who .model { font-weight: 400; font-size: 11px; color: var(--muted); letter-spacing: .03em; }

.turn.user { --rail: var(--clay); --panel: var(--raised); }
.turn.assistant { --rail: var(--pine); --panel: var(--paper); }
.turn.unknown { --rail: var(--rule); --panel: var(--paper); }
.turn.user .who { color: var(--clay); }
.turn.assistant .who { color: var(--pine); }

/* The panel marks where a turn starts and stops. Left and right edges repeat on
   every page fragment, so a turn that spans a page break still reads as one box. */
.body {
  background: var(--panel);
  border: 1px solid var(--rule-soft);
  border-left: 3px solid var(--rail);
  border-radius: 0 4px 4px 0;
  padding: 1.05rem 1.3rem;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.turn.user .body { font-size: .96em; }

.body > :first-child { margin-top: 0; }
.body > :last-child { margin-bottom: 0; }
.body p { margin: 0 0 1.05rem; }

.body h1, .body h2, .body h3, .body h4, .body h5, .body h6 {
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.005em;
  margin: 2.1rem 0 .8rem;
}
.body h1 { font-size: 1.32em; }
.body h2 {
  font-size: 1.14em;
  padding-bottom: .35rem;
  border-bottom: 1px solid var(--rule);
}
.body h3 { font-size: 1.02em; }
.body h4, .body h5, .body h6 { font-size: .95em; color: var(--muted); }

.body ul, .body ol { margin: 0 0 1.05rem; padding-left: 1.3rem; }
.body li { margin: .3rem 0; padding-left: .15rem; }
.body li::marker { color: var(--muted); }
.body li > ul, .body li > ol { margin: .3rem 0; }

.body blockquote {
  margin: 0 0 1.05rem;
  padding: .2rem 0 .2rem 1.1rem;
  border-left: 2px solid var(--rule);
  color: var(--muted);
  font-style: italic;
}

.body a { color: var(--pine); text-underline-offset: 2px; overflow-wrap: anywhere; }
.body img { max-width: 100%; height: auto; border-radius: 4px; }
.body hr { border: 0; border-top: 1px solid var(--rule-soft); margin: 2rem 0; }
.body strong { font-weight: 600; }

.body code {
  font: 400 .86em/1.5 var(--ui-font);
  background: var(--code-bg);
  border: 1px solid var(--rule-soft);
  padding: .1em .34em;
  border-radius: 3px;
}
.body pre {
  background: var(--code-bg);
  border: 1px solid var(--rule);
  border-radius: 5px;
  padding: .95rem 1.1rem;
  margin: 0 0 1.05rem;
  overflow-x: auto;
}
.body pre code {
  background: none; border: 0; padding: 0;
  font-size: .82em; line-height: 1.6;
  white-space: pre;
}

.body table { border-collapse: collapse; width: 100%; margin: 0 0 1.05rem; font-size: .92em; }
.body th, .body td {
  border: 1px solid var(--rule);
  padding: .5rem .7rem;
  text-align: left;
  vertical-align: top;
}
.body th { background: var(--code-bg); font-weight: 600; }

footer.doc {
  margin-top: 2.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--rule);
  font: 400 10.5px/1.6 var(--ui-font);
  letter-spacing: .06em;
  color: var(--muted);
  text-transform: uppercase;
}

@media print {
  /* Zero page margin keeps the body box covering the full sheet, so its printed
     background reaches every edge. The gutters below restore the white space. */
  @page { margin: 0; }

  /* The body box is only as tall as its content, so on the final page everything
     below the last line is bare page canvas — which Firefox refuses to paint
     unless the user ticks "Print backgrounds". A position:fixed element is a real
     element (honoured by print-color-adjust) and Firefox repeats it on every
     printed page at full page height, so this paints the paper across every page,
     last-page tail included, with no checkbox. Kept behind content via z-index. */
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    background: var(--paper);
    z-index: -1;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  html, body { background: var(--paper) !important; }
  body {
    padding: 0 14mm;
    font-size: calc(var(--body-size) * 0.875);
    line-height: 1.62;
  }
  .frame td.gutter { height: 15mm; }
  .sheet { max-width: none; }

  header.doc { break-after: avoid; }
  .who { break-after: avoid; }
  .turn { margin-bottom: 1.5rem; break-inside: auto; }
  .body { break-inside: auto; }

  .body p, .body li { orphans: 3; widows: 3; }
  .body li { break-inside: avoid; }
  .body pre, .body table, .body img, .body blockquote { break-inside: avoid; }
  .body h1, .body h2, .body h3, .body h4 { break-after: avoid; break-inside: avoid; }

  .body a { text-decoration: none; }
  footer.doc { break-inside: avoid; }
  .no-print { display: none !important; }
}
`.trim();

  const LABEL = { user: 'You', assistant: 'ChatGPT', unknown: 'Unknown' };

  CE.buildBody = function (data) {
    const esc = CE.escapeHtml;

    const turns = data.messages
      .map((m) => {
        const role = m.role === 'user' || m.role === 'assistant' ? m.role : 'unknown';
        const model = role === 'assistant' && m.model
          ? ` <span class="model">${esc(m.model)}</span>` : '';
        return (
          `<section class="turn ${role}">` +
          `<div class="who"><span class="dot"></span>${esc(LABEL[role] || m.role)}${model}</div>` +
          `<div class="body">${CE.markdownToHtml(m.markdown)}</div>` +
          `</section>`
        );
      })
      .join('\n');

    const when = new Date(data.exportedAt);
    const stamp = when.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    const sheet =
      `<div class="sheet">` +
      `<header class="doc">` +
      `<h1>${esc(data.title)}</h1>` +
      `<div class="stamp"><span>${data.messages.length} messages</span><span>${esc(stamp)}</span>` +
      `<span class="src"><a href="${esc(data.url)}">${esc(data.url)}</a></span></div>` +
      `</header>` +
      turns +
      `<footer class="doc">Exported locally from the browser &middot; no content left this machine</footer>` +
      `</div>`;

    return (
      `<table class="frame">` +
      `<thead><tr><td class="gutter"></td></tr></thead>` +
      `<tbody><tr><td class="page">${sheet}</td></tr></tbody>` +
      `<tfoot><tr><td class="gutter"></td></tr></tfoot>` +
      `</table>`
    );
  };

  CE.buildDocument = function (data, opts) {
    const o = CE.normalizeOpts(opts);
    return (
      `<!doctype html>\n<html lang="en" data-theme="${o.theme}" style="${CE.rootStyle(o)}">\n` +
      `<head>\n<meta charset="utf-8">\n` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
      `<meta name="color-scheme" content="${o.theme === 'auto' ? 'light dark' : o.theme}">\n` +
      `<title>${CE.escapeHtml(data.title)}</title>\n<style>\n${CE.DOC_CSS}\n</style>\n</head>\n<body>\n` +
      CE.buildBody(data) +
      `\n</body>\n</html>\n`
    );
  };
})();
