// «Динамика»: тороид, неделя, история, спарклайн, недельный обзор (петля адаптации).
// Настройки профиля вынесены в «Ещё»: экран динамики показывает только тренды.
import React, { useMemo, useState } from 'react';
import { journalHypotheses } from '../../domain/insights.js';
import { MODULES } from '../../domain/practices.js';
import {
  comebacks, dayKey, stateSeries, tactOrder14, weekHistory, weekSummary,
} from '../../domain/loop.js';
import { polarityQuadrant } from '../../domain/stateCheckIn.js';
import { DAY_NAMES } from '../../domain/weekPlan.js';
import { Card, Sheet, Sparkline } from '../components.jsx';
import Toroid, { MiniToroid } from '../Toroid.jsx';
import { loadPhoneStepsMap } from '../../infrastructure/phoneSteps.js';

const LEGEND = [
  ['nutrition', 'низ · питание и действие'],
  ['feelings', 'грудь · чувства и тело'],
  ['mind', 'голова · мышление'],
  ['accord', 'ось · аккорд'],
];

function PolarityPoint({ expansion, gathering }) {
  if (expansion === null || gathering === null) {
    return <p className="tiny dim">Пока мало отметок состояния для этой картины.</p>;
  }
  const size = 120;
  const x = 10 + expansion * (size - 20);
  const y = 10 + (1 - gathering) * (size - 20);
  const quadrant = polarityQuadrant(expansion, gathering);
  return (
    <div className="polarity-point">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img"
        aria-label="Расширение и собранность недели">
        <line x1={size / 2} y1="6" x2={size / 2} y2={size - 6} stroke="var(--line)" strokeDasharray="3 4" />
        <line x1="6" y1={size / 2} x2={size - 6} y2={size / 2} stroke="var(--line)" strokeDasharray="3 4" />
        <circle cx={x} cy={y} r="5" fill="var(--accord)" />
      </svg>
      <div className="polarity-axes">
        <span className="tiny dim">→ расширение (тепло · ясность)</span>
        <span className="tiny dim">↑ собранность (покой · сила)</span>
      </div>
      {quadrant && <p className="small">{quadrant.label}</p>}
    </div>
  );
}

const OBSERVATION_STATUS = {
  insufficient: 'Собираем данные',
  'no-signal': 'Ясного повторения пока нет',
  hypothesis: 'Есть повторение — продолжаем проверять',
};

function shortDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function Dynamics({ lists, addEntry }) {
  const journal = lists;
  const phoneSteps = loadPhoneStepsMap();
  const summary = useMemo(() => weekSummary(journal, new Date(), phoneSteps), [journal, phoneSteps]);
  const history = useMemo(() => weekHistory(journal, 4, new Date(), phoneSteps), [journal, phoneSteps]);
  const series = useMemo(() => stateSeries(journal.state, 28), [journal.state]);
  const returns = useMemo(() => comebacks(journal.practice), [journal.practice]);
  const tactOrder = useMemo(() => tactOrder14(journal, new Date()), [journal]);
  const hypotheses = useMemo(() => journalHypotheses(journal), [journal]);
  const [review, setReview] = useState({ keep: '', change: '' });
  const [showInfo, setShowInfo] = useState(false);
  const today = dayKey(new Date());
  const reviewDone = journal.practice.some(
    (p) => p.payload.practiceId === 'weekly-review' && summary.keys.includes(dayKey(p.at))
  );

  return (
    <>
      <Card eyebrow="Тороид недели">
        <Toroid summary={summary} />
        <button className="tbtn" style={{ marginTop: 8 }} onClick={() => setShowInfo(true)}>
          Как читать тороид — линии, дуги и точки
        </button>
      </Card>

      <Card eyebrow="Расширение и собранность" tight>
        <p className="dim small">
          Тепло и ясность — одна ось; покой и сила — другая. Усреднённые в одно число,
          они стирают разницу между «разогнан, но не держит» и «собран, но глухо».
        </p>
        <PolarityPoint expansion={summary.expansion} gathering={summary.gathering} />
      </Card>

      <Card eyebrow="Нижний полюс · четыре такта" tight>
        <p className="dim small">
          Приём → нагрузка → пауза → сон. Не объём каждого, а порядок: сколько дней
          из 14 такты прошли без перестановок — еда не позже нагрузки, движение не
          позже отбоя. День без одного из тактов просто не считается.
        </p>
        <div className="statgrid">
          <div className="stat"><div className="n">{tactOrder}</div><div className="l">дней из 14 по порядку</div></div>
        </div>
      </Card>

      <Card eyebrow="Эта неделя" tight>
        <div className="weekdots">
          {summary.keys.map((k, i) => (
            <div className="wd" key={k}>
              <div className={`c${summary.activeDayKeys.includes(k) ? ' done' : ''}${k === today ? ' today' : ''}`}>
                {summary.activeDayKeys.includes(k) ? '•' : ''}
              </div>
              {DAY_NAMES[i]}
            </div>
          ))}
        </div>
        <div className="statgrid">
          <div className="stat"><div className="n">{summary.counts.practices}</div><div className="l">практик</div></div>
          <div className="stat"><div className="n">{summary.counts.meals}</div><div className="l">записей еды</div></div>
          <div className="stat"><div className="n">{summary.counts.willDone}</div><div className="l">циклов воли</div></div>
        </div>
        {summary.avgDelta !== null && (
          <p className="small dim">
            Средний сдвиг «до → после» практик: {summary.avgDelta > 0 ? '+' : ''}
            {summary.avgDelta.toFixed(1)} по пятибалльной шкале.
          </p>
        )}
        {returns > 0 && (
          <p className="small dim">
            Возвращений после перерыва: {returns}. Возвращаться — главный навык; серии не важны.
          </p>
        )}
      </Card>

      <Card eyebrow="Самочувствие · 28 дней" tight>
        <Sparkline series={series} />
      </Card>

      <Card eyebrow="Что повторяется в записях · 28 дней" tight>
        <p className="dim small">
          Здесь приложение ищет повторяющиеся совпадения. В сравнение входят только дни,
          когда заполнены оба показателя. Это подсказка для самонаблюдения, а не прогноз
          или медицинский вывод.
        </p>
        <div className="insight-list">
          {hypotheses.observations.map((observation) => (
            <div className={`insight ${observation.status}`} key={observation.id}>
              <p><b>{observation.title}</b></p>
              <span className="insight-status">{OBSERVATION_STATUS[observation.status]}</span>
              <p className="small dim">{observation.text}</p>
              <p className="tiny">
                Дней с обеими записями: {observation.pairs} из минимум {observation.minimum}.
                {' '}Сравнение: {observation.lagDays === 0 ? 'показатели одного дня' : 'практики накануне и самочувствие сегодня'}.
              </p>
            </div>
          ))}
        </div>
        <p className="tiny">
          Рассмотрены записи с {shortDate(hypotheses.from)} по {shortDate(hypotheses.to)}.
          Чем больше заполненных дней, тем надёжнее видно, повторяется ли совпадение.
        </p>
      </Card>

      <Card eyebrow="Недели" tight>
        <div className="minitor">
          {history.map((h) => (
            <MiniToroid key={h.label} summary={h.summary} label={h.label} />
          ))}
        </div>
      </Card>

      <Card eyebrow="Недельный обзор · петля адаптации">
        {reviewDone ? (
          <p className="dim small">Обзор этой недели сделан. Новая петля начнётся с понедельника.</p>
        ) : (
          <>
            <p className="dim small">
              Факты выше — без оценок. Два вопроса, чтобы следующая неделя стала точнее.
            </p>
            <label className="fl">Что сработало — и стоит оставить?</label>
            <textarea rows={2} value={review.keep}
              onChange={(e) => setReview({ ...review, keep: e.target.value })} />
            <label className="fl">Что изменить — одним маленьким экспериментом?</label>
            <textarea rows={2} value={review.change}
              onChange={(e) => setReview({ ...review, change: e.target.value })} />
            <button className="btn" disabled={!review.keep.trim() && !review.change.trim()}
              onClick={() => {
                addEntry('practice', {
                  module: 'accord', practiceId: 'weekly-review', completed: true,
                  form: { keep: review.keep.trim(), change: review.change.trim() },
                });
                setReview({ keep: '', change: '' });
              }}>
              Завершить обзор
            </button>
          </>
        )}
      </Card>

      {showInfo && (
        <Sheet onClose={() => setShowInfo(false)}>
          <p className="eyebrow">Как читать тороид</p>
          <h2>Линии, дуги и точки</h2>
          <p className="dim small">
            Тороид — живая иллюстрация ваших записей за неделю. Каждый элемент
            отражает то, что вы уже отметили в приложении.
          </p>

          <p className="eyebrow" style={{ marginTop: 16 }}>Дуги вокруг тела — практики частей</p>
          <p className="dim small">
            Кольцо дуги прибывает от внешнего края к телу: сперва появляется
            внешняя линия, ядро — ближе к телу — замыкается последним. Это число
            задетых дней недели, а не объём. Три дуги по высоте тела:
          </p>
          <div className="chips">
            {LEGEND.slice(0, 3).map(([id, label]) => (
              <span key={id} className="chip">
                <span className="dot" style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: 4,
                  background: MODULES[id].color, marginRight: 6,
                }} />
                {label}
              </span>
            ))}
          </div>

          <p className="eyebrow" style={{ marginTop: 16 }}>Точки на оси тела</p>
          <p className="dim small">
            Отмечают три части — голову (мышление), грудь (чувства и тело), низ
            (питание и действие — еда и воля вместе, один обменно-двигательный
            полюс). Крупнее — когда части уделено больше внимания за неделю.
          </p>

          <p className="eyebrow" style={{ marginTop: 16 }}>Вертикальная ось — аккорд</p>
          <p className="dim small">
            Согласованность частей между собой. Толще и ярче — с практиками
            модуля «аккорд».
          </p>

          <p className="eyebrow" style={{ marginTop: 16 }}>Цвет силуэта — тепло</p>
          <p className="dim small">
            От прохладного к тёплому янтарю — по вашим сам-отчётам
            (покой, энергия, ясность, тепло к себе).
          </p>

          <p className="eyebrow" style={{ marginTop: 16 }}>Скорость потока</p>
          <p className="dim small">Как быстро «дышат» дуги — из шагов и сна за неделю.</p>

          <p className="note" style={{ marginTop: 16 }}>
            Это иллюстрация ваших записей, а не измерение здоровья.
          </p>
          <button className="btn" onClick={() => setShowInfo(false)}>Понятно</button>
        </Sheet>
      )}
    </>
  );
}
