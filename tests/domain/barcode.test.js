import { test } from 'node:test';
import assert from 'node:assert';
import { parseGs1, gtinToEan } from '../../src/domain/barcode.js';

const GS = String.fromCharCode(29);

test('parseGs1: скобочный вид GS1 DataMatrix', () => {
  const r = parseGs1('(01)04634123010019(21)SER12345(91)AB12CD34');
  assert.equal(r.gtin, '04634123010019');
  assert.equal(r.serial, 'SER12345');
  assert.equal(r.crypto, 'AB12CD34');
});

test('parseGs1: разделитель FNC1/GS (0x1D)', () => {
  const r = parseGs1(`0104634123010019${GS}21SER12345${GS}91AB12CD34`);
  assert.equal(r.gtin, '04634123010019');
  assert.equal(r.serial, 'SER12345');
  assert.equal(r.crypto, 'AB12CD34');
});

// ── Регрессия: реальная раскладка «Честного знака» ─────────────────────────
// AI 01 имеет предопределённую длину (14 цифр), поэтому разделитель после него
// НЕ ставится и AI 21 идёт слитно. Прежний разбор резал строку только по
// разделителям и склеивал GTIN с серийным номером — сервер отвергал такой код,
// и любой отсканированный DataMatrix давал «товар не определяется».
test('parseGs1: GTIN не склеивается с серийным номером (реальный код ЧЗ)', () => {
  const r = parseGs1(`0104600682000655215Bd-Ent${GS}93dGVz`);
  assert.equal(r.gtin, '04600682000655');
  assert.equal(r.serial, '5Bd-Ent');
  assert.equal(r.crypto, 'dGVz');
  assert.equal(gtinToEan(r.gtin), '4600682000655');
});

test('parseGs1: код ЧЗ без единого разделителя', () => {
  const r = parseGs1('0104600682000655215Bd-Ent93dGVz');
  assert.equal(r.gtin, '04600682000655');
  assert.equal(gtinToEan(r.gtin), '4600682000655');
});

test('parseGs1: ведущий FNC1 и идентификатор символики отбрасываются', () => {
  for (const prefix of [GS, ']d2', ']C1']) {
    const r = parseGs1(`${prefix}0104600682000655215Bd-Ent${GS}93dGVz`);
    assert.equal(r.gtin, '04600682000655', `префикс ${JSON.stringify(prefix)}`);
  }
});

test('parseGs1: элемент фиксированной длины между GTIN и серией (дата 17)', () => {
  // 01<14 цифр> 17<6 цифр — срок годности> 21<серия>
  const r = parseGs1(`010460068200065517251231 21ABC123${GS}93dGVz`.replace(' 21', '21'));
  assert.equal(r.gtin, '04600682000655');
  assert.equal(r.serial, 'ABC123');
});

test('parseGs1: AI 3103 — масса нетто, а не код проверки', () => {
  // 3103 в GS1 — масса нетто в кг с тремя знаками, ровно 6 цифр.
  // Код проверки Честного знака передаётся в AI 91/92/93.
  const r = parseGs1(`010460068200065521ABC123${GS}3103001234${GS}93dGVz`);
  assert.equal(r.gtin, '04600682000655');
  assert.equal(r.crypto, 'dGVz', 'код проверки берётся из 93, а не из 3103');
});

// ── Масса нетто: подставляется вместо ручного ввода граммов ────────────────
test('parseGs1: масса нетто из 310n переводится в граммы', () => {
  const weight = (ai, value) => parseGs1(`010460068200065521ABC${GS}${ai}${value}${GS}93dGVz`).netWeightG;
  assert.equal(weight('3103', '001234'), 1234, '1.234 кг');
  assert.equal(weight('3102', '001234'), 12340, '12.34 кг');
  assert.equal(weight('3101', '000125'), 12500, '12.5 кг');
  assert.equal(weight('3100', '000002'), 2000, '2 кг');
  assert.equal(weight('3103', '000330'), 330, 'банка 330 г');
});

test('parseGs1: масса нетто читается и в скобочном виде', () => {
  assert.equal(parseGs1('(01)04600682000655(3103)000500(21)ABC').netWeightG, 500);
});

test('parseGs1: без AI 310n массы нет — поле граммов не трогаем', () => {
  assert.equal(parseGs1(`010460068200065521ABC${GS}93dGVz`).netWeightG, null);
  assert.equal(parseGs1('4600682000655').netWeightG, null);
});

test('parseGs1: бессмысленная масса отбрасывается', () => {
  // 3100 «999999» → 999 999 кг: явно не порция, подставлять такое нельзя
  assert.equal(parseGs1(`010460068200065521ABC${GS}3100999999${GS}93dGVz`).netWeightG, null);
  assert.equal(parseGs1(`010460068200065521ABC${GS}3105000000${GS}93dGVz`).netWeightG, null);
});

test('gtinToEan: GTIN-14 → EAN-13 (убираем ведущий 0)', () => {
  assert.equal(gtinToEan('04634123010019'), '4634123010019');
  assert.equal(gtinToEan('4634123010019'), '4634123010019');
});

test('parseGs1: без разделителей — разбор по префиксам', () => {
  const r = parseGs1('010463412301001921SER12345');
  assert.equal(r.gtin, '04634123010019');
  assert.equal(r.serial, 'SER12345');
});

test('parseGs1: обычный EAN-13 не ломает разбор', () => {
  const r = parseGs1('4600682000655');
  assert.equal(r.gtin, null);
  assert.equal(gtinToEan(r.gtin || '4600682000655'), '4600682000655');
});

test('parseGs1: пусто/не строка — безопасно', () => {
  assert.deepEqual(parseGs1(''), { gtin: null, serial: null, crypto: null, raw: '' });
  assert.deepEqual(parseGs1(undefined), { gtin: null, serial: null, crypto: null, raw: '' });
});

test('parseGs1: мусор не зацикливает разбор', () => {
  assert.equal(parseGs1('не код вовсе').gtin, null);
  assert.equal(parseGs1('1'.repeat(500)).gtin, null);
});
