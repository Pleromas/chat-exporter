# Chat Exporter (local)

A Firefox extension that exports a ChatGPT conversation to **Markdown, JSON, HTML, or PDF**.
Everything happens inside your browser. There is no server, no API key, no analytics, no
network request of any kind.

Why this exists: the popular PDF add-ons are powered by a hosted HTML-to-PDF service. Because a
ChatGPT page is behind a login, the service can't fetch the URL itself — so the add-on captures
the rendered page and **uploads it** to be converted. Your conversation gets rendered on someone
else's machine. This extension uses Firefox's own print engine instead.

---

## Install

Firefox only allows signed extensions on the Release channel, so pick one of these.

**1. Temporary (easiest, gone when you restart Firefox)**

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select the `manifest.json` file in this folder

> Every file must stay in **one folder, side by side**. If you download the files individually
> and they end up scattered, or you move any of them into a subfolder, Firefox will load the
> manifest but silently fail to find the popup and content scripts — the icon shows as broken and
> clicking it does nothing.

**2. Permanent, still private** — sign it as an *unlisted* add-on. It stays off the public
directory and nobody else can find it.

```bash
npm install --global web-ext
# get credentials at addons.mozilla.org -> Tools -> Manage API Keys
web-ext sign --channel=unlisted --api-key=JWT_ISSUER --api-secret=JWT_SECRET
```

That uploads the extension, Mozilla signs it, and a signed `.xpi` lands in `web-ext-artifacts/`.
Install it permanently from `about:addons` -> gear icon -> *Install Add-on From File*. Signing
requires your own AMO account, so nobody can produce a signed build on your behalf.

**3. Permanent, unsigned** — Developer Edition, Nightly, or ESR only. Set
`xpinstall.signatures.required` to `false` in `about:config`, then install the `.xpi`:

```bash
./build.sh        # or: npm run build
```

Release Firefox ignores that pref and will refuse the file. That is a deliberate Mozilla policy,
not a bug in the build.

> `manifest.json` must sit at the **root** of the `.xpi`. Zipping the folder itself gives you
> `chat-exporter/manifest.json` and Firefox rejects the file with a vague install error. `build.sh`
> gets this right; a right-click "compress folder" does not.

## Use

Open a conversation, click the toolbar icon, pick a format.

- **Markdown** — the format to keep things in. Code fences, tables, lists, and LaTeX survive.
- **PDF** — opens a clean print view and Firefox's print dialog. Choose *Save to PDF* as the
  destination, and untick **Print headers and footers** so Firefox stops stamping the
  `moz-extension://` URL and page numbers on every page.
- **HTML** — one self-contained file, styles included.
- **JSON** — structured data with message IDs, roles, and model slugs. Good for feeding
  conversations into other tools.

Leave **"Scroll back first"** checked. Long threads are virtualised — older messages genuinely
aren't in the page until something scrolls them into view, so the extension scrolls the thread to
the top and waits for the message count to stop growing before reading anything.

## Paper and type

**Paper** sets light or dark, **Type** sets the typeface (Serif, Book, Sans, Mono) and body size
(13–21px). All three apply to the PDF and HTML exports only — Markdown and JSON are plain text.
*Auto* paper follows your system setting when the file is opened. Your choices are remembered.

The print view carries the same three controls, so you can retune a transcript and re-save it as
PDF without exporting again.

Print sizing is derived, not separate: printed text is `calc(var(--body-size) * 0.875)`, so the
16px default lands at the 10.5pt that reads well on paper, and the whole scale moves with it.

### How the dark page actually prints

Browsers drop backgrounds when printing. `print-color-adjust: exact` overrides that, but only for
**element** backgrounds — a background on the root element propagates to the page *canvas*, which
isn't an element, so Firefox discards it regardless. The page background therefore has to be
painted by `<body>`, and for `<body>` to reach the paper edge the page margin must be zero.

