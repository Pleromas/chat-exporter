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

  function messageBlocks() {
    let b = labelBlocks();
    if (b.length) return b;
    b = anchorBlocks();
    if (b.length) return b;
    return legacyBlocks();
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

  // The thread lives in a scrollable ancestor, not on <body>.
  function scrollContainer() {
    const first = messageBlocks()[0];
    let node = (first && first.node) || document.querySelector(SEL.message);
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 40) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Long chats are virtualised: older turns are not in the DOM until you
     scroll back to them. Scroll to the top until the count stops growing. */
  CE.loadWholeThread = async function (onProgress) {
    await whenVisible();
    const box = scrollContainer();
    const restore = box.scrollTop;
    let previous = -1;
    let settled = 0;

    for (let pass = 0; pass < 250 && settled < 3; pass++) {
      const count = CE.messageCount();
      if (count === previous) settled++;
      else { settled = 0; previous = count; }

      if (onProgress) onProgress(count);
      box.scrollTop = 0;
      await wait(300);
    }

    box.scrollTop = restore || box.scrollHeight;
    return CE.messageCount();
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
