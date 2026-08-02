// Проверяемые наблюдения по журналу. Это ассоциации в данных пользователя,
// а не причинные, диагностические или медицинские выводы.
import { dayKey } from './loop.js';
import { representativeStateValues } from './stateCheckIn.js';

const MIN_PAIRS = 7;

function localDays(count, now) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (count - 1 - index));
    return { key: dayKey(date), date };
  });
}

function stateScore(entries) {
  const values = representativeStateValues(entries);
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function pearson(pairs) {
  if (pairs.length < 2) return null;
  const meanX = pairs.reduce((sum, pair) => sum + pair.x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair.y, 0) / pairs.length;
  let numerator = 0;
  let squareX = 0;
  let squareY = 0;
  for (const pair of pairs) {
    const dx = pair.x - meanX;
    const dy = pair.y - meanY;
    numerator += dx * dy;
    squareX += dx * dx;
    squareY += dy * dy;
  }
  const denominator = Math.sqrt(squareX * squareY);
  return denominator > 0 ? numerator / denominator : null;
}

function describe(id, title, pairs, lagDays) {
  const correlation = pearson(pairs);
  if (pairs.length < MIN_PAIRS) {
    return {
      id, title, lagDays, pairs: pairs.length, minimum: MIN_PAIRS,
      status: 'insufficient', text: `Пока данных мало. Заполните оба показателя ещё ${MIN_PAIRS - pairs.length} дн., и приложение сможет начать сравнение.`,
    };
  }
  if (correlation === null || Math.abs(correlation) < 0.3) {
    return {
      id, title, lagDays, pairs: pairs.length, minimum: MIN_PAIRS,
      status: 'no-signal', correlation,
      text: 'За выбранный период устойчивого повторения не видно. Это тоже полезный результат: пока записи не дают основания связывать эти показатели.',
    };
  }
  const magnitude = Math.abs(correlation);
  const strength = magnitude >= 0.7 ? 'часто' : magnitude >= 0.5 ? 'заметно' : 'иногда';
  return {
    id, title, lagDays, pairs: pairs.length, minimum: MIN_PAIRS,
    status: 'hypothesis', correlation,
    text: `В ваших записях показатели ${strength} менялись ${correlation > 0 ? 'в одну сторону' : 'в разные стороны'}. Продолжайте наблюдение: совпадение ещё не доказывает причину.`,
  };
}

export function journalHypotheses(journal, days = 28, now = new Date()) {
  const windowDays = localDays(days, now);
  const states = journal?.state || [];
  const activities = journal?.activity || [];
  const practices = journal?.practice || [];
  const statesByDay = new Map(windowDays.map(({ key }) => [
    key,
    stateScore(states.filter((entry) => dayKey(entry.at) === key)),
  ]));
  const practicesByDay = new Map(windowDays.map(({ key }) => [
    key,
    practices.filter((entry) =>
      dayKey(entry.at) === key && entry.payload?.completed !== false
    ).length,
  ]));

  const sleepPairs = [];
  const practicePairs = [];
  const laggedPracticePairs = [];
  for (let index = 0; index < windowDays.length; index += 1) {
    const { key } = windowDays[index];
    const state = statesByDay.get(key);
    if (state === null) continue;
    const sleepEntry = activities.find((entry) =>
      (entry.payload?.date || dayKey(entry.at)) === key
      && Number(entry.payload?.sleepHours) > 0
    );
    if (sleepEntry) sleepPairs.push({ x: Number(sleepEntry.payload.sleepHours), y: state });
    practicePairs.push({ x: practicesByDay.get(key), y: state });
    if (index > 0) {
      laggedPracticePairs.push({
        x: practicesByDay.get(windowDays[index - 1].key),
        y: state,
      });
    }
  }

  return {
    days,
    from: windowDays[0]?.key || null,
    to: windowDays.at(-1)?.key || null,
    observations: [
      describe('sleep-state', 'Сон и самочувствие в этот день', sleepPairs, 0),
      describe('practice-state', 'Практики и самочувствие в этот день', practicePairs, 0),
      describe('practice-next-state', 'Практики и самочувствие на следующий день', laggedPracticePairs, 1),
    ],
  };
}
