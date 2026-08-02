// «Практика»: каталог по частям (тело·дыхание, чувства, мышление, воля) — свёрнут
// для компактности, тороид центра открывается отдельной кнопкой поверх экрана,
// и волевые циклы — намерение → шаг → возвращение без самонаказания.
import React, { useEffect, useRef, useState } from 'react';
import { solarSessionToEntry } from '../../application/practice/session.js';
import { adherence, breathCount, breathingCoherence, cycleSeconds, paceBpm, phaseAt, phasesFor } from '../../domain/practice/breathing.js';
import { centerCharge, streakDays, weekBuckets } from '../../domain/practice/progress.js';
import { MODULES, byModule } from '../../domain/practices.js';
import { createPulseSensor, pulseErrorText } from '../../infrastructure/pulse-sensor.js';
import { Card, Sheet } from '../components.jsx';
import ToroidCanvas from '../ToroidCanvas.jsx';

const GROUPS = ['soma', 'feelings', 'mind', 'will'];

const PROTOCOLS = {
  coherent: { name: 'Когерентное', note: 'Ровный вдох и выдох. Спокойный базовый ритм.' },
  box: { name: 'Бокс 4·4·4·4', note: 'Равные фазы для собранности.' },
  sigh: { name: 'Физиологический вздох', note: 'Короткая практика для быстрого снижения напряжения.' },
  r478: { name: '4‑7‑8', note: 'Мягкий вечерний ритм с длинным выдохом.' },
  belly: { name: 'Диафрагмальное', note: 'Медленно, с движением живота.' },
  fire: { name: 'Огненное (мягко)', note: 'Короткие активные циклы. Не используйте при головокружении и дискомфорте.' },
};

const SIMPLE_PROTOCOLS = ['coherent', 'sigh', 'belly'];
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor((sorted.length - 1) / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle] + sorted[middle + 1]) / 2;
};

