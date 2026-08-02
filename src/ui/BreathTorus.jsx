// Дыхательный тороид — canvas-анимация из toroid-centra.html.
// Полностью переписан: RAF-цикл работает через refs, не зависит от ре-рендеров React.
// Прямое обновление DOM для текста фазы и таймера — максимально плавно.
import { useEffect, useRef } from 'react';

const clamp = (x, lo, hi) => {
  const n = Number(x);
  if (!isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
};
const easeBreath = (p) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(p, 0, 1));

// Дыхательные фазы: [длительность_сек, kind, from, to, label]
const PHASES = {
  br1: [ // Ровный медленный ритм — вдох 5с, выдох 6с
    { sec: 5, kind: 'in',  from: 0, to: 1, label: 'Вдох' },
    { sec: 6, kind: 'out', from: 1, to: 0, label: 'Выдох' },
  ],
  br2: [ // Длинный выдох — вдох 4с, выдох 8с
    { sec: 4, kind: 'in',  from: 0, to: 1, label: 'Вдох' },
    { sec: 8, kind: 'out', from: 1, to: 0, label: 'Выдох' },
  ],
};

function cycleSec(phases) {
  return phases.reduce((s, p) => s + p.sec, 0);
}

function phaseAt(phases, elapsedS) {
  const cyc = cycleSec(phases);
  if (cyc <= 0) return { label: '', exp: 0 };
  let t = elapsedS % cyc, i = 0;
  while (i < phases.length && t >= phases[i].sec) { t -= phases[i].sec; i++; }
  if (i >= phases.length) i = phases.length - 1;
  const p = phases[i];
  const prog = p.sec > 0 ? t / p.sec : 1;
  const exp = p.from + (p.to - p.from) * easeBreath(prog);
  return { label: p.label, exp: clamp(exp, 0, 1) };
}

function drawTorus(ctx, w, h, exp, glow) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const baseR = Math.min(w, h) * 0.30;

  // Фоновые кольца
  for (let k = 3; k >= 0; k--) {
    const rr = baseR * (1 + 0.06 * k);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rr, rr * 0.62, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(200,169,110,${0.05 + 0.05 * k})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Главное дыхательное кольцо
  const gr = baseR * (0.5 + 0.85 * exp);
  ctx.beginPath();
  ctx.ellipse(cx, cy, gr, gr * 0.62, 0, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(232,200,122,${0.18 + 0.22 * exp})`;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Свечение центра (огонь)
  const fr = baseR * (0.32 + 0.7 * exp);
  const a = clamp(glow, 0, 1);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, fr);
  g.addColorStop(0,    `rgba(255,242,214,${0.95 * a})`);
  g.addColorStop(0.35, `rgba(232,200,122,${0.80 * a})`);
  g.addColorStop(0.7,  `rgba(224,130,74,${0.45 * a})`);
  g.addColorStop(1,    'rgba(224,130,74,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, fr, fr * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ядро
  ctx.beginPath();
  ctx.arc(cx, cy, baseR * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,242,214,${0.5 + 0.4 * exp})`;
  ctx.fill();
}

// props: practiceId, stepIdx, totalSteps, leftSec, paused
export default function BreathTorus({ practiceId, stepIdx, totalSteps, leftSec, paused }) {
  const canvasRef = useRef(null);
  const phaseRef = useRef(null);
  const timeRef = useRef(null);

  // Хранилище мутабельного состояния анимации — переживает ре-рендеры
  const anim = useRef({
    raf: 0,
    elapsed: 0,        // накопленные секунды дыхания
    lastTick: 0,       // timestamp последнего кадра
    paused: false,
    phases: null,      // активные фазы или null (холостой ход)
  });

  // Обновляем props в ref без перезапуска цикла
  const propsRef = useRef({ stepIdx, totalSteps, leftSec, paused });
  propsRef.current = { stepIdx, totalSteps, leftSec, paused };

  // Главный эффект — запускается один раз, живёт до размонтирования
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
    const ctx = cv.getContext('2d');

    // Сайзинг canvas с DPR
    const resize = () => {
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.max(1, Math.round(rect.width * dpr));
      cv.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const a = anim.current;
    a.lastTick = performance.now();

    const loop = (now) => {
      const dt = (now - a.lastTick) / 1000;
      a.lastTick = now;

      const { stepIdx: si, totalSteps: ts, leftSec: ls, paused: p } = propsRef.current;

      // Определяем фазы для текущего шага
      const ph = PHASES[practiceId];
      const isBreathingStep = ph && si >= 1 && si < ts - 1;
      const phases = isBreathingStep ? ph : null;

      // Накапливаем время только когда не на паузе
      if (!p) {
        a.elapsed += dt;
      }

      // Рисуем
      const rect = cv.getBoundingClientRect();
      const w = rect.width, h = rect.height;

      if (phases) {
        // Дыхательный шаг — анимация в такт фазам
        const info = phaseAt(phases, a.elapsed);
        const glow = 0.5 + 0.4 * info.exp;
        drawTorus(ctx, w, h, info.exp, glow);

        // Прямое обновление DOM — без React ре-рендера
        if (phaseRef.current) phaseRef.current.textContent = info.label;
      } else {
        // Холостой ход — лёгкое покачивание
        const idle = 0.12 + 0.08 * Math.sin(a.elapsed * 0.8);
        drawTorus(ctx, w, h, idle, 0.2);
        if (phaseRef.current) phaseRef.current.textContent = '';
      }

      // Обновляем таймер
      if (timeRef.current) {
        const sec = Math.max(0, ls);
        const mm = Math.floor(sec / 60);
        const ss = String(sec % 60).padStart(2, '0');
        timeRef.current.textContent = `${mm}:${ss}`;
      }

      a.raf = requestAnimationFrame(loop);
    };
    a.raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(a.raf);
      window.removeEventListener('resize', resize);
    };
  }, [practiceId]); // Только practiceId — цикл не перезапускается на каждый ре-рендер

  return (
    <div className="breath-torus">
      <div className="breath-stage">
        <canvas ref={canvasRef} width="300" height="240" aria-hidden="true" />
      </div>
      <div className="breath-phase" ref={phaseRef} aria-live="polite" />
      <div className="breath-time" ref={timeRef} />
    </div>
  );
}
