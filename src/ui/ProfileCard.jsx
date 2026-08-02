// Профиль содержит только контекст расчётов. Измерения тела ведутся отдельно
// в device-only контуре BodyObservations и здесь не дублируются.
import React, { useEffect, useMemo, useState } from 'react';
import { Card } from './components.jsx';

const DEFAULTS = {
  height: '', age: '', sex: '',
};

export default function ProfileCard({ lists, addEntry }) {
  const saved = useMemo(
    () => lists.profile?.find((p) => !p.payload.deleted)?.payload || {},
    [lists.profile]
  );
  const [form, setForm] = useState({ ...DEFAULTS, ...saved });
  const [savedFlag, setSavedFlag] = useState(false);
  const [validation, setValidation] = useState('');

  useEffect(() => {
    setForm({ ...DEFAULTS, ...saved });
  }, [saved]);

  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setSavedFlag(false); setValidation(''); };

  const save = () => {
    const required = ['height', 'age'].every((key) => Number(form[key]) > 0) && ['m', 'f'].includes(form.sex);
    if (!required) {
      setValidation('Укажите рост, возраст и пол — для контекста наблюдения.');
      return;
    }
    const at = new Date().toISOString();

    const payload = {
      height: Number(form.height),
      age: Number(form.age),
      sex: form.sex,
      deleted: false,
    };
    addEntry('profile', payload, at, 'profile');
    setSavedFlag(true);
  };

  return (
    <Card eyebrow="Параметры профиля">
      <p className="dim small">
        Рост, возраст и пол используются как контекст расчётов. При включённой
        резервной копии они входят в синхронизируемый профиль. Вес и талия
        находятся ниже — в отдельном локальном разделе.
      </p>

      <div className="formrow">
        <div>
          <label className="fl">Возраст</label>
          <input type="number" inputMode="numeric" value={form.age}
            onChange={(e) => set('age', e.target.value)} />
        </div>
        <div>
          <label className="fl">Рост, см</label>
          <input type="number" inputMode="numeric" value={form.height}
            onChange={(e) => set('height', e.target.value)} />
        </div>
      </div>

      <label className="fl">Пол</label>
      <select value={form.sex} onChange={(e) => set('sex', e.target.value)}>
        <option value="">не указан</option>
        <option value="m">муж</option>
        <option value="f">жен</option>
      </select>

      {validation && <p className="small" role="alert" style={{ marginTop: 8, color: 'var(--animal)' }}>{validation}</p>}
      <button className="btn" onClick={save}>{savedFlag ? 'Сохранено ✓' : 'Сохранить профиль'}</button>
    </Card>
  );
}
