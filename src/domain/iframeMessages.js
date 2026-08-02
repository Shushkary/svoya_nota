// Доменная граница для сообщений standalone-виджетов.
// UI доверяет только данным, прошедшим эту проверку; DOM/origin здесь не используются.

const finiteIn = (value, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const shortText = (value, max = 80) => (
  typeof value === 'string' ? value.trim().slice(0, max) : ''
);

export function parseNutritionMessage(data) {
  if (!data || typeof data !== 'object' || data.type !== 'nota-nutrition') return null;
  if (!Array.isArray(data.meals) || data.meals.length > 200) return null;

  const meals = [];
  for (const raw of data.meals) {
    if (!raw || typeof raw !== 'object') return null;
    const uid = shortText(raw.uid, 64);
    const hour = finiteIn(raw.hour, 0, 23.999);
    const kcal = finiteIn(raw.kcal, 0, 10_000);
    const protein = finiteIn(raw.p, 0, 1_000);
    const fat = finiteIn(raw.f, 0, 1_000);
    const carb = finiteIn(raw.c, 0, 1_000);
    if (!uid || hour === null || kcal === null || protein === null || fat === null || carb === null) return null;
    meals.push({
      uid,
      name: shortText(raw.name, 80) || 'Приём пищи',
      hour,
      kcal,
      p: protein,
      f: fat,
      c: carb,
    });
  }

  const started = Number(data.windowStartedAt);
  return {
    meals,
    preserveHistory: data.preserveHistory === true,
    windowStartedAt: Number.isFinite(started) && started > 0 ? started : null,
  };
}

export function parseSolarMessage(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'nota-open-profile') return { type: 'open-profile' };
  if (data.type !== 'nota-solar-session' || !data.session || typeof data.session !== 'object') return null;

  const s = data.session;
  const id = shortText(s.id, 64);
  const protocol = shortText(s.protocol, 40);
  const date = shortText(s.date, 40);
  const durationMs = finiteIn(s.durationMs, 0, 6 * 60 * 60 * 1000);
  if (!id || !protocol || durationMs === null || Number.isNaN(Date.parse(date))) return null;

  return {
    type: 'session',
    session: {
      id,
      protocol,
      date,
      durationMs,
      breaths: finiteIn(s.breaths, 0, 100_000) ?? 0,
      adherence: finiteIn(s.adherence, 0, 1),
      coherence: finiteIn(s.coherence, 0, 1),
      calmDelta: finiteIn(s.calmDelta, -4, 4),
    },
  };
}
