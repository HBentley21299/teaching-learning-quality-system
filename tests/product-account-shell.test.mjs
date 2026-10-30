import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), jsx = web('react/jsx-runtime');
const icons = new Proxy({}, {get:()=>()=>null});
const text = node => Array.isArray(node) ? node.map(text).join('') : node?.type === LoadingState ? text(LoadingState(node.props)) : node?.props ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function load(path, imports={}) {
  const source=await readFile(new URL(`../apps/web/src/${path}`,import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','exports','module',code)(name=>{assert.ok(name in imports,`Unexpected import ${name}`);return imports[name];},module.exports,module);
  return module.exports;
}
const { LoadingState } = await load('components/LoadingState.tsx', {'react/jsx-runtime':jsx});
async function mount(path,name,props,imports={}) {
  let cursor=0,pending=true,tree;
  const slots=[],effects=[];
  const hooks={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;pending=true;}}];},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useMemo(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))slots[i]={deps,value:fn()};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}},
    lazy(loader){const component=()=>null;component.route=loader.toString().match(/routes\/([^"']+)/)?.[1];return component;},
    Suspense:()=>null
  };
  hooks.useCallback=(fn,deps)=>hooks.useMemo(()=>fn,deps);
  const Button=()=>null;
  const Component=(await load(path,{react:hooks,'react/jsx-runtime':jsx,'lucide-react':icons,'../design-system/Button':{Button},'./LoadingState':{LoadingState},'../components/LoadingState':{LoadingState},'../features/DisplayPreferencesProvider':{useDisplayPreferences:()=>({preferences:{navigation:'expanded'},appearance:'light',updatePreferences(){},openDisplaySettings(){}})},...imports}))[name];
  function nodes(){const found=[];function walk(node){if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;found.push(node);if(node.type===LoadingState)walk(LoadingState(node.props));else walk(node.props?.children);}walk(tree);return found;}
  async function settle(){for(let n=0;n<40;n++){if(pending){pending=false;cursor=0;tree=Component(props);}while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));if(!pending&&!effects.length)return;}throw Error('View did not settle');}
  await settle();
  return {nodes,settle,Button,text:()=>text(tree),async change(node,value){node.props.onChange({target:{value}});await settle();},async click(label){const node=nodes().find(n=>(n.type==='button'||n.type===Button)&&text(n)===label);assert.ok(node,`Missing ${label}`);assert.ok(!node.props.disabled);const request=node.props.onClick?.();await settle();return request;}};
}

test('Microsoft-only sign-in failures are visible and release the button for retry',async()=>{
  const request=deferred();let calls=0;
  const page=await mount('components/LoginScreen.tsx','LoginScreen',{}, {'../services/auth':{isAuthEnabled:true,isLocalLoginEnabled:false,passwordResetUrl:'https://example.test/reset',signIn(){calls++;return request.promise;}}});
  assert.equal(page.nodes().filter(n=>n.type==='form').length,0);
  const button=()=>page.nodes().find(n=>n.type==='button'&&text(n).includes('Sign in with Microsoft'));
  button().props.onClick();await page.settle();assert.equal(button().props.disabled,true);
  request.reject(Error('internal stack detail'));await page.settle();
  assert.equal(calls,1);assert.equal(button().props.disabled,false);
  assert.ok(page.nodes().some(n=>n.props?.role==='alert'&&text(n).includes('could not be started')));
  assert.doesNotMatch(page.text(),/internal stack detail/);
});

test('local sign-in offers the configured method and keeps failed values available for correction',async()=>{
  const page=await mount('components/LoginScreen.tsx','LoginScreen',{}, {'../services/auth':{isAuthEnabled:false,isLocalLoginEnabled:true,signInWithPassword:async()=>{throw Error('Email or password is incorrect.');}}});
  assert.doesNotMatch(page.text(),/Sign in with Microsoft|Reset Microsoft/);
  await page.change(page.nodes().find(n=>n.type==='input'&&n.props.type==='email'),' test@example.test ');
  await page.change(page.nodes().find(n=>n.type==='input'&&n.props.type==='password'),'test-only-placeholder');
  const submit=page.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await page.settle();await submit;await page.settle();
  assert.match(page.text(),/Email or password is incorrect/);
  assert.equal(page.nodes().find(n=>n.type==='input'&&n.props.type==='email').props.disabled,false);
  assert.equal(page.nodes().find(n=>n.type==='input'&&n.props.type==='email').props.value,' test@example.test ');
});

