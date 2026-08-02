import React, { useState } from 'react';

// Режим питания — локально на устройстве (nota.prefs.v1).
// Не содержит клинических данных и не синхронизируется с сервером (логика «Вариант D»).
const PREFS_KEY = 'nota.prefs.v1';


const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`;
const fmtRemain = (mins) => {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60); const m = mins % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин`;
};

const defaults = () => ({
  window: { enabled: true, start: 8 * 60, end: 14 * 60 },
});

function load() { try { const raw = localStorage.getItem(PREFS_KEY); return raw ? { ...defaults(), ...JSON.parse(raw) } : defaults(); } catch { return defaults(); } }
function persist(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* приватный режим */ } }

export default function WellnessPrefs({ now }) {
  const [prefs, setPrefs] = useState(load);
  const update = (next) => { setPrefs(next); persist(next); };

  const d = new Date(now || Date.now());
  const nowMin = d.getHours() * 60 + d.getMinutes();

  // ---- Окно питания ----
  const w = prefs.window;
  const inWindow = w.enabled && nowMin >= w.start && nowMin < w.end;
  let winStatus;
  if (!w.enabled) winStatus = 'окно выключено';
  else if (inWindow) winStatus = 'сейчас: окно приёма';
  else if (nowMin < w.start) winStatus = `до открытия: ${fmtRemain(w.start - nowMin)}`;
  else winStatus = `перерыв · до ${hhmm(w.start)} через ${fmtRemain(24 * 60 - nowMin + w.start)}`;
  const span = ((w.end - w.start + 1440) % 1440) || 1;
  const since = ((nowMin - w.start + 1440) % 1440);
  const progressInWindow = Math.max(0, Math.min(1, since / span));
  const setWindow = (patch) => update({ ...prefs, window: { ...w, ...patch } });

  return (
    <>
      {/* ОКНО ПИТАНИЯ */}
      <section className="n-panel">
        <p className="n-panel-label">окно питания · режим, не медицинская рекомендация</p>
        <div className="wp-row">
          <label>открытие</label>
          <input type="time" value={hhmm(w.start)} onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); setWindow({ start: h * 60 + m }); }} />
          <label>закрытие</label>
          <input type="time" value={hhmm(w.end)} onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); setWindow({ end: h * 60 + m }); }} />
          <label className="wp-switch"><input type="checkbox" checked={w.enabled} onChange={(e) => setWindow({ enabled: e.target.checked })} /> вкл</label>
        </div>
        <div className="wp-status">
          <b>{winStatus}</b>
          <div className="wp-bar"><i style={{ width: `${inWindow ? Math.round(progressInWindow * 100) : 0}%`, background: inWindow ? '#5D8A6E' : 'var(--line, #e7e2d6)' }} /></div>
        </div>
      </section>
    </>
  );
}