That creates a second problem: padding on `<body>` applies once to the whole element, so it gives
the first page a top margin and leaves every later page flush against the edge. The fix is a
one-column table wrapping the document, with an empty `<thead>` and `<tfoot>`. Browsers repeat
table headers and footers on every printed page, so those cells become a gutter that reappears on
each sheet — inside the painted area, unlike a real page margin.

The body box is only as tall as its content, so on the final page everything below the last line
would be bare page canvas — which Firefox leaves white unless you tick **Print backgrounds**. A
`position: fixed` paper layer fixes that: it is a real element (so `print-color-adjust` prints it)
and Firefox repeats it on every printed page at full height, painting the paper across every sheet,
last-page tail included. The whole document prints correctly without touching any print setting.

## How it works

```
popup.js       picks a format, messages the tab
  └─ content.js   runs the export, hands the finished file to the background
       ├─ extract.js    finds turns in the DOM, forces the whole thread to load
       ├─ markdown.js   HTML -> Markdown, and a small Markdown -> HTML renderer
       └─ doc.js        the stylesheet and page structure for HTML/PDF output
background.js  creates the download; opens the print tab
print.js       renders the transcript and calls window.print()
```

Two details worth knowing:

**Downloads are created in the background script, not the content script.** A blob URL made
inside a content script belongs to the web page's context, and handing that to the downloads API
is unreliable. The background page is the extension's own context, so the blob outlives the page.

**The print view is a real extension page.** ChatGPT's Content-Security-Policy can block injected
iframes and blob documents, so the transcript is stashed in `storage.local`, a `moz-extension:`
tab is opened, and the payload is deleted as soon as it's read.

## When ChatGPT changes its markup

It will. Every selector that can break lives in one object at the top of `extract.js`:

```js
const SEL = {
  message: '[data-message-author-role]',
  assistantBody: '.markdown',
  userBody: '.whitespace-pre-wrap',
  ...
};
```

`data-message-author-role` has been stable for a long time and is the load-bearing one. If exports
come back empty, open the console on a chat and run
`document.querySelectorAll('[data-message-author-role]').length`. If that's `0`, find the new
attribute in the inspector and change it in that one place.

## Permissions, and why each one is there

| Permission | Reason |
|---|---|
| `host_permissions` for chatgpt.com | Read the conversation you're looking at. Nothing else matches. |
| `downloads` | Save the file you asked for. |
| `storage` | Pass the transcript to the print tab, then delete it. |

There is no `<all_urls>`, no background network access, and no remote code. You can verify that
quickly: `grep -n "fetch\|XMLHttpRequest\|sendBeacon" *.js` returns nothing.

## Tests

```bash
npm install jsdom
node test-run.js        # conversion against a ChatGPT-shaped DOM fixture
node test-security.js   # injection, javascript: URLs, nested code fences
node test-markdown.js   # heading demotion, turn separators, code-fence safety
```

`test-run.js` writes `out.html` so you can eyeball the styling without loading the extension.

## Known limits

- **Images expire.** ChatGPT image URLs are signed and time-limited, so an exported link will die.
  To keep images, fetch each one and inline it as a base64 data URI.
- **Very long threads** take a few seconds to scroll back through, and extremely long ones can be
  slow to re-render.
- **Canvas documents, and other side-panel content** aren't in the message DOM, so they aren't
  captured.
- **Interface noise** — buttons, citation chips, and image-gallery count badges — is stripped via
  the `noise` selector list in `extract.js`. If a stray fragment shows up in an export, add its
  selector there.
- **PDF page breaks** are decent but not perfect. Adjust `@media print` in `doc.js` to taste.

## Repo map

| File | Purpose |
|---|---|
| `CLAUDE.md` | Context for Claude Code: architecture, invariants, browser gotchas |
| `PRIVACY.md` | Privacy policy (required for AMO submission) |
| `build.sh` | Packages an unsigned `.xpi` with the manifest at the archive root |
| `test-*.js` | jsdom suites: conversion, injection safety, Markdown structure |

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later). See [LICENSE](LICENSE).
