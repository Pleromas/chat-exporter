/* Receives commands from the popup, builds the file, hands it to the background script. */
(function () {
  const CE = (globalThis.CE = globalThis.CE || {});
  const api = globalThis.browser || globalThis.chrome;

  function slug(title) {
    return (title || 'chatgpt-conversation')
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 70)
      .toLowerCase() || 'chatgpt-conversation';
  }

  function stamp(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  /* A turn's own headings must sit below the speaker heading, otherwise
     "## You" and "## General introductions" read as the same level. */
  function demoteHeadings(md) {
    const lines = md.split('\n');
    let inFence = false;
    let shallowest = 7;

    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = /^(#{1,6})\s+/.exec(line);
      if (m) shallowest = Math.min(shallowest, m[1].length);
    }
    if (shallowest > 6) return md;

    const shift = Math.max(0, 3 - shallowest);
    if (!shift) return md;

    inFence = false;
    return lines
      .map((line) => {
        if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
        if (inFence) return line;
        const m = /^(#{1,6})(\s+)/.exec(line);
        if (!m) return line;
        const level = Math.min(6, m[1].length + shift);
        return '#'.repeat(level) + line.slice(m[1].length);
      })
      .join('\n');
  }

  function toMarkdown(data) {
    const head = [
      '---',
      `title: ${JSON.stringify(data.title)}`,
      `source: ${data.url}`,
      `exported: ${data.exportedAt}`,
      `messages: ${data.messages.length}`,
      '---',
      ''
    ].join('\n');

    const turns = data.messages.map((m, i) => {
      const who = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'ChatGPT' : m.role;
      const model = m.model ? ` \u00b7 ${m.model}` : '';
      const seq = `${i + 1} of ${data.messages.length}`;

      return [
        '',
        '---',
        '',
        `## ${who}`,
        '',
        `\`${seq}\`${model ? ` \u2014 \`${m.model}\`` : ''}`,
        '',
        demoteHeadings(m.markdown),
        ''
      ].join('\n');
    });

    return `${head}# ${data.title}\n${turns.join('\n')}\n`;
  }

  CE.__toMarkdown = toMarkdown;

  const FORMATS = {
    markdown: { ext: 'md', mime: 'text/markdown', build: toMarkdown },
    json: { ext: 'json', mime: 'application/json', build: (d) => JSON.stringify(d, null, 2) },
    html: { ext: 'html', mime: 'text/html', build: (d, opts) => CE.buildDocument(d, opts) }
  };

  async function run(request) {
    const opts = CE.normalizeOpts(request.opts);

    if (request.loadAll !== false) await CE.loadWholeThread();

    const data = CE.extract();
    if (!data.messages.length) {
      return { ok: false, error: 'No messages found. Open a conversation, then try again.' };
    }

    // Copy path: build the text and hand it back for the popup to put on the
    // clipboard. Reliable on Android, where the downloads API is flaky.
    if (request.deliver === 'clipboard') {
      const fmt = FORMATS[request.format] || FORMATS.markdown;
      return { ok: true, count: data.messages.length, text: fmt.build(data, opts) };
    }

    const base = `${slug(data.title)}-${stamp(data.exportedAt)}`;

    if (request.format === 'pdf') {
      await api.runtime.sendMessage({
        type: 'PRINT',
        title: data.title,
        opts,
        body: CE.buildBody(data)
      });
      return { ok: true, count: data.messages.length, note: 'Opened print view' };
    }

    const spec = FORMATS[request.format];
    if (!spec) return { ok: false, error: `Unknown format: ${request.format}` };

    const name = `${base}.${spec.ext}`;
    const res = await api.runtime.sendMessage({
      type: 'DOWNLOAD',
      filename: name,
      mime: spec.mime,
      text: spec.build(data, opts)
    });

    if (!res || !res.ok) {
      return { ok: false, error: (res && res.error) || 'Download failed.' };
    }
    const note = res.viaTab
      ? `Opened ${name} in a tab — save it from the browser menu`
      : `Saved ${name}`;
    return { ok: true, count: data.messages.length, note };
  }

  api.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'EXPORT') return;
    return run(msg).catch((err) => ({ ok: false, error: String(err && err.message || err) }));
  });

  // Lets the popup show a live count without doing any work.
  api.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'PING') return;
    return Promise.resolve({
      ok: true,
      loaded: document.querySelectorAll(CE.SEL.message).length,
      title: CE.conversationTitle()
    });
  });
})();