test('account setup retries unavailable choices, resets dependent team and recovers from failed saving',async()=>{
  let loads=0,saves=0;const created=[];
  const options={faculties:[{id:'f',code:'F',name:'Faculty'},{id:'g',code:'G',name:'Other'}],teams:[{id:'t',parentOrgUnitId:'f',code:'T',name:'Team'}],categories:[{key:'teaching',name:'Teaching'}]};
  const page=await mount('components/FirstTimeOnboarding.tsx','FirstTimeOnboarding',{email:'setup@example.test',onComplete:user=>created.push(user)}, {'../services/api':{api:{staffOnboardingOptions:async()=>{if(++loads===1)throw Error('offline');return options;},completeStaffOnboarding:async payload=>{saves++;assert.equal(payload.teamOrgUnitId,'t');throw Error('offline');}}},'../services/auth':{isAuthEnabled:false,getLocalToken:()=>null}});
  assert.match(page.text(),/could not be loaded/);await page.click('Try again');assert.equal(loads,2);
  const field=name=>page.nodes().find(n=>n.type==='select'&&n.props.name===name);
  await page.change(field('faculty'),'f');await page.change(field('team'),'t');await page.change(field('faculty'),'g');assert.equal(field('team').props.value,'');
  await page.change(field('faculty'),'f');await page.change(field('team'),'t');
  page.nodes().find(n=>n.type==='input'&&n.props.type==='radio').props.onChange();await page.settle();
  const form=()=>page.nodes().find(n=>n.type==='form');
  form().props.onSubmit({preventDefault(){}});await page.settle();
  assert.equal(saves,1);assert.equal(form().props['aria-busy'],false);assert.equal(created.length,0);
  assert.match(page.text(),/could not be completed/);assert.equal(field('team').props.value,'t');
  assert.equal(field('team').props.required,true);assert.equal(page.nodes().find(n=>n.type===page.Button).props.type,'submit');
});

const context=await load('app/pageContext.ts');
async function shell(route, responses = {}, target = '', options = {}) {
  const location={route,profileStaffId:target,actionStaffId:'',actionDetailId:'',sourceRecordId:'',pendingRecordId:'',adminTab:'overview'};
  globalThis.document={title:'',getElementById:()=>({focus(){}}),querySelector:()=>null};
  globalThis.window={location:{pathname:`/${route}`,search:'',hash:''},requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){},scrollTo(){},addEventListener(){},removeEventListener(){},dispatchEvent(){}};
  const api={currentUser:async()=>({userAccountId:'a',staffId:'s',displayName:'Test',permissions:['reports.view_all'],scopes:[]}),orgUnits:async()=>[],academicYears:async()=>[{academicYear:'2026/27',isCurrent:true}],ucoTlaAccess:async()=>({canAccess:false}),staff:async()=>[],...responses};
  const navigation=await load('app/navigation.ts',{'lucide-react':icons});
  return mount('app/App.tsx','App',{}, {'../services/api':{api},'./pageContext':context,'./navigation':navigation,'./history':{historyPosition:()=>0,initialiseAppHistory(){},writeAppPath:options.writeAppPath??(()=>{})},'./routing':{parseAppLocation:()=>location,routePath:route=>`/${route}`},'../services/auth':{isAuthEnabled:false},'../features/DisplayPreferencesProvider':{useDisplayPreferences:()=>({preferences:{navigation:options.navigation??'expanded'},appearance:options.theme??'light',updatePreferences:options.updatePreferences??(()=>{}),openDisplaySettings(){}})},'../components/UnsavedChangesGuard':{UnsavedChangesGuard:()=>null,confirmUnsavedNavigation:options.confirmUnsavedNavigation??(async()=>true),hasUnsavedChanges:()=>false},'../components/SidebarNavigation':{SidebarNavigation:()=>null},'../components/WorkspaceSwitch':{WorkspaceSwitch:()=>null},'../components/UserMenu':{UserMenu:()=>null},'../components/FirstTimeOnboarding':{FirstTimeOnboarding:()=>null}});
}
test('dashboard waits for specialist access before mounting and interpreting a saved UCO view',async()=>{
  const request=deferred(),page=await shell('dashboard',{ucoTlaAccess:()=>request.promise});
  assert.equal(page.nodes().some(n=>n.type?.route==='Dashboard'),false);
  assert.match(page.text(),/Loading dashboard access/);
  request.resolve({canAccess:true});await page.settle();
  assert.equal(page.nodes().find(n=>n.type?.route==='Dashboard').props.ucoAccess.canAccess,true);
});

