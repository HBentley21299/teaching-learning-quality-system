import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import * as model from '../apps/web/src/services/displayPreferences.ts';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), jsx = web('react/jsx-runtime');
async function load(path, imports) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  new Function('require','exports','module',code)(name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; },module.exports,module);
  return module.exports;
}
const storage = initial => { const entries = new Map(Object.entries(initial ?? {})); return { getItem:key => entries.get(key) ?? null, setItem:(key,value) => entries.set(key,value) }; };

test('display preferences accept only known independent choices and recover from invalid saved values', () => {
  assert.deepEqual(model.parseDisplayPreferences(null), model.defaultDisplayPreferences);
  assert.deepEqual(model.parseDisplayPreferences([]), model.defaultDisplayPreferences);
  const settings = model.parseDisplayPreferences({appearance:'dark',textSize:'larger',density:'compact',contrast:'<style>',admin:true});
  assert.equal(settings.appearance,'dark'); assert.equal(settings.textSize,'larger'); assert.equal(settings.density,'compact');
  assert.equal(settings.contrast,'standard'); assert.equal(settings.admin,undefined);
  assert.deepEqual(model.readDisplayPreferences(storage({[model.displayPreferencesKey]:'malformed'})),model.defaultDisplayPreferences);
});

test('existing appearance/navigation choices migrate once while device appearance stays live', () => {
  const saved = storage({'ielevate-theme':'dark','ielevate-navigation-collapsed':'true'});
  const migrated = model.readDisplayPreferences(saved);
  assert.equal(migrated.appearance,'dark'); assert.equal(migrated.navigation,'compact');
  assert.equal(model.saveDisplayPreferences({...migrated,appearance:'system'},saved),true);
  saved.setItem('ielevate-theme','light');
  const current = model.readDisplayPreferences(saved);
  assert.equal(current.appearance,'system'); assert.equal(current.navigation,'compact');
  assert.equal(model.resolvedAppearance(current,true),'dark'); assert.equal(model.resolvedAppearance(current,false),'light');
});

