import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), jsx = web('react/jsx-runtime');
const source = await readFile(new URL('../apps/web/src/components/UnsavedChangesGuard.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i=0;i<4;i++) await new Promise(resolve => setImmediate(resolve)); };

function setup() {
  const priorWindow = globalThis.window, events = new Map();
  globalThis.window = { addEventListener(name, listener) { if (!events.has(name)) events.set(name,new Set()); events.get(name).add(listener); }, removeEventListener(name, listener) { events.get(name)?.delete(listener); } };
  let host;
  const hooks = {
    useRef(value) { const slot=host.cursor++; return host.slots[slot] ??= {current:value}; },
    useEffect(effect,deps) {
      const slot=host.cursor++, old=host.slots[slot];
      if (!old || !deps || deps.some((value,index)=>!Object.is(value,old.deps?.[index]))) {
        host.slots[slot]={deps}; const target=host;
        host.effects.push(()=>{old?.cleanup?.();target.slots[slot].cleanup=effect();});
      }
    },
    useSyncExternalStore(_subscribe,snapshot) { return snapshot(); }
  };
  const Button=()=>null, ModalDialog=()=>null, loaded={exports:{}};
  new Function('require','exports','module',code)(name=>{
    if(name==='react')return hooks;
    if(name==='react/jsx-runtime')return jsx;
    if(name==='../design-system/Button')return {Button};
    if(name==='./ModalDialog')return {ModalDialog};
    assert.fail(`Unexpected guard import ${name}`);
  },loaded.exports,loaded);
  const api=loaded.exports, mounted=[];
  function editor(initial) {
    const instance={slots:[],effects:[],cursor:0,props:initial}; mounted.push(instance);
    const render=()=>{host=instance;host.cursor=0;instance.clear=api.useUnsavedChanges(instance.props);while(instance.effects.length)instance.effects.shift()();host=null;};
    render();
    return {clear:()=>instance.clear(),update(next){instance.props={...instance.props,...next};render();},unmount(){for(const slot of instance.slots)slot?.cleanup?.();instance.slots=[];}};
  }
  function view() {
    const tree=api.UnsavedChangesGuard(),nodes=[];
    function visit(node){if(Array.isArray(node))return node.forEach(visit);if(!node||typeof node!=='object')return;nodes.push(node);visit(node.props?.children);}
    visit(tree);
    return {tree,text:text(tree),button:label=>nodes.find(node=>node.type===Button&&text(node)===label)};
  }
  function click(label){const button=view().button(label);assert.ok(button,`Missing ${label}`);assert.ok(!button.props.disabled,`${label} is disabled`);button.props.onClick();}
  function unload(){const event={prevented:false,returnValue:undefined,preventDefault(){this.prevented=true;}};for(const listener of events.get('beforeunload')??[])listener(event);return event;}
  return {api,editor,view,click,unload,events,dispose(){for(const instance of mounted)for(const slot of instance.slots)slot?.cleanup?.();globalThis.window=priorWindow;}};
}

test('staff exit offers explicit draft/submission choices, keeps editing safely and pauses background decisions',async()=>{
  const h=setup();try{
    let writes=0;
    h.editor({label:'Learning Walk',dirty:true,submission:true,onSave:async()=>{writes++;return true;},onSubmit:async()=>{writes++;return true;}});
    const leave=h.api.confirmUnsavedNavigation();
    assert.equal(h.api.useNavigationDecisionPending(),true);
    assert.equal(h.view().tree.props.label,'Leave this submission?');
    for(const label of ['Keep editing','Cancel submission','Save as draft','Submit formally'])assert.ok(h.view().button(label));
    assert.match(h.view().text,/without creating a new draft/);
    h.click('Keep editing');assert.equal(await leave,false);assert.equal(writes,0);assert.equal(h.api.hasUnsavedChanges(),true);assert.equal(h.api.useNavigationDecisionPending(),false);
  }finally{h.dispose();}
});

test('cancel submission discards locally without calling draft or submit and clears the unload warning',async()=>{
  const h=setup();try{
    let drafts=0,submits=0,discarded=0;
    const entry=h.editor({label:'CPD',dirty:true,submission:true,onSave:async()=>{drafts++;return true;},onSubmit:async()=>{submits++;return true;},onDiscard:()=>{discarded++;}});
    assert.equal(h.unload().prevented,true);
    const leave=h.api.confirmUnsavedNavigation();h.click('Cancel submission');assert.equal(await leave,true);
    assert.deepEqual({drafts,submits,discarded},{drafts:0,submits:0,discarded:1});assert.equal(h.api.hasUnsavedChanges(),false);assert.equal(h.unload().prevented,false);
    entry.update({dirty:false});assert.equal(h.unload().prevented,false);assert.equal(h.events.get('beforeunload')?.size,0);
  }finally{h.dispose();}
});

test('Save as draft invokes only the real registered draft callback and leaves after success',async()=>{
  const h=setup();try{
    let drafts=0,submits=0;
    h.editor({label:'Environment',dirty:true,submission:true,onSave:async()=>{drafts++;return true;},onSubmit:async()=>{submits++;return true;}});
    const leave=h.api.confirmUnsavedNavigation();h.click('Save as draft');assert.equal(await leave,true);
    assert.equal(drafts,1);assert.equal(submits,0);assert.equal(h.api.hasUnsavedChanges(),false);assert.equal(h.unload().prevented,false);
  }finally{h.dispose();}
});

test('formal validation failure retains the decision and inputs; a successful retry submits without saving a draft',async()=>{
  const h=setup();try{
    let valid=false,submits=0,drafts=0;
    h.editor({label:'Observation',dirty:true,submission:true,onSave:async()=>{drafts++;return true;},onSubmit:async()=>{submits++;return valid;},submitLabel:'Complete stage'});
    const leave=h.api.confirmUnsavedNavigation();let settled=false;leave.then(()=>settled=true);
    h.click('Complete stage');await tick();assert.equal(settled,false);assert.equal(h.api.hasUnsavedChanges(),true);assert.match(h.view().text,/Check Observation before leaving/);
    valid=true;h.click('Complete stage');assert.equal(await leave,true);assert.equal(submits,2);assert.equal(drafts,0);
  }finally{h.dispose();}
});

test('duplicate stale submit/cancel gestures cannot interrupt or duplicate an in-flight operation',async()=>{
  const h=setup();try{
    const request=deferred();let submits=0,discarded=0;
    h.editor({label:'Review',dirty:true,submission:true,onSave:async()=>true,onSubmit:()=>{submits++;return request.promise;},onDiscard:()=>discarded++});
    const leave=h.api.confirmUnsavedNavigation(), stale=h.view();
    stale.button('Submit formally').props.onClick();stale.button('Submit formally').props.onClick();stale.button('Cancel submission').props.onClick();stale.button('Keep editing').props.onClick();stale.tree.props.onClose();
    assert.equal(submits,1);assert.equal(discarded,0);assert.equal(h.view().tree.props.busy,true);assert.equal(await h.api.confirmUnsavedNavigation(),false);assert.equal(h.unload().prevented,true);
    request.resolve(true);assert.equal(await leave,true);
  }finally{h.dispose();}
});

test('failed draft or submit promises keep work and allow a safe retry or cancellation',async()=>{
  for(const operation of ['Save as draft','Submit formally']){
    const h=setup();try{
      h.editor({label:'Partial record',dirty:true,submission:true,onSave:async()=>{throw Error('offline');},onSubmit:async()=>{throw Error('offline');}});
      const leave=h.api.confirmUnsavedNavigation();h.click(operation);await tick();
      assert.equal(h.api.hasUnsavedChanges(),true);assert.equal(h.view().tree.props.busy,false);assert.match(h.view().text,/could not be/);
      h.click('Keep editing');assert.equal(await leave,false);
    }finally{h.dispose();}
  }
});

test('a save callback clearing its form cannot let a second navigation overtake the original destination',async()=>{
  const h=setup();try{
    const request=deferred();let entry;
    entry=h.editor({label:'Review',dirty:true,submission:true,onSave:async()=>{entry.clear();return request.promise;}});
    const leave=h.api.confirmUnsavedNavigation();h.click('Save as draft');
    assert.equal(h.api.hasUnsavedChanges(),false);assert.equal(await h.api.confirmUnsavedNavigation(),false);
    request.resolve(true);assert.equal(await leave,true);assert.equal(h.api.useNavigationDecisionPending(),false);
  }finally{h.dispose();}
});

test('unrelated save-only edits cannot be silently included in a formal submission',async()=>{
  const h=setup();try{
    let submits=0;
    h.editor({label:'Review',dirty:true,submission:true,onSave:async()=>true,onSubmit:async()=>{submits++;return true;}});
    h.editor({label:'Profile correction',dirty:true,onSave:async()=>true});
    const leave=h.api.confirmUnsavedNavigation();assert.equal(h.view().button('Submit formally').props.disabled,true);
    h.view().button('Submit formally').props.onClick();await tick();assert.equal(submits,0);assert.match(h.view().text,/Formal submission is not available for every change/);
    h.click('Keep editing');assert.equal(await leave,false);
  }finally{h.dispose();}
});

test('unsupported drafts and previously saved QA evidence are described honestly',async()=>{
  const h=setup();try{
    h.editor({label:'QA evidence',dirty:true,submission:true,onSubmit:async()=>true,submitLabel:'Submit evidence',discardLabel:'Discard unsaved changes',discardMessage:'Previously autosaved evidence remains as a draft; only unsaved changes are discarded.'});
    const leave=h.api.confirmUnsavedNavigation();assert.equal(h.view().button('Save as draft').props.disabled,true);assert.ok(h.view().button('Submit evidence'));assert.match(h.view().text,/Previously autosaved evidence remains/);assert.doesNotMatch(h.view().text,/without creating a new draft/);
    h.click('Discard unsaved changes');assert.equal(await leave,true);
  }finally{h.dispose();}
});

test('administration keeps its ordinary save wording, and clean editors never block navigation or unload',async()=>{
  const h=setup();try{
    const entry=h.editor({label:'Admin settings',dirty:false,onSave:async()=>true});
    assert.equal(await h.api.confirmUnsavedNavigation(),true);assert.equal(h.unload().prevented,false);
    entry.update({dirty:true});const leave=h.api.confirmUnsavedNavigation();
    assert.equal(h.view().tree.props.label,'Keep your changes?');assert.ok(h.view().button('Save and leave'));assert.equal(h.view().button('Submit formally'),undefined);
    h.click('Discard and leave');assert.equal(await leave,true);entry.unmount();assert.equal(h.api.hasUnsavedChanges(),false);
  }finally{h.dispose();}
});

test('an editor that unmounts outside the pending operation releases its navigation decision safely',async()=>{
  const h=setup();try{
    const entry=h.editor({label:'Review',dirty:true,submission:true});const leave=h.api.confirmUnsavedNavigation();entry.unmount();
    assert.equal(await leave,false);assert.equal(h.api.useNavigationDecisionPending(),false);assert.equal(h.unload().prevented,false);
  }finally{h.dispose();}
});