test('the collapsed sidebar uses the i-Elevate logo while the named collapse control remains a simple icon',async()=>{
  for(const [navigation,theme,expected,next] of [['expanded','light','/system-assets/i-elevate-logo-ink.png','compact'],['compact','dark','/system-assets/i-elevate-logo-transparent.png','expanded']]){
    const updates=[],page=await shell('home',{},'',{navigation,theme,updatePreferences:value=>updates.push(value)});
    const toggle=page.nodes().find(node=>node.type==='button'&&node.props.className?.includes('navigation-collapse-button'));
    assert.ok(toggle);assert.equal(toggle.props['aria-label'],navigation==='compact'?'Expand navigation':'Collapse navigation');
    assert.equal(toggle.props['aria-expanded'],navigation!=='compact');assert.equal(toggle.props['aria-controls'],'main-navigation');
    assert.notEqual(toggle.props.children?.type,'img');assert.doesNotMatch(toggle.props.className,/navigation-logo-toggle/);
    const logo=page.nodes().find(node=>node.type==='img'&&node.props.className==='brand-logo-mark');
    assert.ok(logo);assert.equal(logo.props.src,expected);assert.doesNotMatch(logo.props.src,/eli-favicon/);
    toggle.props.onClick();await page.settle();assert.deepEqual(updates,[{navigation:next}]);
  }
});

test('top Home uses native links for modified clicks and the normal guarded navigation path for a plain click',async()=>{
  let confirmations=0,allow=false;const paths=[];
  const page=await shell('dashboard',{},'',{confirmUnsavedNavigation:async()=>{confirmations++;return allow;},writeAppPath:(path,replace)=>paths.push({path,replace})});
  const home=()=>page.nodes().find(node=>node.type==='a'&&node.props.href==='/home');
  assert.ok(home());assert.match(home().props['aria-label']??text(home()),/Home/i);
  assert.ok(page.nodes().some(node=>node.type?.route==='Dashboard'));
  for(const modifiers of [{button:1},{button:0,ctrlKey:true},{button:0,metaKey:true},{button:0,shiftKey:true},{button:0,altKey:true}]){
    let prevented=false;home().props.onClick({...modifiers,preventDefault(){prevented=true;}});await page.settle();
    assert.equal(prevented,false);assert.equal(confirmations,0);assert.deepEqual(paths,[]);
  }
  let prevented=0;
  home().props.onClick({button:0,preventDefault(){prevented++;}});await page.settle();
  assert.equal(prevented,1);assert.equal(confirmations,1);assert.deepEqual(paths,[]);
  assert.ok(page.nodes().some(node=>node.type?.route==='Dashboard'));
  allow=true;home().props.onClick({button:0,preventDefault(){prevented++;}});await page.settle();
  assert.equal(prevented,2);assert.equal(confirmations,2);assert.deepEqual(paths,[{path:'/home',replace:false}]);
  assert.ok(page.nodes().some(node=>node.type?.route==='Home'));
  assert.equal(home().props['aria-current'],'page');
});
test('a staff deep link waits for the directory instead of mounting a fallback profile',async()=>{
  const request=deferred(),page=await shell('profile',{staff:()=>request.promise},'requested-person');
  assert.equal(page.nodes().some(n=>n.type?.route==='StaffProfileWorkspace'),false);
  assert.match(page.text(),/Loading the staff directory/);
  request.resolve([{id:'requested-person'}]);await page.settle();
  assert.equal(page.nodes().find(n=>n.type?.route==='StaffProfileWorkspace').props.initialStaffId,'requested-person');
});
test('shared year selection appears only on pages that consume it, while probation actions include history',()=>{
  for(const route of ['home','team','admin','qa','practice','coaching','probation','liv','als_liv'])assert.equal(context.pageUsesAcademicYear(route),false,route);
  for(const route of ['dashboard','staff','profile','actions','cpd','uco'])assert.equal(context.pageUsesAcademicYear(route),true,route);
  assert.equal(context.actionsAcademicYear('probation','2026/27'),undefined);
  assert.equal(context.actionsAcademicYear('actions','2026/27'),'2026/27');
});

