/* Rich content: maths (TeX in markdown, MathML in HTML/PDF), mermaid/SVG, and
   favicon images. Guards the fixes for the capability stress test. */
const fs = require('fs'), path = require('path'), { JSDOM } = require('jsdom');
const DIR = __dirname;

// Assistant turn with: a display equation (KaTeX: annotation + MathML), an inline
// equation, a mermaid diagram (inline <svg> with an embedded <style> and text that
// would otherwise mash together), a citation favicon, and a real image.
const FIX = `
<div data-turn-key="t1"><h4 class="sr-only">You said:</h4>
  <div data-user-message-bubble="true"><div class="whitespace-pre-wrap">Show me maths and a diagram.</div></div>
</div>
<div data-turn-key="t2"><h4 class="sr-only">ChatGPT said:</h4>
  <div class="MarkdownRoot-xy">
    <p>The Gaussian integral:</p>
    <span class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><msqrt><mi>&#960;</mi></msqrt></mrow><annotation encoding="application/x-tex">\\int e^{-x^2}\\,dx=\\sqrt{\\pi}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base">junk</span></span></span></span>
    <p>and inline <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>O</mi><mo stretchy="false">(</mo><mi>n</mi><mo stretchy="false">)</mo></mrow><annotation encoding="application/x-tex">O(n)</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">junk</span></span> complexity.</p>
    <p>A diagram:</p>
    <div class="group/mermaid-preview">
      <svg id="chatgpt-mermaid-_r_ab_" role="img"><style>#chatgpt-mermaid-_r_ab_{fill:red;} .node{stroke:blue;}</style><g><text>Application</text><text>Operating system</text></g></svg>
    </div>
    <p>Source: <img class="favicon" src="https://www.google.com/s2/favicons?domain=https://nasa.gov&amp;sz=32" alt="image"></p>
    <p><img src="https://images.openai.com/real-photo.png" alt="A real photo"></p>
  </div>
</div>`;

const dom = new JSDOM(`<!doctype html><html><head><title>Capability stress test</title></head><body>${FIX}</body></html>`, { url: 'https://chatgpt.com/c/abc' });
Object.assign(global, { window: dom.window, document: dom.window.document, Node: dom.window.Node, location: dom.window.location, getComputedStyle: dom.window.getComputedStyle });
for (const f of ['markdown.js', 'doc.js', 'extract.js', 'content.js']) {
  try { new Function('browser', fs.readFileSync(path.join(DIR, f), 'utf8')).call(global, { runtime: { onMessage: { addListener() {} } } }); }
  catch (e) { console.log('load', f, e.message); }
}

const CE = global.CE;
const data = CE.extract();
const assistant = data.messages.find((m) => m.role === 'assistant');
const md = assistant ? assistant.markdown : '';
const html = CE.buildDocument(data, 'light');

console.log(md);
console.log('=== checks ===');
const t = [
  // Markdown keeps TeX so maths-aware viewers render it.
  ['display TeX in markdown', /\$\$\n\\int e\^\{-x\^2\}\\,dx=\\sqrt\{\\pi\}\n\$\$/.test(md)],
  ['inline TeX in markdown', /\$O\(n\)\$/.test(md)],
  // The mermaid SVG must not leak its CSS or mashed text.
  ['mermaid becomes a placeholder', md.includes('[Mermaid diagram]')],
  ['no embedded CSS leaked', !/fill:red|stroke:blue|chatgpt-mermaid/.test(md)],
  ['no mashed SVG labels', !/ApplicationOperating system/.test(md)],
  // Favicon dropped, real image kept.
  ['favicon image dropped', !/s2\/favicons/.test(md)],
  ['real image kept', md.includes('![A real photo](https://images.openai.com/real-photo.png)')],
  // HTML/PDF renders MathML captured from the page (no library, no network).
  ['HTML emits MathML', /<math[^>]*>[\s\S]*<msqrt>[\s\S]*<\/math>/.test(html)],
  ['display MathML wrapped', html.includes('class="math math-display"')],
  ['inline MathML emitted', /<math[^>]*>[\s\S]*<mi>O<\/mi>/.test(html)],
  ['MathML annotation stripped', !/annotation/.test(html)],
  ['HTML has no raw TeX source', !html.includes('\\sqrt')],
];
let ok = true;
for (const [n, p] of t) { ok &&= p; console.log((p ? 'PASS  ' : 'FAIL  ') + n); }
process.exit(ok ? 0 : 1);
