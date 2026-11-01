import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), jsx = web('react/jsx-runtime');
const source = `${await readFile(new URL('../apps/web/src/routes/CoachingMentoring.tsx', import.meta.url), 'utf8')}\nexport { CoachingSessionEditor, validateCompletion };`;
const module = { exports: {} };
const fallback = new Proxy({}, { get: () => function Placeholder() { return null; } });
const imports = { 'react/jsx-runtime': jsx, react: web('react'), '../services/formContent': { useFormContent: () => ({ field: (_, label, helpText) => ({ label, helpText }) }) } };
new Function('require', 'exports', 'module', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText)(name => imports[name] || fallback, module.exports, module);
const { CoachingSessionEditor, validateCompletion } = module.exports;
const noOp = () => {};
const action = { id: 'saved', actionOrder: 1, actionTheme: 'Planning', actionText: 'Saved current action', ownerType: 'staff', dueDate: '2026-12-01', status: 'not_started', canManageAction: false };
const previous = { actionId: 'prior', title: 'Carried action', actionTheme: 'Planning', ownerType: 'staff', ownerName: 'Staff member', dueDate: '2026-11-10', status: 'in_progress', canManageAction: false };
const form = { staffId: 'staff', sessionDate: '2026-11-01', sessionType: 'coaching', deliveryMethod: 'in_person', durationMinutes: 30, qualificationStatusKey: 'qualified', primaryFocusKey: 'planning', specificSessionFocus: 'Subject practice', supportTypes: ['guidance'], conversationSummary: 'Discussion notes', closeCycle: false, actions: [action], actionReviews: [{ actionId: 'prior' }] };
function nodes(tree) { const result = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node?.props) return; result.push(node); walk(node.props.children); } walk(tree); return result; }
function editor({ previousAction = previous, currentAction = action, editable = true } = {}) {
  const changes = [];
  const tree = CoachingSessionEditor({ configuration: null, context: null,
    detail: { canEdit: editable, status: 'draft', previousActions: [previousAction], sessionNumber: 2 },
    form: { ...form, actions: [currentAction] }, isSaving: false, isLoading: false, loadingLabel: '', message: '', validationError: null,
    onBack: noOp, onChange: value => changes.push(value), onCycleChange: noOp, onSave: noOp });
  return { tree, nodes: nodes(tree), changes };
}

test('coaching previous and saved actions stay read-only without the server creator-hierarchy capability', () => {
  const page = editor();
  const outcome = page.nodes.find(node => node.props.id === 'coaching-review-prior');
  outcome.props.onChange({ target: { value: 'completed' } });
  const savedAction = page.nodes.find(node => node.props.action?.id === 'saved' && node.props.onChange);
  savedAction.props.onChange({ actionText: 'Forged edit' });
  assert.deepEqual(page.changes, [], 'disabled controls also reject direct handler invocation');
  assert.ok(page.nodes.filter(node => node.type === 'fieldset' && node.props.disabled === true).length >= 2);
  const close = page.nodes.find(node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked === false);
  assert.equal(close.props.disabled, true, 'unresolved immutable carried actions prevent cycle closure');
  const missing = editor({ previousAction: { ...previous, canManageAction: undefined }, currentAction: { ...action, canManageAction: undefined } });
  missing.nodes.find(node => node.props.id === 'coaching-review-prior').props.onChange({ target: { value: 'completed' } });
  assert.deepEqual(missing.changes, []);
});

test('coaching server-authorised action controls update their own action while narrative access alone grants no action rights', () => {
  const page = editor({ previousAction: { ...previous, canManageAction: true }, currentAction: { ...action, canManageAction: true } });
  page.nodes.find(node => node.props.id === 'coaching-review-prior').props.onChange({ target: { value: 'completed' } });
  assert.equal(page.changes[0].actionReviews[0].reviewOutcome, 'completed');
  page.nodes.find(node => node.props.action?.id === 'saved' && node.props.onChange).props.onChange({ actionText: 'Permitted edit' });
  assert.equal(page.changes[1].actions[0].actionText, 'Permitted edit');
  const readOnlySession = editor({ previousAction: { ...previous, canManageAction: true }, editable: false });
  readOnlySession.nodes.find(node => node.props.id === 'coaching-review-prior').props.onChange({ target: { value: 'completed' } });
  assert.deepEqual(readOnlySession.changes, []);
});

test('coaching completion allows untouched unmanaged carried actions but closing the cycle still requires resolution', () => {
  assert.equal(validateCompletion(form, [previous], 3), undefined, 'the session can be completed without a forbidden action review');
  assert.equal(validateCompletion(form, [{ ...previous, canManageAction: true }], 3).id, 'coaching-review-prior');
  assert.equal(validateCompletion({ ...form, closeCycle: true }, [previous], 3).id, 'coaching-review-prior');
  assert.equal(validateCompletion({ ...form, closeCycle: true }, [{ ...previous, status: 'completed' }], 3), undefined);
});
