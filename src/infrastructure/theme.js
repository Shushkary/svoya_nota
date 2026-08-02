const THEME_KEY = 't_theme';
const VALID = new Set(['light', 'dark', 'system']);

export function loadThemePreference(store = globalThis.localStorage) {
  try {
    const value = store?.getItem(THEME_KEY);
    return VALID.has(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(preference, media = globalThis.matchMedia) {
  if (preference === 'light' || preference === 'dark') return preference;
  try {
    return media?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(preference, root = globalThis.document?.documentElement) {
  const resolved = resolveTheme(preference);
  if (!root) return resolved;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  const meta = globalThis.document?.querySelector?.('meta[name="theme-color"]');
  meta?.setAttribute('content', resolved === 'dark' ? '#151713' : '#F6F2E9');
  return resolved;
}

export function saveThemePreference(preference, store = globalThis.localStorage) {
  const safe = VALID.has(preference) ? preference : 'system';
  try { store?.setItem(THEME_KEY, safe); } catch { /* private mode */ }
  return safe;
}
