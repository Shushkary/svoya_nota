// Тороид вокруг силуэта человека — главная визуализация «Динамики».
// Иллюстрация и метафора, не измерение здоровья.
//
// Отображение: дуги потока по вертикали тела (низ — питание и действие, грудь —
// чувства, голова — мышление), ось — аккорд; тепло цвета — самочувствие;
// скорость потока — энергия из трекера; плотность — регулярность.
//
// Дуги прибывают от внешнего края к центру: кольцо у края появляется первым,
// ядро (ближе к телу) замыкается последним. Заполнение читается как «неделя
// собралась», а не как накопление — тот же принцип, что density вместо серий.
import React from 'react';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Интерполяция в RGB: холодный серо-синий → тёплый янтарь, без прохода через зелёный.
// Экспортируется — тот же цвет состояния использует виджет «Сейчас» в «Сегодня».
const cool = [122, 140, 160];
const warm = [200, 135, 90];
const mix = (a, b, t) => Math.round(a + (b - a) * t);
export const warmthColor = (t, alpha = 1) =>
  `rgba(${mix(cool[0], warm[0], t)},${mix(cool[1], warm[1], t)},${mix(cool[2], warm[2], t)},${alpha})`;

// Три кольца дуги — от внешнего (k=1) к ядру (k=0.56). Каждое кольцо получает
// свою долю недельной шкалы intensity и проявляется по очереди: край раньше,
// ядро позже.
const RING_K = [1, 0.78, 0.56];

// Группа дуг тороида: эллипсы вокруг вертикальной оси на высоте cy.
// Полнота дуги = intensity (практики части за неделю); density — регулярность.
function ArcBand({ cy, rxMax, ryMax, intensity, color, flowDur, density }) {
  const step = 1 / RING_K.length;
  const lines = RING_K.map((k, i) => {
    const reach = clamp01((intensity - i * step) / step);
    if (reach <= 0) return null;
    return (
      <ellipse
        key={i}
        cx="170" cy={cy} rx={rxMax * k} ry={ryMax * k}
        fill="none" stroke={color}
        strokeWidth={1.4 + reach * 1.8}
        strokeDasharray="10 12"
        className="torusflow"
        style={{ animationDuration: `${flowDur}s`, animationDelay: `${i * 0.7}s` }}
        opacity={(0.35 + reach * 0.55) * (0.72 + density * 0.28)}
      />
    );
  }).filter(Boolean);
  return <g>{lines}</g>;
}

// Изящный силуэт с руками на бёдрах. Торс+ноги — залитая фигура (TORSO, правая
// половина: dx — отступ от оси x=170, y — сверху вниз до ступни у центра). Руки —
// отдельные согнутые limb'ы позади торса; треугольный «akimbo»-просвет между рукой
// и торсом получается сам собой (фон), без хрупких вырезов.
const TORSO = [
  [8, 74], [10, 88], [34, 104], [25, 124], [15, 180], [40, 246], [37, 272],
  [23, 332], [13, 354], [6, 367], [1, 362], [6, 332], [6, 262], [2, 248],
];
const ARM = [[33, 102], [62, 168], [32, 242]]; // плечо → локоть → кисть на бедре

