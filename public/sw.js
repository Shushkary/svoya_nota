/*
 * Своя нота · безопасная offline-shell стратегия.
 *
 * Кэшируем только оболочку приложения и статические файлы сборки. API,
 * пользовательские ответы и запросы с секретами всегда проходят напрямую
 * в сеть и никогда не попадают в Cache Storage.
 */
const CACHE_PREFIX = 'svoya-nota-';
const CACHE_VERSION = '2026-08-12.31';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${CACHE_VERSION}`;
const ACTIVE_CACHES = new Set([SHELL_CACHE, STATIC_CACHE]);
const LEGACY_CACHES = new Set(['nota-v7']);
const MAX_RUNTIME_ENTRIES = 80;

const scopeUrl = new URL(self.registration.scope);
const scopePath = scopeUrl.pathname.endsWith('/')
  ? scopeUrl.pathname
  : `${scopeUrl.pathname}/`;
const indexUrl = new URL('index.html', scopeUrl).toString();

const publicShellPaths = new Set(
  [
    'index.html',
    'manifest.webmanifest',
    'icon.svg',
    'icon-192.png',
    'icon-512.png',
    // Аудио для практики дыхания и юридические страницы («Ещё») открываются
    // из уже установленного приложения — без сети они не должны 404-иться.
    'audio/wim-hof-breathing.mp3',
    'legal.css',
    'license.html',
    'pricing.html',
    'privacy.html',
  ].map((path) => new URL(path, scopeUrl).pathname),
);

const secretQueryNames = new Set([
  'access_token',
  'api_key',
  'apikey',
  'authorization',
  'key',
  'secret',
  'signature',
  'token',
]);

function isInAppScope(url) {
  return url.origin === scopeUrl.origin && url.pathname.startsWith(scopePath);
}

function hasSecretQuery(url) {
  for (const name of url.searchParams.keys()) {
    if (secretQueryNames.has(name.toLowerCase())) return true;
  }
  return false;
}

function hasSecretHeaders(request) {
  return [
    'authorization',
    'proxy-authorization',
    'x-api-key',
    'x-backup-token',
    'x-openrouter-api-key',
  ].some((name) => request.headers.has(name));
}

function isApiOrSensitive(request, url) {
  return (
    /\/(?:api|svoya-nota-app-api)(?:\/|$)/i.test(url.pathname) ||
    hasSecretQuery(url) ||
    hasSecretHeaders(request)
  );
}

function isKnownStaticUrl(url) {
  return (
    isInAppScope(url) &&
    (publicShellPaths.has(url.pathname) ||
      url.pathname.startsWith(`${scopePath}assets/`))
  );
}

function responseCanBeCached(response) {
  if (!response || !response.ok || response.type === 'opaque') return false;
  const cacheControl = response.headers.get('cache-control') || '';
  return !/(?:^|,)\s*(?:no-store|private)(?:\s|,|$)/i.test(cacheControl);
}

async function putInCache(cacheName, request, response) {
  if (!responseCanBeCached(response)) return false;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return true;
}

async function fetchShellAsset(cache, url, required = false) {
  try {
    const request = new Request(url, {
      cache: 'reload',
      credentials: 'same-origin',
    });
    const response = await fetch(request);
    if (!responseCanBeCached(response)) {
      throw new Error(`Нельзя кэшировать ${url}`);
    }
    await cache.put(request, response.clone());
    return response;
  } catch (error) {
    if (required) throw error;
    return null;
  }
}

function referencedStaticUrls(html) {
  const urls = new Set();
  const attributePattern = /\b(?:src|href)\s*=\s*["']([^"'#]+)["']/gi;
  for (const match of html.matchAll(attributePattern)) {
    const url = new URL(match[1], indexUrl);
    if (isKnownStaticUrl(url) && !hasSecretQuery(url)) urls.add(url.toString());
  }
  return urls;
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const indexResponse = await fetchShellAsset(cache, indexUrl, true);
  const html = await indexResponse.clone().text();

  // Файлы с хешами Vite находим из реально развёрнутого index.html. Если
  // обязательный JS/CSS недоступен, новая версия SW не активируется частично.
  await Promise.all(
    [...referencedStaticUrls(html)].map((url) =>
      fetchShellAsset(cache, url, true),
    ),
  );

  const optionalUrls = [...publicShellPaths]
    .filter((pathname) => pathname !== new URL(indexUrl).pathname)
    .map((pathname) => new URL(pathname, scopeUrl.origin).toString());
  await Promise.allSettled(
    optionalUrls.map((url) => fetchShellAsset(cache, url, false)),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
});

// Активация выполняется стандартно после закрытия старых вкладок. При желании
// интерфейс может явно прислать SKIP_WAITING после согласия пользователя.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                LEGACY_CACHES.has(key) ||
                (key.startsWith(CACHE_PREFIX) && !ACTIVE_CACHES.has(key)),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function navigationResponse(request, url) {
  const isAppShell = url.pathname === scopePath || url.pathname === new URL(indexUrl).pathname;
  try {
    const response = await fetch(request);
    const contentType = response.headers.get('content-type') || '';
    if (isAppShell && contentType.includes('text/html') && responseCanBeCached(response)) {
      // Храним SPA-оболочку под одним каноническим ключом, без query string.
      await putInCache(SHELL_CACHE, indexUrl, response);
    }
    return response;
  } catch {
    const cached = isAppShell
      ? await caches.match(indexUrl, { ignoreSearch: true })
      : await caches.match(request, { ignoreSearch: false });
    return (
      cached ||
      new Response('Приложение пока не готово к работе без сети.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

async function trimRuntimeCache() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  const excess = keys.length - MAX_RUNTIME_ENTRIES;
  if (excess > 0) {
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  }
}

async function staticResponse(request) {
  const url = new URL(request.url);
  const isHashedBuildAsset = url.pathname.startsWith(`${scopePath}assets/`);

  if (isHashedBuildAsset) {
    const cached = await caches.match(request);
    if (cached) return cached;
  }

  try {
    const response = await fetch(request);
    if (await putInCache(STATIC_CACHE, request, response)) {
      await trimRuntimeCache();
    }
    return response;
  } catch {
    return (await caches.match(request)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isInAppScope(url) || isApiOrSensitive(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request, url));
    return;
  }

  if (isKnownStaticUrl(url)) {
    event.respondWith(staticResponse(request));
  }
});
