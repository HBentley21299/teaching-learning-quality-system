import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const postcss = web('postcss');
const main = await readFile(new URL('../apps/web/src/main.tsx', import.meta.url), 'utf8');
const sheets = await Promise.all([...main.matchAll(/import "(\.\/app\/[^\"]+\.css)"/g)].map(async match =>
  postcss.parse(await readFile(new URL(`../apps/web/src/${match[1]}`, import.meta.url), 'utf8'))));

// Resolve the actual cascade for these known rendered elements. Keeping both
// historical and new sheets catches a breakpoint's old column direction or
// more-specific minimum width defeating a later visual adjustment.
function styles(selectors, width) {
  const values = {};
  for (const sheet of sheets) sheet.walkRules(rule => {
    for (let parent = rule.parent; parent?.type !== 'root'; parent = parent?.parent) {
      if (parent?.type !== 'atrule' || parent.name !== 'media') continue;
      if (/forced-colors|prefers-color-scheme|print|pointer/.test(parent.params)) return;
      for (const bound of parent.params.matchAll(/(max|min)-width:\s*([\d.]+)px/g)) {
        if (bound[1] === 'max' && width > Number(bound[2]) || bound[1] === 'min' && width < Number(bound[2])) return;
      }
    }
    for (const selector of rule.selectors.filter(selector => selectors.includes(selector))) {
      const specificity = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length * 100
        + (selector.match(/(?:^|[ >+~])(?:div|small|span|button|label|select)(?=[ :.#>+~]|$)/g) ?? []).length;
      rule.walkDecls(declaration => {
        const rank = specificity + (declaration.important ? 10000 : 0);
        if (!values[declaration.prop] || rank >= values[declaration.prop].rank) values[declaration.prop] = { rank, value: declaration.value };
      });
    }
  });
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.value]));
}

for (const width of [320, 680, 760]) test(`${width}px: reporting columns use content height and remain within the available width`, () => {
  const header = styles(['.intelligence-header', '.intelligence-dashboard .intelligence-header'], width);
  const heading = styles(['.intelligence-header > div:first-child'], width);
  assert.equal(header['flex-direction'], 'column');
  assert.equal(header['flex-wrap'], 'nowrap', 'a column must not wrap the export into a new horizontal column');
  assert.equal(heading.flex, '0 1 auto', 'the desktop 24rem width basis must not become a 24rem height');
  assert.equal(heading.width, '100%');
  const filter = styles(['.intelligence-filter-heading', '.intelligence-dashboard .intelligence-filter-heading'], width);
  const description = styles(['.intelligence-filter-heading small', '.intelligence-dashboard .intelligence-filter-heading small'], width);
  assert.equal(filter['flex-direction'], 'column');
  assert.equal(filter['flex-wrap'], 'nowrap', 'percentage bases must not create an overflowing second column');
  assert.equal(description.flex, '0 1 auto');
  assert.equal(description.width, '100%');
});

test('800px reporting row does not inherit a historical column while retaining a desktop width basis', () => {
  assert.equal(styles(['.intelligence-header', '.intelligence-dashboard .intelligence-header'], 800)['flex-direction'], 'row');
  assert.equal(styles(['.intelligence-header > div:first-child'], 800).flex, '1 1 24rem');
});

test('320px dashboard chooser keeps its select and search control on the same bounded row', () => {
  const switcher = styles(['.dashboard-switcher'], 320);
  const context = styles(['.dashboard-switcher-location'], 320);
  const select = styles(['.dashboard-explorer-filter', '.dashboard-switcher > .dashboard-explorer-filter'], 320);
  const search = styles(['.icon-button', '.dashboard-switcher > button', '.dashboard-switcher > .icon-button'], 320);
  assert.equal(switcher.display, 'grid');
  assert.equal(switcher['grid-template-columns'], 'minmax(0, 1fr) var(--control-height)');
  assert.equal(context['grid-column'], '1 / -1');
  assert.equal(select['min-width'], '0', 'the historical 190px minimum must not widen the narrow select column');
  assert.equal(select.width, '100%');
  assert.equal(search.width, 'var(--control-height)', 'the search icon must not become a full-width row');
});

for (const width of [320, 800, 1024]) test(`${width}px outcome disclosure keeps all labelled metrics inside three shrinkable columns`, () => {
  const summary = styles(['.outcome-drilldown-groups details > summary'], width);
  assert.equal(summary['grid-template-columns'], 'repeat(3, minmax(0, 1fr))', 'the legacy 220px title track must not clip metrics');
  assert.equal(styles(['.outcome-drilldown-title'], width)['grid-column'], '1 / -1');
  const distribution = styles(['.outcome-distribution', '.outcome-drilldown-groups details > summary > .outcome-distribution'], width);
  assert.equal(distribution['min-width'], '0', 'a summary distribution must not impose the table bar minimum');
  assert.equal(distribution['grid-column'], '1 / -1');
  for (const [index, name] of ['rated', 'secure', 'mean'].entries()) {
    const metric = styles([`.outcome-drilldown-${name}`], width);
    assert.equal(metric['grid-column'], String(index + 1));
    assert.equal(metric['grid-row'], '3');
  }
  const label = styles(['.outcome-drilldown-metric-label'], width);
  assert.equal(label.position, 'static');
  assert.equal(label['clip-path'], 'none');
});
