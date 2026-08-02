import { mealType } from '../../domain/nutrition/rhythm.js';

// Сценарий синхронизации iframe с журналом. Хранилище передаётся как порт `upsert`.
export function reconcileNutritionJournal({ journal, message, upsert, now = new Date() }) {
  let next = journal;
  const windowStartedAt = Number(message.windowStartedAt);
  const canReconcileWindow = !message.preserveHistory
    && Number.isFinite(windowStartedAt) && windowStartedAt > 0;
  const incomingIds = new Set(message.meals.map((meal) => `w-${meal.uid}`));

  for (const meal of message.meals) {
    const clientId = `w-${meal.uid}`;
    const at = new Date(now);
    const hour = Number.isFinite(Number(meal.hour)) ? Number(meal.hour) : 12;
    at.setHours(Math.floor(hour), Math.round((hour - Math.floor(hour)) * 60), 0, 0);
    next = upsert(next, 'meal', {
      description: meal.name || 'Приём пищи',
      kcal: Number(meal.kcal) || 0,
      proteinG: Number(meal.p) || 0,
      fatG: Number(meal.f) || 0,
      carbG: Number(meal.c) || 0,
      mealHour: meal.hour,
      mealType: mealType(meal.hour),
      source: 'nutrition_widget',
      nutritionWindowStartedAt: windowStartedAt,
      deleted: false,
    }, at.toISOString(), clientId).journal;
  }

  for (const [clientId, entry] of Object.entries(next.entries.meal || {})) {
    if (entry.payload.source === 'nutrition_widget'
      && canReconcileWindow
      && entry.payload.nutritionWindowStartedAt === windowStartedAt
      && entry.payload.deleted !== true
      && !incomingIds.has(clientId)) {
      next = upsert(
        next,
        'meal',
        { ...entry.payload, deleted: true },
        entry.at,
        clientId,
      ).journal;
    }
  }
  return next;
}