test('an unavailable named staff URL never falls back to displaying a different person',async()=>{
  const Panel=()=>null;
  const page=await mount('routes/StaffProfileWorkspace.tsx','StaffProfileWorkspace',{academicYear:'2026/27',initialStaffId:'requested-person',staff:[],user:{staffId:'viewer-person',email:'viewer@example.test',permissions:['reports.view_all']},onOpenRecord(){},onOpenActionDetails(){}}, {'../components/StaffSearchSelect':{StaffSearchSelect:()=>null},'../components/UnsavedChangesGuard':{confirmUnsavedNavigation:async()=>true},'../features/StaffProfilePanel':{StaffProfilePanel:Panel}});
  assert.equal(page.nodes().some(n=>n.type===Panel),false);
  assert.match(page.text(),/This staff profile is unavailable/);
});

test('account password dialog uses shared busy/error recovery without making a real credential request',async()=>{
  const ModalDialog=()=>null, request=deferred();let calls=0;
  const page=await mount('components/UserMenu.tsx','UserMenu',{displayName:'Test account'}, {'./ModalDialog':{ModalDialog},'./UnsavedChangesGuard':{confirmUnsavedNavigation:async()=>true},'../services/api':{api:{changePassword:()=>{calls++;return request.promise;}}},'../services/auth':{getLocalToken:()=> 'test-session',isAuthEnabled:false}});
  page.nodes().find(n=>n.type==='button'&&n.props['aria-haspopup']==='menu').props.onClick();await page.settle();
  await page.click('Change password');
  const form=()=>page.nodes().find(n=>n.type==='form');
  const result=form().props.onSubmit({preventDefault(){}});await page.settle();
  assert.equal(calls,1);assert.equal(form().props['aria-busy'],true);assert.equal(page.nodes().find(n=>n.type===ModalDialog).props.busy,true);
  request.reject(Error('offline'));await result;await page.settle();
  assert.equal(form().props['aria-busy'],false);assert.equal(page.nodes().find(n=>n.type===ModalDialog).props.busy,false);
  assert.ok(page.nodes().some(n=>n.props?.id===form().props['aria-describedby']&&n.props.role==='alert'));
});

test('probation receives historical linked actions and an older refresh cannot overwrite a newer request',async()=>{
  const location={route:'probation',profileStaffId:'',actionStaffId:'',actionDetailId:'',sourceRecordId:'',pendingRecordId:'',adminTab:'overview'};
  const events=new Map(),calls=[],queue=[];
  globalThis.document={title:'',getElementById:()=>({focus(){}}),querySelector:()=>null};
  globalThis.window={location:{pathname:'/probationary-observations',search:'',hash:''},requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){},scrollTo(){},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener(){},dispatchEvent(){}};
  const api={currentUser:async()=>({userAccountId:'a',staffId:'s',displayName:'Test',permissions:['probation.manage'],scopes:[]}),orgUnits:async()=>[],academicYears:async()=>[{academicYear:'2026/27',isCurrent:true}],ucoTlaAccess:async()=>({canAccess:false}),staff:async()=>[],actions:async(...args)=>{calls.push(args);return queue.length?queue.shift().promise:[{id:'historic',academicYear:'2024/25'}];}};
  const navigation=await load('app/navigation.ts',{'lucide-react':icons});
  const page=await mount('app/App.tsx','App',{}, {'../services/api':{api},'./pageContext':context,'./navigation':navigation,'./history':{historyPosition:()=>0,initialiseAppHistory(){},writeAppPath(){}},'./routing':{parseAppLocation:()=>location,routePath:route=>`/${route}`},'../services/auth':{isAuthEnabled:false},'../components/UnsavedChangesGuard':{UnsavedChangesGuard:()=>null,confirmUnsavedNavigation:async()=>true,hasUnsavedChanges:()=>false},'../components/SidebarNavigation':{SidebarNavigation:()=>null},'../components/WorkspaceSwitch':{WorkspaceSwitch:()=>null},'../components/UserMenu':{UserMenu:()=>null},'../components/FirstTimeOnboarding':{FirstTimeOnboarding:()=>null}});
  const probation=()=>page.nodes().find(n=>n.type?.route==='ProbationObservations');
  assert.ok(probation());assert.deepEqual(calls,[[false,undefined]]);assert.equal(probation().props.actions[0].id,'historic');
  const old=deferred(),current=deferred();queue.push(old,current);
  const first=probation().props.onActionsChanged(),second=probation().props.onActionsChanged();await page.settle();
  current.resolve([{id:'newest',academicYear:'2024/25'}]);await second;await page.settle();
  old.resolve([{id:'stale',academicYear:'2024/25'}]);await first;await page.settle();
  assert.equal(probation().props.actions[0].id,'newest');
});