// Плавный замкнутый путь: квадратичные Безье через середины рёбер —
// огибает точки без «перелёта», углы мягко скруглены.
function smooth(pts) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[0], pts[1]);
  let d = `M${m0[0].toFixed(1)} ${m0[1].toFixed(1)}`;
  for (let i = 1; i <= n; i++) {
    const cur = pts[i % n], nxt = pts[(i + 1) % n], m = mid(cur, nxt);
    d += ` Q${cur[0].toFixed(1)} ${cur[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  return `${d} Z`;
}

// Контур торса+ног при горизонтальном масштабе sx (ширина тела).
function torsoPath(sx) {
  const R = TORSO.map(([dx, y]) => [170 + dx * sx, y]);
  const L = [...TORSO].reverse().map(([dx, y]) => [170 - dx * sx, y]);
  return smooth([...R, ...L]);
}

// Изогнутая рука (Q через локоть); sign +1 — правая, −1 — левая.
function armPath(sx, sign) {
  const p = ARM.map(([dx, y]) => [170 + sign * dx * sx, y]);
  return `M${p[0][0].toFixed(1)} ${p[0][1]} Q${p[1][0].toFixed(1)} ${p[1][1]} ${p[2][0].toFixed(1)} ${p[2][1]}`;
}

export default function Toroid({ summary, width = '100%' }) {
  const { arcs, core, warmth, flow, density } = summary;
  const flowDur = 16 - flow * 10; // быстрее при высокой энергии
  const bodyColor = warmthColor(warmth, 0.92);
  const sx = 1;                                     // фиксированная ширина силуэта — метафора, не замер
  const headRx = 19, headRy = 24, headCy = 50;
  const bands = [
    // низ — питание и действие (обменно-двигательный полюс: еда и воля вместе)
    { cy: 210, rxMax: 96, ryMax: 34, intensity: arcs.lower, color: 'var(--nutrition)' },
    // грудь — чувства и тело
    { cy: 150, rxMax: 108, ryMax: 40, intensity: arcs.feelings, color: 'var(--feelings)' },
    // голова — мышление
    { cy: 52, rxMax: 74, ryMax: 30, intensity: arcs.mind, color: 'var(--mind)' },
  ];
  return (
    <svg viewBox="0 0 340 380" width={width} role="img"
      aria-label="Тороид состояния: дуги питания и действия, чувств, мышления и ось согласованности">
      {/* задние половины дуг */}
      {bands.map((b, i) => <ArcBand key={`b${i}`} {...b} flowDur={flowDur} density={density} />)}

      {/* силуэт человека — фиксированная ширина, метафора, не замер.
          Руки позади торса → akimbo-просвет между рукой и телом получается сам. */}
      <g fill={bodyColor}>
        <path d={armPath(sx, 1)} fill="none" stroke={bodyColor} strokeWidth={13}
          strokeLinecap="round" />
        <path d={armPath(sx, -1)} fill="none" stroke={bodyColor} strokeWidth={13}
          strokeLinecap="round" />
        <ellipse cx="170" cy={headCy} rx={headRx} ry={headRy} />
        <path d={torsoPath(sx)} />
      </g>

      {/* ось — аккорд */}
      <line x1="170" y1="26" x2="170" y2="352" stroke="var(--accord)"
        strokeWidth={1.6 + core * 1.8} opacity={0.35 + core * 0.55} />
      <circle cx="170" cy="185" r={5 + core * 4} fill="var(--accord)" opacity={0.4 + core * 0.5} />
      <circle cx="170" cy="185" r={12 + core * 8} fill="none" stroke="var(--accord)"
        strokeWidth="1" opacity={0.22 + core * 0.35} />

      {/* точки зон на оси тела: голова · грудь · низ */}
      <g stroke="rgba(255,255,255,0.65)" strokeWidth="1">
        <circle cx="170" cy={headCy} r={4 + arcs.mind * 3} fill="var(--mind)"
          opacity={0.6 + arcs.mind * 0.4}>
          <title>голова · мышление</title>
        </circle>
        <circle cx="170" cy="150" r={4 + arcs.feelings * 3} fill="var(--feelings)"
          opacity={0.6 + arcs.feelings * 0.4}>
          <title>грудь · чувства и тело</title>
        </circle>
        <circle cx="170" cy="210" r={4 + arcs.lower * 3} fill="var(--nutrition)"
          opacity={0.6 + arcs.lower * 0.4}>
          <title>низ · питание и действие</title>
        </circle>
      </g>

    </svg>
  );
}

export function MiniToroid({ summary, size = 56, label }) {
  const { arcs, core, warmth } = summary;
  const mean = (arcs.lower + arcs.feelings + arcs.mind) / 3;
  return (
    <div className="mt1">
      <svg viewBox="0 0 60 60" width={size} height={size} aria-label={`Неделя ${label}`}>
        <ellipse cx="30" cy="38" rx="17" ry="6" fill="none" stroke="var(--nutrition)"
          strokeWidth={1 + arcs.lower * 1.4} opacity={0.25 + arcs.lower * 0.6} />
        <ellipse cx="30" cy="29" rx="19" ry="7" fill="none" stroke="var(--feelings)"
          strokeWidth={1 + arcs.feelings * 1.4} opacity={0.25 + arcs.feelings * 0.6} />
        <ellipse cx="30" cy="18" rx="13" ry="5" fill="none" stroke="var(--mind)"
          strokeWidth={1 + arcs.mind * 1.4} opacity={0.25 + arcs.mind * 0.6} />
        <line x1="30" y1="7" x2="30" y2="53" stroke="var(--accord)"
          strokeWidth={1 + core * 1.6} opacity={0.25 + core * 0.6} />
        <circle cx="30" cy="30" r={2 + mean * 2.5} fill={warmthColor(warmth, 0.8)} />
      </svg>
      <div>{label}</div>
    </div>
  );
}