function SolarSheet({ addEntry, lists, goTo, onClose }) {
  const [protocol, setProtocol] = useState('coherent');
  const [cadence, setCadence] = useState(5.5);
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [taps, setTaps] = useState([]);
  const [mode, setMode] = useState('simple');
  const [checkinOn, setCheckinOn] = useState(false);
  const [checkin, setCheckin] = useState({ calm: 3, steady: 3, warm: 3 });
  const [preCheckin, setPreCheckin] = useState(null);
  const [showMethod, setShowMethod] = useState(false);
  const [bioSource, setBioSource] = useState('none');
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState('');
  const [showBioHelp, setShowBioHelp] = useState(false);
  const [sensor, setSensor] = useState({ mode: 'none', streaming: false, ibis: [], hr: null, rmssd: null, quality: 0, error: '' });
  const startedAt = useRef(0);
  const accumulated = useRef(0);
  const sensorRef = useRef(null);
  const cameraRef = useRef(null);
  const coherenceSamples = useRef([]);
  const phases = phasesFor(protocol, cadence);
  const seconds = elapsedMs / 1000;
  const current = phaseAt(phases, seconds);
  const sessions = lists.practice
    .filter((entry) => !entry.payload?.deleted && entry.payload?.practiceId === 'solar-breath')
    .map((entry) => ({ date: entry.at, durationMs: Number(entry.payload?.durationSec || 0) * 1000, ...(entry.payload?.form || {}) }));
  const charge = centerCharge(sessions);
  const streak = streakDays(sessions);
  const week = weekBuckets(sessions);
  const coherence = running && sensor.quality >= 0.35
    ? breathingCoherence(sensor.ibis, (second) => phaseAt(phases, second).exp, startedAt.current, accumulated.current)
    : null;
  const measured = sensor.quality >= 0.35;
  const adherenceAverage = average(sessions.map((item) => item.adherence).filter(Number.isFinite));
  const calmAverage = average(sessions.map((item) => item.calmDelta).filter(Number.isFinite));
  const coherenceAverage = average(sessions.map((item) => item.coherence).filter(Number.isFinite));
  const bioMessage = bioError || sensor.error || (bioSource === 'none'
    ? 'Датчик не подключён — созвучие не измеряется. Можно выбрать Bluetooth, касание или камеру.'
    : !sensor.streaming ? 'Источник остановлен. Подключите его повторно.'
      : !measured ? (bioSource === 'camera' ? 'Сигнал пока слабый: прижмите палец к камере и держите ровно.' : bioSource === 'tap' ? 'Нажимайте «Удар ♥» в ритме пульса. Нужно несколько касаний.' : 'Жду данные с датчика.')
        : bioSource === 'tap' ? 'Отсчёт касанием — грубая оценка, не медицинское измерение.' : 'Сигнал достаточный для ориентировочной оценки созвучия.');

  useEffect(() => {
    const adapter = createPulseSensor(setSensor);
    sensorRef.current = adapter;
    const hide = () => {
      if (document.hidden && adapter.snapshot().mode === 'camera') {
        adapter.stop();
        setBioSource('none');
        setBioError('Камера остановлена, когда приложение ушло в фон.');
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); adapter.stop(); };
  }, []);

  useEffect(() => {
    if (running && Number.isFinite(coherence)) coherenceSamples.current.push(coherence);
    if (coherenceSamples.current.length > 3000) coherenceSamples.current.shift();
  }, [coherence, running]);

  useEffect(() => {
    if (!running) return undefined;
    let frame = 0;
    const tick = () => {
      setElapsedMs(accumulated.current + Date.now() - startedAt.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  const startOrStop = () => {
    if (!running) {
      if (elapsedMs === 0) {
        if (checkinOn) setPreCheckin({ ...checkin });
        coherenceSamples.current = [];
      }
      startedAt.current = Date.now();
      setRunning(true);
      return;
    }
    const durationMs = accumulated.current + Date.now() - startedAt.current;
    accumulated.current = durationMs;
    setElapsedMs(durationMs);
    setRunning(false);
  };

  const finish = () => {
    const durationMs = running ? accumulated.current + Date.now() - startedAt.current : accumulated.current;
    if (durationMs < 1_000) { onClose(); return; }
    const entry = solarSessionToEntry({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      date: new Date().toISOString(), protocol, durationMs,
      breaths: breathCount(phases, durationMs / 1000),
      adherence: adherence(taps, cycleSeconds(phases)), coherence: median(coherenceSamples.current), cadence,
      calmDelta: checkinOn && preCheckin ? checkin.calm - preCheckin.calm : null,
      checkin: checkinOn ? { pre: preCheckin, post: { ...checkin } } : null,
      pulseSource: sensor.mode, signalQuality: sensor.quality,
      heartRate: measured ? sensor.hr : null, rmssd: measured ? sensor.rmssd : null,
    });
    addEntry(entry.kind, entry.payload, entry.at, entry.clientId);
    onClose();
  };

  const choose = (key) => {
    if (running) return;
    setProtocol(key);
    accumulated.current = 0;
    setElapsedMs(0);
    setTaps([]);
    coherenceSamples.current = [];
  };

  const changeMode = (nextMode) => {
    setMode(nextMode);
    if (nextMode === 'simple') {
      sensorRef.current?.stop();
      setBioSource('none');
      setBioError('');
      if (!SIMPLE_PROTOCOLS.includes(protocol)) choose('coherent');
    }
  };

  const changeBioSource = async (source) => {
    setBioError('');
    if (source === 'none') {
      sensorRef.current?.stop();
      setBioSource('none');
      return;
    }
    setBioBusy(true);
    const result = await sensorRef.current?.start(source, { video: cameraRef.current });
    if (!result?.ok) {
      sensorRef.current?.stop();
      setBioSource('none');
      setBioError(pulseErrorText(result?.reason, source));
    } else setBioSource(source);
    setBioBusy(false);
  };

  return (
    <Sheet onClose={onClose}>
      <div className="center-legacy">
        <div className="center-topbar"><button className="center-btn" onClick={() => { onClose(); goTo?.('dynamics'); }}>Профиль</button><span className="center-mode"><button className={mode === 'simple' ? 'on' : ''} aria-pressed={mode === 'simple'} onClick={() => changeMode('simple')}>Просто</button><button className={mode === 'full' ? 'on' : ''} aria-pressed={mode === 'full'} onClick={() => changeMode('full')}>Полно</button></span><button className="center-btn primary" onClick={() => setShowMethod((value) => !value)}>Инструкция · метод</button></div>
        <button className="tbtn" onClick={onClose}>← Назад в практику</button>
        {showMethod && <div className="center-method"><h2>Тороид центра — <em>солнечное сплетение</em></h2><p>Дыхание, внимание к телу и внутренний огонь. Под метафорой — физиология диафрагмы, барорефлекса и саморегуляции.</p><p>Выберите протокол и дышите с проводником. Несколько минут регулярно важнее редких длинных подходов.</p><p><b>Измерено:</b> время, вдохи, темп. <b>Модель:</b> огонь и заряд. <b>Сам-отчёт:</b> ваше состояние до и после.</p><p className="note warn">При головокружении остановитесь и дышите обычно. Практика не заменяет медицинскую помощь.</p></div>}

        <div className="center-grid">
          <section className="center-card span">
            <div className="center-cap"><span>Сессия · дыхательный проводник <i>модель</i></span><b>{PROTOCOLS[protocol].name}</b></div>
            <div className="center-stage-old">
              <ToroidCanvas variant="center" expansion={running ? current.exp : .12 + charge * .25} intensity={running ? .58 + current.exp * .35 : .18 + charge * .4} segments={[]} />
              <div className="center-breath-guide" role="status" aria-live="polite">
                <b>{running ? current.label : elapsedMs ? 'Пауза' : 'Готово'}</b>
                <span>{running ? `${current.tLeft} с` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`}</span>
              </div>
              <div className="center-transport"><button className="center-btn primary" onClick={startOrStop}>{running ? 'Пауза' : elapsedMs ? 'Продолжить' : 'Поехали'}</button><button className="center-btn" disabled={!running} onClick={() => setTaps((value) => [...value, Date.now()])}>В такт</button>{sensor.mode === 'tap' && sensor.streaming && <button className="center-btn pulse" onClick={() => sensorRef.current?.tap()}>Удар ♥</button>}<button className="center-btn" disabled={elapsedMs < 1000} onClick={finish}>Остановка</button></div>
              <div className="center-readout"><span>время <b>{Math.floor(seconds / 60)}:{String(Math.floor(seconds % 60)).padStart(2, '0')}</b> <i>измерено</i></span><span>вдохов <b>{breathCount(phases, seconds)}</b> <i>измерено</i></span><span>ритм <b>{paceBpm(phases).toFixed(1)} /мин</b> <i>измерено</i></span>{adherence(taps, cycleSeconds(phases)) != null && <span>в такт <b>{Math.round(adherence(taps, cycleSeconds(phases)) * 100)}%</b></span>}</div>
              <p className="center-hint">Огонь и кольцо — иллюстрация, а не датчик. Измеряется то, что вы делаете: темп, время и число вдохов.</p>
            </div>
          </section>

          <section className="center-card"><div className="center-cap"><span>Практика <i>с источником</i></span></div><div className="center-chips">{Object.entries(PROTOCOLS).filter(([key]) => mode === 'full' || SIMPLE_PROTOCOLS.includes(key)).map(([key, item]) => <button key={key} className={protocol === key ? 'on' : ''} disabled={running} onClick={() => choose(key)}>{item.name}</button>)}</div>{protocol === 'coherent' && <div className="center-field"><label>резонанс</label><input type="range" min="4.5" max="6.5" step=".1" value={cadence} disabled={running} onChange={(event) => setCadence(Number(event.target.value))} /><b>{cadence.toFixed(1)} / мин</b></div>}<p className="center-meta">{PROTOCOLS[protocol].note}</p></section>

          <section className="center-card">
            <div className="center-cap"><span>Отметка состояния <i>сам-отчёт</i></span><label><input type="checkbox" checked={checkinOn} onChange={(event) => { setCheckinOn(event.target.checked); if (!event.target.checked) setPreCheckin(null); }} /> вести</label></div>
            {checkinOn ? <div>
              <p className="center-checkin-phase">{preCheckin ? (running ? 'Исходное состояние сохранено. После практики передвиньте шкалы.' : 'Отметьте состояние после практики перед «Остановкой».') : 'Состояние «до» сохранится при запуске.'}</p>
              {[['calm', 'Покой', 'возбуждён · спокоен'], ['steady', 'Опора в центре', 'зыбко · твёрдо'], ['warm', 'Тепло / тонус', 'тускло · ярко']].map(([key, label, ends]) => <div className="center-slider" key={key}><p><span>{label}</span><small>{ends}</small></p><input type="range" min="1" max="5" value={checkin[key]} onChange={(event) => setCheckin((value) => ({ ...value, [key]: Number(event.target.value) }))} /></div>)}
              {preCheckin && <div className="center-delta"><span>покой {checkin.calm - preCheckin.calm >= 0 ? '+' : ''}{checkin.calm - preCheckin.calm}</span><span>опора {checkin.steady - preCheckin.steady >= 0 ? '+' : ''}{checkin.steady - preCheckin.steady}</span><span>тонус {checkin.warm - preCheckin.warm >= 0 ? '+' : ''}{checkin.warm - preCheckin.warm}</span></div>}
              <p className="center-meta">Это ваш отчёт, а не измерение датчика. Смысл — в паттерне за недели, не в одной сессии.</p>
            </div> : <p className="center-empty">Включите, чтобы отмечать самочувствие до и после практики.</p>}
          </section>

          <section className="center-card"><div className="center-cap"><span>Огонь центра <i>модель · метафора</i></span></div><div className="center-meter"><i style={{ width: `${Math.round(charge * 100)}%` }} /></div><p className="center-meta"><b>{Math.round(charge * 100)}%</b> — растёт от постоянства, тускнеет без ухода. Огонь держат ровным ритмом, а не одним жарким рывком.</p></section>

          <section className="center-card"><div className="center-cap"><span>Неделя <i>измерено</i></span></div><div className="center-week">{week.map((day) => <div key={day.key}><span><i style={{ height: `${Math.max(3, Math.min(100, day.min / 20 * 100))}%` }} /></span><small>{day.label}</small></div>)}</div><div className="center-stats"><span><b>{streak}</b>дней подряд</span><span><b>{Math.round(week.reduce((sum, day) => sum + day.min, 0))}</b>минут за 7 дней</span><span><b>{sessions.length}</b>сессий</span></div></section>

          {mode === 'full' && <>
            <section className="center-card span">
              <div className="center-cap"><span>Биообратная связь · замкнутая петля <i>оценка · с датчиком</i></span><button className="center-help" onClick={() => setShowBioHelp((value) => !value)}>как подключить ⓘ</button></div>
              <div className="center-field"><label>источник</label><select value={bioSource} disabled={bioBusy} onChange={(event) => changeBioSource(event.target.value)}><option value="none">Не подключён</option><option value="ble">Браслет / датчик · Bluetooth</option><option value="tap">Отсчёт пульса (касание)</option><option value="camera">Камера · PPG</option></select>{bioBusy && <small>подключаю…</small>}</div>
              <div className={`center-camera${bioSource === 'camera' ? ' visible' : ''}`}><video ref={cameraRef} muted playsInline /><span>Прижмите палец к камере и вспышке. Держите ровно несколько секунд.</span></div>
              {bioSource !== 'none' && <div className="center-loop"><span>Дыхание</span>→<span>Сигнал ♥</span>→<span>Созвучие</span>→<span>Правка ритма</span></div>}
              {bioSource !== 'none' && <><div className="center-biolive"><span>пульс <b>{measured ? `${Math.round(sensor.hr)} уд/мин` : '—'}</b></span><span>ВСР (RMSSD) <b>{measured && sensor.rmssd != null ? `${Math.round(sensor.rmssd)} мс` : '—'}</b></span><span>созвучие <b>{Number.isFinite(coherence) ? `${Math.round(coherence * 100)}%` : running ? 'слушаю…' : '—'}</b></span></div><div className="center-quality"><i style={{ width: `${Math.round(sensor.quality * 100)}%` }} /></div><small className="center-quality-label">качество сигнала {Math.round(sensor.quality * 100)}%</small></>}
              <p className="center-biomsg" role="status">{bioMessage}</p>
              {showBioHelp && <div className="center-bio-help"><b>Как подключить</b><p><strong>Bluetooth:</strong> включите на браслете трансляцию пульса и выберите его в системном окне браузера.</p><p><strong>Касание:</strong> найдите пульс и нажимайте «Удар ♥» на каждый удар.</p><p><strong>Камера:</strong> прикройте пальцем объектив и вспышку; изображение обрабатывается только на устройстве и не сохраняется.</p><p>Показатели ориентировочные и не предназначены для диагностики.</p></div>}
            </section>
            <section className="center-card span"><div className="center-cap"><span>Прогресс · сбор данных, анализ, визуализация</span></div><div className="center-progress"><div>В такт, %<b>{adherenceAverage == null ? '—' : Math.round(adherenceAverage * 100)}</b></div><div>Сдвиг покоя<b>{calmAverage == null ? '—' : `${calmAverage > 0 ? '+' : ''}${calmAverage.toFixed(1)}`}</b></div><div>Созвучие, %<b>{coherenceAverage == null ? 'нужен датчик' : Math.round(coherenceAverage * 100)}</b></div></div></section>
          </>}
        </div>
      </div>
    </Sheet>
  );
}

function WillCycles({ lists, addEntry, updateEntry }) {
  const [draft, setDraft] = useState({ intention: '', minStep: '', when: '' });
  const open = lists.will
    .filter((w) => ['planned', 'started'].includes(w.payload.status))
    .sort((a, b) => a.at.localeCompare(b.at));
  const recent = lists.will
    .filter((w) => ['done', 'cancelled'].includes(w.payload.status))
    .slice(-3);

  const create = () => {
    if (!draft.intention.trim() || !draft.minStep.trim()) return;
    addEntry('will', {
      intention: draft.intention.trim(),
      minStep: draft.minStep.trim(),
      when: draft.when.trim(),
      status: 'planned',
    });
    setDraft({ intention: '', minStep: '', when: '' });
  };

  const transition = (w, status, extra = {}) =>
    updateEntry('will', w.clientId, { ...w.payload, status, ...extra });

  return (
    <Card eyebrow="Волевой цикл" module="will">
      <p className="dim small">
        Одно посильное действие: намерение → минимальный шаг → начало → завершение.
        Осознанная отмена — тоже волевой акт. Мерило — не серия без пропусков,
        а скорость возвращения.
      </p>
      {open.map((w) => (
        <div key={w.clientId} className="note" style={{ margin: '8px 0' }}>
          <b>{w.payload.intention}</b>
          <br />шаг: {w.payload.minStep}{w.payload.when ? ` · ${w.payload.when}` : ''}
          <div>
            {w.payload.status === 'planned' ? (
              <>
                <button className="btn inline" onClick={() => transition(w, 'started', { startedAt: new Date().toISOString() })}>
                  Начал
                </button>
                <button className="btn inline ghost" onClick={() => transition(w, 'cancelled', { finishedAt: new Date().toISOString() })}>
                  Осознанно отменяю
                </button>
              </>
            ) : (
              <>
                <button className="btn inline" onClick={() => transition(w, 'done', { finishedAt: new Date().toISOString() })}>
                  Завершил
                </button>
                <button className="btn inline ghost" onClick={() => transition(w, 'planned')}>
                  Отложить
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      <label className="fl">Намерение</label>
      <input type="text" value={draft.intention} placeholder="Что вы хотите сделать и зачем"
        onChange={(e) => setDraft({ ...draft, intention: e.target.value })} />
      <label className="fl">Минимальный шаг</label>
      <input type="text" value={draft.minStep} placeholder="Самый маленький посильный объём"
        onChange={(e) => setDraft({ ...draft, minStep: e.target.value })} />
      <label className="fl">Когда и где (необязательно)</label>
      <input type="text" value={draft.when} placeholder="Например: завтра в 8:30, за столом"
        onChange={(e) => setDraft({ ...draft, when: e.target.value })} />
      <button className="btn" onClick={create} disabled={!draft.intention.trim() || !draft.minStep.trim()}>
        Создать цикл
      </button>
      {recent.length > 0 && (
        <p className="tiny">
          Недавно: {recent.map((w) =>
            `${w.payload.intention} — ${w.payload.status === 'done' ? 'сделано' : 'отменено осознанно'}`).join(' · ')}
        </p>
      )}
    </Card>
  );
}

export default function Practice({ lists, addEntry, updateEntry, openPractice, goTo }) {
  // Списки практик свёрнуты для компактности.
  const [open, setOpen] = useState({});
  const [solarOpen, setSolarOpen] = useState(false);
  const toggle = (g) => setOpen((o) => ({ ...o, [g]: !o[g] }));

  return (
    <>
      {GROUPS.map((g) => {
        const list = byModule(g);
        return (
          <Card key={g} eyebrow={MODULES[g].name} module={g} tight>
            {g === 'soma' && (
              <button className="pitem solar-practice-link" onClick={() => setSolarOpen(true)}>
                <span><span className="pt">Солнечное сплетение</span><br /><span className="pd">Дыхательный проводник с тороидом, спокойным ритмом и отметкой состояния.</span></span>
                <span className="tag">открыть</span>
              </button>
            )}
            <button className="tbtn" onClick={() => toggle(g)}>
              {open[g] ? 'свернуть ▴' : `практики раздела (${list.length}) ▾`}
            </button>
            {open[g] && (
              <div className="plist" style={{ marginTop: 8 }}>
                {list.map((p) => (
                  <button key={p.id} className="pitem" onClick={() => openPractice(p)}>
                    <span>
                      <span className="pt">{p.title}</span>
                      <br /><span className="pd">{p.intent}</span>
                    </span>
                    <span className="tag">{p.minutes} мин</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        );
      })}
      <WillCycles lists={lists} addEntry={addEntry} updateEntry={updateEntry} />

      {solarOpen && (
        <SolarSheet addEntry={addEntry} lists={lists} goTo={goTo} onClose={() => setSolarOpen(false)} />
      )}
    </>
  );
}
