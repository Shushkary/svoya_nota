// Тороид вокруг силуэта человека — главная визуализация «Динамики».
// Иллюстрация и метафора, не измерение здоровья.
//
// Отображение: дуги потока по вертикали тела (живот — питание, грудь — чувства,
// голова — мышление, внешний контур — воля), ось — аккорд; тепло цвета —
// самочувствие; скорость потока — энергия из трекера; плотность — регулярность.
import React from 'react';

// Интерполяция в RGB: холодный серо-синий → тёплый янтарь, без прохода через зелёный.
const cool = [122, 140, 160];
const warm = [200, 135, 90];
const mix = (a, b, t) => Math.round(a + (b - a) * t);
const warmthColor = (t, alpha = 1) =>
  `rgba(${mix(cool[0], warm[0], t)},${mix(cool[1], warm[1], t)},${mix(cool[2], warm[2], t)},${alpha})`;

// Группа дуг тороида: эллипсы вокруг вертикальной оси на высоте cy.
// Полнота дуги = intensity (практики части за неделю); density — регулярность.
function ArcBand({ cy, rxMax, ryMax, intensity, color, flowDur, density }) {
  const n = intensity <= 0.02 ? 1 : 1 + Math.round(intensity * 2); // 1..3 линии
  const lines = Array.from({ length: n }, (_, i) => {
    const k = 1 - i * 0.22;
    return (
      <ellipse
        key={i}
        cx="170" cy={cy} rx={rxMax * k} ry={ryMax * k}
        fill="none" stroke={color}
        strokeWidth={1.8 + intensity * 1.6}
        strokeDasharray="10 12"
        className="torusflow"
        style={{ animationDuration: `${flowDur}s`, animationDelay: `${i * 0.7}s` }}
        opacity={(0.5 + intensity * 0.45) * (0.72 + density * 0.28)}
      />
    );
  });
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
    // живот — питание
    { cy: 210, rxMax: 96, ryMax: 34, intensity: arcs.nutrition, color: 'var(--nutrition)' },
    // грудь — чувства и тело
    { cy: 150, rxMax: 108, ryMax: 40, intensity: arcs.feelings, color: 'var(--feelings)' },
    // голова — мышление
    { cy: 52, rxMax: 74, ryMax: 30, intensity: arcs.mind, color: 'var(--mind)' },
  ];
  return (
    <svg viewBox="0 0 340 380" width={width} role="img"
      aria-label="Тороид состояния: дуги питания, чувств, мышления, контур воли и ось согласованности">
      {/* внешний контур — воля */}
      <ellipse cx="170" cy="196" rx={132} ry={184} fill="none" stroke="var(--will)"
        strokeWidth={1.8 + arcs.will * 1.6} strokeDasharray="12 14" className="torusflow"
        style={{ animationDuration: `${flowDur + 3}s` }}
        opacity={(0.48 + arcs.will * 0.42) * (0.72 + density * 0.28)} />
      <ellipse cx="170" cy="196" rx={118} ry={172} fill="none" stroke="var(--will)"
        strokeWidth={1.4 + arcs.will * 1.2} strokeDasharray="12 14" className="torusflow"
        style={{ animationDuration: `${flowDur + 4.5}s`, animationDelay: '1s' }}
        opacity={(0.36 + arcs.will * 0.4) * (0.72 + density * 0.28)} />

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

      {/* точки зон на оси тела: голова · грудь · живот (воля — контур) */}
      <g stroke="rgba(255,255,255,0.65)" strokeWidth="1">
        <circle cx="170" cy={headCy} r={4 + arcs.mind * 3} fill="var(--mind)"
          opacity={0.6 + arcs.mind * 0.4}>
          <title>голова · мышление</title>
        </circle>
        <circle cx="170" cy="150" r={4 + arcs.feelings * 3} fill="var(--feelings)"
          opacity={0.6 + arcs.feelings * 0.4}>
          <title>грудь · чувства и тело</title>
        </circle>
        <circle cx="170" cy="210" r={4 + arcs.nutrition * 3} fill="var(--nutrition)"
          opacity={0.6 + arcs.nutrition * 0.4}>
          <title>живот · питание</title>
        </circle>
      </g>

    </svg>
  );
}

export function MiniToroid({ summary, size = 56, label }) {
  const { arcs, core, warmth } = summary;
  const mean = (arcs.nutrition + arcs.feelings + arcs.mind + arcs.will) / 4;
  return (
    <div className="mt1">
      <svg viewBox="0 0 60 60" width={size} height={size} aria-label={`Неделя ${label}`}>
        <ellipse cx="30" cy="30" rx="24" ry="27" fill="none" stroke="var(--will)"
          strokeWidth={1 + arcs.will * 1.4} opacity={0.25 + arcs.will * 0.6} />
        <ellipse cx="30" cy="38" rx="17" ry="6" fill="none" stroke="var(--nutrition)"
          strokeWidth={1 + arcs.nutrition * 1.4} opacity={0.25 + arcs.nutrition * 0.6} />
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
