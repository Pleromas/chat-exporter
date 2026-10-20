/* Conversion helpers. Runs in the content script sandbox.
 * CE.htmlToMarkdown(rootElement) -> markdown string
 * CE.markdownToHtml(markdown)    -> html string (all text escaped; tags are ours)
 */
(function () {
  const CE = (globalThis.CE = globalThis.CE || {});

  /* ---------------------------------------------------------------- *
   * HTML -> Markdown
   * ---------------------------------------------------------------- */

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'BUTTON', 'CANVAS', 'TEMPLATE',
    'SELECT', 'TEXTAREA', 'IFRAME', 'AUDIO', 'VIDEO'
  ]);

  // Escape only the characters that would actually change meaning.
  // Underscores are left alone so snake_case survives.
  function escText(t) {
    return t.replace(/([\\`*[\]])/g, '\\$1');
  }

  function longestBacktickRun(s) {
    let max = 0;
    for (const m of s.matchAll(/`+/g)) max = Math.max(max, m[0].length);
    return max;
  }

  function children(node) {
    return Array.from(node.childNodes).map(walk).join('');
  }

  function codeLanguage(pre, codeEl) {
    if (codeEl) {
      for (const cls of codeEl.classList) {
        const m = /^(?:language|lang)-(.+)$/.exec(cls);
        if (m) return m[1];
      }
    }
    // ChatGPT puts the language in a small header div inside the <pre>.
    for (const div of pre.querySelectorAll('div')) {
      const t = (div.textContent || '').trim().toLowerCase();
      if (t && t.length <= 20 && /^[a-z0-9+#._-]+$/.test(t) && t !== 'copy' && t !== 'edit') {
        return t;
      }
    }
    return '';
  }

  function renderList(el) {
    const ordered = el.tagName === 'OL';
    let start = parseInt(el.getAttribute('start') || '1', 10);
    if (Number.isNaN(start)) start = 1;

    const items = Array.from(el.children).filter((c) => c.tagName === 'LI');
    const lines = items.map((li, i) => {
      let marker = ordered ? `${start + i}. ` : '- ';

      const box = li.querySelector(':scope > input[type="checkbox"]');
      if (box) marker += box.checked ? '[x] ' : '[ ] ';

      const pad = ' '.repeat(marker.length);
      const body = children(li)
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\n\n(?=\s*(?:[-*+]|\d+[.)])\s)/g, '\n')
        .trim();

      return marker + body
        .split('\n')
        .map((line, j) => (j === 0 || !line ? line : pad + line))
        .join('\n');
    });

    return '\n\n' + lines.join('\n') + '\n\n';
  }

  function renderTable(el) {
    const rows = Array.from(el.querySelectorAll('tr'));
    if (!rows.length) return '';

    const cells = (row) =>
      Array.from(row.children).map((c) =>
        children(c).replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|').trim()
      );

    const head = cells(rows[0]);
    const body = rows.slice(1).map(cells);
    const line = (arr) => '| ' + arr.join(' | ') + ' |';

    return (
      '\n\n' +
      [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n') +
      '\n\n'
    );
  }

  /* ChatGPT renders math with KaTeX, which leaves the TeX source in an
     <annotation> and — crucially — a presentation-MathML copy in .katex-mathml.
     Markdown keeps the TeX ($…$ / $$…$$), which every maths-aware viewer renders.
     For HTML/PDF we also stash the MathML, keyed by the TeX, so the document
     builder can emit it: Firefox renders MathML natively, so equations render in
     the HTML file and in the printed PDF with no library and no network. */
  CE._mathCapture = CE._mathCapture || new Map();

  // TeX can arrive HTML-escaped on the markdown->HTML side; normalise both ends.
  function mathKey(tex) {
    return String(tex)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }
  CE._mathKey = mathKey;

  // Presentation MathML is a small, closed vocabulary with no scripting. Rebuild
  // it from a whitelist so nothing but known elements/attributes survives, and so
  // every text run is escaped — same string-building discipline as the rest of the
  // HTML path. The <annotation> (raw TeX) is dropped; the visual MathML is enough.
  const MATHML_TAGS = new Set([
    'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace',
    'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mover', 'munder',
    'munderover', 'mtable', 'mtr', 'mtd', 'mlabeledtr', 'mpadded', 'mphantom',
    'menclose', 'mstyle', 'mmultiscripts', 'mprescripts', 'none', 'merror'
  ]);
  const MATHML_ATTRS = new Set([
    'mathvariant', 'display', 'stretchy', 'fence', 'separator', 'accent',
    'accentunder', 'columnalign', 'rowalign', 'rowspacing', 'columnspacing',
    'open', 'close', 'displaystyle', 'scriptlevel', 'linethickness', 'width',
    'height', 'depth', 'mathsize', 'lspace', 'rspace', 'notation', 'dir',
    'form', 'minsize', 'maxsize', 'rowspan', 'columnspan', 'xmlns'
  ]);

  function serializeMathML(node) {
    if (node.nodeType === Node.TEXT_NODE) return escHtml(node.nodeValue || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const name = (node.localName || node.tagName || '').toLowerCase();
    if (name === 'annotation' || name === 'annotation-xml') return '';
    const inner = Array.from(node.childNodes).map(serializeMathML).join('');
    if (!MATHML_TAGS.has(name)) return inner; // unknown wrapper: keep its contents
    let attrs = '';
    for (const a of Array.from(node.attributes || [])) {
      const an = a.name.toLowerCase();
      if (MATHML_ATTRS.has(an) && !/^on/.test(an)) attrs += ` ${an}="${escHtml(a.value)}"`;
    }
    return `<${name}${attrs}>${inner}</${name}>`;
  }
  CE._serializeMathML = serializeMathML;

  function renderMath(el) {
    const tex = el.querySelector('annotation[encoding="application/x-tex"]');
    if (!tex) return null;
    const src = (tex.textContent || '').trim();
    if (!src) return '';
    const display = el.classList.contains('katex-display') || !!el.closest('.katex-display');

    const mathNode = el.querySelector('math');
    if (mathNode) {
      try {
        const mm = serializeMathML(mathNode);
        if (mm) CE._mathCapture.set(mathKey(src), { mathml: mm, display });
      } catch (e) { /* capture is best-effort; markdown still carries the TeX */ }
    }
    return display ? `\n\n$$\n${src}\n$$\n\n` : `$${src}$`;
  }

  /* Inline <svg> — a mermaid diagram or a chart ChatGPT drew. Its text nodes
     concatenate into gibberish and it carries an embedded <style>, so never walk
     into it; leave a short placeholder instead. (Real pictures are <img>, handled
     separately, so they are unaffected.) */
  function svgPlaceholder(el) {
    const id = (el.getAttribute && el.getAttribute('id')) || '';
    const mermaid = /mermaid/i.test(id) || (el.closest && !!el.closest('[class*="mermaid"]'));
    return mermaid ? '\n\n> **[Mermaid diagram]**\n\n' : '\n\n*[Embedded image]*\n\n';
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escText((node.nodeValue || '').replace(/\s+/g, ' '));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node;
    // SVG elements report a lowercase tagName ("svg", "style"), so normalise it;
    // otherwise an embedded <style> slips past SKIP_TAGS and dumps CSS into the text.
    const tag = (el.tagName || '').toUpperCase();

    if (SKIP_TAGS.has(tag)) return '';
    if (el.getAttribute('aria-hidden') === 'true') return '';
    if (el.classList.contains('sr-only')) return '';

    if (tag === 'SVG') return svgPlaceholder(el);

    if (el.classList.contains('katex') || el.classList.contains('katex-display')) {
      const math = renderMath(el);
      if (math !== null) return math;
    }

    switch (tag) {
      case 'BR':
        return '\n';
      case 'HR':
        return '\n\n---\n\n';
      case 'P':
      case 'DIV':
      case 'SECTION':
      case 'ARTICLE':
        return tag === 'P' ? '\n\n' + children(el) + '\n\n' : children(el);
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + children(el).trim() + '\n\n';
      case 'STRONG':
      case 'B': {
        const s = children(el).trim();
        return s ? `**${s}**` : '';
      }
      case 'EM':
      case 'I': {
        const s = children(el).trim();
        return s ? `*${s}*` : '';
      }
      case 'DEL':
      case 'S':
      case 'STRIKE': {
        const s = children(el).trim();
        return s ? `~~${s}~~` : '';
      }
      case 'A': {
        const href = el.getAttribute('href');
        const s = children(el).trim();
        if (!href) return s;
        if (!s) return href;
        return `[${s}](${href})`;
      }
      case 'IMG': {
        const src = el.getAttribute('src') || '';
        // Citation/source favicons ride along as tiny images; they are interface
        // furniture, not content. Drop them so they stop appearing as ![image].
        if (/\/s2\/favicons|[/.]favicon/i.test(src)) return '';
        const alt = el.getAttribute('alt') || 'image';
        return src ? `![${alt}](${src})` : '';
      }
      case 'CODE': {
        if (el.closest('pre')) return el.textContent || '';
        const t = el.textContent || '';
        const ticks = '`'.repeat(longestBacktickRun(t) + 1);
        const padded = /^`|`$/.test(t) ? ` ${t} ` : t;
        return `${ticks}${padded}${ticks}`;
      }
      case 'PRE': {
        const codeEl = el.querySelector('code');
        const raw = ((codeEl || el).textContent || '').replace(/\n+$/, '');
        const lang = codeLanguage(el, codeEl);
        const fence = '`'.repeat(Math.max(3, longestBacktickRun(raw) + 1));
        return `\n\n${fence}${lang}\n${raw}\n${fence}\n\n`;
      }
      case 'BLOCKQUOTE': {
        const inner = children(el).replace(/\n{3,}/g, '\n\n').trim();
        if (!inner) return '';
        return '\n\n' + inner.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n') + '\n\n';
      }
      case 'UL':
      case 'OL':
        return renderList(el);
      case 'TABLE':
        return renderTable(el);
      default:
        return children(el);
    }
  }

  CE.htmlToMarkdown = function (root) {
    if (!root) return '';
    return walk(root)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  /* ---------------------------------------------------------------- *
   * Markdown -> HTML (only what we emit above; every text run escaped)
   * ---------------------------------------------------------------- */

  function escHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeUrl(u) {
    return /^(https?:|mailto:|data:image\/)/i.test(u.trim()) ? escHtml(u.trim()) : '#';
  }

  /* Turn TeX back into rendered maths for HTML/PDF. If extraction captured the
     page's MathML for this exact expression, emit that (Firefox renders MathML
     natively, in the HTML file and in print). Otherwise fall back to the TeX
     source as code, so an equation degrades to readable text, never vanishes. */
  function mathHtml(tex, display) {
    const key = CE._mathKey ? CE._mathKey(tex) : String(tex).replace(/\s+/g, ' ').trim();
    const cap = CE._mathCapture && CE._mathCapture.get(key);
    if (cap && cap.mathml) {
      return display ? `<div class="math math-display">${cap.mathml}</div>` : cap.mathml;
    }
    const t = escHtml(String(tex).trim());
    return display ? `<pre class="math"><code>${t}</code></pre>` : `<code class="math">${t}</code>`;
  }

  function inlineHtml(src) {
    let s = escHtml(src);

    // Pull code spans out first so their contents are not re-parsed.
    const spans = [];
    s = s.replace(/(`+)([\s\S]*?)\1/g, (_, __, code) => {
      spans.push(code.replace(/^ | $/g, ''));
      return `\u0000${spans.length - 1}\u0000`;
    });

    // Then take escaped characters out too, so \* is never read as emphasis.
    const literals = [];
    s = s.replace(/\\([\\`*[\]_~])/g, (_, ch) => {
      literals.push(ch);
      return `\u0001${literals.length - 1}\u0001`;
    });

    // Inline maths: $…$. Only rewrite when the page gave us MathML for it, so a
    // bare dollar sign (prices, shell vars) is never mistaken for an equation.
    s = s.replace(/\$([^$\n]+)\$/g, (whole, tex) => {
      const key = CE._mathKey ? CE._mathKey(tex) : tex;
      return CE._mathCapture && CE._mathCapture.has(key) ? mathHtml(tex, false) : whole;
    });

    // The URL part allows one level of nested parens, so links like
    // en.wikipedia.org/wiki/Mercury_(planet) survive intact.
    const URL_PART = '((?:[^\\s()]|\\([^\\s()]*\\))+)(?:\\s+&quot;[^&]*&quot;)?';

    s = s.replace(new RegExp(`!\\[([^\\]]*)\\]\\(${URL_PART}\\)`, 'g'),
      (_, alt, url) => `<img alt="${alt}" src="${safeUrl(url)}">`);
    s = s.replace(new RegExp(`\\[([^\\]]+)\\]\\(${URL_PART}\\)`, 'g'),
      (_, text, url) => `<a href="${safeUrl(url)}" rel="noreferrer">${text}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\u0001(\d+)\u0001/g, (_, n) => literals[Number(n)]);
    s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${spans[Number(n)]}</code>`);

    return s;
  }

  const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

  function takeList(lines, i) {
    const firstLine = lines[i];
    const indent = firstLine.match(/^\s*/)[0].length;
    const ordered = /^\s*\d+[.)]/.test(firstLine);
    const items = [];

    while (i < lines.length) {
      const m = LIST_RE.exec(lines[i]);
      if (m && m[1].length === indent) {
        items.push([m[3]]);
        i++;
        continue;
      }
      if (/^\s*$/.test(lines[i])) {
        const next = lines[i + 1];
        if (next && LIST_RE.test(next) && next.match(/^\s*/)[0].length >= indent) {
          i++;
          continue;
        }
        break;
      }
      const ind = lines[i].match(/^\s*/)[0].length;
      if (ind > indent && items.length) {
        items[items.length - 1].push(lines[i].slice(indent + 2));
        i++;
        continue;
      }
      break;
    }

    const tag = ordered ? 'ol' : 'ul';
    const startNum = ordered ? Number((/^\s*(\d+)[.)]/.exec(firstLine) || [, '1'])[1]) : 1;
    const attr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
    const html =
      `<${tag}${attr}>` +
      items
        .map((it) => `<li>${it.length > 1 ? blocksToHtml(it.join('\n')) : inlineHtml(it[0])}</li>`)
        .join('') +
      `</${tag}>`;

    return [html, i];
  }

  function tableRow(line) {
    return line.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
  }

  function blocksToHtml(md) {
    const lines = md.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (/^\s*$/.test(line)) { i++; continue; }

      const fence = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(line);
      if (fence) {
        const close = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
        const buf = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) buf.push(lines[i++]);
        i++;
        const lang = fence[2] ? ` class="language-${escHtml(fence[2])}"` : '';
        out.push(`<pre><code${lang}>${escHtml(buf.join('\n'))}</code></pre>`);
        continue;
      }

      // Display maths: a $$ line, its body, a closing $$ line.
      if (/^\s*\$\$\s*$/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(mathHtml(buf.join('\n'), true));
        continue;
      }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const n = heading[1].length;
        out.push(`<h${n}>${inlineHtml(heading[2].trim())}</h${n}>`);
        i++;
        continue;
      }

      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${blocksToHtml(buf.join('\n'))}</blockquote>`);
        continue;
      }

      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
        const head = tableRow(line);
        i += 2;
        const body = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(tableRow(lines[i++]));
        out.push(
          '<table><thead><tr>' +
            head.map((c) => `<th>${inlineHtml(c)}</th>`).join('') +
            '</tr></thead><tbody>' +
            body.map((r) => '<tr>' + r.map((c) => `<td>${inlineHtml(c)}</td>`).join('') + '</tr>').join('') +
            '</tbody></table>'
        );
        continue;
      }

      if (LIST_RE.test(line)) {
        const [html, next] = takeList(lines, i);
        out.push(html);
        i = next;
        continue;
      }

      const para = [];
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^\s*(#{1,6}\s|>|`{3,}|~{3,}|\||\$\$\s*$)/.test(lines[i]) &&
        !LIST_RE.test(lines[i])
      ) {
        para.push(lines[i++]);
      }
      if (para.length) out.push(`<p>${inlineHtml(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }

    return out.join('\n');
  }

  CE.markdownToHtml = blocksToHtml;
  CE.escapeHtml = escHtml;
})();
