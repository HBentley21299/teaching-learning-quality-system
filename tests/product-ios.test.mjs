import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const postcss = web('postcss');
const files = ['theme.css', 'product-polish.css', 'product-ios.css'];
const sheets = await Promise.all(files.map(async file => postcss.parse(await readFile(new URL(`../apps/web/src/app/${file}`, import.meta.url), 'utf8'))));
const ios = sheets.at(-1);

function tokens({ theme = 'light', high = false, systemDark = false, forced = false } = {}) {
  const attributes = { ...(theme == null ? {} : { 'data-theme': theme }), 'data-contrast': high ? 'high' : 'standard' };
  const values = {};
  for (const sheet of sheets) sheet.walkRules(rule => {
    for (let parent = rule.parent; parent?.type !== 'root'; parent = parent?.parent) {
      if (parent?.type !== 'atrule' || parent.name !== 'media') continue;
      if (parent.params.includes('prefers-color-scheme: dark') && !systemDark) return;
      if (parent.params.includes('forced-colors: active') && !forced) return;
      if (/pointer|print|max-width|prefers-reduced-motion/.test(parent.params)) return;
    }
    for (const selector of rule.selectors) {
      if (!selector.startsWith(':root') || /\s/.test(selector)) continue;
      let matches = true;
      const positive = selector.replace(/:not\(\[([^=\]]+)(?:="([^"]+)")?\]\)/g, (_, key, value) => {
        if (value ? attributes[key] === value : attributes[key] !== undefined) matches = false;
        return '';
      });
      for (const [, key, value] of positive.matchAll(/\[([^=\]]+)(?:="([^"]+)")?\]/g)) {
        if (value ? attributes[key] !== value : attributes[key] === undefined) matches = false;
      }
      if (!matches) continue;
      const rank = (selector.match(/\[/g) ?? []).length + 1;
      rule.walkDecls(declaration => {
        if (!declaration.prop.startsWith('--')) return;
        if (!values[declaration.prop] || rank >= values[declaration.prop].rank) values[declaration.prop] = { rank, value: declaration.value };
      });
    }
  });
  const resolve = name => values[name]?.value.replace(/var\((--[\w-]+)\)/g, (_, dependency) => resolve(dependency));
  return new Proxy({}, { get: (_, name) => resolve(`--${name}`) });
}

function rgb(hex) {
  assert.match(hex, /^#[\da-f]{6}(?:[\da-f]{2})?$/i);
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
}
function luminance(values) {
  const linear = values.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(foreground, background) {
  const values = [luminance(typeof foreground === 'string' ? rgb(foreground) : foreground), luminance(typeof background === 'string' ? rgb(background) : background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const [name, mode] of [
  ['light', {}], ['dark', { theme: 'dark' }], ['device dark', { theme: null, systemDark: true }],
  ['high light', { high: true }], ['high dark', { theme: 'dark', high: true }]
]) test(`iOS ${name}: grouped fields, pressed surfaces, icons and chrome retain measured contrast`, () => {
  const values = tokens(mode);
  for (const background of ['ios-group-bg', 'ios-field-bg', 'ios-pressed-bg']) {
    for (const foreground of ['text', 'text-muted']) assert.ok(contrast(values[foreground], values[background]) >= 4.5, `${foreground} on ${background}`);
  }
  assert.ok(contrast(values['line-strong'], values['ios-field-bg']) >= 3, 'inset controls keep visible boundaries');
  assert.ok(contrast(values['teal-text'], values['ios-icon-bg']) >= 4.5, 'Home glyphs remain legible');
  assert.ok(contrast(values['on-accent'], values.teal) >= 4.5, 'featured Home glyph uses the established accessible accent pairing');
  const chrome = values['ios-chrome-bg'], alpha = chrome.length === 9 ? parseInt(chrome.slice(7), 16) / 255 : 1;
  for (const behind of [0, 1]) {
    const composite = rgb(chrome).map(channel => channel * alpha + behind * (1 - alpha));
    for (const foreground of ['text', 'text-muted']) assert.ok(contrast(values[foreground], composite) >= 4.5, `chrome contrast over ${behind ? 'white' : 'black'}`);
  }
});

test('high contrast and forced colours remove translucent materials and decorative depth', () => {
  for (const mode of [{ high: true }, { high: true, theme: 'dark' }]) {
    const values = tokens(mode);
    assert.equal(values['ios-chrome-bg'], values.surface);
    assert.equal(values['ios-elevation'], 'none');
    assert.equal(values['ios-control-elevation'], 'none');
  }
  const forced = tokens({ high: true, theme: 'dark', forced: true });
  assert.equal(forced['ios-chrome-bg'], 'Canvas');
  assert.equal(forced['ios-group-bg'], 'Canvas');
  assert.equal(forced['ios-elevation'], 'none');
});

test('press feedback respects both motion preferences without defeating the foundation duration limits or keyboard focus', () => {
  let personal, system;
  ios.walkRules(rule => {
    if (rule.selector.includes('[data-motion="reduced"]')) personal = rule;
    if (rule.parent.type === 'atrule' && rule.parent.params.includes('prefers-reduced-motion: reduce')) system = rule;
    if (rule.selector.includes(':focus')) rule.walkDecls('outline', declaration => assert.notEqual(declaration.value, 'none'));
    rule.walkDecls(declaration => {
      if (/^(animation|transition)/.test(declaration.prop)) assert.equal(Boolean(declaration.important), false, 'foundation reduced-motion !important rules retain priority');
    });
  });
  assert.ok(personal, 'explicit reduced motion must disable active scaling');
  assert.ok(system, 'device reduced motion must disable active scaling');
  for (const rule of [personal, system]) assert.ok(rule.nodes.some(declaration => declaration.prop === 'transform' && declaration.value === 'none'));
});