test('storage failures retain a usable default and application attributes are bounded', () => {
  const denied = {getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.deepEqual(model.readDisplayPreferences(denied),model.defaultDisplayPreferences);
  assert.equal(model.saveDisplayPreferences({...model.defaultDisplayPreferences},denied),false);
  const root = {dataset:{}};
  model.applyDisplayPreferences({...model.defaultDisplayPreferences,textSize:'large',motion:'reduced',links:'underlined'},true,root);
  assert.deepEqual(root.dataset,{theme:'dark',appearance:'system',textSize:'large',contrast:'standard',density:'comfortable',motion:'reduced',links:'underlined',reading:'standard'});
});

test('settings controls have meaningful labels, native choice semantics and isolated reversible handlers', async () => {
  const changes = []; let reset = 0, closed = 0;
  const {DisplaySettingsDialog} = await load('components/DisplaySettingsDialog.tsx', {
    react:{useId:()=>'display-test'},'react/jsx-runtime':jsx,'lucide-react':new Proxy({},{get:()=>()=>null}),'./ModalDialog':{ModalDialog:()=>null}
  });
  const tree = DisplaySettingsDialog({preferences:{...model.defaultDisplayPreferences},saved:false,onChange:patch=>changes.push(patch),onReset:()=>reset++,onClose:()=>closed++});
  const nodes=[];
  function visit(node){if(Array.isArray(node))return node.forEach(visit);if(!node||typeof node!=='object')return;nodes.push(node);if(typeof node.type==='function' && node.type.name==='PreferenceSwitch') visit(node.type(node.props));visit(node.props?.children);}
  visit(tree);
  const fields=nodes.filter(node=>node.type==='input' && node.props.role==='switch');
  assert.equal(fields.length,5);
  for(const field of fields){assert.ok(nodes.some(node=>node.props?.htmlFor===field.props.id));assert.ok(nodes.some(node=>node.props?.id===field.props['aria-describedby']));}
  fields.find(node=>node.props.id.endsWith('-contrast')).props.onChange({target:{checked:true}});
  assert.deepEqual(changes.at(-1),{contrast:'high'});
  const sizes=nodes.find(node=>node.type==='select'&&node.props.value==='standard');
  sizes.props.onChange({target:{value:'larger'}}); assert.deepEqual(changes.at(-1),{textSize:'larger'});
  nodes.find(node=>node.type==='input'&&node.props.name==='display-test-appearance'&&node.props.value==='system').props.onChange();
  assert.deepEqual(changes.at(-1),{appearance:'system'});
  nodes.find(node=>node.type==='button'&&node.props.children==='Done').props.onClick();assert.equal(closed,1);
  nodes.find(node=>node.type==='button'&&Array.isArray(node.props.children)&&node.props.children.includes('Reset display settings')).props.onClick();assert.equal(reset,1);
  assert.ok(nodes.some(node=>node.props?.role==='alert'));
  assert.ok(nodes.some(node=>node.type==='h2'&&node.props['data-dialog-heading']&&node.props.tabIndex===-1));
});

async function mountProvider({blocked=false, initial={}}={}) {
  let cursor=0,pending=true,tree,dark=false;
  const slots=[],effects=[],events=new Map(),mediaEvents=new Set();
  const local=blocked?{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}:storage(initial);
  globalThis.document={documentElement:{dataset:{}}};
  const media={get matches(){return dark;},addEventListener:(name,fn)=>mediaEvents.add(fn),removeEventListener:(name,fn)=>mediaEvents.delete(fn)};
  globalThis.window={localStorage:local,matchMedia:()=>media,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
  const hooks={
    createContext:()=>({Provider:()=>null}),useContext:()=>null,
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;pending=true;}}];},
    useMemo(factory,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))slots[i]={deps,value:factory()};return slots[i].value;},
    useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}}
  };
  const Dialog=()=>null;
  const {DisplayPreferencesProvider}=await load('features/DisplayPreferencesProvider.tsx',{react:hooks,'react/jsx-runtime':jsx,'../services/displayPreferences':model,'../components/DisplaySettingsDialog':{DisplaySettingsDialog:Dialog}});
  function settle(){for(let n=0;n<30;n++){if(pending){pending=false;cursor=0;tree=DisplayPreferencesProvider({children:'Page with unsaved work'});}while(effects.length)effects.shift()();if(!pending)return;}throw Error('preferences did not settle');}
  settle();
  return {get value(){return tree.props.value;},get dialog(){return tree.props.children.find?.(node=>node?.type===Dialog);},settle,
    systemDark(value){dark=value;for(const fn of mediaEvents)fn();settle();},
    external(value){events.get('storage')({key:model.displayPreferencesKey,newValue:value});settle();},
    dispose(){for(const slot of slots)slot?.cleanup?.();}
  };
}

test('provider follows device changes, preserves explicit appearance and syncs only valid cross-tab preferences', async () => {
  const page=await mountProvider();
  page.systemDark(true);assert.equal(page.value.appearance,'dark');assert.equal(document.documentElement.dataset.theme,'dark');
  page.value.updatePreferences({appearance:'light',textSize:'larger'});page.settle();page.systemDark(false);page.systemDark(true);
  assert.equal(page.value.appearance,'light');assert.equal(document.documentElement.dataset.textSize,'larger');
  page.external('broken');assert.equal(page.value.preferences.textSize,'larger');
  page.external(JSON.stringify({appearance:'dark',contrast:'high',navigation:'expanded',unknown:'bad'}));
  assert.equal(page.value.appearance,'dark');assert.equal(document.documentElement.dataset.contrast,'high');
  assert.equal(page.value.preferences.unknown,undefined);page.dispose();
});

test('blocked storage does not prevent settings changes, resetting or keeping the page mounted', async () => {
  const page=await mountProvider({blocked:true});
  page.value.openDisplaySettings();page.settle();assert.equal(page.dialog.props.saved,false);
  page.value.updatePreferences({contrast:'high',motion:'reduced'});page.settle();
  assert.equal(document.documentElement.dataset.contrast,'high');assert.equal(document.documentElement.dataset.motion,'reduced');
  page.dialog.props.onReset();page.settle();assert.deepEqual(page.value.preferences,model.defaultDisplayPreferences);
  page.dialog.props.onClose();page.settle();assert.equal(page.dialog,undefined);page.dispose();
});
