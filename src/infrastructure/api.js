// API-клиент. Все вызовы необязательны: сеть недоступна → приложение живёт локально.

const BASE = import.meta.env.VITE_API_BASE || '/svoya-nota-app-api';
const TIMEOUT_MS = 20000;
const LLM_TIMEOUT_MS = 90000;

async function request(path, { method = 'GET', token, body, timeout = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `http_${response.status}`);
      error.code = data.error || `http_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => request('/health'),
  register: (version) => request('/api/register', {
    method: 'POST', body: { granted: true, version },
  }),
  sync: (token, entries) => request('/api/sync', { method: 'POST', token, body: { entries } }),
  snapshot: (token) => request('/api/snapshot', { token }),
  deleteMe: (token) => request('/api/me', { method: 'DELETE', token }),
  setAiConsent: (token, granted, version) =>
    request('/api/consents/ai', { method: 'PUT', token, body: { granted, version } }),
  setDataConsent: (token, granted, version) =>
    request('/api/consents/data', { method: 'PUT', token, body: { granted, version } }),
  estimateMeal: (token, description) =>
    request('/api/meals/estimate', { method: 'POST', token, body: { description }, timeout: LLM_TIMEOUT_MS }),
  analyzeMeal: (token, image, hint) =>
    request('/api/meals/analyze', { method: 'POST', token, body: { image, hint }, timeout: LLM_TIMEOUT_MS }),
  barcode: (token, code) =>
    request(`/api/products/barcode/${encodeURIComponent(code)}`, { token }),
};

export const ERROR_TEXT = {
  feature_disabled: 'ИИ-анализ на сервере выключен. Доступен ручной ввод и локальная оценка.',
  quota_exceeded: 'Дневной лимит ИИ-оценок исчерпан. Попробуйте завтра или введите вручную.',
  provider_unavailable: 'Модель сейчас недоступна. Попробуйте позже или введите вручную.',
  unauthorized: 'Нет связи с профилем на сервере. Данные сохранены локально.',
  bad_request: 'Код распознан не полностью. Проверьте цифры GTIN или сфотографируйте этикетку.',
};

export const errorText = (e) =>
  ERROR_TEXT[e?.code] || 'Нет соединения. Данные сохранены локально, всё продолжает работать.';
