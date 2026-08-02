// «Аккорд»: согласованность. Смысл практик опирается на современные
// исследования работы мозга и влияния убеждений и среды на поведение;
// в интерфейсе — только понятные шаги, без имён и теорий.
import React from 'react';
import { byId } from '../../domain/practices.js';
import { dayKey } from '../../domain/loop.js';
import { Card } from '../components.jsx';

const CYCLE = ['Заметь', 'Различи', 'Рассмотри', 'Выбери', 'Сделай', 'Проверь'];

const SECTIONS = [
  {
    eyebrow: 'Заметить и переждать',
    hint: 'Сильное чувство — волна. Сначала тело, потом выводы.',
    ids: ['ac1', 'ac5'],
  },
  {
    eyebrow: 'Увидеть роли',
    hint: 'Одна ситуация выглядит по-разному из разных ролей. Решение становится объёмнее, когда каждой нашлось место.',
    ids: ['ac2', 'ac3'],
  },
  {
    eyebrow: 'Перенастроить',
    hint: 'Убеждение меняется экспериментом, привычка — средой.',
    ids: ['ac4', 'ac6'],
  },
];

export default function Accord({ lists, openPractice }) {
  const notes = lists.practice
    .filter((p) => p.payload.practiceId === 'ac4' && p.payload.form?.new)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  const chords = lists.practice
    .filter((p) => p.payload.practiceId === 'ac3' && p.payload.form?.chord)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 3);

  return (
    <>
      <Card eyebrow="Аккорд" module="accord">
        <h2>Своя нота — это согласие частей</h2>
        <p className="dim small">
          Вы не обязаны действовать из первой автоматической реакции. Можно заметить
          состояние, различить факты и интерпретации, увидеть свои внутренние
          роли, выбрать свою ноту и сделать малое согласованное действие.
        </p>
        <div className="chips" aria-label="Цикл">
          {CYCLE.map((c, i) => (
            <span key={c} className={`chip${i === 0 ? ' on' : ''}`}>{i + 1}. {c}</span>
          ))}
        </div>
      </Card>

      {SECTIONS.map((s) => (
        <Card key={s.eyebrow} eyebrow={s.eyebrow} module="accord" tight>
          <p className="dim small">{s.hint}</p>
          <div className="plist">
            {s.ids.map((id) => {
              const p = byId[id];
              return (
                <button key={id} className="pitem" onClick={() => openPractice(p)}>
                  <span>
                    <span className="pt">{p.title}</span>
                    <br /><span className="pd">{p.intent}</span>
                  </span>
                  <span className="tag">{p.minutes} мин</span>
                </button>
              );
            })}
          </div>
        </Card>
      ))}

      {(notes.length > 0 || chords.length > 0) && (
        <Card eyebrow="Проверь · мои новые ноты" module="accord" tight>
          {notes.map((n) => (
            <div key={n.clientId} className="note" style={{ margin: '8px 0' }}>
              <span className="tiny">{dayKey(n.at)}</span><br />
              <s className="dim">{n.payload.form.old}</s><br />
              <b>{n.payload.form.new}</b>
              {n.payload.form.experiment && (
                <><br /><span className="small">эксперимент: {n.payload.form.experiment}</span></>
              )}
            </div>
          ))}
          {chords.map((c) => (
            <div key={c.clientId} className="note" style={{ margin: '8px 0' }}>
              <span className="tiny">{dayKey(c.at)} · общее решение</span><br />
              <b>{c.payload.form.chord}</b>
            </div>
          ))}
          <p className="tiny">
            Возвращайтесь к новым нотам через несколько дней: сработал ли эксперимент —
            и как уточнить формулировку.
          </p>
        </Card>
      )}
    </>
  );
}
