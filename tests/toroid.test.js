// Проверка отрисовки тороида питания на соответствие эталону
// «Промпты старые/toroid-vidzhet-2.html»: форма, сетка и логика мерцающих точек.
//
// Контекст canvas заменён записывающей заглушкой, поэтому логика проверяется
// без браузера и без DOM.
import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceNutritionMotion, drawNutrition } from '../src/ui/toroidDraw.js';

const TAU = Math.PI * 2;

function recorder() {
  const calls = [];
  const ctx = {
    calls,
    globalAlpha: 1,
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    get fillStyle() { return ''; },
    set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    get strokeStyle() { return ''; },
    set lineWidth(v) {}, get lineWidth() { return 1; },
    set lineJoin(v) {}, get lineJoin() { return 'round'; },
    beginPath() { calls.push(['beginPath']); },
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    closePath() { calls.push(['closePath']); },
    arc(x, y, r) { calls.push(['arc', x, y, r]); },
    ellipse() { calls.push(['ellipse']); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    createRadialGradient() { return { addColorStop() {} }; },
    clearRect() {}, fillRect() {}, save() {}, restore() {}, clip() {},
    fillText() {}, setTransform() {},
  };
  return ctx;
}

// Приём пищи в виде сегмента тороида (как строит вкладка «Тело»).
const meal = (over = {}) => ({
  start: 8 / 24 * TAU, span: 3 / 24 * TAU,
  level: 0.8, load: 0.8, late: false, isActivity: false,
  fuel: 0.8, frac: 1, ...over,
});

const SIZE = 480;
const CENTER = SIZE / 2;
const LUM_GUARD = SIZE * 0.092; // зона огня в центре: точки приёмов туда не рисуются
const draw = (props, reduced = false) => {
  const ctx = recorder();
  drawNutrition(ctx, SIZE, SIZE, 1000, { intensity: 0.4, disposal: 0, segments: [], ...props }, reduced);
  return ctx;
};

// Точки приёмов — мелкие дуги ВНЕ центральной зоны огня. Зерно шума переработки
// рисуется внутри этой зоны и в подсчёт точек не входит.
const dotArcs = (ctx) => ctx.calls.filter(([op, x, y, r]) => op === 'arc'
  && r > 0 && r < SIZE * 0.05
  && Math.hypot(x - CENTER, y - CENTER) >= LUM_GUARD);
const centerGrains = (ctx) => ctx.calls.filter(([op, x, y, r]) => op === 'arc'
  && r > 0 && r < 3
  && Math.hypot(x - CENTER, y - CENTER) < LUM_GUARD);

test('каждая мерцающая точка рисуется отдельным контуром (нет слитого «пятна»)', () => {
  const ctx = draw({ segments: [meal()] });
  const arcs = dotArcs(ctx);
  assert.ok(arcs.length > 5, `ожидались точки, получено ${arcs.length}`);

  // Для каждого arc() точки проверяем: непосредственно перед ним был beginPath(),
  // а сразу после — fill(). Без beginPath дуги сливаются в один залитый контур.
  const ops = ctx.calls.map(([op]) => op);
  let checked = 0;
  ctx.calls.forEach(([op, , , r], index) => {
    if (op !== 'arc' || !(r > 0 && r < SIZE * 0.05)) return;
    const before = ops.slice(0, index).filter((o) => o === 'beginPath' || o === 'arc' || o === 'fill');
    assert.equal(before[before.length - 1], 'beginPath',
      'перед arc() точки обязан идти beginPath()');
    checked += 1;
  });
  assert.ok(checked > 5);
});

test('сетка и форма соответствуют эталону: 92×26 патчей, R = size*0.30', () => {
  // reduced = true → пульсация выключена, геометрию можно сверять точно
  const ctx = draw({ segments: [] }, true);
  const quads = ctx.calls.filter(([op]) => op === 'moveTo').length;
  assert.equal(quads, 92 * 26, 'сетка тора должна быть 92×26, как NU/NV эталона');

  // Радиус кольца: самая дальняя точка сетки по X равна R + r = R*1.42.
  const xs = ctx.calls.filter(([op]) => op === 'moveTo' || op === 'lineTo').map(([, x]) => x);
  const maxOffset = Math.max(...xs.map((x) => Math.abs(x - SIZE / 2)));
  const expected = SIZE * 0.30 * 1.42;
  assert.ok(Math.abs(maxOffset - expected) < expected * 0.02,
    `радиус тора ${maxOffset.toFixed(1)} должен быть ≈ ${expected.toFixed(1)} (R=size*0.30, r=R*0.42)`);
});

test('точки исчезают по мере переваривания (frac убывает со временем)', () => {
  const fresh = dotArcs(draw({ segments: [meal({ frac: 1 })] })).length;
  const half = dotArcs(draw({ segments: [meal({ frac: 0.5 })] })).length;
  const almost = dotArcs(draw({ segments: [meal({ frac: 0.1 })] })).length;
  assert.ok(fresh > half && half > almost,
    `число точек должно убывать: ${fresh} → ${half} → ${almost}`);
});

test('мерцающие точки в центре убывают вместе с общей пищеварительной нагрузкой', () => {
  const high = centerGrains(draw({ intensity: 0.8 })).length;
  const medium = centerGrains(draw({ intensity: 0.4 })).length;
  const low = centerGrains(draw({ intensity: 0.1 })).length;
  assert.ok(high > medium && medium > low,
    `центральное зерно должно убывать: ${high} → ${medium} → ${low}`);
});

test('полностью переваренный приём не даёт ни точек, ни полосы переваривания', () => {
  const ctx = draw({ segments: [meal({ frac: 0 })] });
  assert.equal(dotArcs(ctx).length, 0, 'точек быть не должно');
  const digestStroke = ctx.calls.some(([op, value]) => op === 'strokeStyle'
    && (String(value).startsWith('rgba(240,205,70') || String(value).startsWith('rgba(255,45,34')));
  assert.equal(digestStroke, false, 'полоса переваривания должна погаснуть');
});

test('общий расход дня не удаляет точки без пересечения с окном приёма', () => {
  const rest = dotArcs(draw({ segments: [meal()], disposal: 0 })).length;
  const active = dotArcs(draw({ segments: [meal()], disposal: 0.6 })).length;
  assert.equal(active, rest, 'дневной расход вне временного контекста не должен менять точки');
});

test('активность рисуется холодной голубой меткой, без мерцающих точек', () => {
  const activity = { start: 8 / 24 * TAU, span: 1 / 24 * TAU, level: 0.45, load: 0.45, isActivity: true };
  const ctx = draw({ segments: [activity] });
  assert.equal(dotArcs(ctx).length, 0, 'у активности нет точек глюкозы');
  assert.ok(ctx.calls.some(([op, v]) => op === 'strokeStyle' && String(v).startsWith('rgba(120,205,225')),
    'ожидалась голубая метка активности из эталона');
});

test('дневной итог шагов без времени рисуется тихой полосой, а не блоком реальной активности', () => {
  const real = { start: 8 / 24 * TAU, span: 1 / 24 * TAU, level: .45, load: .45, isActivity: true };
  const estimated = { start: 0, span: TAU, level: .45, load: .45, isActivity: true, estimatedTiming: true };
  const realCtx = draw({ segments: [real] });
  const estimatedCtx = draw({ segments: [estimated] });
  assert.ok(realCtx.calls.some(([op, v]) => op === 'strokeStyle' && String(v).startsWith('rgba(120,205,225')),
    'реальная активность — обычная голубая метка');
  assert.ok(estimatedCtx.calls.some(([op, v]) => op === 'strokeStyle' && String(v).startsWith('rgba(150,190,200')),
    'оценённое время (шаги) — отдельный, более тихий тон');
  assert.ok(!estimatedCtx.calls.some(([op, v]) => op === 'strokeStyle' && String(v).startsWith('rgba(120,205,225')),
    'оценённое время не должно выглядеть как настоящая активность');
});

test('прогноз после 18:00 даёт красную сетку, к 18:00 — жёлтую', () => {
  const lateStroke = draw({ segments: [meal({ start: 18 / 24 * TAU, late: true })] })
    .calls.some(([op, v]) => op === 'strokeStyle' && String(v).startsWith('rgba(255,45,34'));
  const dayStroke = draw({ segments: [meal({ start: 9 / 24 * TAU, late: false })] })
    .calls.some(([op, v]) => op === 'strokeStyle' && String(v).startsWith('rgba(240,205,70'));
  assert.ok(lateStroke, 'переваривание после 18:00 — красная сетка');
  assert.ok(dayStroke, 'переваривание к 18:00 — жёлтая сетка');
});

test('цвет точек по циклу Рендла: жир — жёлтый, глюкоза — красный', () => {
  const fatColors = draw({ segments: [meal({ fuel: 0 })] })
    .calls.filter(([op, v]) => op === 'fillStyle' && String(v).startsWith('rgba(245,224,138'));
  const glucoseColors = draw({ segments: [meal({ fuel: 1 })] })
    .calls.filter(([op, v]) => op === 'fillStyle' && String(v).startsWith('rgba(255,70,50'));
  assert.ok(fatColors.length > 0, 'при жировом топливе точки светло-жёлтые');
  assert.ok(glucoseColors.length > 0, 'при глюкозном топливе точки красные');
});

test('позиции точек стабильны между кадрами (фиксированные «семена»)', () => {
  const positions = (time) => {
    const ctx = recorder();
    drawNutrition(ctx, SIZE, SIZE, time, { intensity: 0, disposal: 0, segments: [meal({ load: 0 })] }, true);
    return dotArcs(ctx).map(([, x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`);
  };
  assert.deepEqual(positions(1000), positions(5000),
    'без дрожания (reduced motion) точки не должны менять позиции между кадрами');
});

test('фаза пульсации непрерывна при резком изменении пищевой нагрузки', () => {
  const first = advanceNutritionMotion(null, 1000, 0.1);
  const beforeChange = advanceNutritionMotion(first, 1033, 0.1);
  const afterChange = advanceNutritionMotion(beforeChange, 1066, 1);
  assert.ok(afterChange.phase > beforeChange.phase, 'фаза должна продолжаться вперёд');
  assert.ok(afterChange.phase - beforeChange.phase < 0.25, 'не должно быть скачка фазы');
  assert.ok(afterChange.intensity > beforeChange.intensity && afterChange.intensity < 1,
    'амплитуда должна приблизиться к новой нагрузке плавно');
});
