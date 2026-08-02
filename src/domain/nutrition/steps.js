import { estimateStepCalories } from './activity.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Шаги за день не содержат времени прогулки. Поэтому для тороида создаём
// локальную визуальную оценку, но не используем её для сдвига переваривания.
export function stepsActivity(steps, heightCm, source = 'phone') {
  const total = clamp(Math.round(Number(steps) || 0), 0, 200_000);
  if (!total) return null;
  const durationMin = clamp(Math.round(total / 100), 5, 240);
  return {
    type: 'walk_brisk',
    label: `${total.toLocaleString('ru-RU')} шагов`,
    intensity: 'moderate',
    durationMin,
    // Время распределено условно: у дневного итога трекера нет таймлайна.
    startMin: Math.round(clamp(720 - durationMin / 2, 0, 1440 - durationMin)),
    kcal: estimateStepCalories(total, heightCm),
    steps: total,
    source,
    dailySteps: true,
    estimatedTiming: true,
  };
}

export function canonicalStepsForDay(date, phoneStepsByDate = {}, activity = []) {
  const phone = Number(phoneStepsByDate?.[date]?.steps);
  if (phone > 0) return { steps: phone, source: phoneStepsByDate[date].source || 'телефон' };
  const entry = (activity || []).find((item) => Number(item?.payload?.steps) > 0);
  const steps = Number(entry?.payload?.steps);
  return steps > 0 ? { steps, source: entry.payload.source || 'журнал' } : null;
}
