// Изолированная секция «Самонаблюдение тела»: только на устройстве, без сервера.
import React, { useState } from 'react';
import { Card, Sparkline } from './components.jsx';
import { loadBody, hasConsent, setConsent, addMeasurement, clearMeasurements, getSeries, BODY_CONSENT_VERSION } from '../infrastructure/bodyStorage.js';
import { addWeight, clearWeights, loadWeights } from '../infrastructure/weight.js';

function todayStr() { const d = new Date(); const pad = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function dateRu(iso) { try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return String(iso).slice(0, 10); } }
function round1(n) { return Math.round(n * 10) / 10; }

export default function BodyObservations({ profile = [] }) {
  const [state, setState] = useState(() => loadBody());
  const [cm, setCm] = useState('');
  const [kg, setKg] = useState('');
  const [weights, setWeights] = useState(() => loadWeights());
  const [date, setDate] = useState(todayStr());
  const [msg, setMsg] = useState(null);
  if (!hasConsent(state)) return (
    <Card eyebrow="Самонаблюдение тела">
      <p className="small dim">Здесь можно вести собственные отметки веса и обхвата талии и видеть изменения во времени. Сохраняются только значения, дата и пометка «введено вручную». Данные остаются на этом устройстве, не передаются, не синхронизируются и не входят в резервную копию.</p>
      <label className="fl" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}><input type="checkbox" style={{ width: 'auto', marginTop: 2 }} onChange={(e) => setState(setConsent(state, e.target.checked))} /><span>Согласен(на) на локальную обработку отметок веса и обхвата талии для личного самонаблюдения.</span></label>
      <p className="tiny dim">Версия согласия: {BODY_CONSENT_VERSION}.</p>
    </Card>
  );
  const series = getSeries(state);
  const weightSeries = [...weights].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const last = series[series.length - 1] || null;
  const prev = series[series.length - 2] || null;
  const delta = last && prev ? round1(last.cm - prev.cm) : null;
  const profileEntry = Array.isArray(profile) ? profile.find((p) => !p.payload?.deleted) : null;
  const heightCm = Number(profileEntry?.payload?.height) > 0 ? Number(profileEntry.payload.height) : null;
  const whtr = last && heightCm ? Math.round((last.cm / heightCm) * 100) / 100 : null;
  const vals = series.map((m) => m.cm);
  const add = () => {
    if (!cm.trim() && !kg.trim()) return;
    const at = `${date}T12:00:00`;
    const cmValue = Number(cm.replace(',', '.')); const kgValue = Number(kg.replace(',', '.'));
    if (cm.trim() && (!Number.isFinite(cmValue) || cmValue < 30 || cmValue > 300)) { setMsg('Обхват талии — значение в сантиметрах от 30 до 300.'); return; }
    if (kg.trim() && (!Number.isFinite(kgValue) || kgValue < 20 || kgValue > 500)) { setMsg('Вес — значение в килограммах от 20 до 500.'); return; }
    if (cm.trim()) setState(addMeasurement(state, cmValue, at).state);
    if (kg.trim()) setWeights(addWeight(kgValue, at));
    setCm(''); setKg(''); setMsg(null);
  };
  return (
    <Card eyebrow="Самонаблюдение тела">
      <div className="formrow"><div><label className="fl">Вес, кг</label><input type="number" inputMode="decimal" step="0.1" value={kg} placeholder="например, 72,5" onChange={(e) => setKg(e.target.value)} /></div><div><label className="fl">Обхват талии, см</label><input type="number" inputMode="decimal" step="0.1" value={cm} placeholder="например, 82,5" onChange={(e) => setCm(e.target.value)} /></div></div>
      <label className="fl">Дата</label><input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
      <button className="btn" disabled={!cm.trim() && !kg.trim()} onClick={add}>Добавить отметку</button>
      {msg && <p className="small" style={{ color: 'var(--animal)' }}>{msg}</p>}
      {last && <p className="small">Последняя отметка: <b>{last.cm} см</b> <span className="tiny dim">(самоотчёт, {dateRu(last.at)})</span>{delta !== null && <> · изменение с прошлой: <b>{delta > 0 ? '+' : ''}{delta} см</b></>}</p>}
      {weightSeries.length > 0 && <p className="small">Последний вес: <b>{weightSeries[weightSeries.length - 1].kg} кг</b> <span className="tiny dim">(введено вручную, {dateRu(weightSeries[weightSeries.length - 1].at)})</span></p>}
      {whtr !== null && <p className="tiny dim">Отношение обхвата талии к росту: <b>{whtr}</b> · расчёт по вашим измерениям</p>}
      {series.length >= 2 && <Sparkline series={series.map((m) => ({ value: m.cm }))} min={Math.min(...vals) - 2} max={Math.max(...vals) + 2} color="var(--acc)" label="Динамика обхвата талии" />}
      {weightSeries.length >= 2 && <Sparkline series={weightSeries.map((entry) => ({ value: entry.kg }))} min={Math.min(...weightSeries.map((entry) => entry.kg)) - 2} max={Math.max(...weightSeries.map((entry) => entry.kg)) + 2} color="var(--mind)" label="Динамика веса" />}
      <p className="tiny dim">Это личные самозаписи, а не медицинская оценка. Данные хранятся только на устройстве.</p>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}><button className="btn ghost" disabled={!series.length && !weightSeries.length} onClick={() => { if (confirm('Удалить все отметки веса и талии?')) { setState(clearMeasurements(state)); setWeights(clearWeights()); } }}>Удалить все отметки</button><button className="btn warn" onClick={() => { if (confirm('Отозвать согласие и удалить все данные раздела?')) { setState(setConsent(state, false)); setWeights(clearWeights()); } }}>Отозвать согласие и удалить данные</button></div>
    </Card>
  );
}
