/* Pulls the conversation out of the page DOM.
 *
 * ChatGPT hashes its CSS-module class names (MarkdownRoot-<hash>, Paragraph-<hash>),
 * and those differ between desktop and mobile builds, so class selectors are not a
 * reliable anchor. The stable anchor is the per-message screen-reader heading —
 * an sr-only "You said:" / "ChatGPT said:" — which marks every turn and names its
 * role. Each heading's containing block is the message; its body is that block with
 * the sr-only label and interface furniture removed.
 *
 * messageBlocks() tries three strategies, most reliable first:
 *   1. labels  — the sr-only "You said:" / "ChatGPT said:" headings (current DOM)
 *   2. anchors — [data-user-message-bubble] + [class*="MarkdownRoot"] (recent DOM)
 *   3. legacy  — [data-message-author-role] (pre-2026-09 DOM)
 */
(function () {
  const CE = (globalThis.CE = globalThis.CE || {});

  const SEL = {
    userText: '.whitespace-pre-wrap',
    markdownRoot: '[class*="MarkdownRoot"]',
    userMessage: '[data-user-message-bubble]',
    turn: '[data-turn-key]',
    attrId: 'data-chatgpt-selection-message-id',

    legacyMessage: '[data-message-author-role]',
    legacyAssistantBody: '.markdown',
    legacyRole: 'data-message-author-role',
    legacyId: 'data-message-id',

    // Interface furniture that is not part of the message.
    noise: [
      'button',
      '[role="button"]',
      '.sr-only',
      '[aria-hidden="true"]',
      '[data-testid*="citation"]',
      '[data-testid*="sources"]',
      '[data-testid*="carousel"]',
      'img[class*="Favicon"]',
      'span[class*="Favicon"]',
      'figure figcaption span:only-child'
    ].join(',')
  };

  // Combined selector, used only to find *a* message node (scroll container, count).
  SEL.message = SEL.userMessage + ',' + SEL.markdownRoot + ',' + SEL.legacyMessage;
  CE.SEL = SEL;

  const LABEL_RE = /\b(you said|chatgpt said)\b/i;
  const roleFromLabel = (t) => (/chatgpt said/i.test(t) ? 'assistant' : 'user');

  /* Strategy 1: the sr-only role headings. */
  function labelBlocks() {
    const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const out = [];
    for (const h of heads) {
      const t = (h.textContent || '').trim();
      if (LABEL_RE.test(t)) {
        out.push({ node: h.parentElement || h, role: roleFromLabel(t), kind: 'label' });
      }
    }
    return out;
  }

  /* Strategy 2: user bubbles and assistant markdown roots, in DOM order. */
  function anchorBlocks() {
    const nodes = Array.from(document.querySelectorAll(SEL.userMessage + ',' + SEL.markdownRoot));
    return nodes.map((n) => ({
      node: n,
      role: n.matches(SEL.userMessage) ? 'user' : 'assistant',
      kind: 'anchor'
    }));
  }

  /* Strategy 3: the pre-2026-09 attribute. */
  function legacyBlocks() {
    return Array.from(document.querySelectorAll(SEL.legacyMessage)).map((n) => ({
      node: n,
      role: n.getAttribute(SEL.legacyRole) || 'unknown',
      kind: 'legacy'
    }));
  }

  function rawBlocks() {
    let b = labelBlocks();
    if (b.length) return b;
    b = anchorBlocks();
    if (b.length) return b;
    return legacyBlocks();
  }

  // The current conversation id, from /c/<id> in the URL.
  function conversationId() {
    const m = /\/c\/([^/?#]+)/.exec(location.pathname || '');
    return m ? m[1] : null;
  }

  const CONV_ATTR = 'data-chatgpt-selection-conversation-id';

  // The conversation a message block belongs to: ChatGPT tags turns with the
  // conversation id. Look on the block, inside it, and across its enclosing turn.
  function blockConversationId(node) {
    const el =
      (node.closest && node.closest('[' + CONV_ATTR + ']')) ||
      (node.querySelector && node.querySelector('[' + CONV_ATTR + ']')) ||
      (node.closest &&
        node.closest(SEL.turn) &&
        node.closest(SEL.turn).querySelector('[' + CONV_ATTR + ']'));
    return el ? el.getAttribute(CONV_ATTR) : null;
  }

  /* ChatGPT is a single-page app and leaves a previously-viewed conversation's
     turns in the DOM, so a whole-document scan mixes two conversations. Keep only
     the blocks that belong to the conversation in the URL. Blocks with no id tag
     are kept (don't over-filter), and if scoping would drop everything the raw
     set is returned unchanged. */
  function scopeToConversation(blocks) {
    const id = conversationId();
    if (!id || !document.querySelector('[' + CONV_ATTR + ']')) return blocks;
    const scoped = blocks.filter((b) => {
      const c = blockConversationId(b.node);
      return c === null || c === id;
    });
    return scoped.length ? scoped : blocks;
  }

  function messageBlocks() {
    return scopeToConversation(rawBlocks());
  }

  CE.messageCount = () => messageBlocks().length;

  function idOf(node) {
    return (
      (node.getAttribute && (node.getAttribute(SEL.attrId) || node.getAttribute(SEL.legacyId))) ||
      (node.closest && node.closest(SEL.turn) && node.closest(SEL.turn).getAttribute('data-turn-key')) ||
      null
    );
  }

  /* On Android the export is triggered from a popup that backgrounds this tab, and
     a hidden tab neither renders virtualised turns nor runs timers at full speed.
     Wait until the tab is visible (the popup has gone) before scrolling. */
  function whenVisible() {
    if (document.visibilityState === 'visible') return Promise.resolve();
    return new Promise((resolve) => {
      const handler = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', handler);
          clearTimeout(timer);
          resolve();
        }
      };
      const timer = setTimeout(() => {
        document.removeEventListener('visibilitychange', handler);
        resolve();
      }, 8000);
      document.addEventListener('visibilitychange', handler);
    });
  }

  // The thread lives in a scrollable ancestor, not on <body>. Pick the ancestor of
  // a message that actually scrolls and has the most content; fall back to the page.
  function scrollContainer() {
    const first = rawBlocks()[0];
    let node = (first && first.node) || document.querySelector(SEL.message);
    let best = null;
    while (node && node !== document.body && node.parentElement) {
      try {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 40) {
          if (!best || node.scrollHeight > best.scrollHeight) best = node;
        }
      } catch (e) { /* detached */ }
      node = node.parentElement;
    }
    return best || document.scrollingElement || document.documentElement;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pageScroller = () => document.scrollingElement || document.documentElement;

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // A stable id for a message, the same across scroll snapshots, so the same turn
  // is never counted twice and never lost. Prefer ChatGPT's own ids; role is part
  // of the key so a turn that carries both a user and assistant message splits.
  function idForMerge(block) {
    const n = block.node;
    const own = n.querySelector && n.querySelector('[data-chatgpt-selection-message-id]');
    if (own) return 'm:' + own.getAttribute('data-chatgpt-selection-message-id') + ':' + block.role;
    const turn = n.closest && n.closest(SEL.turn);
    if (turn && turn.getAttribute('data-turn-key')) return 't:' + turn.getAttribute('data-turn-key') + ':' + block.role;
    return 'h:' + block.role + ':' + hashStr(markdownOf(block));
  }

  /* Export the whole conversation, robust to ChatGPT's virtualisation.
     Turns far from the viewport are dropped from the DOM in BOTH directions, so a
     single extract at the top loses the latest messages and a single extract at the
     bottom loses the oldest. Instead: start at the bottom (capture the latest before
     they can be dropped), scroll UP a chunk at a time capturing each window, then
     return to the bottom and capture again. Each window is merged by stable id into
     one ordered list, so nothing is counted twice or lost. Either the thread
     container or the window may be the real scroller, so both are scrolled. */
  CE.extractAll = async function (onProgress) {
    await whenVisible();
    const box = scrollContainer();
    const content = new Map();
    let order = [];
    const seen = new Set();

    function merge(win) {
      if (!win.length) return;
      if (!order.length) { order = win.slice(); win.forEach((id) => seen.add(id)); return; }
      const firstSeen = win.findIndex((id) => seen.has(id));
      if (firstSeen === -1) {
        const news = win.filter((id) => !seen.has(id));
        order = news.concat(order); // no overlap while scrolling up => older, goes on top
        news.forEach((id) => seen.add(id));
        return;
      }
      const older = win.slice(0, firstSeen).filter((id) => !seen.has(id));
      if (older.length) {
        const pos = order.indexOf(win[firstSeen]);
        order = order.slice(0, pos).concat(older, order.slice(pos));
        older.forEach((id) => seen.add(id));
      }
      const tail = win.slice(firstSeen + 1).filter((id) => !seen.has(id));
      if (tail.length) { order = order.concat(tail); tail.forEach((id) => seen.add(id)); }
    }

    function capture() {
      const win = [];
      for (const b of messageBlocks()) {
        if (b.role === 'system' || b.role === 'tool') continue;
        const md = markdownOf(b);
        if (!md) continue;
        const id = idForMerge(b);
        win.push(id);
        const ex = content.get(id);
        if (!ex || md.length > ex.markdown.length) content.set(id, { role: b.role, markdown: md });
      }
      merge(win);
      if (onProgress) onProgress(order.length);
    }

    const toBottom = () => {
      try { if (box) box.scrollTop = box.scrollHeight; } catch (e) { /* */ }
      try { window.scrollTo(0, pageScroller().scrollHeight); } catch (e) { /* */ }
    };

    // 1. Bottom first — the latest turns, before virtualisation can drop them.
    toBottom();
    await wait(250);
    capture();

    // 2. Scroll up, capturing each window, until the top is reached and stable.
    let previous = -1;
    let settled = 0;
    for (let pass = 0; pass < 400 && settled < 4; pass++) {
      const boxTop = box ? box.scrollTop : 0;
      const winTop = pageScroller().scrollTop;
      const atTop = boxTop <= 1 && winTop <= 1;
      if (order.length === previous && atTop) settled++;
      else settled = 0;
      previous = order.length;

      const step = Math.max(500, Math.round((box && box.clientHeight ? box.clientHeight : window.innerHeight) * 0.7));
      try { if (box) box.scrollTop = Math.max(0, boxTop - step); } catch (e) { /* */ }
      try { window.scrollBy(0, -step); } catch (e) { /* */ }
      await wait(350);
      capture();
    }

    // 3. Back to the bottom and capture again, so the latest are present and current.
    toBottom();
    await wait(400);
    capture();

    return order
      .map((id) => content.get(id))
      .filter(Boolean)
      .map((m) => ({ id: null, role: m.role, model: null, markdown: m.markdown }));
  };

  /* Work on a copy so the live page is never modified, and drop the buttons,
     gallery badges, sr-only labels and citation chips. */
  function cleanCopy(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll(SEL.noise).forEach((el) => el.remove());
    return copy;
  }

  /* Image galleries leave their count badge behind as a bare number on its own
     line. Remove those, but never touch anything inside a code fence. */
  function stripStrayCounters(md) {
    const lines = md.split('\n');
    const kept = [];
    let inFence = false;

    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;

      if (!inFence && /^\s*\d{1,3}\s*$/.test(lines[i])) {
        const before = i === 0 || /^\s*$/.test(lines[i - 1]);
        const after = i === lines.length - 1 || /^\s*$/.test(lines[i + 1]);
        if (before && after) continue;
      }
      kept.push(inFence ? lines[i] : lines[i].replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 '));
    }

    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  CE.conversationTitle = function () {
    const active = document.querySelector('nav a[data-active], nav li[data-active] a');
    const fromNav = active && active.textContent.trim();
    if (fromNav) return fromNav;

    return (document.title || 'ChatGPT conversation')
      .replace(/\s*[-–|]\s*ChatGPT\s*$/i, '')
      .replace(/^\s*ChatGPT\s*[-–|]\s*/i, '')
      .trim() || 'ChatGPT conversation';
  };

  function markdownOf(block) {
    const { node, role } = block;

    if (role === 'user') {
      const u = node.querySelector(SEL.userText) || node;
      const raw = typeof u.innerText === 'string' ? u.innerText : u.textContent;
      return (raw || '')
        .replace(/ /g, ' ')
        .replace(/^\s*you said:\s*/i, '')
        .trim();
    }

    // Assistant: prefer the markdown root; else the legacy container; else the whole
    // block (cleanCopy strips the sr-only label and furniture either way).
    const body =
      node.querySelector(SEL.markdownRoot) ||
      node.querySelector(SEL.legacyAssistantBody) ||
      node;
    return stripStrayCounters(CE.htmlToMarkdown(cleanCopy(body)));
  }

  CE.extract = function () {
    const messages = messageBlocks()
      .map((block) => ({
        id: idOf(block.node),
        role: block.role,
        model: null,
        markdown: markdownOf(block)
      }))
      .filter((m) => m.markdown && m.role !== 'system' && m.role !== 'tool');

    return {
      title: CE.conversationTitle(),
      url: location.href,
      exportedAt: new Date().toISOString(),
      messages
    };
  };
})();
