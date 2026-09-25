/* Pulls the conversation out of the page DOM.
 * Every selector ChatGPT could change lives in SEL, so there is one place to fix.
 *
 * ChatGPT's DOM changed in 2026-09: the old `data-message-author-role` node is
 * gone. A conversation is now a list of turns (`data-turn-key`), and inside a
 * turn each message is anchored by one of two stable hooks:
 *   - user:      an element with `data-user-message-bubble`, text in .whitespace-pre-wrap
 *   - assistant: a CSS-module container whose class starts with "MarkdownRoot"
 *                (the hash suffix changes per build; the prefix is the component name)
 * The role is no longer an attribute on the content node — it is inferred from
 * which hook matched. Model slug is no longer exposed anywhere, so it is null.
 * The pre-2026-09 selectors are kept as a fallback.
 */
(function () {
  const CE = (globalThis.CE = globalThis.CE || {});

  const SEL = {
    // Current DOM (2026-09+).
    userMessage: '[data-user-message-bubble]',
    assistantBody: '[class*="MarkdownRoot"]',
    userText: '.whitespace-pre-wrap',
    turn: '[data-turn-key]',
    attrId: 'data-chatgpt-selection-message-id',

    // Legacy DOM (pre-2026-09) fallback.
    legacyMessage: '[data-message-author-role]',
    legacyAssistantBody: '.markdown',
    legacyRole: 'data-message-author-role',
    legacyId: 'data-message-id',
    legacyModel: 'data-message-model-slug',

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

  // Combined message hook: user bubbles and assistant markdown roots, in DOM order.
  SEL.message = SEL.userMessage + ',' + SEL.assistantBody;
  CE.SEL = SEL;

  const isLegacy = (node) => !!(node.hasAttribute && node.hasAttribute(SEL.legacyRole));

  function messageNodes() {
    const nodes = Array.from(document.querySelectorAll(SEL.message));
    if (nodes.length) return nodes;
    return Array.from(document.querySelectorAll(SEL.legacyMessage));
  }

  function roleOf(node) {
    if (isLegacy(node)) return node.getAttribute(SEL.legacyRole) || 'unknown';
    return node.matches(SEL.userMessage) ? 'user' : 'assistant';
  }

  // The element whose contents are the actual message body.
  function bodyOf(node, role) {
    if (isLegacy(node)) {
      return node.querySelector(SEL.legacyAssistantBody) || node.querySelector(SEL.userText) || node;
    }
    if (role === 'user') return node.querySelector(SEL.userText) || node;
    return node; // assistant: the MarkdownRoot node is itself the body
  }

  function idOf(node) {
    return (
      node.getAttribute(SEL.attrId) ||
      node.getAttribute(SEL.legacyId) ||
      (node.closest && node.closest(SEL.turn) && node.closest(SEL.turn).getAttribute('data-turn-key')) ||
      null
    );
  }

  // The thread lives in a scrollable ancestor, not on <body>.
  function scrollContainer() {
    let node = document.querySelector(SEL.message) || document.querySelector(SEL.legacyMessage);
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
    const box = scrollContainer();
    const restore = box.scrollTop;
    let previous = -1;
    let settled = 0;

    for (let pass = 0; pass < 250 && settled < 3; pass++) {
      const count = messageNodes().length;
      if (count === previous) settled++;
      else { settled = 0; previous = count; }

      if (onProgress) onProgress(count);
      box.scrollTop = 0;
      await wait(300);
    }

    box.scrollTop = restore || box.scrollHeight;
    return messageNodes().length;
  };

  /* Work on a copy so the live page is never modified, and drop the buttons,
     gallery badges and citation chips that would otherwise land in the text. */
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
      // Removing an inline chip can leave a double space behind. Collapse those,
      // but never touch leading indentation (it carries list nesting).
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

  CE.extract = function () {
    const messages = messageNodes()
      .map((node) => {
        const role = roleOf(node);
        const body = bodyOf(node, role);

        // User turns are plain text; keep their line breaks verbatim.
        let markdown;
        if (role === 'user') {
          const raw = typeof body.innerText === 'string' ? body.innerText : body.textContent;
          markdown = (raw || '').replace(/ /g, ' ').trim();
        } else {
          markdown = stripStrayCounters(CE.htmlToMarkdown(cleanCopy(body)));
        }

        return {
          id: idOf(node),
          role,
          model: role === 'assistant' ? node.getAttribute(SEL.legacyModel) || null : null,
          markdown
        };
      })
      .filter((m) => m.markdown && m.role !== 'system' && m.role !== 'tool');

    return {
      title: CE.conversationTitle(),
      url: location.href,
      exportedAt: new Date().toISOString(),
      messages
    };
  };
})();
