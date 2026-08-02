// Исполнитель практики: отметка «до» → шаги (таймер или форма) → отметка «после».
// Дельта состояния — часть петли; неоконченная практика тоже сохраняется честно.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MODULES } from '../domain/practices.js';
import { Card, Sheet, SliderRow } from './components.jsx';

const PRE_POST = [
  { id: 'calm', label: 'Покой', ends: 'напряжённо · спокойно' },
  { id: 'clarity', label: 'Ясность', ends: 'туманно · ясно' },
];

function RingTimer({ totalSec, leftSec }) {
  const R = 56;
  const C = 2 * Math.PI * R;
  const done = totalSec > 0 ? 1 - leftSec / totalSec : 0;
  const mm = Math.floor(leftSec / 60);
  const ss = String(leftSec % 60).padStart(2, '0');
  return (
    <svg className="ring" width="150" height="150" viewBox="0 0 150 150">
      <circle cx="75" cy="75" r={R} fill="none" stroke="var(--line)" strokeWidth="6" />
      <circle cx="75" cy="75" r={R} fill="none" stroke="var(--acc)" strokeWidth="6"
        strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - done)}
        transform="rotate(-90 75 75)" />
      <text className="digits" x="75" y="82" textAnchor="middle">{mm}:{ss}</text>
    </svg>
  );
}

function TimedSteps({ practice, onDone }) {
  const stepsSec = useMemo(() => {
    const explicit = practice.steps.every((s) => s.sec);
    if (explicit) return practice.steps.map((s) => s.sec);
    const totalW = practice.steps.reduce((a, s) => a + (s.w || 1), 0);
    return practice.steps.map((s) => Math.round((practice.minutes * 60 * (s.w || 1)) / totalW));
  }, [practice]);
  const [idx, setIdx] = useState(0);
  const [left, setLeft] = useState(stepsSec[0]);
  const [paused, setPaused] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    if (paused) return undefined;
    const t = setInterval(() => setLeft((v) => v - 1), 1000);
    return () => clearInterval(t);
  }, [paused]);

  useEffect(() => {
    if (left > 0 || doneRef.current) return;
    if (idx + 1 < practice.steps.length) {
      setIdx(idx + 1);
      setLeft(stepsSec[idx + 1]);
      if (navigator.vibrate) navigator.vibrate(80);
    } else {
      doneRef.current = true;
      if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
      onDone(stepsSec.reduce((a, b) => a + b, 0));
    }
  }, [left, idx, practice, stepsSec, onDone]);

  const step = practice.steps[idx];
  return (
    <div className="run">
      <p className="stepno">Шаг {idx + 1} из {practice.steps.length} · {step.t}</p>
      <p className="instr">{step.i}</p>
      <RingTimer totalSec={stepsSec[idx]} leftSec={Math.max(0, left)} />
      <div className="linkrow" style={{ justifyContent: 'center' }}>
        <button className="tbtn" onClick={() => setPaused(!paused)}>{paused ? 'продолжить' : 'пауза'}</button>
        {idx + 1 < practice.steps.length && (
          <button className="tbtn" onClick={() => { setIdx(idx + 1); setLeft(stepsSec[idx + 1]); }}>
            дальше
          </button>
        )}
        <button className="tbtn" onClick={() => {
          doneRef.current = true;
          const spent = stepsSec.slice(0, idx).reduce((a, b) => a + b, 0) + (stepsSec[idx] - Math.max(0, left));
          onDone(spent);
        }}>завершить</button>
      </div>
    </div>
  );
}

function FormSteps({ practice, onDone }) {
  const [values, setValues] = useState({});
  const startRef = useRef(Date.now());
  return (
    <div>
      {practice.fields.map((f) => (
        <div key={f.id}>
          {f.type === 'slider' ? (
            <SliderRow label={f.label} ends={f.ends}
              value={values[f.id] ?? 3} onChange={(v) => setValues({ ...values, [f.id]: v })} />
          ) : (
            <>
              <label className="fl" htmlFor={`ff-${f.id}`}>{f.label}</label>
              <textarea id={`ff-${f.id}`} placeholder={f.hint} rows={2}
                value={values[f.id] || ''}
                onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} />
            </>
          )}
          {f.type === 'slider' && f.hint && <p className="tiny">{f.hint}</p>}
        </div>
      ))}
      <button className="btn" onClick={() => onDone(Math.round((Date.now() - startRef.current) / 1000), values)}>
        Готово
      </button>
    </div>
  );
}

