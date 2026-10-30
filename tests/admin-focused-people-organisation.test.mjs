import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createElement } = webRequire('react');
const { renderToStaticMarkup } = webRequire('react-dom/server');
const { createServer } = await import(pathToFileURL(webRequire.resolve('vite')));
let server;
let OrganisationStructureAdmin;
let AdminStaffDetails;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../apps/web', import.meta.url)),
    configFile: false, server: { middlewareMode: true },
    esbuild: { jsx: 'automatic' },
    define: { 'import.meta.env.VITE_ENTRA_CLIENT_ID': '""' }
  });
  ({ OrganisationStructureAdmin } = await server.ssrLoadModule('/src/routes/OrganisationStructureAdmin.tsx'));
  ({ AdminStaffDetails } = await server.ssrLoadModule('/src/routes/AdminStaffDetails.tsx'));
});

after(async () => { await server?.close(); });

const renderOrganisation = (view, isAdministrator = true) => renderToStaticMarkup(createElement(OrganisationStructureAdmin, { view, isAdministrator }));
const renderStaff = (view) => renderToStaticMarkup(createElement(AdminStaffDetails, { view, isAdministrator: true }));

test('only organisation structure pages offer unit creation', () => {
  for (const view of [undefined, 'all', 'structure']) {
    const html = renderOrganisation(view);
    assert.match(html, /Add directorate/);
    assert.match(html, /Add faculty/);
    assert.match(html, /Add team/);
  }
  for (const view of ['leadership', 'membership', 'reviews', 'reporting']) {
    const html = renderOrganisation(view);
    assert.doesNotMatch(html, /Add directorate|Add faculty|Add team/);
    assert.match(html, /aria-label="Directorates, faculties and teams"/);
    assert.match(html, /Search directorates, faculties and teams/);
  }
});

test('organisation workflows explain their selection and confirmation steps', () => {
  assert.match(renderOrganisation('structure'), /Review the impact before activating or deactivating/);
  assert.match(renderOrganisation('leadership'), /Changing or removing a manager requires a reason/);
  assert.match(renderOrganisation('membership'), /Choose a team to add a primary or additional staff allocation/);
  assert.match(renderOrganisation('reporting'), /whether it contributes to dashboard reporting/);
  const reviews = renderOrganisation('reviews');
  assert.match(reviews, /Choose the correct unit before preparing a leadership assignment/);
  assert.match(reviews, /No self-declared leaders are awaiting a managed unit/);
  assert.match(reviews, /No open migration allocations need review/);
});

test('non-administrators cannot use unit creation controls', () => {
  const html = renderOrganisation('structure', false);
  const createButtons = [...html.matchAll(/<button[^>]*>[\s\S]*?<span>Add (?:directorate|faculty|team)<\/span><\/button>/g)].map((match) => match[0]);
  assert.equal(createButtons.length, 3);
  assert.ok(createButtons.every((button) => button.includes('disabled=""')));
});

test('staff workflow destinations keep their own instructions and account filters', () => {
  assert.match(renderStaff('details'), /amend their name, job title or staff category/);
  assert.match(renderStaff('scope'), /select the areas their existing roles can access/);
  for (const view of ['details', 'scope']) {
    const html = renderStaff(view);
    assert.match(html, /Include archived staff/);
    assert.doesNotMatch(html, /Include active staff for archiving/);
  }
  const archived = renderStaff('archived');
  assert.match(archived, /Restore an archived staff account/);
  assert.match(archived, /Include active staff for archiving/);
  assert.doesNotMatch(archived, /Include archived staff/);
  assert.match(archived, /<span>Staff member<\/span><select/);
});
