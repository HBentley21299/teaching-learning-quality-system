import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript');
const defaults = JSON.parse(await readFile(new URL('../shared/workflow-form-content.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../apps/web/src/services/formContent.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function harness(api) {
  let active;
  const hooks = {
    useState(initial) { const slot = active.cursor++; const owner = active; if (!(slot in owner.slots)) owner.slots[slot] = initial; return [owner.slots[slot], next => { owner.slots[slot] = next; }]; },
    useEffect(effect, deps) { const slot = active.cursor++; const owner = active; const old = owner.effects[slot]; if (!old || deps.some((item,index) => item !== old.deps[index])) { old?.cleanup?.(); owner.effects[slot] = { deps, cleanup: effect() }; } }
  };
  const module = { exports: {} };
  new Function('require','module','exports',code)(name => {
    if (name === 'react') return hooks;
    if (name.endsWith('workflow-form-content.json')) return defaults;
    if (name === './api') return { api };
    throw new Error(`Unexpected import ${name}`);
  },module,module.exports);
  function mount(key) {
    const owner = { slots: [], effects: [], cursor: 0, key };
    return { render(next=owner.key) { owner.key=next; owner.cursor=0; active=owner; return module.exports.useFormContent(next); }, close() { for (const effect of owner.effects) effect?.cleanup?.(); } };
  }
  return { mount, invalidate: module.exports.invalidateFormContent };
}
const flush = async () => { for(let i=0;i<3;i++) await new Promise(resolve=>setImmediate(resolve)); };

test('configured prompt reads are shared and keep shipped wording usable while loading', async () => {
  const request = deferred(), calls=[];
  const app=harness({ formContent(key) { calls.push(key); return request.promise; } });
  const first=app.mount('liv'), second=app.mount('liv');
  assert.equal(first.render().field('contextText','Fallback').label,'Context');
  second.render(); assert.deepEqual(calls,['liv']);
  request.resolve({ formKey:'liv',title:'LIV',fields:[{key:'contextText',label:'What is the context?',helpText:'Be specific.'}] }); await flush();
  assert.deepEqual(first.render().field('contextText','Fallback'),{label:'What is the context?',helpText:'Be specific.'});
  assert.equal(second.render().field('contextText','Fallback').label,'What is the context?');
  first.close();second.close();
});
test('changing workflow cannot display the previous workflow response even when it arrives late', async () => {
  const liv=deferred(), coaching=deferred();
  const app=harness({formContent(key) { return key==='liv'?liv.promise:coaching.promise; }}), page=app.mount('liv');
  page.render(); page.render('coaching');
  liv.resolve({formKey:'liv',title:'LIV',fields:[{key:'contextText',label:'Late response'}]}); await flush();
  assert.notEqual(page.render().field('contextText','Safe fallback').label,'Late response');
  coaching.resolve({formKey:'coaching',title:'Coaching',fields:[{key:'specificSessionFocus',label:'Session purpose'}]}); await flush();
  assert.equal(page.render().field('specificSessionFocus','Fallback').label,'Session purpose'); page.close();
});
test('failed configuration reads leave real fields usable and the next mount can retry', async () => {
  let count=0; const app=harness({formContent() { count++; return count===1?Promise.reject(new Error('Offline')):Promise.resolve({formKey:'actions',title:'Actions',fields:[{key:'title',label:'Agreed action'}]}); }});
  const first=app.mount('actions'); first.render(); await flush();
  assert.equal(first.render().field('title','Action').label, defaults.find(form=>form.formKey==='actions').fields.find(field=>field.key==='title').label); first.close();
  const retry=app.mount('actions'); retry.render(); await flush();
  assert.equal(retry.render().field('title','Action').label,'Agreed action'); assert.equal(count,2); retry.close();
});
test('saving invalidates only the changed form so a reopened form reads the new prompts', async () => {
  let count=0; const app=harness({formContent() { count++; return Promise.resolve({formKey:'liv',title:'LIV',fields:[{key:'contextText',label:`Revision ${count}`}]}); }});
  const first=app.mount('liv'); first.render(); await flush(); assert.equal(first.render().field('contextText','Fallback').label,'Revision 1'); first.close();
  app.invalidate('liv'); const next=app.mount('liv'); next.render(); await flush(); assert.equal(next.render().field('contextText','Fallback').label,'Revision 2'); next.close();
});
