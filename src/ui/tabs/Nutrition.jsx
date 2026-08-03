import React, { useEffect, useMemo, useRef, useState } from 'react';
import { errorText, api } from '../../infrastructure/api.js';
import { prepareMealImage } from '../../infrastructure/image-processing.js';
import { aggregateMeals, clampMealTimestamp, combinedDigestiveLoad, digestionActivityAt, digestionFinishesBy, estimateDigestionHours, effectiveDigestionHours, estimateProcessing, mealTimestamp, nutrientProgress, processingScore, scaleMealPayload } from '../../domain/nutrition/meal.js';
import { computeNutritionTargets } from '../../domain/nutrition/targets.js';
import { estimateActivityNutritionImpact, findFreeActivityStart } from '../../domain/nutrition/activity.js';
import { formatHour, mealType, normalizeHour } from '../../domain/nutrition/rhythm.js';
import { parseGs1, isValidGtin } from '../../domain/barcode.js';
import { latestWeightKg } from '../../infrastructure/weight.js';
import { latestWaistCm } from '../../infrastructure/bodyStorage.js';
import { loadPhoneSteps, savePhoneSteps } from '../../infrastructure/phoneSteps.js';
import { canonicalStepsForDay, stepsActivity } from '../../domain/nutrition/steps.js';
import { Card, Sheet } from '../components.jsx';
import ToroidCanvas from '../ToroidCanvas.jsx';
import WellnessPrefs from '../WellnessPrefs.jsx';
import FoodCatalogPicker from '../FoodCatalogPicker.jsx';
import { sumFoodComponents } from '../../domain/nutrition/foodCatalog.js';

const emptyForm = () => ({
  name: '', time: new Date().toTimeString().slice(0, 5), kcal: '', proteinG: '', fatG: '', carbG: '', fiberG: '', sodiumMg: '', potassiumMg: '', magnesiumMg: '',
});

