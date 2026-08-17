// Чистая логика отрисовки тороида — перенос эталона toroid-vidzhet-2.html.
// Без React и DOM: принимает 2D-контекст, поэтому проверяется тестом отдельно от UI.
const TAU = Math.PI * 2;
const TILT = 62 * Math.PI / 180;
const CA = Math.cos(TILT);
const SA = Math.sin(TILT);
const LIGHT = (() => { const x = .2; const y = -.4; const z = .9; const m = Math.hypot(x, y, z); return { x: x / m, y: y / m, z: z / m }; })();
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const wrap = (angle) => ((angle % TAU) + TAU) % TAU;

// Непрерывная фаза пульсации. Частота и амплитуда могут меняться вместе с
// нагрузкой, но сама синусоида не перескакивает при добавлении/удалении блюда.
export function advanceNutritionMotion(previous, time, targetIntensity, reduced = false) {
  const timestamp = Number.isFinite(Number(time)) ? Number(time) : 0;
  const previousTime = Number.isFinite(Number(previous?.time)) ? Number(previous.time) : null;
  const delta = previousTime === null ? 0 : clamp(timestamp - previousTime, 0, 100);
  const target = clamp(targetIntensity, 0, 1);
  const before = Number.isFinite(Number(previous?.intensity)) ? clamp(previous.intensity, 0, 1) : target;
  const blend = reduced || previousTime === null ? 1 : 1 - Math.exp(-delta / 650);
  const intensity = before + (target - before) * blend;
  const period = clamp(3400 - intensity * 2500, 900, 3400);
  const phaseBefore = Number.isFinite(Number(previous?.phase)) ? Number(previous.phase) : 0;
  const phase = reduced ? 0 : wrap(phaseBefore + TAU * delta / period);
  return { time: timestamp, intensity, phase };
}

function point(u, v, major, minor) {
  const ring = major + minor * Math.cos(v);
  return { x: ring * Math.cos(u), y: ring * Math.sin(u), z: minor * Math.sin(v) };
}
function normal(u, v) { return { x: Math.cos(v) * Math.cos(u), y: Math.cos(v) * Math.sin(u), z: Math.sin(v) }; }
function rotate(p) { return { x: p.x, y: p.y * CA - p.z * SA, z: p.y * SA + p.z * CA }; }
function colorMix(left, right, amount) {
  const t = clamp(amount, 0, 1);
  return left.map((value, index) => Math.round(value + (right[index] - value) * t));
}
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
// день/ночь — по виджету toroid-vidzhet-2: золото (день) ↔ фиолет (ночь),
// плавный переход smoothstep около 7 и 14 ч.
const DAY_RGB = { r: 232, g: 200, b: 122 };
const NIGHT_RGB = { r: 70, g: 60, b: 120 };
function dayWeight(h) { const D = 1.2; return clamp(smoothstep(7 - D, 7 + D, h) - smoothstep(14 - D, 14 + D, h), 0, 1); }
function dayRGB(h) { const t = dayWeight(h); return { r: NIGHT_RGB.r + (DAY_RGB.r - NIGHT_RGB.r) * t, g: NIGHT_RGB.g + (DAY_RGB.g - NIGHT_RGB.g) * t, b: NIGHT_RGB.b + (DAY_RGB.b - NIGHT_RGB.b) * t }; }
function covers(segment, angle) {
  const start = wrap(segment.start);
  const end = start + clamp(segment.span, .02, TAU);
  return end <= TAU ? angle >= start && angle <= end : angle >= start || angle <= wrap(end);
}
// Активность на этом угле кольца: настоящая по времени — или дневной итог без
// таймлайна (шаги телефона). У итога нет достоверного часа, поэтому он не
// должен читаться как обычная тренировка — только как более тихая полоса.
function activityKindAt(segments, angle) {
  let real = false;
  let estimated = false;
  for (const segment of segments || []) {
    if (!segment.isActivity || !covers(segment, angle)) continue;
    if (segment.estimatedTiming) estimated = true; else real = true;
  }
  if (real) return 'real';
  if (estimated) return 'estimated';
  return null;
}
// Полоса переваривания: наибольшая нагрузка среди накрывающих приёмов + признак
// позднего приёма (эталон: digestInfoAt). Переваренные приёмы полосу не рисуют.
function digestInfoAt(segments, angle) {
  let best = -1; let late = false; let found = false;
  for (const segment of segments || []) {
    if (segment.isActivity) continue;
    if (clamp(segment.frac ?? 1, 0, 1) <= 0.02) continue;
    if (!covers(segment, angle)) continue;
    found = true;
    if (segment.late) late = true;
    const load = clamp(segment.load ?? segment.level, 0, 1);
    if (load > best) best = load;
  }
  return found ? { load: best, late } : null;
}
// Детерминированный пул «семян» точек — аналог makeSeeds() эталона (48 на приём).
// Пул неизменен между кадрами и перерисовками React, поэтому точки не «прыгают».
const SEEDS = (() => {
  let seed = 0x2f6e2b1;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };
  return Array.from({ length: 288 }, () => ({
    uOff: random(),
    v: random() * TAU,
    rf: 0.12 + random() * 0.74,
    tw: random() * TAU,
    sp: 260 + random() * 260,
  }));
})();

