import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript');
const react = requireWeb('react');
const { renderToStaticMarkup } = requireWeb('react-dom/server');

async function load(path) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(requireWeb, module.exports, module);
  return module.exports;
}

const { Button } = await load('design-system/Button.tsx');
const { KpiStrip } = await load('components/KpiStrip.tsx');

test('shared buttons retain native form and accessible description semantics', () => {
  const click = () => {}, key = () => {}, ref = { current: null };
  const node = Button({ children: 'Save', type: 'submit', name: 'operation', value: 'save', form: 'review', 'aria-describedby': 'save-help', onClick: click, onKeyDown: key, ref, className: 'review-save' });
  assert.equal(node.props.type, 'submit');
  assert.equal(node.props.onClick, click);
  assert.equal(node.props.onKeyDown, key);
  assert.equal(node.props.ref, ref);
  assert.equal(node.props.form, 'review');
  assert.equal(node.props.name, 'operation');
  assert.equal(node.props.value, 'save');
  assert.equal(node.props['aria-describedby'], 'save-help');
  assert.equal(node.props.className, 'button button-secondary review-save');
  assert.equal(Button({ children: 'Cancel' }).props.type, 'button', 'ordinary actions never accidentally submit a surrounding form');
});

test('busy actions prevent duplicate native activation, keep the label and hide decorative spinner from assistive technology', () => {
  const html = renderToStaticMarkup(react.createElement(Button, { busy: true, variant: 'primary' }, 'Saving review…'));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /class="button button-primary"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /<span>Saving review…<\/span>/);
  assert.equal(Button({ children: 'Already disabled', disabled: true }).props.disabled, true);
  assert.equal(Button({ children: 'Ready' }).props.disabled, false);
});

test('metric labels and values form semantic description pairs and empty strips disappear', () => {
  const html = renderToStaticMarkup(react.createElement(KpiStrip, { items: [{ label: 'Open actions', value: 12, tone: 'amber' }, { label: 'Completed', value: '81%', tone: 'green' }] }));
  assert.match(html, /^<dl class="kpi-strip" aria-label="Key metrics">/);
  assert.match(html, /<dt>Open actions<\/dt><dd>12<\/dd>/);
  assert.match(html, /<dt>Completed<\/dt><dd>81%<\/dd>/);
  assert.equal(KpiStrip({ items: [] }), null);
});

const css = await readFile(new URL('../apps/web/src/app/product-polish.css', import.meta.url), 'utf8');
function declarations(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `Missing theme ${selector}`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(match => [match[1], match[2]]));
}
function luminance(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(first, second) { const values = [luminance(first), luminance(second)].sort((a, b) => b - a); return (values[0] + 0.05) / (values[1] + 0.05); }

for (const selector of [':root', ':root[data-theme="dark"]', ':root[data-contrast="high"]', ':root[data-contrast="high"][data-theme="dark"]']) {
  test(`${selector}: body, context, actions and form boundaries have measured contrast`, () => {
    const theme = { ...declarations(':root'), ...declarations(selector) };
    for (const background of ['surface', 'surface-muted', 'bg']) {
      for (const foreground of ['text', 'text-muted']) assert.ok(contrast(theme[foreground], theme[background]) >= 4.5, `${foreground} on ${background}: ${contrast(theme[foreground], theme[background]).toFixed(2)}`);
    }
    for (const background of ['teal', 'teal-strong']) assert.ok(contrast(theme['on-accent'], theme[background]) >= 4.5, `primary button ${background}: ${contrast(theme['on-accent'], theme[background]).toFixed(2)}`);
    assert.ok(contrast(theme['line-strong'], theme.surface) >= 3, `form boundary: ${contrast(theme['line-strong'], theme.surface).toFixed(2)}`);
    assert.ok(contrast(theme['focus-color'], theme.surface) >= 3, `focus outline: ${contrast(theme['focus-color'], theme.surface).toFixed(2)}`);
  });
}

test('Windows forced-colour focus wins over both explicit and device-resolved high-contrast themes', () => {
  const postcss = requireWeb('postcss'), sheet = postcss.parse(css);
  for (const theme of ['light', 'dark', undefined]) {
    let selected;
    sheet.walkRules(rule => {
      if (rule.parent.type === 'atrule' && rule.parent.name === 'media'
        && rule.parent.params.includes('prefers-color-scheme: dark') && theme === 'light') return;
      for (const selector of rule.selectors) {
        if (!selector.startsWith(':root') || selector.includes(' ')) continue;
        if (selector.includes(':not([data-theme="light"])') && theme === 'light') continue;
        const positive = selector.replace(/:not\([^)]*\)/g, '');
        if (positive.includes('[data-theme]') && theme === undefined) continue;
        if (positive.includes('[data-theme="dark"]') && theme !== 'dark') continue;
        if (positive.includes('[data-theme="light"]') && theme !== 'light') continue;
        const specificity = (selector.match(/\[/g) ?? []).length + 1;
        rule.walkDecls('--focus-color', declaration => {
          if (!selected || specificity >= selected.specificity) selected = { specificity, value: declaration.value };
        });
      }
    });
    assert.equal(selected.value, 'Highlight', `${theme ?? 'device'} high contrast must use the Windows palette`);
  }
});

test('required markers and inline errors retain readable semantic colour on light and dark form surfaces', async () => {
  const postcss = requireWeb('postcss');
  const themeCss = await readFile(new URL('../apps/web/src/app/theme.css', import.meta.url), 'utf8');
  const sheet = postcss.parse(css);
  for (const selector of ['.preview-field span strong', '.entry-field span strong', '.entry-field > label > strong', '.practice-observed-rubric legend > strong', '.learning-walk-focus-rubrics > legend > strong', '.onboarding-category-fieldset strong', '.onboarding-form .entry-field strong', '.scrutiny-choice-field legend strong', '.qa-form-grid label > span strong', '.error-copy']) {
    let resolved;
    sheet.walkRules(rule => {
      if (rule.selectors.includes(selector)) rule.walkDecls('color', declaration => { resolved = declaration; });
    });
    assert.equal(resolved?.value, 'var(--danger-text)', `${selector} must not fall back to the fixed dark-red foreground`);
    if (selector === '.error-copy') assert.equal(resolved.important, true, 'replace the legacy important declaration');
  }
  for (const selector of [':root', ':root[data-theme="dark"]', ':root[data-contrast="high"]', ':root[data-contrast="high"][data-theme="dark"]']) {
    const dark = selector.includes('[data-theme="dark"]');
    const themeSelector = dark ? ':root[data-theme="dark"]' : ':root';
    const start = themeCss.indexOf(`${themeSelector} {`);
    const danger = themeCss.slice(start, themeCss.indexOf('}', start)).match(/--danger-text:\s*(#[\da-f]{6})/i)?.[1];
    assert.ok(danger, `${themeSelector} provides the semantic error colour`);
    const theme = { ...declarations(':root'), ...declarations(dark ? ':root[data-theme="dark"]' : ':root'), ...declarations(selector) };
    for (const background of ['surface', 'surface-muted', 'bg']) assert.ok(contrast(danger, theme[background]) >= 4.5, `${selector}: required marker on ${background}: ${contrast(danger, theme[background]).toFixed(2)}`);
  }
});
