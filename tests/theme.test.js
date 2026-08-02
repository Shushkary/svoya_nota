import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  loadThemePreference, resolveTheme, saveThemePreference,
} from '../src/infrastructure/theme.js';

test('тема по умолчанию следует системной настройке', () => {
  assert.equal(loadThemePreference({ getItem: () => null }), 'system');
  assert.equal(resolveTheme('system', () => ({ matches: true })), 'dark');
  assert.equal(resolveTheme('system', () => ({ matches: false })), 'light');
});

test('явный выбор темы сохраняется локально', () => {
  let saved = null;
  assert.equal(saveThemePreference('dark', { setItem: (_key, value) => { saved = value; } }), 'dark');
  assert.equal(saved, 'dark');
  assert.equal(resolveTheme('dark', () => ({ matches: false })), 'dark');
});

test('сцены тороидов используют поверхность текущей темы', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.torus-stage\{[^}]*var\(--surface\)/s);
  assert.match(css, /\.center-stage-old\{[^}]*var\(--surface\)/s);
});