function quad(context, corners, fill, stroke) {
  context.beginPath();
  context.moveTo(corners[0][0], corners[0][1]);
  corners.slice(1).forEach(([x, y]) => context.lineTo(x, y));
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = .8;
  context.lineJoin = 'round';
  context.stroke();
}

export function drawNutrition(context, width, height, time, props, reduced) {
  const cx = width / 2;
  const cy = height / 2;
  const size = Math.min(width, height);
  // Геометрия эталона toroid-vidzhet-2: R = size*0.30, r = R*0.42, сетка 92×26.
  const major = size * .30;
  const minor = major * .42;
  const load = clamp(props.motionIntensity ?? props.intensity, 0, 1);
  const period = clamp(3400 - load * 2500, 900, 3400);
  const phase = Number.isFinite(Number(props.pulsePhase)) ? Number(props.pulsePhase) : TAU * time / period;
  const pulse = reduced ? 1 : 1 + clamp(.010 + load * .10, .010, .11) * Math.sin(phase);
  const nowAngle = ((new Date().getHours() * 60 + new Date().getMinutes()) / 1440) * TAU;
  const base = nowAngle + Math.PI / 2;
  const patches = [];
  const around = 92;
  const tube = 26;

  for (let i = 0; i < around; i += 1) {
    for (let j = 0; j < tube; j += 1) {
      const u0 = i / around * TAU; const u1 = (i + 1) / around * TAU;
      const v0 = j / tube * TAU; const v1 = (j + 1) / tube * TAU;
      const uc = (u0 + u1) / 2; const vc = (v0 + v1) / 2;
      const c3 = rotate(point(uc, vc, major, minor));
      const n = rotate(normal(uc, vc));
      const light = Math.max(0, n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z);
      const clockAngle = wrap(base - uc);
      const hour = clockAngle / TAU * 24;
      // день/ночь: золото (день) ↔ фиолет (ночь), плавно около 7 и 14 ч (виджет toroid-vidzhet-2)
      const baseRGB = dayRGB(hour);
      const shade = 0.42 + 0.58 * light;
      const fill = `rgb(${Math.round(baseRGB.r * shade)}, ${Math.round(baseRGB.g * shade)}, ${Math.round(baseRGB.b * shade)})`;
      // Приоритет сетки — как в эталоне: активность → полоса переваривания → базовый мешь.
      // Полоса переваривания учитывает ВСЕ приёмы, накрывающие этот угол (не только первый).
      const digest = digestInfoAt(props.segments, clockAngle);
      const activityKind = activityKindAt(props.segments, clockAngle);
      let stroke;
      if (activityKind === 'real') {
        // активность с известным временем — холодные голубые метки
        stroke = `rgba(120,205,225,${(0.55 + 0.4 * light).toFixed(2)})`;
      } else if (activityKind === 'estimated') {
        // дневной итог без таймлайна (шаги) — тихая полоса на все сутки,
        // не блок в конкретном часе: у него нет достоверного времени.
        stroke = `rgba(150,190,200,${(0.16 + 0.14 * light).toFixed(2)})`;
      } else if (digest) {
        // Приём: жёлтая сетка, если прогноз завершится к 18:00;
        // красная — если прогнозируемое переваривание продолжится позже.
        const hot = digest.late ? '255,45,34' : '240,205,70';
        stroke = `rgba(${hot},${(0.55 + 0.4 * light).toFixed(2)})`;
      } else {
        // базовый мешь — как в эталоне
        stroke = `rgba(150,180,228,${(0.30 + 0.16 * light).toFixed(2)})`;
      }
      const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => {
        const p = rotate(point(u, v, major, minor));
        return [cx + p.x * pulse, cy + p.y * pulse];
      });
      patches.push({ z: c3.z, corners, fill, stroke });
    }
  }
  patches.sort((a, b) => a.z - b.z);
  const split = patches.findIndex((p) => p.z >= 0);
  const far = split < 0 ? patches : patches.slice(0, split);
  const near = split < 0 ? [] : patches.slice(split);

  far.forEach((patch) => quad(context, patch.corners, patch.fill, patch.stroke));

  // центральное свечение («солнце») — ДО ближних патчей, чтобы передняя трубка перекрыла низ
  const glow = context.createRadialGradient(cx, cy, 2, cx, cy, size * .10);
  const fuel = load;
  glow.addColorStop(0, fuel > .45 ? 'rgba(224,130,74,.92)' : 'rgba(232,200,122,.95)');
  glow.addColorStop(.42, fuel > .45 ? 'rgba(224,130,74,.42)' : 'rgba(232,200,122,.42)');
  glow.addColorStop(1, 'rgba(232,200,122,0)');
  context.fillStyle = glow;
  context.beginPath(); context.arc(cx, cy, size * .10, 0, TAU); context.fill();

  near.forEach((patch) => quad(context, patch.corners, patch.fill, patch.stroke));

  // Зерно шума переработки в центре — аналог speckle() эталона (на месте светила).
  const nz = load;
  if (!reduced && nz > 0.03) {
    const grainR = size * .058 * .92;
    const visibleCount = nz * 26;
    for (let i = 0; i < Math.ceil(visibleCount); i += 1) {
      const seed = SEEDS[SEEDS.length - 1 - i];
      const presence = clamp(visibleCount - i, 0, 1);
      const a = seed.uOff * TAU;
      const rr = Math.sqrt(seed.rf) * grainR;
      const twinkle = .45 + .55 * Math.abs(Math.sin(time / seed.sp + seed.tw));
      const al = presence * twinkle * Math.min(0.72, nz * .9);
      context.beginPath();
      context.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.8 + seed.rf * 1.3, 0, TAU);
      context.fillStyle = i % 2
        ? `rgba(45,32,20,${al.toFixed(2)})`
        : `rgba(255,246,214,${al.toFixed(2)})`;
      context.fill();
    }
  }

  // ── Мерцающие точки (глюкоза) — по эталону toroid-vidzhet-2 ──────────────
  // Появление: точки рождаются на дуге приёма (позиции из фиксированных «семян»),
  //   поэтому они не «прыгают» между кадрами.
  // Исчезновение по времени: frac = digestionActivityAt() убывает от момента еды
  //   к концу окна переваривания; при frac ≤ 0.02 приём переварен и точек нет.
  // Исчезновение по активности: только пересечение с окном конкретного приёма
  //   сжимает/растягивает это окно через effectiveDigestionHours. Общий расход
  //   за день не удаляет точки задним числом.
  // Цвет — общий для дня по циклу Рендла: жир → светло-жёлтый, глюкоза → красный.
  const mealSegments = (props.segments || []).filter((segment) => !segment.isActivity);
  let fuelSum = 0; let fuelWeight = 0;
  mealSegments.forEach((segment) => {
    const weight = Math.max(0.05, clamp(segment.level, 0, 1)) * clamp(segment.frac ?? 1, 0, 1);
    fuelSum += clamp(segment.fuel ?? .5, 0, 1) * weight;
    fuelWeight += weight;
  });
  const dot = colorMix([245, 224, 138], [255, 70, 50], fuelWeight > 0 ? fuelSum / fuelWeight : .5);
  const lumGuard = size * .092;
  mealSegments.forEach((segment, segmentIndex) => {
    const frac = clamp(segment.frac ?? 1, 0, 1);
    if (frac <= 0.02) return; // приём переварен — точек нет
    const mealLoad = clamp(segment.load ?? segment.level, 0, 1);
    const jitter = reduced ? 0 : mealLoad * 2.6;
    const speed = 1 + mealLoad * .9;
    const level = clamp(segment.level, 0, 1);
    const visibleCount = clamp(4 + level * 36, 2, 44) * frac;
    for (let index = 0; index < Math.ceil(visibleCount); index += 1) {
      const seed = SEEDS[(segmentIndex * 48 + index) % SEEDS.length];
      const presence = clamp(visibleCount - index, 0, 1);
      const clockAngle = wrap(segment.start + seed.uOff * segment.span);
      const rin = minor * seed.rf; // радиус внутри трубки (< r)
      const u = wrap(base - clockAngle);
      const p = rotate(point(u, seed.v, major, rin));
      let sx = cx + p.x * pulse;
      let sy = cy + p.y * pulse;
      if (jitter) {
        sx += Math.sin(time / 110 + seed.tw * 2) * jitter;
        sy += Math.cos(time / 95 + seed.tw) * jitter;
      }
      if (Math.hypot(sx - cx, sy - cy) < lumGuard) continue; // не перекрываем огонь в центре
      const depth = clamp(.4 + .6 * (p.z + rin) / (2 * rin), .4, 1);
      const twinkle = reduced ? .7 : .35 + .65 * Math.abs(Math.sin(time * speed / seed.sp + seed.tw));
      const alpha = presence * twinkle * depth * (0.35 + 0.65 * frac);
      // beginPath обязателен: без него все дуги сливаются в один залитый контур
      context.beginPath();
      context.arc(sx, sy, (1.9 + mealLoad * .8) * depth, 0, TAU);
      context.fillStyle = `rgba(${dot[0]},${dot[1]},${dot[2]},${alpha.toFixed(2)})`;
      context.fill();
    }
  });
}

