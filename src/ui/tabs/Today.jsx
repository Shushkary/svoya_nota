// «Сегодня»: моментальные отметки и итог дня, план недельного алгоритма,
// быстрый ввод активности. Начало и конец дневной петли.
import React, { useRef, useState } from 'react';
import { byId } from '../../domain/practices.js';
import { dayKey, kbjuOfDay } from '../../domain/loop.js';
import {
  latestState, openingState, STATE_PHASE, STATE_VALUE_KEYS, statePayload,
} from '../../domain/stateCheckIn.js';
import { parseTrackerCsv } from '../../infrastructure/trackerImport.js';
import { loadPhoneSteps, savePhoneSteps } from '../../infrastructure/phoneSteps.js';
import { estimateStepCalories } from '../../domain/nutrition/activity.js';
import { isEveningBreathingWindow } from '../../domain/practice/reminders.js';
import { DAY_NAMES, GENTLE, isoDay, planForDay, suggestGentle } from '../../domain/weekPlan.js';
import { Card, Sheet, StateSliders } from '../components.jsx';

const EMPTY_STATE = { calm: 3, energy: 3, clarity: 3, warmth: 3 };

function valuesOf(entry) {
  return Object.fromEntries(STATE_VALUE_KEYS.map((key) => [key, Number(entry?.payload?.[key]) || 3]));
}

function CheckIn({ states, addEntry, updateEntry }) {
  const [phase, setPhase] = useState(STATE_PHASE.MOMENT);
  const [value, setValue] = useState({ calm: 3, energy: 3, clarity: 3, warmth: 3 });
  const [saved, setSaved] = useState('');
  const summary = latestState(states, STATE_PHASE.DAY_SUMMARY);
  const moments = states.filter((entry) => entry.payload?.phase !== 'evening'
    && entry.payload?.phase !== STATE_PHASE.DAY_SUMMARY);

  const selectPhase = (next) => {
    setPhase(next);
    setValue(next === STATE_PHASE.DAY_SUMMARY && summary ? valuesOf(summary) : { ...EMPTY_STATE });
    setSaved('');
  };

  const save = () => {
    const payload = statePayload(value, phase);
    if (phase === STATE_PHASE.DAY_SUMMARY && summary) {
      updateEntry('state', summary.clientId, payload);
      setSaved('Итог дня обновлён');
    } else {
      addEntry('state', payload);
      setSaved(phase === STATE_PHASE.MOMENT ? 'Состояние сейчас сохранено' : 'Итог дня сохранён');
    }
    if (phase === STATE_PHASE.MOMENT) setValue({ ...EMPTY_STATE });
  };

  return (
    <Card eyebrow="Быстрая отметка">
      <div className="seg checkin-kind" role="group" aria-label="Тип отметки состояния">
        <button type="button" className={phase === STATE_PHASE.MOMENT ? 'on' : ''}
          aria-pressed={phase === STATE_PHASE.MOMENT}
          onClick={() => selectPhase(STATE_PHASE.MOMENT)}>Сейчас</button>
        <button type="button" className={phase === STATE_PHASE.DAY_SUMMARY ? 'on' : ''}
          aria-pressed={phase === STATE_PHASE.DAY_SUMMARY}
          onClick={() => selectPhase(STATE_PHASE.DAY_SUMMARY)}>Итог дня</button>
      </div>
      <p className="dim small">
        {phase === STATE_PHASE.MOMENT
          ? 'Снимок этого момента. Можно отмечать снова, когда состояние изменится.'
          : 'Одна общая оценка дня. Её можно вернуться и обновить.'}
      </p>
      <StateSliders value={value} onChange={setValue} />
      <button className="btn" onClick={save}>
        {phase === STATE_PHASE.DAY_SUMMARY && summary ? 'Обновить итог' : 'Сохранить отметку'}
      </button>
      <p className="tiny checkin-status" role="status" aria-live="polite">
        {saved || (moments.length
          ? `Сегодня моментальных отметок: ${moments.length}`
          : 'Первая отметка займёт несколько секунд.')}
      </p>
    </Card>
  );
}

