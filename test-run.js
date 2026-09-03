const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FIXTURE = `
<div id="thread">
  <article data-testid="conversation-turn-1">
    <div data-message-author-role="user" data-message-id="u1">
      <div class="whitespace-pre-wrap">How do I read a file in Python?
Second line here.</div>
    </div>
  </article>

  <article data-testid="conversation-turn-2">
    <div data-message-author-role="assistant" data-message-id="a1" data-message-model-slug="gpt-5">
      <div class="markdown prose">
        <p>Use <code>open()</code> with a <strong>context manager</strong>. It's the <em>safe</em> way.</p>
        <h3>Example</h3>
        <pre class="overflow-x-auto">
          <div class="contain-inline-size">
            <div class="flex items-center">python</div>
            <div class="sticky top-9"><button>Copy</button></div>
            <div class="overflow-y-auto p-4"><code class="!whitespace-pre language-python">with open("data.txt") as f:
    text = f.read()
print(text)</code></div>
          </div>
        </pre>
        <ol start="2">
          <li>Open the file
            <ul>
              <li>Use a <code>with</code> block</li>
              <li>Pick an encoding_name</li>
            </ul>
          </li>
          <li>Read it</li>
        </ol>
        <blockquote><p>Never forget to close it. Or better: don't open it manually.</p></blockquote>
        <table>
          <thead><tr><th>Mode</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td>r</td><td>read | text</td></tr>
            <tr><td>rb</td><td>read <strong>bytes</strong></td></tr>
          </tbody>
        </table>
        <p>See <a href="https://docs.python.org/3/">the docs</a> and this <img src="https://example.com/a.png" alt="chart">.</p>
        <p>Inline math: <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">a^2+b^2=c^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">junk</span></span> done.</p>
        <span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">\\int_0^1 x\\,dx</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">junk</span></span></span>
        <hr>
        <p>A star * and a [bracket] and 5 * 3 should survive.</p>
      </div>
    </div>
  </article>
</div>
`;

const dom = new JSDOM(`<!doctype html><html><head><title>Reading files - ChatGPT</title></head><body>${FIXTURE}</body></html>`, {
  url: 'https://chatgpt.com/c/abc-123'
});

global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.location = dom.window.location;
global.getComputedStyle = dom.window.getComputedStyle;
global.setTimeout = setTimeout;

const load = (p) => {
  const code = fs.readFileSync(path.join(__dirname, p), 'utf8');
  new Function(code).call(global);
};

load('markdown.js');
load('doc.js');
load('extract.js');

const data = global.CE.extract();

console.log('=== TITLE ===');
console.log(data.title);
console.log('\n=== MESSAGES:', data.messages.length, '===');
for (const m of data.messages) {
  console.log(`\n--- ${m.role} (${m.model || 'n/a'}) ---`);
  console.log(m.markdown);
}

console.log('\n\n=== MARKDOWN -> HTML ===');
console.log(global.CE.markdownToHtml(data.messages[data.messages.length-1].markdown));

fs.writeFileSync('out.html', global.CE.buildDocument(data));
console.log('\n[wrote out.html]');
