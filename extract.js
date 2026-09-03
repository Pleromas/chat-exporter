/* Pulls the conversation out of the page DOM.
 * Every selector ChatGPT could change lives in SEL, so there is one place to fix.
 */
(function () {
  const CE = (globalThis.CE = globalThis.CE || {});

  const SEL = {
    message: '[data-message-author-role]',
    turn: 'article[data-testid^="conversation-turn"]',
    assistantBody: '.markdown',
    userBody: '.whitespace-pre-wrap',
    attrId: 'data-message-id',
    attrRole: 'data-message-author-role',
    attrModel: 'data-message-model-slug',

    // Interface furniture that is not part of the message.
    noise: [
      'button',
      '[role="button"]',
      '.sr-only',
      '[aria-hidden="true"]',
      '[data-testid*="citation"]',
      '[data-testid*="sources"]',
      '[data-testid*="carousel"]',
      'figure figcaption span:only-child'
    ].join(',')
  };

  CE.SEL = SEL;

  function messageNodes() {
    return Array.from(document.querySelectorAll(SEL.message));
  }

  // The thread lives in a scrollable ancestor, not on <body>.
  function scrollContainer() {
    let node = document.querySelector(SEL.message);
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

  function bodyOf(node) {
    return node.querySelector(SEL.assistantBody) || node.querySelector(SEL.userBody) || node;
  }

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
        const role = node.getAttribute(SEL.attrRole) || 'unknown';
        const body = bodyOf(node);

        // User turns are plain text in a pre-wrap div; keep their line breaks verbatim.
        let markdown;
        if (body.classList.contains('whitespace-pre-wrap')) {
          const raw = typeof body.innerText === 'string' ? body.innerText : body.textContent;
          markdown = (raw || '').replace(/\u00a0/g, ' ').trim();
        } else {
          markdown = stripStrayCounters(CE.htmlToMarkdown(cleanCopy(body)));
        }

        return {
          id: node.getAttribute(SEL.attrId) || null,
          role,
          model: role === 'assistant' ? node.getAttribute(SEL.attrModel) || null : null,
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