export default function Today({ journal, lists, addEntry, updateEntry, openPractice, goTo }) {
  const now = new Date();
  const today = dayKey(now);
  const plan = planForDay(now);
  const states = lists.state.filter((s) => dayKey(s.at) === today);
  const firstState = openingState(states);
  const gentle = suggestGentle(firstState?.payload);
  const donePractices = lists.practice.filter((p) => dayKey(p.at) === today);
  const kbju = kbjuOfDay(lists.meal, today);
  const todayActivities = lists.activity.filter((entry) => !entry.payload.deleted
    && (entry.payload.date === today || dayKey(entry.at) === today));
  // Дневной итог шагов/сна не должен смешиваться с тренировками из «Тело».
  const stepsToday = todayActivities.find((entry) => entry.payload.dailySteps || Number(entry.payload.steps) > 0);
  const sleepToday = todayActivities.find((entry) => Number(entry.payload.sleepHours) > 0);
  const activityToday = stepsToday || sleepToday;
  const bodyActivities = todayActivities.filter((entry) => !entry.payload.dailySteps
    && !Number(entry.payload.steps) && !Number(entry.payload.sleepHours));
  const trackerFileRef = useRef(null);
  const initialPhoneSteps = loadPhoneSteps(today);
  const [phoneSteps, setPhoneSteps] = useState(initialPhoneSteps);
  const [trackerStatus, setTrackerStatus] = useState('');
  const saltDone = lists.ritual.some((e) => (e.payload?.type === 'saltWater' || e.payload?.type === 'electrolytes') && dayKey(e.at) === today);
  const [steps, setSteps] = useState(() => String(initialPhoneSteps?.steps ?? stepsToday?.payload.steps ?? ''));
  const [sleep, setSleep] = useState(() => String(sleepToday?.payload.sleepHours ?? ''));
  const [saltModal, setSaltModal] = useState(false);
  const hour = now.getHours();
  const saltReminder = hour < 12 && !saltDone;
  const eveningBreathReminder = isEveningBreathingWindow(now);
  const markSalt = () => {
    addEntry('ritual', { type: 'electrolytes', done: true, date: today }, `${today}T08:00:00`);
    setSaltModal(false);
  };

  const importPhoneFile = async (file) => {
    if (!file) return;
    try {
      const rows = parseTrackerCsv(await file.text());
      const row = rows.find((entry) => entry.date === today && Number.isFinite(entry.steps));
      if (!row) {
        setTrackerStatus('В файле не найдены шаги за сегодня. Нужны колонки даты и шагов.');
        return;
      }
      const record = savePhoneSteps(today, row.steps, 'файл трекера');
      setPhoneSteps(record);
      setSteps(String(row.steps));
      setTrackerStatus(`Подставлено ${row.steps.toLocaleString('ru-RU')} шагов из файла.`);
    } catch {
      setTrackerStatus('Не удалось прочитать файл трекера.');
    }
  };

  const practiceList = (ids) => (
    <div className="plist">
      {ids.map((id) => {
        const p = byId[id];
        if (!p) return null;
        const done = donePractices.some((d) => d.payload.practiceId === id);
        return (
          <button key={id} className="pitem" onClick={() => openPractice(p)}>
            <span>
              <span className="pt">{done ? '✓ ' : ''}{p.title}</span>
              <br /><span className="pd">{p.intent}</span>
            </span>
            <span className="tag">{p.minutes} мин</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <Card eyebrow={`${DAY_NAMES[isoDay(now) - 1]} · день ${plan.day} недели`} module={plan.module}>
        <h2>{plan.title}</h2>
        <p className="dim">{plan.note}</p>
        <p className="small note">Тело: {plan.nutrition}</p>
        {gentle && (
          <p className="note" style={{ marginTop: 8 }}>
            Утренняя отметка невысокая. {GENTLE.note}
          </p>
        )}
        {practiceList(gentle ? GENTLE.practices : plan.practices)}
        {gentle && (
          <div className="linkrow">
            <button className="tbtn" onClick={() => goTo('practice')}>всё же открыть план дня</button>
          </div>
        )}
      </Card>

      {saltReminder && (
        <Card eyebrow="Утренний ритуал" module="nutrition" tight>
          <p className="dim small">
            Сразу после пробуждения — стакан тёплой воды с электролитами.
            Мягкая гидратация и бережная опора пищеварению в начале дня.
          </p>
          <div className="formrow">
            <button className="btn" onClick={markSalt}>Выпил(а)</button>
            <button className="btn ghost" onClick={() => setSaltModal(true)}>Почему это полезно</button>
          </div>
        </Card>
      )}

      {eveningBreathReminder && (
        <Card eyebrow="Вечернее напоминание" module="soma" tight>
          <button className="pitem" onClick={() => openPractice(byId.br2)}>
            <span><span className="pt">Успокаивающее дыхание 4–8</span><br /><span className="pd">Мягкий вдох на 4 счёта и длинный выдох на 8. Три спокойные минуты перед завершением дня.</span></span>
            <span className="tag">открыть</span>
          </button>
        </Card>
      )}

      <CheckIn states={states} addEntry={addEntry} updateEntry={updateEntry} />

      <Card eyebrow="Тело сегодня" module="nutrition" tight>
        {kbju.count === 0 ? (
          <p className="dim small">Записей пока нет.</p>
        ) : (
          <div className="kbjurow">
            <div><div className="n">{kbju.kcal}</div><div className="u">ккал</div></div>
            <div><div className="n">{kbju.protein}</div><div className="u">белки</div></div>
            <div><div className="n">{kbju.fat}</div><div className="u">жиры</div></div>
            <div><div className="n">{kbju.carb}</div><div className="u">углеводы</div></div>
          </div>
        )}
        <button className="btn ghost" onClick={() => goTo('nutrition')}>Записать еду</button>
      </Card>

      <Card eyebrow="Активность" tight>
        <p className="small dim">
          Сегодня: {phoneSteps?.steps ?? stepsToday?.payload.steps ?? '—'} шагов,
          сон {sleepToday?.payload.sleepHours || '—'} ч.
        </p>
        {phoneSteps && (
          <p className="tiny">Источник шагов: {phoneSteps.source} · данные только на этом устройстве.</p>
        )}
        <button className="tbtn tracker-import-link" onClick={() => trackerFileRef.current?.click()}>
          импортировать CSV из приложения трекера
        </button>
        <input ref={trackerFileRef} type="file" accept=".csv,text/csv" hidden
          onChange={(event) => {
            void importPhoneFile(event.target.files?.[0]);
            event.target.value = '';
          }} />
        {trackerStatus && <p className="tiny" role="status" aria-live="polite">{trackerStatus}</p>}
        {bodyActivities.length > 0 && (
          <p className="tiny">Из «Тело»: {bodyActivities.map((entry) => `${entry.payload.label || 'активность'} · ${entry.payload.durationMin || 0} мин`).join(' · ')}</p>
        )}
        <>
            <div className="formrow">
              <input type="number" inputMode="numeric" placeholder="Шаги" value={steps}
                onChange={(e) => setSteps(e.target.value)} aria-label="Шаги за день" />
              <input type="number" inputMode="decimal" placeholder="Сон, ч" value={sleep}
                onChange={(e) => setSleep(e.target.value)} aria-label="Сон, часов" />
            </div>
            <button className="btn ghost" onClick={() => {
              const s = Number(steps), h = Number(sleep);
              if (!s && !h) return;
              const importedLocally = phoneSteps?.steps === s;
              if (importedLocally && !h && !activityToday) {
                setTrackerStatus(`Шаги уже сохранены только на этом устройстве: ${s.toLocaleString('ru-RU')}.`);
                return;
              }
              const payload = {
                ...(activityToday?.payload || {}),
                date: today,
                steps: !importedLocally && s > 0 && s < 200000 ? s : undefined,
                sleepHours: h > 0 && h <= 16 ? h : undefined,
                // Дневной итог шагов — не таймлайн тренировки. Тороид
                // преобразует его в отдельную условную метку без влияния на
                // окно переваривания.
                dailySteps: !importedLocally && s > 0 && s < 200000,
                kcal: !importedLocally && s > 0 && s < 200000 ? estimateStepCalories(s, 170) : undefined,
                source: 'manual',
              };
              if (activityToday) updateEntry('activity', activityToday.clientId, payload);
              else addEntry('activity', payload, `${today}T12:00:00`, `act-${today}`);
              setTrackerStatus(importedLocally
                ? `Шаги остаются на устройстве${h > 0 ? `, сон ${h} ч сохранён в журнале` : ''}.`
                : `Сохранено: ${s > 0 ? `${s.toLocaleString('ru-RU')} шагов` : 'без шагов'}${h > 0 ? `, сон ${h} ч` : ''}.`);
            }}>{activityToday ? 'Обновить' : 'Сохранить'}</button>
            <p className="tiny">
              Ручной ввод сохраняется в журнале. Импортированные шаги остаются на устройстве
              и не включаются в резервную копию.
            </p>
          </>
      </Card>

      {saltModal && (
        <Sheet onClose={() => setSaltModal(false)}>
          <button className="tbtn" onClick={() => setSaltModal(false)}>← Закрыть</button>
          <h2>Стакан тёплой воды с электролитами</h2>
          <p className="dim small">Утренний ритуал гидратации. Что и зачем — и где это подтверждено наукой.</p>

          <h3>Польза для тела</h3>
          <ul className="salt-list">
            <li><b>Гидратация.</b> За ночь организм теряет жидкость; стакан воды после сна восполняет её объём и помогает почкам, терморегуляции и транспорту веществ. База — в поддержании водного баланса (Mayo Clinic, NHS).</li>
            <li><b>Тепло.</b> Тёплая вода успокаивает и может мягче запускать гастроколический рефлекс — у части людей это облегчает утреннее опорожнение кишечника.</li>
            <li><b>Электролиты.</b> Натрий, калий и магний — носители заряда для нервов и мышц; в «щепотке» соли их ничтожно по сравнению с рационом, а явные электролиты восполняют их дозировано. Лишний натрий при гипертонии, болезнях почек и сердца нежелателен (Harvard Health, Mayo Clinic).</li>
          </ul>

          <h3>Кишечник</h3>
          <p className="dim small">
            Тёплая жидкость может помочь перистальтике и регулярному стулу. Специфического влияния именно минералов щепотки на микробиоту кишечника научных доказательств нет — основная польза здесь от тепла и воды, а не от минералов. По теме «тёплая вода и перистальтика/запор» — подборка исследований на PubMed.
          </p>

          <h3>Как пить</h3>
          <p className="dim small">
            Не залпом, а <b>глотками, медленно</b>. Залпом выпитый стакан быстро уходит в мочу —
            почки выводят избыток, не успев распределить, а резкий объём даёт нагрузку на сердце и
            сосуды (особенно при гипертонии или проблемах с почками). Маленькие глотки постепенно
            восполняют объём, мягче для желудка и посылают парасимпатический «сигнал спокойствия» —
            организм просыпается плавно, а не в режиме стресса. Тёплая вода глотками ещё и нежнее для
            ЖКТ, чем холодная.
          </p>

          <h3>Обратный осмос и «мёртвая» вода</h3>
          <p className="dim small">
            Фильтры обратного осмоса отсекают практически всё — и примеси, и нужные минералы. Вода
            становится <b>деминерализованной</b>: в ней почти нет кальция, магния, натрия, бикарбонатов.
            ВОЗ в докладе «Nutrients in Drinking Water» (2005) указывает, что длительное употребление
            такой воды с низкой минерализацией связано с неблагоприятными эффектами — риском дефицита
            магния и кальция, возможным влиянием на сердечно-сосудистые показатели и повышенной
            коррозионной агрессивностью (вымывание металлов из труб и посуды). Поэтому опираться на
            очищенную RO-воду как на источник минералов нельзя — их нужно восполнять из еды или
            добавок. Логика этого ритуала и Ториона — вода плюс минералы, а не просто вода.
          </p>

          <h3>Зачем электролиты</h3>
          <p className="dim small">
            Натрий, калий и магний — не «соль для вкуса», а <b>носители заряда</b>: от них зависят
            нервные импульсы, сокращение мышц (включая сердце), баланс жидкости внутри и снаружи клетки
            и кислотно-щелочное равновесие. Они постоянно теряются с потом и мочой, а при жаре,
            тренировках, бане и перелётах расход растёт. Без адекватного поступления — слабость,
            судороги, головная боль, сбои ритма. Отсюда и смысл утренней щепотки соли и Ториона:
            гидратация имеет значение только вместе с электролитами.
          </p>

          <h3>Научные источники</h3>
          <ul className="salt-links">
            <li><a href="https://www.nhs.uk/live-well/eat-well/water-drinks-nutrition/" target="_blank" rel="noopener noreferrer">NHS Великобритании — вода и напитки для здоровья</a></li>
            <li><a href="https://www.health.harvard.edu/staying-healthy/how-much-water-should-you-drink" target="_blank" rel="noopener noreferrer">Harvard Health — сколько воды пить в день</a></li>
            <li><a href="https://www.health.harvard.edu/diet-and-nutrition/the-salts-of-the-earth" target="_blank" rel="noopener noreferrer">Harvard Health — морская соль не полезнее обычной (натрия одинаково много, риски для сердца и почек)</a></li>
            <li><a href="https://www.mayoclinic.org/healthy-lifestyle/nutrition-and-healthy-eating/expert-answers/sea-salt/faq-20058512" target="_blank" rel="noopener noreferrer">Mayo Clinic — морская соль против обычной: в чём разница</a></li>
            <li><a href="https://pubmed.ncbi.nlm.nih.gov/?term=warm+water+drinking+constipation" target="_blank" rel="noopener noreferrer">PubMed — тёплая вода и перистальтика/запор (подборка исследований)</a></li>
            <li><a href="https://iris.who.int/bitstream/handle/10665/43843/9241593989_eng.pdf" target="_blank" rel="noopener noreferrer">ВОЗ — Nutrients in Drinking Water (2005): деминерализованная вода и риски</a></li>
          </ul>

          <p className="salt-disclaimer">
            <b>Не медицинская рекомендация.</b> При заболеваниях — особенно артериальной гипертензии,
            болезнях почек, сердца, отёках, нарушениях натриевого обмена — и при приёме мочегонных
            или гипотензивных препаратов проконсультируйтесь с врачом до изменения привычки.
            Детям, беременным и кормящим — также с врачом.
          </p>
        </Sheet>
      )}
    </>
  );
}
