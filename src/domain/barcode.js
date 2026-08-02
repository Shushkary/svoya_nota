// Разбор кода маркировки «Честный знак» (GS1 DataMatrix).
//
// Декодеры отдают payload в одном из видов:
//   • скобочный:            «(01)04600682000655(21)5Bd-Ent(93)dGVz»
//   • элементами с FNC1/GS: «0104600682000655215Bd-Ent<GS>93dGVz»
//   • слитный без FNC1:     «0104600682000655215Bd-Ent93dGVz»
//
// Ключевое правило GS1: часть AI имеет ПРЕДОПРЕДЕЛЁННУЮ длину значения
// (01 — ровно 14 цифр, 17 — 6 и т. д.). После такого элемента разделитель
// не ставится, и следующий AI идёт слитно. Поэтому payload нельзя просто
// резать по разделителям — нужно идти по строке, зная длины.
//
// Извлекаем:
//   AI 01 — GTIN (идентификатор товара, 14 цифр),
//   AI 21 — серийный номер экземпляра,
//   AI 91/92/93 — код проверки (криптохвост Честного знака).

// Значения предопределённой длины: AI → длина значения.
const FIXED_VALUE_LENGTH = {
  '00': 18, '01': 14, '02': 14, '03': 14, '04': 16,
  11: 6, 12: 6, 13: 6, 14: 6, 15: 6, 16: 6, 17: 6, 18: 6, 19: 6,
  20: 2, 31: 6, 32: 6, 33: 6, 34: 6, 35: 6, 36: 6, 41: 13,
};

// Сколько цифр занимает сам AI. Определяется по первым двум цифрам.
function aiLength(head2) {
  if (/^3[1-6]$/.test(head2)) return 4;              // 31nn…36nn — вес, объём, размеры
  if (head2 === '39' || head2 === '70' || head2 === '71' || head2 === '72') return 4;
  if (/^8[0-2]$/.test(head2)) return 4;              // 80nn…82nn
  if (head2 === '23' || head2 === '24' || head2 === '25') return 3;
  if (/^4[0-3]$/.test(head2)) return 3;              // 40n…43n
  return 2;
}

// Длина значения для AI, если она предопределена; иначе null (до разделителя).
function fixedValueLength(ai) {
  if (ai.length === 4) return FIXED_VALUE_LENGTH[ai.slice(0, 2)] ?? null;
  if (ai.length === 3) return FIXED_VALUE_LENGTH[ai.slice(0, 2)] ?? null;
  return FIXED_VALUE_LENGTH[ai] ?? null;
}

// Проход по строке элементов GS1 с учётом предопределённых длин.
function walkElements(source) {
  const pairs = {};
  let index = 0;
  let guard = 0;
  while (index < source.length && guard < 64) {
    guard += 1;
    if (source[index] === '|') { index += 1; continue; }

    const head2 = source.slice(index, index + 2);
    if (!/^\d{2}$/.test(head2)) break; // не элемент GS1 — дальше разбирать нечего

    const ai = source.slice(index, index + aiLength(head2));
    if (!/^\d+$/.test(ai)) break;
    index += ai.length;

    const fixed = fixedValueLength(ai);
    let value;
    if (fixed !== null) {
      value = source.slice(index, index + fixed);
      index += fixed;
    } else {
      const stop = source.indexOf('|', index);
      value = stop === -1 ? source.slice(index) : source.slice(index, stop);
      index += value.length;
    }
    if (value && pairs[ai] === undefined) pairs[ai] = value;
  }
  return pairs;
}

export function parseGs1(raw = '') {
  if (typeof raw !== 'string' || !raw) {
    return { gtin: null, serial: null, crypto: null, raw: '' };
  }
  // FNC1/GS/RS/US и «ñ» (иногда так кодируют FNC1) → единый разделитель.
  // Ведущий идентификатор символики «]d2»/«]C1» и начальный разделитель — отбрасываем.
  const norm = raw
    .replace(/^\]\w\d/, '')
    .replace(/[\x1D\x1E\x1F]/g, '|')
    .replace(/[ñÑ]/g, '|')
    .replace(/^\|+/, '')
    .trim();

  let pairs = {};

  // 1) скобочный вид: (AI)значение
  const parenRe = /\((\d{2,4})\)([^()|]+)/g;
  let match;
  while ((match = parenRe.exec(norm))) pairs[match[1]] = match[2].trim();

  // 2) элементы GS1 — с разделителями или слитно
  if (Object.keys(pairs).length === 0) pairs = walkElements(norm);

  // 3) страховка: GTIN по префиксу, если разбор не дал результата
  let gtin = pairs['01'] || null;
  if (!gtin || !/^\d{14}$/.test(gtin)) {
    const found = norm.match(/01(\d{14})/);
    gtin = found ? found[1] : null;
  }

  const serial = pairs['21'] || null;
  const crypto = pairs['91'] || pairs['92'] || pairs['93'] || null;
  return { gtin, serial, crypto, netWeightG: netWeightGrams(pairs), raw };
}

// Масса нетто из AI 310n — килограммы, где n — число знаков после запятой
// (значение всегда 6 цифр). Для весовых товаров «Честного знака» это точный вес
// упаковки, поэтому его можно подставить вместо ручного ввода граммов.
//   3103 «001234» → 1.234 кг → 1234 г
//   3102 «001234» → 12.34 кг → 12340 г
export function netWeightGrams(pairs = {}) {
  for (let decimals = 0; decimals <= 5; decimals += 1) {
    const value = pairs[`310${decimals}`];
    if (!value || !/^\d{1,6}$/.test(value)) continue;
    const grams = Number(value) * 10 ** (3 - decimals);
    // Отбрасываем бессмысленные для порции значения (пыль и тонны).
    if (Number.isFinite(grams) && grams >= 1 && grams <= 100_000) return Math.round(grams);
  }
  return null;
}

// GTIN-14 → EAN-13 (убираем ведущий 0), как ожидает база штрихкодов.
export function gtinToEan(gtin = '') {
  const d = String(gtin).replace(/\D/g, '');
  if (d.length === 14 && d.startsWith('0')) return d.slice(1);
  return d;
}

// Проверка длины и контрольной цифры EAN/GTIN — те же правила, что на сервере.
// Позволяет сказать о нечитаемом коде сразу, не отправляя заведомо плохой запрос.
export function isValidGtin(code = '') {
  const d = String(code).replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(d)) return false;
  const body = d.slice(0, -1).split('').reverse();
  const sum = body.reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]);
}
