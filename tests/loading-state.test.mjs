import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const web=createRequire(new URL('../apps/web/package.json',import.meta.url)), ts=web('typescript'), react=web('react');
const {renderToStaticMarkup}=web('react-dom/server');
const source=await readFile(new URL('../apps/web/src/components/LoadingState.tsx',import.meta.url),'utf8');
const module={exports:{}};
new Function('require','exports','module',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText)(web,module.exports,module);
const {LoadingState}=module.exports;

for(const size of ['page','section','inline'])test(`${size} loading exposes one contextual status and keeps all animated decoration out of the accessible name`,()=>{
  const html=renderToStaticMarkup(react.createElement(LoadingState,{size,label:'Loading staff records…',detail:'Retrieving this academic year.'}));
  assert.equal((html.match(/role="status"/g)||[]).length,1);
  assert.match(html,/aria-live="polite" aria-atomic="true"/);
  assert.match(html,/<strong>Loading staff records…<\/strong>/);
  assert.match(html,/<p>Retrieving this academic year\.<\/p>/);
  assert.match(html,/class="loading-state-dots" aria-hidden="true"/);
  assert.equal(html.includes('class="loading-state-art"'),size!=='inline');
  if(size!=='inline')assert.match(html,/class="loading-state-art" aria-hidden="true"/);
  assert.doesNotMatch(html,/<button|tabindex|progressbar|aria-valuenow/);
});

test('the animation has a static first frame under either motion preference and uses a real local transparent sprite',async()=>{
  const css=await readFile(new URL('../apps/web/src/app/loading-state.css',import.meta.url),'utf8'),postcss=web('postcss'),sheet=postcss.parse(css);
  let manual=false,device=false;
  sheet.walkRules(rule=>{
    if(!rule.selector.includes('loading-state-art'))return;
    rule.walkDecls('animation',decl=>{
      if(decl.value!=='none'||!decl.important)return;
      if(rule.selector.includes('[data-motion="reduced"]'))manual=true;
      if(rule.parent.type==='atrule'&&rule.parent.params==='(prefers-reduced-motion: reduce)')device=true;
    });
  });
  assert.ok(manual&&device,'both preferences must stop the typing sequence');
  const png=await readFile(new URL('../apps/web/public/system-assets/eli/eli-loading-typing.png',import.meta.url));
  assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png[25],6,'RGBA asset retains actual transparency');
  assert.equal(png.readUInt32BE(16)%4,0,'four frames divide evenly without half pixels');
  assert.ok(png.length<1024*1024,'the shared sprite stays under one megabyte');
  assert.doesNotMatch(source,/setTimeout|setInterval|Math\.random|fetch\(/,'the loading graphic cannot delay or create a request');
});
