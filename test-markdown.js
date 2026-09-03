const fs=require('fs'), path=require('path'), {JSDOM}=require('jsdom');
const DIR=__dirname;
const FIX=`
<div data-message-author-role="user" data-message-id="u1"><div class="whitespace-pre-wrap">Recommendation for esoteric books.</div></div>
<div data-message-author-role="assistant" data-message-id="a1" data-message-model-slug="gpt-5-5">
  <div class="markdown">
    <p>I'll group them by tradition.</p>
    <h2>General introductions</h2>
    <p>The Secret Teachings of All Ages</p>
    <ul><li>The classic survey.</li></ul>
    <h2>Hermeticism</h2>
    <p>Corpus Hermeticum</p>
    <h3>Sub point</h3>
    <pre><code class="language-md"># not a heading, it is code
## also code</code></pre>
  </div>
</div>`;
const dom=new JSDOM(`<!doctype html><html><head><title>Philosophy - Esoteric Book Recommendations</title></head><body>${FIX}</body></html>`,{url:'https://chatgpt.com/c/6a68'});
Object.assign(global,{window:dom.window,document:dom.window.document,Node:dom.window.Node,location:dom.window.location,getComputedStyle:dom.window.getComputedStyle});
for(const f of ['markdown.js','doc.js','extract.js','content.js']) {
  try { new Function('browser', fs.readFileSync(path.join(DIR,f),'utf8')).call(global, {runtime:{onMessage:{addListener(){}}}}); } catch(e){ console.log('load',f,e.message); }
}
const data=global.CE.extract();
const md=global.CE.__toMarkdown(data);
console.log(md);
console.log('=== checks ===');
const t=[
 ['speaker heading is level 2', /^## You$/m.test(md)],
 ['content headings demoted to h3+', /^### General introductions$/m.test(md) && /^#### Sub point$/m.test(md)],
 ['no content heading collides at h2', (()=>{let f=false;return md.split('\n').filter(l=>{if(/^```/.test(l)){f=!f;return false;}return !f&&/^## /.test(l);}).every(l=>/^## (You|ChatGPT)$/.test(l));})()],
 ['code fence headings untouched', md.includes('# not a heading, it is code') && md.includes('## also code')],
 ['rule before each speaker', (md.match(/\n---\n/g)||[]).length >= 2],
 ['sequence indicator present', md.includes('`1 of 2`') && md.includes('`2 of 2`')],
 ['model on assistant only', md.includes('`gpt-5-5`') && !/## You\n\n`1 of 2` \u2014/.test(md)],
];
let ok=true;for(const[n,p]of t){ok&&=p;console.log((p?'PASS  ':'FAIL  ')+n);}process.exit(ok?0:1);
