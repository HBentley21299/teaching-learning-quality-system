import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createElement } = webRequire('react');
const { renderToStaticMarkup } = webRequire('react-dom/server');
const { createServer } = await import(pathToFileURL(webRequire.resolve('vite')));
let server;
let LivCaseWorkspace;
let LivVisibilityConfirmationDialog;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../apps/web', import.meta.url)),
    configFile: false, server: { middlewareMode: true },
    esbuild: { jsx: 'automatic' },
    define: { 'import.meta.env.VITE_ENTRA_CLIENT_ID': '""' }
  });
  ({ LivCaseWorkspace } = await server.ssrLoadModule('/src/routes/LivVisits.tsx'));
  ({ LivVisibilityConfirmationDialog } = await server.ssrLoadModule('/src/components/LivStageVisibility.tsx'));
});
after(async () => { await server?.close(); });

function fixture(overrides = {}, cycleNumber = 1) {
  const stages = ['pre_discussion', 'visit', 'post_reflection', 'actions', 'follow_up_review'].map((stageType, i) => ({
    id: `stage-${i}`, stageType: cycleNumber > 1 && i === 0 ? 'distance_impact' : stageType,
    stageOrder: i + 1, stageStatus: 'in_progress', developmentOpportunityKeys: [],
    visitId: stageType === 'visit' ? 'visit-1' : undefined,
    canEdit: true, visibleToStaff: true, canView: true
  }));
  return {
    id: 'liv-1', recordId: 'record-1', subjectStaffId: 'alex', subjectStaffName: 'Alex',
    status: 'in_progress', canEdit: true, canViewSensitive: false, isCreatedByCurrentUser: false,
    areaOfPracticeThemeIds: [], areaOfPracticeKeys: [],
    cycles: [{ id: 'cycle-1', cycleNumber, status: 'in_progress', isFollowUp: cycleNumber > 1, stages }],
    visits: [{ id: 'visit-1', ratings: [], reflectionNotes: 'Shared visit notes for Alex' }],
    ...overrides
  };
}

function render(record, extra = {}) {
  return renderToStaticMarkup(createElement(LivCaseWorkspace, {
    record, configuration: { deliveryAreas: [], courseLevels: [], focusAreas: [], developmentOpportunities: [], rubric: [] },
    actions: [], cycleId: 'cycle-1', staff: [], onBack: () => {}, onChanged: async () => {}, onCycleChange: () => {}, ...extra
  }));
}

test('only the review creator has a visibility switch for each section', () => {
  const owner = render(fixture({ isCreatedByCurrentUser: true }));
  assert.equal((owner.match(/role="switch"/g) ?? []).length, 5);
  assert.match(owner, /aria-checked="true"/);
  assert.match(owner, /Make LIV Visit visible to Alex/);
  const manager = render(fixture({ canEdit: true, canViewSensitive: true }));
  assert.doesNotMatch(manager, /role="switch"/);
});

test('hidden section contents stay out of the rendered page and explain how sharing works', () => {
  const record = fixture({ canEdit: false });
  for (const stage of record.cycles[0].stages) {
    Object.assign(stage, { canView: false, canEdit: false, visibleToStaff: false, contextText: 'PRIVATE CONTEXT', reflectionText: 'PRIVATE REFLECTION' });
  }
  record.visits[0].reflectionNotes = 'PRIVATE VISIT NOTES';
  const html = render(record);
  assert.equal((html.match(/This section has not been shared with you/g) ?? []).length, 5);
  assert.doesNotMatch(html, /PRIVATE/);
  assert.doesNotMatch(html, /role="switch"/);
});

test('staff can see shared visit details without access to practitioner information', () => {
  const record = fixture({ canEdit: false, canViewSensitive: false });
  for (const stage of record.cycles[0].stages) stage.canEdit = false;
  const html = render(record);
  assert.match(html, /Shared visit notes for Alex/);
  assert.doesNotMatch(html, /Elevate practitioner/);
  assert.doesNotMatch(html, /Save stage/);
});

test('self-only LIV viewers have no Word control without the matching export policy', () => {
  const record = fixture({ canEdit: false });
  assert.doesNotMatch(render(record), /Export Word/);
  assert.match(render(record, { canExportWord: true }), /Export Word/);
  assert.doesNotMatch(render(record, { canExportWord: true, embedded: true }), /Export Word/);
});

test('cycle 1 removes follow-up N\/A and requires cycle 2, while cycle 2 offers N\/A', () => {
  const first = render(fixture({ probationObservationNumber: 2 }));
  assert.doesNotMatch(first, /Not applicable - no further follow-up required/);
  assert.match(first, /Cycle 2 is required for every staff member/);
  assert.match(first, /Complete cycle and open cycle 2/);
  assert.doesNotMatch(first, /Complete Probation Observation 2/);
  const next = render(fixture({ probationObservationNumber: 2 }, 2));
  assert.match(next, /Not applicable - no further follow-up required/);
  assert.match(next, /Complete Probation Observation 2/);
});

test('visibility confirmation names the exact section and staff member with explicit cancel and confirm buttons', () => {
  for (const visibleToStaff of [true, false]) {
    const html = renderToStaticMarkup(createElement(LivVisibilityConfirmationDialog, {
      visibleToStaff, sectionLabel: 'Professional Discussion', staffName: 'Alex Smith', busy: false, message: '', idPrefix: 'liv-visibility-stage-1',
      onConfirm: () => {}, onCancel: () => {}
    }));
    assert.match(html, /<dialog/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-labelledby=/);
    assert.match(html, /aria-describedby=/);
    assert.match(html, /id="liv-visibility-stage-1-title"/);
    assert.match(html, /id="liv-visibility-stage-1-description"/);
    if (visibleToStaff) {
      assert.match(html, /Make Professional Discussion visible to Alex Smith/);
      assert.match(html, />Make visible<\/span>/);
      assert.match(html, />Keep hidden<\/span>/);
    } else {
      assert.match(html, /Hide Professional Discussion from Alex Smith/);
      assert.match(html, />Hide section<\/span>/);
      assert.match(html, />Keep visible<\/span>/);
    }
    assert.doesNotMatch(html, /disabled=""/);
  }
});

test('failed visibility saves remain reviewable in the confirmation dialog', () => {
  const html = renderToStaticMarkup(createElement(LivVisibilityConfirmationDialog, {
    visibleToStaff: true, sectionLabel: 'LIV Visit', staffName: 'Alex', busy: false,
    message: 'Only the review owner can change visibility.', idPrefix: 'liv-visibility-stage-1', onConfirm: () => {}, onCancel: () => {}
  }));
  assert.match(html, /role="alert">Only the review owner can change visibility/);
  assert.match(html, />Make visible<\/span>/);
  assert.match(html, />Keep hidden<\/span>/);
});
