const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const roundTo = (value, step = 1) => Math.round(value / step) * step;

// RFM — антропометрическая оценка доли жира по росту, талии и полу.
// Это не измерение состава тела: безжировая масса включает мышцы, воду,
// кости и органы, поэтому в интерфейсе мы не называем её «мышечной массой».
export function estimateReferenceMass({ weightKg, heightCm, waistCm, sex } = {}) {
  const weight = finite(weightKg);
  const height = finite(heightCm);
  const waist = finite(waistCm);
  if (!(weight > 0)) {
    return { kg: null, method: 'fallback', bodyFatPercent: null };
  }
  if (height > 0 && waist > 0 && ['m', 'f'].includes(sex)) {
    const bodyFatPercent = 64 - (20 * height / waist) + (sex === 'f' ? 12 : 0);
    // За пределами области правдоподобных значений оценка не используется.
    if (bodyFatPercent >= 5 && bodyFatPercent <= 60) {
      return {
        kg: Math.round(weight * (1 - bodyFatPercent / 100) * 10) / 10,
        method: 'rfm',
        bodyFatPercent: Math.round(bodyFatPercent * 10) / 10,
      };
    }
  }
  if (height > 0 && ['m', 'f'].includes(sex)) {
    const estimated = sex === 'm'
      ? 0.407 * weight + 0.267 * height - 19.2
      : 0.252 * weight + 0.473 * height - 48.3;
    if (estimated > weight * 0.4 && estimated <= weight) {
      return {
        kg: Math.round(estimated * 10) / 10,
        method: 'boer',
        bodyFatPercent: Math.round((1 - estimated / weight) * 1000) / 10,
      };
    }
  }
  return { kg: null, method: 'fallback', bodyFatPercent: null };
}

export function computeNutritionTargets({
  profile = {}, weightKg, waistCm, lowCarb = false, lowCarbWeek = 1,
  previousActivityKcal = 0,
} = {}) {
  const sex = profile?.sex === 'm' ? 'm' : profile?.sex === 'f' ? 'f' : null;
  const age = clamp(finite(profile?.age) || 34, 18, 100);
  const heightCm = finite(profile?.height);
  const weight = finite(weightKg);
  const reference = estimateReferenceMass({ weightKg: weight, heightCm, waistCm, sex });
  const referenceKg = reference.kg;

  let basalKcal = null;
  if (reference.method === 'rfm') basalKcal = 500 + 22 * referenceKg;
  else if (weight > 0 && heightCm > 0 && sex) {
    basalKcal = 10 * weight + 6.25 * heightCm - 5 * age + (sex === 'm' ? 5 : -161);
  }
  const activityKcal = clamp(finite(previousActivityKcal) || 0, 0, 1200);
  const kcal = basalKcal
    ? clamp(roundTo(basalKcal * 1.2 + activityKcal, 50), 1200, 4500)
    : 2200;

  const protein = referenceKg ? clamp(Math.round(referenceKg * 1.6), 50, 260) : 60;
  const week = clamp(Math.round(finite(lowCarbWeek) || 1), 1, 8);
  const carb = lowCarb
    ? Math.round(60 - (week - 1) * 2)
    : referenceKg ? clamp(Math.round(referenceKg * 3), 130, 320) : 200;
  const baseFat = referenceKg ? clamp(Math.round(referenceKg), 40, 140) : 70;
  const lowCarbFat = referenceKg
    ? clamp(Math.round((kcal - protein * 4 - carb * 4) / 9), Math.round(referenceKg * 0.8), Math.round(referenceKg * 2))
    : 100;
  const fat = lowCarb ? lowCarbFat : baseFat;
  const fiber = clamp(Math.round(kcal * 14 / 1000), 25, 50);
  const sodium = lowCarb ? 2300 : 2000;
  const potassium = sex === 'm' ? 3400 : sex === 'f' ? 2600 : 3500;
  const magnesium = sex === 'm' ? (age > 30 ? 420 : 400) : (age > 30 ? 320 : 310);

  const perReferenceKg = (value) => referenceKg ? Math.round(value / referenceKg * 100) / 100 : null;
  return {
    kcal, protein, fat, carb, fiber, sodium, potassium, magnesium,
    basis: {
      referenceKg,
      method: reference.method,
      bodyFatPercent: reference.bodyFatPercent,
      lowCarb,
      lowCarbWeek: week,
      rates: {
        kcalPerKg: perReferenceKg(kcal),
        proteinGPerKg: perReferenceKg(protein),
        fatGPerKg: perReferenceKg(fat),
        carbGPerKg: perReferenceKg(carb),
        fiberGPerKg: perReferenceKg(fiber),
        sodiumMgPerKg: perReferenceKg(sodium),
        potassiumMgPerKg: perReferenceKg(potassium),
        magnesiumMgPerKg: perReferenceKg(magnesium),
      },
    },
  };
}