export function drawCenter(context, width, height, props) {
  const cx = width / 2; const cy = height / 2;
  const base = Math.min(width, height) * .3;
  const exp = clamp(props.expansion, 0, 1);
  const charge = clamp(props.intensity, 0, 1);
  for (let index = 3; index >= 0; index -= 1) {
    const radius = base * (1 + .06 * index);
    context.beginPath(); context.ellipse(cx, cy, radius, radius * .62, 0, 0, TAU);
    context.strokeStyle = `rgba(138,111,77,${.12 + .08 * index})`; context.lineWidth = 1; context.stroke();
  }
  const guide = base * (.5 + .85 * exp);
  context.beginPath(); context.ellipse(cx, cy, guide, guide * .62, 0, 0, TAU);
  context.strokeStyle = `rgba(176,104,63,${.35 + .45 * exp})`; context.lineWidth = 1.8; context.stroke();
  const fire = base * (.32 + .7 * exp);
  const glow = context.createRadialGradient(cx, cy, 0, cx, cy, fire);
  glow.addColorStop(0, `rgba(255,242,214,${.28 + .68 * charge})`);
  glow.addColorStop(.35, `rgba(232,200,122,${.18 + .62 * charge})`);
  glow.addColorStop(.7, `rgba(224,130,74,${.12 + .4 * charge})`);
  glow.addColorStop(1, 'rgba(224,130,74,0)');
  context.fillStyle = glow; context.beginPath(); context.ellipse(cx, cy, fire, fire * .9, 0, 0, TAU); context.fill();
  context.beginPath(); context.arc(cx, cy, base * .06, 0, TAU); context.fillStyle = `rgba(176,104,63,${.55 + .4 * exp})`; context.fill();
}
