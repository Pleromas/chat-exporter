const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const NASTY = `
<div data-turn-key="t1">
  <h4 class="sr-only">ChatGPT said:</h4>
  <div class="MarkdownRoot-rZKhxa" data-chatgpt-selection-message-id="x">
    <p>&lt;script&gt;alert('xss')&lt;/script&gt;</p>
    <p><a href="javascript:alert(1)">click me</a></p>
    <p>[fake](javascript:alert(2))</p>
    <p>&lt;img src=x onerror=alert(3)&gt;</p>
    <pre><code class="language-md">nested fence:
\`\`\`
inner
\`\`\`
done</code></pre>
    <p>Quote " and amp &amp; and lt &lt;</p>
  </div>
</div>
`;

const dom = new JSDOM(`<!doctype html><html><head><title>t</title></head><body>${NASTY}</body></html>`, {
  url: 'https://chatgpt.com/c/x'
});
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.location = dom.window.location;
global.getComputedStyle = dom.window.getComputedStyle;

const load = (p) => new Function(fs.readFileSync(path.join(__dirname, p), 'utf8')).call(global);
load('markdown.js');
load('doc.js');
load('extract.js');

const data = global.CE.extract();
console.log('=== MARKDOWN ===');
console.log(data.messages[0].markdown);

const html = global.CE.buildDocument(data);
console.log('\n=== HTML BODY ===');
console.log(html.split('<body>')[1]);

console.log('\n=== CHECKS ===');

// Parse the generated document and inspect real nodes, not raw text.
const out = new JSDOM(html).window.document;
const all = Array.from(out.querySelectorAll('*'));
const hasEventAttr = all.some((el) =>
  Array.from(el.attributes).some((a) => /^on/i.test(a.name)));
const badHref = all.some((el) =>
  /^(javascript|data|vbscript):/i.test((el.getAttribute('href') || el.getAttribute('src') || '')));

const wiki = global.CE.markdownToHtml('See [Mercury](https://en.wikipedia.org/wiki/Mercury_(planet)) now.');
console.log('parenthesised URL ->', wiki);

const checks = [
  ['no script elements', out.querySelectorAll('script').length === 0],
  ['no inline event handlers', !hasEventAttr],
  ['no javascript:/data: urls', !badHref],
  ['nested fence escaped', /````/.test(data.messages[0].markdown)],
  ['parenthesised url kept whole', wiki.includes('href="https://en.wikipedia.org/wiki/Mercury_(planet)"')]
];
for (const [name, pass] of checks) console.log((pass ? 'PASS  ' : 'FAIL  ') + name);
process.exit(checks.every(([, p]) => p) ? 0 : 1);