const number = (value, max = 10_000) => Math.max(0, Math.min(max, Number(value) || 0));
const currentMealMinute = (now = new Date()) => now.getHours() * 60 + now.getMinutes();
const localDay = (value) => {
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function atFromTime(time, now = new Date()) {
  const [hours = 12, minutes = 0] = String(time).split(':').map(Number);
  const timestamp = new Date(now);
  timestamp.setHours(hours, minutes, 0, 0);
  return timestamp;
}

function formFromEstimate(result, fallbackName, source, mealMinute) {
  const confidence = Math.max(0.05, Math.min(0.95, Number(result.confidence) || 0.5));
  const floor = source === 'ai_photo' ? 0.3 : 0.2;
  const uncertainty = Math.max(floor, Math.min(0.55, 0.18 + (1 - confidence) * 0.45));
  const kcal = number(result.kcal);
  const fiber = number(result.fiberG, 1000);
  const sodium = number(result.sodiumMg, 20_000);
  const potassium = number(result.potassiumMg, 20_000);
  const magnesium = number(result.magnesiumMg, 5_000);
  const originalEstimate = {
    description: result.description || fallbackName || 'приём', kcal,
    proteinG: number(result.proteinG, 1000), fatG: number(result.fatG, 1000),
    carbG: number(result.carbG, 1000), fiberG: fiber, sodiumMg: sodium, potassiumMg: potassium, magnesiumMg: magnesium, confidence,
  };
  return {
    ...emptyForm(), time: formatHour(mealMinute / 60), name: originalEstimate.description,
    kcal, proteinG: originalEstimate.proteinG, fatG: originalEstimate.fatG,
    carbG: originalEstimate.carbG, fiberG: fiber,
    sodiumMg: sodium, potassiumMg: potassium, magnesiumMg: magnesium,
    confidence, source, originalEstimate,
    estimateRange: [Math.round(kcal * (1 - uncertainty)), Math.round(kcal * (1 + uncertainty))],
    trialRemaining: result.trialRemaining,
  };
}

function entryMeal(entry) {
  const payload = entry.payload || {};
  const at = new Date(entry.at);
  const hour = Number.isFinite(Number(payload.mealHour))
    ? Number(payload.mealHour)
    : at.getHours() + at.getMinutes() / 60;
  return {
    id: entry.clientId,
    entry,
    name: payload.description || 'Приём пищи',
    hour,
    kcal: number(payload.kcal),
    p: number(payload.proteinG, 1000),
    f: number(payload.fatG, 1000),
    c: number(payload.carbG, 1000),
    fiber: number(payload.fiberG, 1000),
    sodium: number(payload.sodiumMg, 20_000),
    potassium: number(payload.potassiumMg, 20_000),
    magnesium: number(payload.magnesiumMg, 5_000),
    eatenAt: at.getTime(),
    digestionH: number(payload.digestionH, 12) || undefined,
    confidence: payload.confidence,
  };
}

function macroShare({ p, f, c }) {
  const calories = Math.max(1, p * 4 + f * 9 + c * 4);
  return { protein: (p * 4 / calories) * 100, fat: (f * 9 / calories) * 100, carbs: (c * 4 / calories) * 100 };
}

function Axis({ label, value, confidence = 'оценка' }) {
  const position = Math.max(2, Math.min(98, Number(value) * 100 || 0));
  return <div className="n-axis"><div className="n-axis-head"><span>{label}</span><b>{confidence}</b></div><div className="n-track"><i className="n-band" /><i className="n-marker" style={{ left: `${position}%` }} /></div></div>;
}

function NutrientRing({ label, value, target, unit = '', color = '#4A7C7E', onClick }) {
  const { ratio, percent } = nutrientProgress(value, target);
  const circumference = 2 * Math.PI * 17;
  const inner = (<><svg viewBox="0 0 42 42" className="n-ring-svg" aria-hidden="true"><circle cx="21" cy="21" r="17" fill="none" stroke="var(--line)" strokeWidth="3" /><circle cx="21" cy="21" r="17" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" transform="rotate(-90 21 21)" strokeDasharray={`${ratio * circumference} ${circumference}`} /><text x="21" y="24" textAnchor="middle">{percent}%</text></svg><span>{label}</span><small>{Math.round(value)}/{target}{unit ? ` ${unit}` : ''}</small></>);
  if (onClick) return <button type="button" className="n-ring-cell n-ring-btn" onClick={onClick}>{inner}</button>;
  return <div className="n-ring-cell">{inner}</div>;
}

const ACTIVITY = {
  walk_brisk: ['ходьба (бодро)', 3.8], walk_low: ['ходьба (спокойно)', 2.8], run: ['бег', 9.8],
  cycling: ['велосипед', 7], strength: ['силовая', 5], hiit: ['интервальная (HIIT)', 9], yoga: ['йога', 2.5],
  swim: ['плавание', 8.0], banya: ['баня', 2.0],
};

const MINERALS = [
  { key: 'sodium', label: 'натрий', unit: 'мг', color: '#B0685C',
    src: 'Кольцо показывает долю верхнего ориентира, а не цель, которую обязательно нужно набрать.' },
  { key: 'potassium', label: 'калий', unit: 'мг', color: '#5D8A6E',
    src: 'Суточный ориентир для взрослого задаётся по полу, а не линейно по массе тела.' },
  { key: 'magnesium', label: 'магний', unit: 'мг', color: '#8A6F4D',
    src: 'Суточный ориентир для взрослого задаётся по полу и возрасту, а не линейно по массе тела.' },
];

function TargetInfo({ info, targets, total }) {
  const values = {
    kcal: total.kcal, protein: total.p, fat: total.f, carb: total.c, fiber: total.fiber,
    sodium: total.sodium, potassium: total.potassium, magnesium: total.magnesium,
  };
  const value = values[info.key] || 0;
  const target = targets[info.key];
  const basis = targets.basis;
  const rateKey = {
    kcal: 'kcalPerKg', protein: 'proteinGPerKg', fat: 'fatGPerKg', carb: 'carbGPerKg',
    fiber: 'fiberGPerKg', sodium: 'sodiumMgPerKg', potassium: 'potassiumMgPerKg', magnesium: 'magnesiumMgPerKg',
  }[info.key];
  const rate = basis.rates[rateKey];
  const activityAdditions = {
    kcal: basis.activityImpact.energyKcal,
    protein: basis.activityImpact.proteinG,
    fat: basis.activityImpact.fatG,
    carb: basis.activityImpact.carbG,
    fiber: basis.activityImpact.fiberG,
    sodium: basis.activityImpact.sodiumMg,
    potassium: basis.activityImpact.potassiumMg,
    magnesium: basis.activityImpact.magnesiumMg,
  };
  const activityAddition = activityAdditions[info.key] || 0;
  const referenceText = basis.method === 'rfm'
    ? `Опорная масса ${basis.referenceKg} кг — расчётная безжировая масса: вес без оценённой жировой доли ${basis.bodyFatPercent}%. Оценка RFM использует рост, талию и пол.`
    : basis.method === 'boer'
      ? `Опорная масса ${basis.referenceKg} кг — запасная оценка безжировой массы по формулам Boer из веса, роста и пола. Добавьте талию, чтобы приложение использовало оценку RFM.`
      : 'Вес не указан: показан общий справочный ориентир. Добавьте вес в «Самонаблюдении тела», а рост и пол — в профиле.';
  const commonRate = rate != null
    ? `${rate} ${info.key === 'kcal' ? 'ккал' : ['sodium', 'potassium', 'magnesium'].includes(info.key) ? 'мг' : 'г'}/кг расчётной массы.`
    : null;

  return <>
    <p className="dim small">{value ? `${Math.round(value)} ${info.unit} за сегодня · ` : 'Нет данных за сегодня · '}расчётный ориентир {target} {info.unit}.</p>
    {['kcal', 'protein', 'fat', 'carb', 'fiber'].includes(info.key) && <p className="dim small">{referenceText}</p>}
    {commonRate && <p className="dim small">Эквивалент текущего расчёта: {commonRate}</p>}
    {activityAddition > 0 && <div className="n-activity-impact"><b>Активность учтена</b><span>базовый ориентир: {basis.baseTargets[info.key]} {info.unit}</span><span>добавлено по модели расхода: +{Math.round(activityAddition * 10) / 10} {info.unit}</span><span>итого для кольца: {target} {info.unit}</span></div>}

    {info.key === 'kcal' && <p className="dim small">Энергия оценивается по основному обмену: по безжировой массе, когда доступны талия и профиль; иначе по формуле Миффлина—Сан Жеора. Добавляется спокойный коэффициент повседневной активности и активность, внесённая за текущий день. Это стартовый ориентир, а не цель снижения веса.</p>}
    {info.key === 'protein' && <>
      <p className="dim small">Формула приложения: 1,6 г × кг расчётной безжировой массы. Жировая доля не увеличивает цель. Безжировая масса включает не только мышцы, но также воду, кости и органы — приложение не выдаёт её за измеренную мышечную массу.</p>
      <p className="dim small">Важно: метаанализ 1,6 г/кг относится к общей массе тела у здоровых взрослых с силовыми тренировками. Расчёт по безжировой массе — более консервативная адаптация приложения, а не дословная норма исследования.</p>
    </>}
    {info.key === 'fat' && <p className="dim small">В обычном режиме стартовый ориентир близок к 1 г/кг расчётной массы. В низкоуглеводном режиме жиры заполняют оставшуюся энергию после белка и выбранного уровня углеводов; значение ограничено диапазоном 0,8–2 г/кг.</p>}
    {info.key === 'carb' && <p className="dim small">В обычном режиме стартовый ориентир — около 3 г/кг расчётной массы. При включённом низкоуглеводном переходе кольцо синхронизируется со шкалой: от 60 до 46 г/день за восемь недель.</p>}
    {info.key === 'fiber' && <p className="dim small">Клетчатка не расходуется мышцами. Активность увеличивает энергетический ориентир, поэтому связанный ориентир клетчатки пересчитывается как 14 г на 1000 ккал. Повышать количество лучше постепенно и вместе с достаточным питьём.</p>}
    {info.key === 'sodium' && <>
      <p className="dim small">{basis.lowCarb ? 'Низкоуглеводный режим включён: базовый верхний ориентир — 2300 мг. В начале ограничения углеводов возможна краткая потеря натрия, но клинический консенсус рекомендует добавлять соль только при симптомах гипотонии и отсутствии противопоказаний.' : 'Обычный режим: базовый предел ВОЗ — менее 2000 мг натрия в день (примерно 5 г соли).'}</p>
      {basis.activityImpact.sodiumMg > 0 && <p className="dim small">Добавка к кольцу — приблизительная компенсация потерь с потом, а не разрешение употребить больше соли. Без измерения изменения массы тела и состава пота ошибка может быть большой.</p>}
      <p className="dim small">При гипертонии, болезнях почек или сердца, отёках, беременности либо приёме мочегонных ориентир должен определять врач.</p>
    </>}
    {info.key === 'potassium' && <p className="dim small">Базовый ориентир National Academies для взрослых: 3400 мг/день для мужчин и 2600 мг/день для женщин. Добавка активности — грубая оценка потерь с потом. При болезнях почек и лекарствах, влияющих на калий, нужна консультация врача.</p>}
    {info.key === 'magnesium' && <p className="dim small">Базовый RDA для взрослых: 400–420 мг/день для мужчин и 310–320 мг/день для женщин в зависимости от возраста. Добавка активности — грубая оценка потерь с потом. Официальный ориентир не масштабируется линейно по килограммам.</p>}

    <p className="eyebrow" style={{ marginTop: 14 }}>Методика и источники</p>
    <div className="linkrow">
      {['kcal', 'protein', 'fat', 'carb', 'fiber'].includes(info.key) && <><a href="https://pubmed.ncbi.nlm.nih.gov/30030479/" target="_blank" rel="noopener noreferrer">RFM: оценка доли жира по росту и талии</a><a href="https://pubmed.ncbi.nlm.nih.gov/6496691/" target="_blank" rel="noopener noreferrer">Boer: запасная оценка безжировой массы</a></>}
      {info.key === 'kcal' && <><a href="https://pubmed.ncbi.nlm.nih.gov/7435418/" target="_blank" rel="noopener noreferrer">Cunningham: основной обмен и безжировая масса</a><a href="https://pubmed.ncbi.nlm.nih.gov/2305711/" target="_blank" rel="noopener noreferrer">Mifflin—St Jeor: запасная формула</a></>}
      {info.key === 'protein' && <a href="https://bjsm.bmj.com/content/52/6/376" target="_blank" rel="noopener noreferrer">Метаанализ белка и силовых тренировок</a>}
      {['kcal', 'protein', 'fat', 'carb'].includes(info.key) && <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC5766985/" target="_blank" rel="noopener noreferrer">Интенсивность и выбор топлива при нагрузке</a>}
      {info.key === 'fiber' && <a href="https://nap.nationalacademies.org/catalog/10490/" target="_blank" rel="noopener noreferrer">National Academies: клетчатка</a>}
      {info.key === 'sodium' && <><a href="https://www.who.int/publications/i/item/9789241504836" target="_blank" rel="noopener noreferrer">ВОЗ: натрий у взрослых</a><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC8610544/" target="_blank" rel="noopener noreferrer">Международный консенсус по кетогенным диетам</a></>}
      {info.key === 'potassium' && <a href="https://nap.nationalacademies.org/read/25353/chapter/8" target="_blank" rel="noopener noreferrer">National Academies: калий</a>}
      {info.key === 'magnesium' && <a href="https://www.ncbi.nlm.nih.gov/books/NBK109816/" target="_blank" rel="noopener noreferrer">National Academies: магний</a>}
      {['sodium', 'potassium', 'magnesium'].includes(info.key) && <a href="https://pubmed.ncbi.nlm.nih.gov/28332116/" target="_blank" rel="noopener noreferrer">Вариабельность пота и потерь натрия</a>}
    </div>
  </>;
}

// Справочные рекомендации по активности и питанию (раздел «Активности»).
// Текст прошёл проверку на соответствие §2.1/§3.2 спец. «Вариант D» и РФ-закону:
// без «висцеральный жир», инсулина, кетонов, печени и иных мед. утверждений.
const ACTIVITY_TIPS = {
  disclaimer: 'Выберите посильный следующий шаг. Даже немного движения полезнее, чем его отсутствие; самочувствие и безопасность важнее цифры.',
  walking: {
    title: 'Движение без гонки за идеалом',
    steps: [
      'Ориентир ВОЗ для взрослых: 150–300 минут умеренной активности в неделю или 75–150 минут интенсивной, плюс силовые упражнения не реже 2 дней в неделю.',
      'Не обязательно сразу стремиться к 10 000 шагов. Крупные наблюдательные исследования связывают пользу уже с меньшим числом; удобнее прибавлять понемногу к своему обычному уровню.',
      'Если долго сидите, время от времени встаньте и немного пройдитесь. Короткие отрезки тоже входят в общую активность.',
      'После еды спокойная короткая прогулка может уменьшить кратковременный подъём глюкозы. Это необязательный вариант: идите только если вам комфортно.',
    ],
  },
  nutrition: {
    title: 'Питание: разнообразие важнее строгости',
    steps: [
      'Основа — разнообразные продукты с минимальной обработкой: овощи, фрукты, бобовые, цельные злаки, орехи и подходящие вам источники белка.',
      'Для людей старше 10 лет ВОЗ указывает ориентиры не менее 400 г овощей и фруктов и не менее 25 г пищевых волокон в день.',
      'Натрий лучше оценивать по этикетке и добавленной соли: ориентир ВОЗ для взрослых — менее 2000 мг натрия в день. При заболеваниях почек или сердца индивидуальные ограничения обсуждают с врачом.',
    ],
  },
  water: {
    title: 'Вода и восстановление',
    steps: [
      'Пейте регулярно, ориентируясь на жажду, погоду, активность и самочувствие. Универсальная точная норма подходит не всем.',
      'При боли в груди, выраженной одышке, головокружении или необычной слабости остановитесь; при необходимости обратитесь за медицинской помощью.',
    ],
  },
  sources: [
    ['ВОЗ: физическая активность и малоподвижность', 'https://www.who.int/publications/i/item/9789240015128'],
    ['ВОЗ: принципы здорового питания', 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet'],
    ['Шаги и смертность: метаанализ 15 когорт', 'https://pubmed.ncbi.nlm.nih.gov/35247352/'],
    ['Прогулка после еды: систематический обзор', 'https://pubmed.ncbi.nlm.nih.gov/36715875/'],
  ],
};

// Торион · Mineral Matrix — состав с torion.su (1 стик, 8 г, в 400–500 мл воды).
// Вместо сока лимона — криопорошок цельного лимона (ИК-сушка + криопомол).
// КБЖУ приблизительное: калорийность даёт в основном инулин (ферментируемая
// клетчатка, ~2 ккал/г); белков, жиров и сахара нет. Минералы — по этикетке.
const TORION = Object.freeze({
  name: 'Торион · Mineral Matrix',
  kcal: 6, proteinG: 0, fatG: 0, carbG: 0.3, fiberG: 2.7,
  sodiumMg: 500, potassiumMg: 608, magnesiumMg: 200,
});

// Постоянный пресет: его можно добавить или повторить с другой порцией, но нельзя
// скрыть из блока. entry нужен для repeatMeal без реальной записи в журнале.
const torionMeal = {
  name: TORION.name,
  kcal: TORION.kcal, p: TORION.proteinG, f: TORION.fatG, c: TORION.carbG, fiber: TORION.fiberG,
  sodium: TORION.sodiumMg, potassium: TORION.potassiumMg, magnesium: TORION.magnesiumMg,
  confidence: null,
  entry: { clientId: 'torion-preset', payload: {
    description: TORION.name, kcal: TORION.kcal, proteinG: TORION.proteinG, fatG: TORION.fatG,
    carbG: TORION.carbG, fiberG: TORION.fiberG,
    sodiumMg: TORION.sodiumMg, potassiumMg: TORION.potassiumMg, magnesiumMg: TORION.magnesiumMg,
    mealHour: 12, mealType: 'обед', digestionH: estimateDigestionHours({ kcal: TORION.kcal, f: TORION.fatG, p: TORION.proteinG, c: TORION.carbG, fiber: TORION.fiberG }),
    confidence: null, source: 'draft_torion', deleted: false,
  } },
};

function MealForm({ value, onChange, onSave, onClose, onRecalculate, onCatalogAdd, onCatalogRemove, title, busy, notice }) {
  const provenanceKey = { kcal: 'kcal', proteinG: 'protein_g', fatG: 'fat_g', carbG: 'carbs_g', fiberG: 'fiber_g', sodiumMg: 'sodium_mg', potassiumMg: 'potassium_mg', magnesiumMg: 'magnesium_mg' };
  const field = (key, label, options = {}) => (
    <label className="fl" key={key}>{label}
      <input {...options} value={value[key]} onChange={(event) => onChange({
        ...value,
        [key]: event.target.value,
        ...(provenanceKey[key] ? { nutritionProvenance: { ...(value.nutritionProvenance || {}), [provenanceKey[key]]: ['manual'] } } : {}),
      })} />
    </label>
  );
  return (
    <Sheet onClose={onClose}>
      <button className="tbtn" onClick={onClose}>← Закрыть</button>
      <h2>{title}</h2>
      <p className="dim small">ИИ даёт ориентир. Перед сохранением можно исправить название, состав, время, КБЖУ и минералы.</p>
      <FoodCatalogPicker onAdd={onCatalogAdd} />
      {value.components?.length > 0 && <div className="meal-components"><p><b>Состав из таблиц</b></p>{value.components.map((component, index) => <div key={`${component.foodId}-${index}`}><span>{component.foodName} · {component.portionG} г</span><button type="button" onClick={() => onCatalogRemove(index)} aria-label={`Убрать ${component.foodName}`}>×</button></div>)}</div>}
      {value.estimateRange && <p className="estimate-review"><b>Предварительно: {value.estimateRange[0]}–{value.estimateRange[1]} ккал</b><span>Проверьте порцию, масло и соусы.{Number.isFinite(Number(value.trialRemaining)) ? ` Осталось пробных фото: ${value.trialRemaining}.` : ''}</span></p>}
      {field('name', 'Состав блюда', { type: 'text', maxLength: 250, placeholder: 'Например: яичница из 3 яиц на топлёном масле с зеленью' })}
      <div className="formrow">
        {field('time', 'Время приёма', { type: 'time', max: formatHour(currentMealMinute() / 60) })}
        {field('kcal', 'Ккал', { type: 'number', inputMode: 'numeric', min: 0, max: 10000 })}
      </div>
      <div className="formrow">
        {field('proteinG', 'Белки, г', { type: 'number', inputMode: 'decimal', min: 0, max: 1000, step: '0.1' })}
        {field('fatG', 'Жиры, г', { type: 'number', inputMode: 'decimal', min: 0, max: 1000, step: '0.1' })}
        {field('carbG', 'Углеводы, г', { type: 'number', inputMode: 'decimal', min: 0, max: 1000, step: '0.1' })}
      </div>
      {field('fiberG', 'Клетчатка, г', { type: 'number', inputMode: 'decimal', min: 0, max: 1000, step: '0.1' })}
      {field('sodiumMg', 'Натрий, мг', { type: 'number', inputMode: 'decimal', min: 0, max: 20000, step: '1' })}
      {field('potassiumMg', 'Калий, мг', { type: 'number', inputMode: 'decimal', min: 0, max: 20000, step: '1' })}
      {field('magnesiumMg', 'Магний, мг', { type: 'number', inputMode: 'decimal', min: 0, max: 5000, step: '1' })}

      {onRecalculate && <button className="n-action ghost" disabled={busy || !value.name.trim()} onClick={onRecalculate}>{busy ? 'Пересчитываю…' : 'Пересчитать КБЖУ и минералы'}</button>}
      {notice && <p className="n-notice" role="status">{notice}</p>}
      <button className="btn" disabled={busy || !value.name.trim()} onClick={onSave}>{String(value.source || '').startsWith('ai_') ? 'Подтвердить и сохранить' : 'Сохранить приём'}</button>
    </Sheet>
  );
}

export default function Nutrition({ lists, addEntry, updateEntry, token, aiConsent }) {
  const inputRef = useRef(null);
  const labelInputRef = useRef(null);
  const barcodeInputRef = useRef(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [repeatTarget, setRepeatTarget] = useState(null);
  const [repeatFactor, setRepeatFactor] = useState(1);
  const [deleteYesterdayTarget, setDeleteYesterdayTarget] = useState(null);
  const [notice, setNotice] = useState('');
  const [formNotice, setFormNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [torionInfo, setTorionInfo] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [barcodeInfo, setBarcodeInfo] = useState(null);
  const [barcodeMiss, setBarcodeMiss] = useState(false);
  const [barcodeIdentity, setBarcodeIdentity] = useState(null);
  const [grams, setGrams] = useState('100');
  const [clock, setClock] = useState(Date.now());
  const [description, setDescription] = useState('');
  const [mealMinute, setMealMinute] = useState(currentMealMinute);
  const [mealMinuteTouched, setMealMinuteTouched] = useState(false);
  const [molOpen, setMolOpen] = useState(false);
  const [actType, setActType] = useState('walk_brisk');
  const [actIntensity, setActIntensity] = useState('moderate');
  const [actDuration, setActDuration] = useState(30);
  const [actStartMinute, setActStartMinute] = useState(currentMealMinute);
  const [activityTimeTouched, setActivityTimeTouched] = useState(false);
  const [actualSteps, setActualSteps] = useState('');
  const [editingActivity, setEditingActivity] = useState(null);
  const [lowCarb, setLowCarb] = useState(false);
  const [lowCarbWeek, setLowCarbWeek] = useState(1);
  const [selectedDay, setSelectedDay] = useState(6);
  const [showToroidInfo, setShowToroidInfo] = useState(false);
  const [ringInfo, setRingInfo] = useState(null);
  const [activityTips, setActivityTips] = useState(false);

  useEffect(() => {
    const refreshClock = () => {
      const now = new Date();
      setClock(now.getTime());
      if (!mealMinuteTouched) setMealMinute(currentMealMinute(now));
      if (!activityTimeTouched && !editingActivity) setActStartMinute(currentMealMinute(now));
    };
    const timer = window.setInterval(refreshClock, 60_000);
    return () => window.clearInterval(timer);
  }, [activityTimeTouched, editingActivity, mealMinuteTouched]);

  const today = useMemo(() => localDay(clock), [clock]);
  const meals = useMemo(() => lists.meal
    .filter((entry) => !entry.payload?.deleted && localDay(entry.at) === today)
    .map(entryMeal)
    .sort((left, right) => left.hour - right.hour), [lists.meal, today]);
  const activities = useMemo(() => lists.activity
    .filter((entry) => !entry.payload?.deleted && localDay(entry.at) === today)
    .sort((left, right) => Number(left.payload?.startMin || 0) - Number(right.payload?.startMin || 0)), [lists.activity, today]);
  const total = useMemo(() => aggregateMeals(meals), [meals]);
  const noise = useMemo(() => combinedDigestiveLoad(meals, new Date(clock), activities), [meals, clock, activities]);
  const share = macroShare(total);
  const processing = processingScore(meals);
  const profile = lists.profile?.find((entry) => !entry.payload?.deleted)?.payload || {};
  const dailySteps = canonicalStepsForDay(today, { [today]: loadPhoneSteps(today) }, activities);
  const stepVisualActivity = stepsActivity(dailySteps?.steps, Number(profile.height) || 170, dailySteps?.source);
  // У итоговых шагов нет достоверного времени. Не смешиваем их с реальными
  // тренировками при расчёте влияния на приём пищи и не считаем дважды.
  const timedActivities = activities.filter((entry) => !entry.payload?.dailySteps);
  const visualActivities = stepVisualActivity
    ? [...timedActivities, { payload: stepVisualActivity, clientId: `steps-${today}` }]
    : timedActivities;
  const weightKg = latestWeightKg();
  const waistCm = latestWaistCm();
  const activityImpact = estimateActivityNutritionImpact(
    visualActivities.map((entry) => entry.payload || {}),
    { weightKg: weightKg || 70, lowCarb },
  );
  const targets = computeNutritionTargets({
    profile, weightKg, waistCm, lowCarb, lowCarbWeek,
    activityImpact,
  });
  const expenditure = activityImpact.energyKcal;
  const molIndex = (() => { const hour = new Date(clock).getHours() + new Date(clock).getMinutes() / 60; return hour >= 7 && hour < 13 ? 0 : hour >= 13 && hour < 19 ? 1 : hour >= 19 || hour < 1 ? 2 : 3; })();
  const molPhases = [
    ['Пробуждение ритма', '07:00–13:00', 'Внутренние часы встречают день: система CLOCK–BMAL1 помогает клеткам включать дневные программы. Организм бодро настраивается на свет, движение и регулярные приёмы пищи.'],
    ['Дневной ход', '13:00–19:00', 'Белки PER и CRY понемногу собираются — словно стрелки внутренних часов движутся дальше. Дневной ритм продолжается, а тело спокойно использует поступившую энергию.'],
    ['Вечернее замедление', '19:00–01:00', 'PER и CRY приглушают активность CLOCK–BMAL1. Это естественный поворот к более тихому вечеру: меньше спешки, мягче свет и спокойнее темп.'],
    ['Ночное обновление', '01:00–07:00', 'Накопленные белки постепенно распадаются, прежнее торможение уходит. Внутренние часы освобождают место для нового ясного цикла утром.'],
  ];
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(clock); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - (6 - index));
    const key = localDay(date);
    const entries = lists.meal.filter((entry) => !entry.payload?.deleted && localDay(entry.at) === key);
    return { key, label: index === 6 ? 'сег' : date.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', ''), kcal: entries.reduce((sum, entry) => sum + number(entry.payload?.kcal), 0), fiber: entries.reduce((sum, entry) => sum + number(entry.payload?.fiberG), 0), current: index === 6 };
  }), [clock, lists.meal]);

  const draftYKey = useMemo(() => { const y = new Date(clock); y.setDate(y.getDate() - 1); return localDay(y); }, [clock]);
  const draftMeals = useMemo(() => lists.meal
    .filter((e) => !e.payload?.deleted && localDay(e.at) === draftYKey)
    .map(entryMeal)
    .sort((a, b) => a.hour - b.hour), [lists.meal, draftYKey]);
  const copiedFromYesterday = useMemo(() => new Set(
    meals.map((meal) => meal.entry.payload?.copiedFrom).filter(Boolean),
  ), [meals]);

  const torusSegments = [...meals.map((meal, index) => {
    const level = Math.min(1, (meal.kcal / 700 + meal.f / 35) / 2);
    const digestionH = effectiveDigestionHours(meal, timedActivities);
    const frac = digestionActivityAt(meal, new Date(clock), digestionH);
    return {
      start: normalizeHour(meal.hour) / 24 * Math.PI * 2,
      // дуга переваривания — как в эталоне: (digestionH / 24) * TAU, без обрезки
      span: Math.max(0.05, digestionH / 24 * Math.PI * 2),
      // Жёлтая сетка означает, что по текущему прогнозу переваривание
      // завершится к 18:00. Активность уже учтена в effectiveDigestionHours.
      late: !digestionFinishesBy(meal.hour, digestionH, 18),
      level, load: level, isActivity: false,
      fuel: Math.max(0, Math.min(1, (meal.c || 0) / ((meal.c || 0) + (meal.f || 0) + 1))),
      color: index % 2 ? '#B0685C' : '#4E8070',
      digestionH, frac,
    };
  }), ...visualActivities.map((entry) => ({ start: number(entry.payload?.startMin, 1440) / 1440 * Math.PI * 2, span: number(entry.payload?.durationMin, 1440) / 1440 * Math.PI * 2, level: .45, load: .45, isActivity: true, color: '#4A7C7E' }))];

  const save = () => {
    if (!form?.name.trim()) return;
    const now = new Date();
    const requestedAt = atFromTime(form.time, now);
    const wasFuture = requestedAt.getTime() > now.getTime();
    const at = new Date(clampMealTimestamp(requestedAt, now));
    const hour = at.getHours() + at.getMinutes() / 60;
    const draft = { name: form.name.trim(), kcal: number(form.kcal), p: number(form.proteinG, 1000), f: number(form.fatG, 1000), c: number(form.carbG, 1000), fiber: number(form.fiberG, 1000), sodium: number(form.sodiumMg, 20000), potassium: number(form.potassiumMg, 20000), magnesium: number(form.magnesiumMg, 5000) };
    const payload = {
      description: draft.name, kcal: draft.kcal, proteinG: draft.p, fatG: draft.f, carbG: draft.c, fiberG: draft.fiber, sodiumMg: draft.sodium, potassiumMg: draft.potassium, magnesiumMg: draft.magnesium,
      mealHour: hour, mealType: mealType(hour), digestionH: estimateDigestionHours(draft),
      processing: estimateProcessing(draft.name, form.confidence), confidence: form.confidence ?? null,
      source: form.source || 'manual', deleted: false,
      copiedFrom: form.copiedFrom || editing?.entry.payload?.copiedFrom || null,
      originalEstimate: form.originalEstimate || editing?.entry.payload?.originalEstimate || null,
      components: form.components || editing?.entry.payload?.components || [],
      nutritionProvenance: form.nutritionProvenance || editing?.entry.payload?.nutritionProvenance || {},
      userConfirmed: String(form.source || '').startsWith('ai_') || editing?.entry.payload?.userConfirmed || false,
      confirmedAt: String(form.source || '').startsWith('ai_') ? new Date().toISOString() : editing?.entry.payload?.confirmedAt || null,
    };
    if (editing) updateEntry('meal', editing.entry.clientId, { ...editing.entry.payload, ...payload }, at.toISOString());
    else addEntry('meal', payload, at.toISOString());
    // Пересчитываем тороид теми же часами, которыми ограничили время приёма.
    // Иначе минутный UI-таймер может ещё считать только что сохранённую запись «будущей».
    setClock(now.getTime());
    setNotice(wasFuture
      ? 'Будущее время заменено текущим: фактический приём не может быть записан заранее.'
      : editing ? 'Приём обновлён.' : 'Приём добавлен в дневной ритм.');
    setForm(null);
    setEditing(null);
    setFormNotice('');
  };

  const estimateDescription = async () => {
    if (!description.trim()) return;
    if (!token || !aiConsent) { setNotice('Для ИИ-оценки включите согласие и синхронизацию в разделе «Ещё».'); return; }
    setBusy(true);
    try {
      const result = await api.estimateMeal(token, description.trim());
      setFormNotice('');
      setForm(formFromEstimate(result, description.trim(), 'ai_text', mealMinute));
      setNotice(result.comment || 'Оценка готова — проверьте и сохраните.');
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const resetActivityForm = () => {
    setEditingActivity(null);
    setActStartMinute(currentMealMinute());
    setActivityTimeTouched(false);
  };

  const applyCatalogComponents = (components) => {
    const totals = sumFoodComponents(components);
    const provenance = {};
    for (const component of components) for (const [nutrient, source] of Object.entries(component.provenance || {})) {
      if (!provenance[nutrient]) provenance[nutrient] = [];
      if (!provenance[nutrient].includes(source)) provenance[nutrient].push(source);
    }
    setForm((current) => ({
      ...current,
      name: components.map((component) => component.foodName).join(' + '),
      kcal: totals.kcal, proteinG: totals.proteinG, fatG: totals.fatG, carbG: totals.carbG,
      fiberG: totals.fiberG, sodiumMg: totals.sodiumMg, potassiumMg: totals.potassiumMg, magnesiumMg: totals.magnesiumMg,
      source: 'food_catalog', components, nutritionProvenance: provenance,
    }));
  };

  const addCatalogComponent = (component) => applyCatalogComponents([...(form?.components || []), component]);
  const removeCatalogComponent = (index) => applyCatalogComponents((form?.components || []).filter((_, componentIndex) => componentIndex !== index));

  const recalculateMeal = async () => {
    if (!form?.name.trim()) return;
    if (!token || !aiConsent) {
      setFormNotice('Для пересчёта включите согласие на ИИ и синхронизацию в разделе «Ещё». Значения можно поправить вручную.');
      return;
    }
    setBusy(true);
    setFormNotice('');
    try {
      const result = await api.estimateMeal(token, form.name.trim());
      const recalculated = formFromEstimate(result, form.name.trim(), 'ai_recalculated', currentMealMinute());
      setForm({
        ...form,
        kcal: recalculated.kcal,
        proteinG: recalculated.proteinG,
        fatG: recalculated.fatG,
        carbG: recalculated.carbG,
        fiberG: recalculated.fiberG,
        sodiumMg: recalculated.sodiumMg,
        potassiumMg: recalculated.potassiumMg,
        magnesiumMg: recalculated.magnesiumMg,
        confidence: recalculated.confidence,
        source: recalculated.source,
        originalEstimate: recalculated.originalEstimate,
        estimateRange: recalculated.estimateRange,
      });
      setFormNotice('КБЖУ и минералы пересчитаны. Проверьте значения и нажмите «Подтвердить и сохранить».');
    } catch (error) {
      setFormNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const storeActivity = ({ type = actType, intensity = actIntensity, durationMin = actDuration, requestedStartMin = actStartMinute, source = 'manual', kcal: suppliedKcal, steps, dailySteps = false, replaceEditing = true }) => {
    const target = replaceEditing ? editingActivity : null;
    const safeType = ACTIVITY[type] ? type : 'walk_brisk';
    const occupied = activities.filter((entry) => entry.clientId !== target?.clientId).map((entry) => entry.payload || {});
    const startMin = findFreeActivityStart(occupied, requestedStartMin, durationMin);
    const kcal = suppliedKcal ?? estimateActivityNutritionImpact([
      { type: safeType, startMin, durationMin, intensity },
    ], { weightKg: weightKg || 70, lowCarb }).energyKcal;
    const at = new Date(); at.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    const payload = { type: safeType, label: ACTIVITY[safeType][0], intensity, durationMin, startMin, kcal, steps, dailySteps, date: today, source, deleted: false };
    if (target) updateEntry('activity', target.clientId, payload);
    else addEntry('activity', payload, at.toISOString());
    resetActivityForm();
    setNotice(startMin !== requestedStartMin ? `Активность сдвинута на ${formatHour(startMin / 60)}, чтобы записи не пересекались.` : 'Активность добавлена.');
  };

  const addActivity = () => storeActivity({});

  const saveActualSteps = () => {
    const steps = Math.round(Number(actualSteps));
    if (!Number.isFinite(steps) || steps <= 0 || steps >= 200_000) {
      setNotice('Введите фактическое число шагов от 1 до 199 999.');
      return;
    }
    const activity = stepsActivity(steps, Number(profile.height) || 170, 'вкладка «Тело»');
    const existing = activities.find((entry) => entry.payload?.dailySteps);
    const now = new Date();
    const startMin = currentMealMinute(now);
    const payload = {
      ...activity,
      startMin,
      date: today,
      source: 'вкладка «Тело»',
      deleted: false,
    };
    if (existing) updateEntry('activity', existing.clientId, payload);
    else addEntry('activity', payload, now.toISOString(), `steps-${today}`);
    savePhoneSteps(today, steps, 'вкладка «Тело»');
    setNotice(`Сохранено ${steps.toLocaleString('ru-RU')} шагов. Значение появится во вкладке «Сегодня».`);
  };

  const addTrackerRun = () => {
    storeActivity({
      type: 'run',
      intensity: 'high',
      durationMin: 30,
      requestedStartMin: currentMealMinute(),
      source: 'tracker',
      replaceEditing: false,
    });
  };

  const repeatMeal = (meal, factor = 1) => {
    const at = new Date();
    const minute = Math.round((at.getHours() * 60 + at.getMinutes()) / 5) * 5;
    const hour = minute / 60;
    const payload = {
      ...scaleMealPayload(meal.entry.payload, factor),
      mealHour: hour,
      mealType: mealType(hour),
      source: 'repeat',
      repeatedFrom: meal.entry.clientId,
      copiedFrom: meal.entry.clientId,
      deleted: false,
    };
    addEntry('meal', payload, new Date(mealTimestamp(hour, at)).toISOString());
    setMealMinute(minute);
    setRepeatTarget(null);
    setNotice(factor === 1
      ? 'Приём повторён с текущим временем.'
      : `Приём повторён: ${Math.round(factor * 100)}% исходной порции.`);
  };

  const openRepeat = (meal) => {
    setRepeatTarget(meal);
    setRepeatFactor(1);
  };

  const hasMinerals = (m) => m.sodium || m.potassium || m.magnesium;

  const addTorion = () => {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const payload = {
      description: TORION.name,
      kcal: TORION.kcal, proteinG: TORION.proteinG, fatG: TORION.fatG, carbG: TORION.carbG, fiberG: TORION.fiberG,
      sodiumMg: TORION.sodiumMg, potassiumMg: TORION.potassiumMg, magnesiumMg: TORION.magnesiumMg,
      mealHour: hour, mealType: mealType(hour),
      digestionH: estimateDigestionHours({ kcal: TORION.kcal, f: TORION.fatG, p: TORION.proteinG, c: TORION.carbG, fiber: TORION.fiberG }),
      confidence: null, source: 'draft_torion', deleted: false,
    };
    addEntry('meal', payload, new Date(mealTimestamp(hour, now)).toISOString());
    setNotice('Торион добавлен в сегодня.');
  };

  // Вчерашняя запись — это шаблон для нового приёма сегодня, а не черновик,
  // который можно случайно удалить из истории.
  const editDraft = (meal) => {
    setEditing(null);
    setForm({
      name: meal.name,
      time: formatHour(mealMinute / 60),
      kcal: meal.kcal,
      proteinG: meal.p, fatG: meal.f, carbG: meal.c, fiberG: meal.fiber,
      sodiumMg: meal.entry.payload.sodiumMg,
      potassiumMg: meal.entry.payload.potassiumMg,
      magnesiumMg: meal.entry.payload.magnesiumMg,
      source: 'repeat', confidence: meal.confidence, originalEstimate: meal.entry.payload.originalEstimate,
      copiedFrom: meal.entry.clientId,
    });
  };

  const deleteYesterdayMeal = (meal) => {
    setDeleteYesterdayTarget(null);
    updateEntry('meal', meal.entry.clientId, { ...meal.entry.payload, deleted: true });
    setNotice(`«${meal.name}» удалено из вчерашних приёмов.`);
  };

  const analyzePhoto = async (file, mode = 'meal') => {
    if (!file) return;
    if (!token || !aiConsent) { setNotice('Для фото-анализа включите согласие и синхронизацию в разделе «Ещё».'); return; }
    setBusy(true);
    try {
      setNotice(file.size > 850_000 ? 'Подготавливаю фото на устройстве…' : 'Отправляю фото на анализ…');
      const image = await prepareMealImage(file);
      const result = await api.analyzeMeal(token, image, mode === 'label' ? 'label' : '');
      setForm(formFromEstimate(result, mode === 'label' ? 'продукт с этикетки' : 'блюдо с фото', 'ai_photo', mealMinute));
      setNotice(mode === 'label'
        ? (result.trialRemaining === 0 ? 'Это была последняя пробная фото-оценка. Проверьте данные.' : 'Этикетка прочитана. Проверьте КБЖУ перед сохранением.')
        : (result.trialRemaining === 0 ? 'Это была последняя пробная фото-оценка. Проверьте данные.' : 'Фото оценено. Проверьте данные перед сохранением.'));
    } catch (error) { setNotice(error?.message === 'image_too_large' || error?.message === 'image_encode_failed' ? 'Не удалось уменьшить фото. Выберите другой снимок или введите блюдо текстом.' : errorText(error)); } finally { setBusy(false); }
  };

  const findBarcode = async () => {
    const info = parseGs1(barcode);
    // National Catalogue / True API expects the canonical 14-digit GTIN from
    // a GS1 DataMatrix.  Do not turn it into EAN-13 here: that made Russian
    // marked products miss the national lookup before it even reached it.
    const code = String(info.gtin || barcode).replace(/\D/g, '');
    if (!code) return;
    setBarcodeMiss(false);
    setBarcodeIdentity(null);
    // Проверяем код на устройстве: так о нечитаемых цифрах сообщаем сразу.
    if (!isValidGtin(code)) {
      setNotice(`Код «${code}» не похож на штрихкод товара: проверьте цифры GTIN или сфотографируйте этикетку.`);
      return;
    }
    if (!token) { setNotice('Для базы штрихкодов сначала включите синхронизацию в разделе «Ещё».'); return; }
    // Для весовых товаров код несёт точную массу нетто — берём её вместо ручного
    // ввода. После сканирования в поле остаётся GTIN, поэтому массу ищем и в разборе.
    const netWeight = info.netWeightG ?? barcodeInfo?.netWeightG ?? null;
    const weighed = netWeight ? String(netWeight) : null;
    if (weighed) setGrams(weighed);
    setBusy(true);
    try {
      const product = await api.barcode(token, code);
      if (!product.found) {
        // Каталог общедоступный и российские товары в нём представлены слабо —
        // предлагаем рабочий путь вместо тупика.
        setBarcodeMiss(true);
        setNotice(`Товара ${code} нет в открытом каталоге — российские марки есть там не всегда. Сфотографируйте этикетку: состав и КБЖУ прочитает ИИ.`);
        return;
      }
      if (!product.nutritionFound) {
        // The official card proves the identity, but not every product card
        // carries a nutrition declaration.  Keeping KБЖУ empty is safer than
        // silently saving zeroes or a guess.
        setBarcodeIdentity(product);
        setNotice(`«${product.name}» найден в Национальном каталоге. Для КБЖУ нужна этикетка: в карточке их нет.`);
        return;
      }
      // setGrams обновит состояние только к следующему рендеру — считаем от локального значения.
      const factor = number(weighed ?? grams, 10_000) / 100;
      setForm({ ...emptyForm(), time: formatHour(mealMinute / 60), name: `${product.brand ? `${product.brand} · ` : ''}${product.name}`, kcal: Math.round(product.kcal100g * factor), proteinG: +(product.protein100g * factor).toFixed(1), fatG: +(product.fat100g * factor).toFixed(1), carbG: +(product.carb100g * factor).toFixed(1), fiberG: +(Number(product.fiber100g || 0) * factor).toFixed(1), sodiumMg: Math.round((product.sodiumMg100g || 0) * factor), source: 'barcode' });
      setBarcodeOpen(false);
      setNotice(weighed
        ? `Найдена упаковка: ${product.name}. Масса ${weighed} г взята из кода — поправьте, если съели не всё.`
        : `Найдена упаковка: ${product.name}. Проверьте граммы и сохраните.`);
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const scanBarcodeImage = async (file) => {
    if (!file) return;
    if (!('BarcodeDetector' in window)) {
      setNotice('В этом браузере распознавание камерой недоступно. Введите код Честный знак вручную — GTIN и другие поля разберутся автоматически.');
      return;
    }
    setBusy(true);
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats?.();
      // Честный знак — это GS1 DataMatrix; EAN оставляем как запасной вариант.
      const preferred = ['data_matrix', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
      const formats = supported?.length ? preferred.filter((item) => supported.includes(item)) : preferred;
      const detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      const raw = codes.find((item) => item.rawValue)?.rawValue;
      if (!raw) { setNotice('Код на фото не распознан. Наведите камеру ровно, добавьте света или введите код вручную.'); return; }
      const info = parseGs1(raw);
      if (info.gtin) {
        // В поле остаётся только GTIN, поэтому массу нетто подставляем сразу,
        // а разбор кода храним в barcodeInfo — оттуда её возьмёт «Найти продукт».
        setBarcode(info.gtin);
        setBarcodeInfo(info);
        if (info.netWeightG) setGrams(String(info.netWeightG));
        const tail = [
          info.serial && `серия ${info.serial}`,
          info.netWeightG && `масса ${info.netWeightG} г`,
        ].filter(Boolean).join(' · ');
        setNotice(`Распознан код Честный знак: GTIN ${info.gtin}${tail ? ` · ${tail}` : ''}. Нажмите «Найти продукт».`);
      } else {
        const digits = raw.replace(/\D/g, '');
        setBarcode(digits);
        setBarcodeInfo(null);
        setNotice(`Распознан код ${digits || raw}. Проверьте и нажмите «Найти продукт».`);
      }
    } catch { setNotice('Не удалось обработать фото. Введите код Честный знак вручную.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Card eyebrow="ЧТО ПОЛУЧАЕТ ТЕЛО" module="nutrition">
        <div className="nutrition-legacy">
          <div className="nutrition-grid">
            <div className="nutrition-stage-col">
              <div className="torus-stage nutrition-stage"><ToroidCanvas variant="nutrition" intensity={noise} segments={torusSegments} /></div>
              <div className="nutrition-state" role="status">
                <span className="ns-sub">{noise < .04 ? 'нет активной нагрузки' : `нагрузка ${Math.round(noise * 100)}%`}</span>
              </div>
              <button className="molecular-phase" aria-expanded={molOpen} onClick={() => setMolOpen((value) => !value)}><span>{molPhases[molIndex][0]}</span><small>молекулярная фаза · тап для списка</small></button>
              {molOpen && <div className="molecular-list">{molPhases.map((phase, index) => <div className={index === molIndex ? 'current' : ''} key={phase[0]}><p><b>{phase[0]}</b><time>{phase[1]}</time></p><span>{phase[2]}</span></div>)}</div>}
              <button type="button" className="torus-explain torus-info-btn" onClick={() => setShowToroidInfo(true)}>ⓘ что показывает тороид · метафора, не измерение</button>
            </div>

            <div className="nutrition-columns">
              <section className="n-panel">
                <p className="n-panel-label">добавить приём</p>

                <div className="meal-text-entry">
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Опишите блюдо и порцию: например, «яичница на топлёном масле с зеленью, 200 г»" rows="2" />
                  <button className="n-action primary" disabled={busy || !description.trim()} onClick={estimateDescription}>{busy ? 'Оцениваю…' : 'Оценить по описанию'}</button>
                </div>

                <p className="meal-or">или снимите</p>

                {/* Три способа-снимка равноценны и открываются одним нажатием,
                    поэтому идут компактным рядом. «Вручную» — запасной путь без ИИ
                    и без сети, он намеренно тише остальных. */}
                <div className="meal-methods">
                  <button className="entry-action photo-action" disabled={busy} title="Снять готовое блюдо — ИИ оценит порцию" onClick={() => inputRef.current?.click()}><span className="entry-icon"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8.5a2 2 0 0 1 2-2h2.2l1.3-1.8a1 1 0 0 1 .8-.4h4.4c.3 0 .6.2.8.4l1.3 1.8H18.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.2"/></svg></span><span className="entry-copy"><strong>Блюдо</strong><small>снять тарелку</small></span></button>
                  <button className="entry-action label-action" disabled={busy} title="Снять состав и КБЖУ на упаковке" onClick={() => labelInputRef.current?.click()}><span className="entry-icon"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 11.4l7.6-7.6a2 2 0 0 1 1.4-.6h6a2 2 0 0 1 2 2v6a2 2 0 0 1-.6 1.4l-7.6 7.6a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1 0-2.8z"/><circle cx="14.5" cy="9.5" r="1.5"/></svg></span><span className="entry-copy"><strong>Этикетка</strong><small>состав</small></span></button>
                  <button className="entry-action manual-action" title="Заполнить вручную, без ИИ" onClick={() => { setEditing(null); setFormNotice(''); setForm({ ...emptyForm(), time: formatHour(mealMinute / 60) }); }}><span className="entry-icon"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4l10.5-10.5a1.8 1.8 0 0 0-2.5-2.5L5.5 17.5 4 20z"/><path d="M13.5 6.5l3 3"/></svg></span><span className="entry-copy"><strong>Вручную</strong><small>без ИИ</small></span></button>
                </div>
                <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { analyzePhoto(event.target.files?.[0]); event.target.value = ''; }} />
                <input ref={labelInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { analyzePhoto(event.target.files?.[0], 'label'); event.target.value = ''; }} />
                {notice && <p className="n-notice" role="status">{notice}</p>}
                <div className="n-meal-list">{meals.length === 0 ? <span className="n-empty">приёмов пока нет — добавьте выше</span> : meals.map((meal, index) => <div className={`n-meal-row${index === meals.length - 1 ? ' latest' : ''}`} key={meal.id}><span>{formatHour(meal.hour)} · {mealType(meal.hour)} · <b>{meal.name}</b> · {Math.round(meal.kcal)} ккал</span><span className="n-row-actions"><button title="Поправить" onClick={() => { setEditing(meal); setFormNotice(''); setForm({ name: meal.name, time: formatHour(Math.min(meal.hour, currentMealMinute() / 60)), kcal: meal.kcal, proteinG: meal.p, fatG: meal.f, carbG: meal.c, fiberG: meal.fiber, sodiumMg: meal.entry.payload.sodiumMg, potassiumMg: meal.entry.payload.potassiumMg, magnesiumMg: meal.entry.payload.magnesiumMg, source: meal.entry.payload.source, confidence: meal.confidence, originalEstimate: meal.entry.payload.originalEstimate, components: meal.entry.payload.components || [], nutritionProvenance: meal.entry.payload.nutritionProvenance || {} }); }}>Поправить</button><button title="Повторить с другой порцией" onClick={() => openRepeat(meal)}>↻</button><button title="Удалить" onClick={() => updateEntry('meal', meal.entry.clientId, { ...meal.entry.payload, deleted: true })}>×</button></span></div>)}</div>

                <div className="n-rings">
                  <NutrientRing label="ккал" value={total.kcal} target={targets.kcal} color="#C8A96E" onClick={() => setRingInfo({ key: 'kcal', label: 'Энергия', unit: 'ккал' })} />
                  <NutrientRing label="белки" value={total.p} target={targets.protein} unit="г" color="#5D8A6E" onClick={() => setRingInfo({ key: 'protein', label: 'Белок', unit: 'г' })} />
                  <NutrientRing label="жиры" value={total.f} target={targets.fat} unit="г" color="#B0685C" onClick={() => setRingInfo({ key: 'fat', label: 'Жиры', unit: 'г' })} />
                  <NutrientRing label="углеводы" value={total.c} target={targets.carb} unit="г" color="#8A6F4D" onClick={() => setRingInfo({ key: 'carb', label: 'Углеводы', unit: 'г' })} />
                </div>
                <div className="n-rings">
                  <NutrientRing label="клетчатка" value={total.fiber} target={targets.fiber} unit="г" color="#7D9B6A" onClick={() => setRingInfo({ key: 'fiber', label: 'Клетчатка', unit: 'г' })} />
                  {MINERALS.map((m) => {
                    const target = targets[m.key];
                    const value = total[m.key];
                    return <NutrientRing key={m.key} label={m.label} value={value} target={target} unit={m.unit} color={m.color} onClick={() => setRingInfo(m)} />;
                  })}
                </div>
                <p className="n-ring-sub">расчётные ориентиры, не медицинское назначение · нажмите кольцо, чтобы увидеть формулу</p>
                {activityImpact.energyKcal > 0 && <div className="n-activity-impact-summary">
                  <b>Активность учтена в кольцах</b>
                  <span>энергия +{activityImpact.energyKcal} ккал</span>
                  <span>топливо: Б +{activityImpact.proteinG} · Ж +{activityImpact.fatG} · У +{activityImpact.carbG} г</span>
                  <span>потери с потом, оценка: Na +{activityImpact.sodiumMg} · K +{activityImpact.potassiumMg} · Mg +{activityImpact.magnesiumMg} мг</span>
                  <small>Клетчатка не расходуется; её ориентир пересчитан по общей энергии. Потери с потом индивидуальны.</small>
                </div>}
                <Axis label="промышленная обработка" value={processing} confidence={meals.length ? 'эвристика' : '—'} />
                <Axis label="цельность · полнота" value={meals.length ? 1 - processing : 0} confidence={meals.length ? 'эвристика' : '—'} />
                <Axis label="гликемия · созвучие" value={Math.min(1, total.c / 180)} confidence={meals.length ? 'оценка' : '—'} />
                <div className="n-kv"><span>пищеварительная нагрузка сейчас</span><b>{Math.round(noise * 100)}% · {noise < .04 ? 'нет' : noise < .34 ? 'низкая' : noise < .67 ? 'умеренная' : 'высокая'}</b></div>
                <div className="n-kv"><span>гликемическая нагрузка (GL)</span><b>{meals.length ? Math.round(total.c * .55) : '—'} · оценка</b></div>
                <div className="fuel"><p><span>топливо · цикл Рендла</span><i>модель</i></p><div><b style={{ width: `${Math.min(100, share.carbs + 15)}%` }} /></div><footer><span>жир</span><span>{share.carbs > 55 ? 'глюкоза преобладает' : 'смешанное'}</span><span>глюкоза</span></footer></div>
              </section>

              <WellnessPrefs now={clock} />

              <section className="n-panel">
                <p className="n-panel-label">вчерашние приёмы · добавить в сегодня</p>
                <div className="n-meal-list">
                  {draftMeals.map((meal) => (
                    <div className="n-meal-row" key={meal.id}>
                      <span>{formatHour(meal.hour)} · {mealType(meal.hour)} · <b>{meal.name}</b> · {Math.round(meal.kcal)} ккал{hasMinerals(meal) ? ` · Na ${Math.round(meal.sodium)}/K ${Math.round(meal.potassium)}/Mg ${Math.round(meal.magnesium)} мг` : ''}</span>
                      <span className="n-row-actions">
                        <button title="Поправить и добавить в сегодня" onClick={() => editDraft(meal)}>{copiedFromYesterday.has(meal.entry.clientId) ? 'Добавить ещё' : 'Добавить с правкой'}</button>
                        <button title="Повторить с другой порцией" onClick={() => openRepeat(meal)}>↻</button>
                        <button title="Удалить из вчерашних приёмов" onClick={() => setDeleteYesterdayTarget(meal)}>×</button>
                      </span>
                    </div>
                  ))}
                  <div className="n-meal-row" data-fixed-preset="torion-mineral-matrix">
                    <span onClick={() => setTorionInfo(true)} style={{ flex: 1, cursor: 'pointer' }}>
                      <b>{TORION.name}</b> · {TORION.kcal} ккал
                      {hasMinerals(torionMeal) ? ` · Na ${TORION.sodiumMg}/K ${TORION.potassiumMg}/Mg ${TORION.magnesiumMg} мг` : ''}
                    </span>
                    <span className="n-row-actions">
                      <button title="Добавить в сегодня" onClick={addTorion}>Добавить</button>
                      <button title="Повторить с другой порцией" onClick={() => openRepeat(torionMeal)}>↻</button>
                    </span>
                  </div>
                </div>
              </section>

              <section className="n-panel">
                <p className="n-panel-label">активность и расход</p>
                <div className="n-two"><label>тип<select value={actType} onChange={(event) => setActType(event.target.value)}>{Object.entries(ACTIVITY).map(([key, item]) => <option value={key} key={key}>{item[0]}</option>)}</select></label><div><span>интенсивность</span><div className="n-chips">{['low', 'moderate', 'high'].map((value) => <button className={actIntensity === value ? 'on' : ''} key={value} onClick={() => setActIntensity(value)}>{value === 'low' ? 'низкая' : value === 'moderate' ? 'умеренная' : 'высокая'}</button>)}</div></div></div>
                <div className="n-control"><div><span>длительность</span><b>{actDuration} мин</b></div><input type="range" min="5" max="120" step="5" value={actDuration} onChange={(event) => setActDuration(Number(event.target.value))} /></div>
                <div className="n-control"><div><span>время начала</span><b>{formatHour(actStartMinute / 60)}</b></div><input type="range" min="0" max="1439" step="1" value={actStartMinute} onChange={(event) => { setActivityTimeTouched(true); setActStartMinute(Number(event.target.value)); }} /><small>{editingActivity ? 'можно точно изменить время сохранённой активности' : 'по умолчанию — текущее время'}</small></div>
                <button className="n-action" onClick={addActivity}>{editingActivity ? 'Сохранить активность' : 'Добавить активность вручную'}</button>
                {editingActivity && <button className="n-action ghost" onClick={resetActivityForm}>Отменить правку</button>}
                <div className="formrow">
                  <input type="number" inputMode="numeric" min="1" max="199999" placeholder="Фактические шаги" value={actualSteps} onChange={(event) => setActualSteps(event.target.value)} aria-label="Фактические шаги" />
                  <button className="n-action" onClick={saveActualSteps}>Сохранить шаги</button>
                </div>
                <div className="n-chips"><button onClick={addTrackerRun}>трекер: пробежка 30 мин</button></div>
                <button className="n-action" onClick={() => setActivityTips(true)}>Рекомендации по активности и питанию</button>
                <div className="n-meal-list">{visualActivities.length === 0 ? <span className="n-empty">активностей пока нет</span> : <>{stepVisualActivity && <div className="n-meal-row" key="daily-steps"><span><b>{stepVisualActivity.label}</b> · дневной итог · {stepVisualActivity.kcal} ккал · оценка</span></div>}{timedActivities.map((entry) => <div className="n-meal-row" key={entry.clientId}><span>{formatHour(number(entry.payload.startMin) / 60)}–{formatHour((number(entry.payload.startMin) + number(entry.payload.durationMin, 1440)) / 60)} · <b>{entry.payload.label}</b> · {entry.payload.durationMin} мин · {entry.payload.kcal} ккал</span><span className="n-row-actions"><button title="Поправить" onClick={() => { setEditingActivity(entry); setActType(ACTIVITY[entry.payload.type] ? entry.payload.type : 'walk_brisk'); setActIntensity(entry.payload.intensity || 'moderate'); setActDuration(number(entry.payload.durationMin, 1440)); setActStartMinute(number(entry.payload.startMin, 1439)); setActivityTimeTouched(true); }}>Поправить</button><button title="Удалить" onClick={() => updateEntry('activity', entry.clientId, { ...entry.payload, deleted: true })}>×</button></span></div>)}</>}</div>
                <div className="n-kv"><span>расход за день</span><b>{Math.round(expenditure)} ккал · оценка</b></div><div className="n-kv"><span>записей активности</span><b>{visualActivities.length}</b></div>
              </section>

              <section className="n-panel">
                <p className="n-panel-label">день · ориентиры</p>
                <div className="n-kv"><span>приход за день</span><b>{Math.round(total.kcal)} ккал</b></div><div className="n-kv"><span>расход (активности)</span><b>{Math.round(expenditure)} ккал</b></div>
                <div className="lowcarb"><p><span>плавный переход на низкоуглеводное</span><button className={lowCarb ? 'on' : ''} onClick={() => setLowCarb((value) => !value)}>{lowCarb ? 'вкл' : 'выкл'}</button></p>{lowCarb && <><div className="n-control"><div><span>неделя перехода</span><b>{lowCarbWeek} из 8</b></div><input type="range" min="1" max="8" value={lowCarbWeek} onChange={(event) => setLowCarbWeek(Number(event.target.value))} /></div><div className="n-kv"><span>ориентир углеводов</span><b>{targets.carb} г/день</b></div><div className="n-kv"><span>углеводы сегодня</span><b>{Math.round(total.c)} г</b></div></>}</div>
                <button className="n-action ghost" onClick={() => { meals.forEach((meal) => updateEntry('meal', meal.entry.clientId, { ...meal.entry.payload, deleted: true })); activities.forEach((entry) => updateEntry('activity', entry.clientId, { ...entry.payload, deleted: true })); }}>Очистить день</button>
              </section>

              <section className="n-panel">
                <p className="n-panel-label">неделя по дням</p>
                <div className="nutrition-week">{weekDays.map((day, index) => { const height = day.kcal ? Math.max(5, Math.min(100, day.kcal / Math.max(targets.kcal, 1) * 100)) : 2; return <button className={`${day.current ? 'current ' : ''}${selectedDay === index ? 'selected' : ''}`} key={day.key} onClick={() => setSelectedDay(index)}><span><i style={{ height: `${height}%`, background: day.kcal <= targets.kcal ? '#5D8A6E' : '#B0685C' }} /></span><b>{day.kcal ? '●' : '○'}</b><small>{day.label}</small></button>; })}</div>
                <p className="week-detail">{weekDays[selectedDay].kcal ? `${weekDays[selectedDay].label}: ${Math.round(weekDays[selectedDay].kcal)} ккал · клетчатка ${Math.round(weekDays[selectedDay].fiber)} г` : `${weekDays[selectedDay].label}: данных нет`}</p>
              </section>
            </div>
          </div>
          <p className="nutrition-foot">измеримое — отдельно · оценка — с диапазоном · направление — не приговор</p>
          <a className="zdorov-link" href="https://zdorov.life" target="_blank" rel="noopener">о здоровье — zdorov.life →</a>
        </div>
      </Card>

      {form && <MealForm value={form} onChange={setForm} onSave={save} onClose={() => { setForm(null); setEditing(null); setFormNotice(''); }} onRecalculate={editing ? recalculateMeal : null} onCatalogAdd={addCatalogComponent} onCatalogRemove={removeCatalogComponent} title={editing ? 'Поправить приём' : 'Ручная оценка'} busy={busy} notice={formNotice} />}
      {deleteYesterdayTarget && (
        <Sheet onClose={() => setDeleteYesterdayTarget(null)}>
          <button className="tbtn" onClick={() => setDeleteYesterdayTarget(null)}>← Отмена</button>
          <h2>Удалить из вчерашних приёмов?</h2>
          <p className="dim small">
            «{deleteYesterdayTarget.name}» исчезнет из истории за вчера. Остальные блюда останутся доступны.
          </p>
          <button className="btn warn" onClick={() => deleteYesterdayMeal(deleteYesterdayTarget)}>Удалить блюдо</button>
        </Sheet>
      )}
      {repeatTarget && (
        <Sheet onClose={() => setRepeatTarget(null)}>
          <button className="tbtn" onClick={() => setRepeatTarget(null)}>← Закрыть</button>
          <h2>Повторить приём</h2>
          <p className="small"><b>{repeatTarget.name}</b></p>
          <p className="dim small">
            Выберите размер относительно прошлой порции. КБЖУ пересчитаются до сохранения.
          </p>
          <div className="seg" aria-label="Размер повторной порции">
            {[
              [0.5, 'Половина'],
              [1, 'Та же'],
              [1.5, 'Полторы'],
              [2, 'Двойная'],
            ].map(([factor, label]) => (
              <button type="button" key={factor} className={repeatFactor === factor ? 'on' : ''}
                aria-pressed={repeatFactor === factor}
                onClick={() => setRepeatFactor(factor)}>{label}</button>
            ))}
          </div>
          <label className="rangelbl" htmlFor="repeat-portion">
            <span>доля прошлой порции</span>
            <b>{Math.round(repeatFactor * 100)}%</b>
          </label>
          <input id="repeat-portion" aria-label="Доля прошлой порции" type="range"
            min="25" max="300" step="5" value={repeatFactor * 100}
            onChange={(event) => setRepeatFactor(Number(event.target.value) / 100)} />
          <p className="note">
            Будет записано примерно {Math.round(repeatTarget.kcal * repeatFactor)} ккал
            вместо {Math.round(repeatTarget.kcal)} ккал.
          </p>
          <button className="btn" onClick={() => repeatMeal(repeatTarget, repeatFactor)}>
            Добавить повтор
          </button>
        </Sheet>
      )}
      {barcodeOpen && <Sheet onClose={() => setBarcodeOpen(false)}>
        <button className="tbtn" onClick={() => setBarcodeOpen(false)}>← Закрыть</button>
        <h2>Честный знак</h2>
        <p className="dim small">Код маркировки — это DataMatrix на упаковке. Распознавание идёт на устройстве; на сервер уходит только GTIN (идентификатор товара), фото, серийный номер и код проверки не отправляются.</p>
        <button className="entry-action barcode-action sheet-barcode-photo" disabled={busy} onClick={() => barcodeInputRef.current?.click()}><span className="entry-icon"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><path d="M14 14h3M17 14v3M14 17h3M20.5 14v3M14 20.5h3M17 17v3.5M20.5 17v3.5M17 20.5h3.5"/></svg></span><span className="entry-copy"><strong>Сфотографировать код</strong><small>Камера или готовое фото DataMatrix</small></span><span>›</span></button>
        <input ref={barcodeInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { scanBarcodeImage(event.target.files?.[0]); event.target.value = ''; }} />
        <label className="fl">GTIN или весь код<input inputMode="numeric" value={barcode} onChange={(event) => { setBarcode(event.target.value); setBarcodeInfo(null); }} placeholder="GTIN либо весь код Честный знак" /></label>
        {barcodeInfo?.serial && (
          <p className="small dim">Серийный номер: {barcodeInfo.serial}</p>
        )}
        {barcodeInfo?.crypto && (
          <p className="small dim">Код проверки: {barcodeInfo.crypto}</p>
        )}
        <label className="fl">Сколько съели, г<input type="number" min="1" max="10000" value={grams} onChange={(event) => setGrams(event.target.value)} /></label>
        {barcodeInfo?.netWeightG && String(barcodeInfo.netWeightG) === String(grams) && (
          <p className="small dim">Масса нетто {barcodeInfo.netWeightG} г взята из кода. Съели часть — поправьте.</p>
        )}
        <button className="btn" disabled={busy || !barcode.trim()} onClick={findBarcode}>{busy ? 'Ищу…' : 'Найти продукт'}</button>
        {barcodeMiss && (
          <>
            <p className="small dim" style={{ marginTop: 10 }}>
              Открытый каталог наполняют сами пользователи, поэтому многих российских
              товаров в нём нет. Быстрее прочитать состав прямо с упаковки.
            </p>
            <button className="btn ghost" disabled={busy}
              onClick={() => { setBarcodeMiss(false); setBarcodeOpen(false); labelInputRef.current?.click(); }}>
              Сфотографировать этикетку
            </button>
          </>
        )}
        {barcodeIdentity && (
          <>
            <p className="small dim" style={{ marginTop: 10 }}>
              Найдено в Национальном каталоге: <strong>{barcodeIdentity.brand ? `${barcodeIdentity.brand} · ` : ''}{barcodeIdentity.name}</strong>.
              В карточке нет КБЖУ на 100 г, поэтому приложение их не подставило.
            </p>
            <button className="btn ghost" disabled={busy}
              onClick={() => { setBarcodeIdentity(null); setBarcodeOpen(false); labelInputRef.current?.click(); }}>
              Сфотографировать этикетку
            </button>
          </>
        )}
      </Sheet>}

      {showToroidInfo && (
        <Sheet onClose={() => setShowToroidInfo(false)}>
          <button className="tbtn" onClick={() => setShowToroidInfo(false)}>← Закрыть</button>
          <h2>Что показывает тороид</h2>
          <p className="dim small">Кольцо суток разделено на фазы циркадного ритма; текущая повёрнута вперёд. Приёмы пищи ложатся полосой переваривания, активность — холодными метками. Глюкоза и жир приёма — мерцающими точками вдоль полосы; цвет по циклу Рендла (Randle cycle): чем больше в приёме углеводов, тем точки краснее (преобладание окисления глюкозы), чем больше жира — тем желтее (преобладание окисления жира). Пульс тороида — нетто‑нагрузка на пищеварение; центральное свечение краснеет при её росте.</p>
          <div className="tl-legend">
            <div className="tl-item"><span className="tl-dot" style={{ background: '#78cde1' }} /> активность — холодные метки</div>
            <div className="tl-item"><span className="tl-dot" style={{ background: '#f5e08a' }} /> жёлтые мерцающие точки — жир (преобладание окисления жира)</div>
            <div className="tl-item"><span className="tl-dot" style={{ background: '#ff4632' }} /> красные мерцающие точки — глюкоза (преобладание глюкозы, цикл Рендла)</div>
            <div className="tl-item"><span className="tl-dot" style={{ background: '#8a8a8a' }} /> серые точки в центре — «шум» глубокой переработки: чем их больше и ярче, тем выше доля ультрапереработанного в рационе дня. Это не оценка, а повод присмотреться к составу и заметить, как такие продукты сказываются на самочувствии</div>
            <div className="tl-item"><span className="tl-dot" style={{ background: 'rgba(224,130,74,.9)' }} /> центральное красное свечение — нагрузка пищеварения (ярче при глюкозной еде)</div>
            <div className="tl-item"><span className="tl-dot tl-pulse" /> амплитуда пульсации тора — нагрузка на пищеварение</div>
          </div>
          <p className="dim small" style={{ marginTop: 14 }}>Метафора, не измерение. Тороид показывает вычисленные (время, фаза) и оценённые (КБЖУ, нагрузка, топливо) величины. Он не измеряет глюкозу крови или гормоны в реальном времени. Не медицинская рекомендация.</p>
        </Sheet>
      )}

      {ringInfo && (
        <Sheet onClose={() => setRingInfo(null)}>
          <button className="tbtn" onClick={() => setRingInfo(null)}>← Закрыть</button>
          <h2>{ringInfo.label}</h2>
          <TargetInfo info={ringInfo} targets={targets} total={total} />
          {['sodium', 'potassium', 'magnesium'].includes(ringInfo.key) && <a className="zdorov-link" href="https://torion.shop" target="_blank" rel="noopener">продукт с минералами — torion.shop →</a>}
        </Sheet>
      )}

      {torionInfo && (
        <Sheet onClose={() => setTorionInfo(false)}>
          <button className="tbtn" onClick={() => setTorionInfo(false)}>← Закрыть</button>
          <h2>{TORION.name}</h2>
          <p className="dim small">Состав на 1 стик (8 г), растворённый в 400–500 мл воды. Ориентир по этикетке — не медицинская рекомендация.</p>
          <div className="n-kv"><span>Калории</span><b>{TORION.kcal} ккал</b></div>
          <div className="n-kv"><span>Белки</span><b>{TORION.proteinG} г</b></div>
          <div className="n-kv"><span>Жиры</span><b>{TORION.fatG} г</b></div>
          <div className="n-kv"><span>Углеводы</span><b>{TORION.carbG} г</b></div>
          <div className="n-kv"><span>Клетчатка</span><b>{TORION.fiberG} г</b></div>
          <p className="eyebrow" style={{ marginTop: 14 }}>Электролиты</p>
          <div className="n-kv"><span>Натрий (Na)</span><b>{TORION.sodiumMg} мг</b></div>
          <div className="n-kv"><span>Калий (K)</span><b>{TORION.potassiumMg} мг</b></div>
          <div className="n-kv"><span>Магний (Mg)</span><b>{TORION.magnesiumMg} мг</b></div>
          <button className="n-action primary" style={{ marginTop: 14 }} onClick={() => { setTorionInfo(false); addTorion(); }}>Добавить блюдо</button>
        </Sheet>
      )}

      {activityTips && (
        <Sheet onClose={() => setActivityTips(false)}>
          <button className="tbtn" onClick={() => setActivityTips(false)}>← Закрыть</button>
          <h2>Мягкие ориентиры на каждый день</h2>
          <p className="dim small" style={{ marginBottom: 12 }}>{ACTIVITY_TIPS.disclaimer}</p>
          <h2>{ACTIVITY_TIPS.walking.title}</h2>
          {ACTIVITY_TIPS.walking.steps.map((s, i) => <p className="dim small" key={i} style={{ margin: '4px 0' }}>— {s}</p>)}
          <h2 style={{ marginTop: 14 }}>{ACTIVITY_TIPS.nutrition.title}</h2>
          {ACTIVITY_TIPS.nutrition.steps.map((s, i) => <p className="dim small" key={i} style={{ margin: '4px 0' }}>— {s}</p>)}
          <h2 style={{ marginTop: 14 }}>{ACTIVITY_TIPS.water.title}</h2>
          {ACTIVITY_TIPS.water.steps.map((s, i) => <p className="dim small" key={i} style={{ margin: '4px 0' }}>— {s}</p>)}
          <p className="eyebrow" style={{ marginTop: 16 }}>Источники</p>
          <div className="linkrow">
            {ACTIVITY_TIPS.sources.map(([label, href]) => (
              <a className="tbtn" href={href} target="_blank" rel="noopener noreferrer" key={href}>{label} →</a>
            ))}
          </div>
          <p className="dim tiny" style={{ marginTop: 12 }}>Справочная информация, не индивидуальная медицинская рекомендация.</p>
        </Sheet>
      )}
    </>
  );
}
