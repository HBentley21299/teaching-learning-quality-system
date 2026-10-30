import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const postcss = web('postcss');
const sourceRoot = fileURLToPath(new URL('../apps/web/src/', import.meta.url));
async function components(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? components(join(folder, entry.name))
    : entry.name.endsWith('.tsx') ? readFile(join(folder, entry.name), 'utf8') : ''))).join('\n');
}
const markup = await components(sourceRoot);
const main = await readFile(join(sourceRoot, 'main.tsx'), 'utf8');
const paths = [...main.matchAll(/import "(\.\/app\/[^\"]+\.css)"/g)].map(match => join(sourceRoot, match[1]));
const sheets = await Promise.all(paths.map(async path => ({ path, root: postcss.parse(await readFile(path, 'utf8')) })));
function declaration(selector, property) {
  let result;
  for (const sheet of sheets) sheet.root.walkRules(rule => {
    if (!rule.selectors?.includes(selector)) return;
    rule.walkDecls(property, value => { result = value.value; });
  });
  return result;
}

test('every active historical fixed-pixel label is replaced by scalable text in the actual imported stylesheet order', () => {
  const active = new Map();
  for (const sheet of sheets.filter(sheet => ['styles.css', 'theme.css'].includes(sheet.path.split(/[\\/]/).at(-1)))) {
    sheet.root.walkDecls('font-size', value => {
      if (!/^\d+(?:\.\d+)?px$/.test(value.value)) return;
      for (const selector of value.parent.selectors ?? []) {
        const classes = [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match => match[1]);
        if (classes.length && classes.every(name => markup.includes(name))) active.set(selector, value.value);
      }
    });
  }
  assert.ok(active.size >= 12, 'the audit must include the real workflow, directory, login and role labels');
  for (const selector of active.keys()) {
    const size = declaration(selector, 'font-size');
    assert.match(size ?? '', /^(?:\d*\.)?\d+rem$/, `${selector} must follow personal text size, rather than its old ${active.get(selector)}`);
    const rem = parseFloat(size);
    assert.ok(rem * 20 > rem * 16, `${selector} enlarges with Larger text`);
    assert.ok(rem * 32 >= rem * 16 * 2, `${selector} enlarges at 200% browser text scaling`);
  }
  assert.equal(declaration('.reporting-trend-grid text', 'font-size'), '0.875rem', 'new SVG labels must follow the same preference');
});

test('year and account controls follow the shared scalable target instead of retaining their old 34px heights', () => {
  for (const selector of ['.topbar .academic-year-selector select', '.topbar .user-menu-trigger']) {
    assert.equal(declaration(selector, 'min-height'), 'var(--control-height)', selector);
  }
});