function AudioSteps({ practice, onDone }) {
  const startedAt = useRef(Date.now());
  const completed = useRef(false);
  const finish = () => {
    if (completed.current) return;
    completed.current = true;
    onDone(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
  };
  return (
    <div className="run audio-practice">
      <p className="instr">Устройтесь безопасно сидя или лёжа. Запись управляется обычными кнопками плеера.</p>
      <audio controls preload="metadata" onEnded={finish}>
        <source src={practice.audioUrl} type="audio/mpeg" />
        Ваш браузер не поддерживает воспроизведение аудио.
      </audio>
      <p className="tiny dim">Можно остановиться в любой момент и вернуться к обычному дыханию.</p>
      <button className="btn" onClick={finish}>Завершить практику</button>
    </div>
  );
}

export default function Runner({ practice, onSave, onClose }) {
  const [phase, setPhase] = useState('pre'); // pre → steps → post
  const [pre, setPre] = useState({ calm: 3, clarity: 3 });
  const [post, setPost] = useState({ calm: 3, clarity: 3 });
  const [result, setResult] = useState(null);
  const [reflection, setReflection] = useState('');
  const module = MODULES[practice.module];

  const finish = () => {
    const delta = ((post.calm - pre.calm) + (post.clarity - pre.clarity)) / 2;
    onSave({
      module: practice.module,
      practiceId: practice.id,
      durationSec: result?.durationSec ?? 0,
      completed: true,
      pre, post, delta,
      form: result?.form,
      reflection: reflection.trim() || undefined,
    });
  };

  return (
    <Sheet onClose={onClose}>
      <p className="eyebrow">
        <span className="dot" style={{ background: module.color }} />
        {module.name} · {practice.minutes} мин
      </p>
      <h2>{practice.title}</h2>
      <p className="dim">{practice.intent}</p>
      {practice.safety && <p className="note warn">{practice.safety}</p>}

      {phase === 'pre' && (
        <>
          <h3>Как сейчас?</h3>
          {PRE_POST.map((f) => (
            <SliderRow key={f.id} label={f.label} ends={f.ends}
              value={pre[f.id]} onChange={(v) => setPre({ ...pre, [f.id]: v })} />
          ))}
          <button className="btn" onClick={() => setPhase('steps')}>Начать</button>
          <button className="btn ghost" onClick={onClose}>Не сейчас</button>
        </>
      )}

      {phase === 'steps' && (practice.kind === 'timed' ? (
        <TimedSteps practice={practice}
          onDone={(durationSec) => { setResult({ durationSec }); setPhase('post'); }} />
      ) : practice.kind === 'audio' ? (
        <AudioSteps practice={practice}
          onDone={(durationSec) => { setResult({ durationSec }); setPhase('post'); }} />
      ) : (
        <FormSteps practice={practice}
          onDone={(durationSec, form) => { setResult({ durationSec, form }); setPhase('post'); }} />
      ))}

      {phase === 'post' && (
        <>
          <h3>А теперь?</h3>
          {PRE_POST.map((f) => (
            <SliderRow key={f.id} label={f.label} ends={f.ends}
              value={post[f.id]} onChange={(v) => setPost({ ...post, [f.id]: v })} />
          ))}
          <label className="fl" htmlFor="refl">Одна фраза о том, что заметили (необязательно)</label>
          <textarea id="refl" rows={2} value={reflection}
            onChange={(e) => setReflection(e.target.value)} />
          <button className="btn" onClick={finish}>Сохранить</button>
        </>
      )}
    </Sheet>
  );
}
