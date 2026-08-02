// Общие компоненты представления. Расчётов предметной области здесь нет.
import React from 'react';
import { MODULES } from '../domain/practices.js';

export function Card({ eyebrow, module, children, tight, ...rest }) {
  return (
    <section className={`card${tight ? ' tight' : ''}`} {...rest}>
      {eyebrow && (
        <p className="eyebrow">
          {module && <span className="dot" style={{ background: MODULES[module]?.color }} />}
          {eyebrow}
        </p>
      )}
      {children}
    </section>
  );
}

export function SliderRow({ label, ends, value, onChange, min = 1, max = 5 }) {
  return (
    <div className="slider-row">
      <div className="lab"><span>{label}</span><span>{ends}</span></div>
      <input
        type="range" min={min} max={max} step="1" value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  );
}

export const STATE_FIELDS = [
  { id: 'calm', label: 'Покой', ends: 'напряжённо · спокойно' },
  { id: 'energy', label: 'Энергия', ends: 'без сил · бодро' },
  { id: 'clarity', label: 'Ясность', ends: 'туманно · ясно' },
  { id: 'warmth', label: 'Тепло к себе', ends: 'жёстко · тепло' },
];

export function StateSliders({ value, onChange, fields = STATE_FIELDS }) {
  return (
    <div>
      {fields.map((f) => (
        <SliderRow
          key={f.id} label={f.label} ends={f.ends}
          value={value[f.id] ?? 3}
          onChange={(v) => onChange({ ...value, [f.id]: v })}
        />
      ))}
    </div>
  );
}

export function Sparkline({ series, width = 300, height = 46,
  color = 'var(--acc)', min = 1, max = 5, label = 'Линия самочувствия' }) {
  const points = series.map((s, i) => ({ i, v: s.value })).filter((p) => p.v !== null);
  if (points.length < 2) {
    return <p className="tiny">Мало данных для линии — она появится после нескольких отметок.</p>;
  }
  const span = Math.max(max - min, 1e-6); // защита от деления на 0
  const x = (i) => 4 + (i / (series.length - 1)) * (width - 8);
  const y = (v) => height - 6 - ((v - min) / span) * (height - 12);
  const mid = (min + max) / 2;
  const path = points.map((p, idx) => `${idx ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img"
      aria-label={label}>
      <line x1="4" y1={y(mid)} x2={width - 4} y2={y(mid)} stroke="var(--line)" strokeDasharray="3 4" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      {points.slice(-1).map((p) => (
        <circle key="last" cx={x(p.i)} cy={y(p.v)} r="3" fill={color} />
      ))}
    </svg>
  );
}

export function Sheet({ onClose, children }) {
  const downTarget = React.useRef(null);
  return (
    <div
      className="scrim"
      onPointerDown={(e) => { downTarget.current = e.target; }}
      onClick={(e) => {
        // Закрываем только если И нажатие, И отпускание были на самом скриме —
        // иначе «призрачный клик» (модалка открылась под курсором) сразу её закроет.
        if (e.target === e.currentTarget && downTarget.current === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="grip" />
        {children}
      </div>
    </div>
  );
}

const ICONS = {
  today: <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z" />,
  body: <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8z" />,
  practice: <path d="M8 5v14l11-7z" />,
  accord: <path d="M9 18a2.5 2.5 0 1 1-2.5-2.5H9zm0 0V6l9-2v11m0 0a2.5 2.5 0 1 1-2.5-2.5H18z" />,
  dynamics: <path d="M12 3c4 0 7 1.8 7 4s-3 4-7 4-7-1.8-7-4 3-4 7-4zM5 12c0 2.2 3 4 7 4s7-1.8 7-4M5 16c0 2.2 3 4 7 4s7-1.8 7-4" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  draft: <path d="M8 6h11M8 12h11M8 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
};

export function TabBar({ tabs, active, onSelect }) {
  return (
    <nav className="tabbar" aria-label="Разделы">
      <div className="row">
        {tabs.map((t) => (
          <button key={t.id} className={active === t.id ? 'on' : ''} onClick={() => onSelect(t.id)}
            aria-current={active === t.id}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[t.icon]}</svg>
            {t.name}
          </button>
        ))}
      </div>
    </nav>
  );
}
