// Панель админа: вход + управление реферальными ссылками.
// Рендерится вместо основного приложения при заходе на /svoya-nota-app/admin.
import React, { useCallback, useEffect, useState } from 'react';

const BASE = import.meta.env?.VITE_API_BASE || '/svoya-nota-app-api';

function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function AdminPanel() {
  const [token, setToken] = useState(() => localStorage.getItem('nota_admin_token') || '');
  const [referrals, setReferrals] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lu, setLu] = useState('');
  const [lp, setLp] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    label: '', target_url: '', discount_percent: '', reward_percent: '',
    owner_contact: '', payment_details: '',
  });

  const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), ...authHeader(token) },
    });
    if (res.status === 401) { setToken(''); localStorage.removeItem('nota_admin_token'); throw new Error('Не авторизован'); }
    if (!res.ok) {
      let msg = `Ошибка ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }, [token]);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { const d = await api('/api/admin/referrals'); setReferrals(d.referrals || []); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [api]);

  useEffect(() => { if (token) load().catch(() => {}); }, [token, load]);

  const login = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const d = await fetch(`${BASE}/api/admin/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: lu, password: lp }),
      });
      if (!d.ok) { setError('Неверный логин или пароль'); setBusy(false); return; }
      const j = await d.json();
      setToken(j.token); localStorage.setItem('nota_admin_token', j.token);
      setLu(''); setLp('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const logout = () => { setToken(''); localStorage.removeItem('nota_admin_token'); setReferrals([]); };

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    const payload = {
      label: form.label,
      target_url: form.target_url,
      discount_percent: Number(form.discount_percent) || 0,
      reward_percent: Number(form.reward_percent) || 0,
      owner_contact: form.owner_contact,
      payment_details: form.payment_details,
    };
    try {
      if (editingId) await api(`/api/admin/referrals/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/api/admin/referrals', { method: 'POST', body: JSON.stringify(payload) });
      setForm({ label: '', target_url: '', discount_percent: '', reward_percent: '', owner_contact: '', payment_details: '' });
      setEditingId(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const edit = (r) => {
    setEditingId(r.id);
    setForm({
      label: r.label || '', target_url: r.target_url || '',
      discount_percent: String(r.discount_percent ?? ''),
      reward_percent: String(r.reward_percent ?? ''),
      owner_contact: r.owner_contact || '', payment_details: r.payment_details || '',
    });
    window.scrollTo({ top: 0 });
  };

  const remove = async (id) => {
    if (!confirm('Удалить реферальную ссылку?')) return;
    setBusy(true);
    try { await api(`/api/admin/referrals/${id}`, { method: 'DELETE' }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const toggleActive = async (r) => {
    setBusy(true);
    try { await api(`/api/admin/referrals/${r.id}`, { method: 'PATCH', body: JSON.stringify({ active: r.active ? 0 : 1 }) }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const shareLink = (code) => `${window.location.origin}/svoya-nota-app-api/api/r/${code}`;
  const copy = (text) => { try { navigator.clipboard?.writeText(text); } catch {} };

  if (!token) {
    return (
      <div className="admin-wrap">
        <h1 className="admin-h1">Панель администратора</h1>
        <form className="admin-form admin-card" onSubmit={login}>
          <label>Логин</label>
          <input value={lu} onChange={(e) => setLu(e.target.value)} autoFocus />
          <label>Пароль</label>
          <input type="password" value={lp} onChange={(e) => setLp(e.target.value)} />
          {error && <p className="admin-err">{error}</p>}
          <button className="btn" disabled={busy}>Войти</button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-wrap">
      <div className="admin-head">
        <h1 className="admin-h1">Реферальные ссылки</h1>
        <button className="btn ghost" onClick={logout}>Выйти</button>
      </div>
      {error && <p className="admin-err">{error}</p>}

      <form className="admin-form admin-card" onSubmit={submit}>
        <h3>{editingId ? 'Редактировать ссылку' : 'Новая реферальная ссылка'}</h3>
        <label>Название (для себя)</label>
        <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="например: блог Ивана" />
        <label>Ссылка назначения (куда ведёт)</label>
        <input value={form.target_url} onChange={(e) => setForm({ ...form, target_url: e.target.value })} placeholder="https://torion.shop/svoya-nota-app/" />
        <div className="admin-row">
          <div>
            <label>Скидка, % (покупателю)</label>
            <input type="number" min="0" max="100" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} />
          </div>
          <div>
            <label>Вознаграждение, % (рефералу)</label>
            <input type="number" min="0" max="100" value={form.reward_percent} onChange={(e) => setForm({ ...form, reward_percent: e.target.value })} />
          </div>
        </div>
        <label>Контакт (для кого ссылка)</label>
        <input value={form.owner_contact} onChange={(e) => setForm({ ...form, owner_contact: e.target.value })} placeholder="Имя / @ник / телефон" />
        <label>Реквизиты для возмещения вознаграждения</label>
        <textarea value={form.payment_details} onChange={(e) => setForm({ ...form, payment_details: e.target.value })} placeholder="Карта / кошелёк / счёт для выплаты" />
        <div className="admin-actions">
          <button className="btn" disabled={busy}>{editingId ? 'Сохранить' : 'Создать'}</button>
          {editingId && (
            <button type="button" className="btn ghost" onClick={() => { setEditingId(null); setForm({ label: '', target_url: '', discount_percent: '', reward_percent: '', owner_contact: '', payment_details: '' }); }}>Отмена</button>
          )}
        </div>
      </form>

      <h3>Список ({referrals.length})</h3>
      {referrals.length === 0 && <p className="dim">Пока нет ссылок.</p>}
      <div className="admin-list">
        {referrals.map((r) => (
          <div className="admin-item" key={r.id}>
            <div className="admin-item-top">
              <b>{r.label || '(без названия)'}</b>
              <span className={`admin-badge ${r.active ? 'on' : 'off'}`}>{r.active ? 'активна' : 'выкл'}</span>
            </div>
            <div className="admin-meta">код: <code>{r.code}</code> · скидка {r.discount_percent}% · вознагр. {r.reward_percent}% · переходов: <b>{r.visits}</b></div>
            <div className="admin-link">
              <input readOnly value={shareLink(r.code)} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn ghost" onClick={() => copy(shareLink(r.code))}>копировать</button>
            </div>
            {r.owner_contact && <div className="admin-meta">Контакт: {r.owner_contact}</div>}
            {r.payment_details && <div className="admin-meta">Реквизиты: {r.payment_details}</div>}
            <div className="admin-actions">
              <button type="button" className="btn ghost" onClick={() => toggleActive(r)}>{r.active ? 'Выключить' : 'Включить'}</button>
              <button type="button" className="btn ghost" onClick={() => edit(r)}>Редактировать</button>
              <button type="button" className="btn ghost danger" onClick={() => remove(r.id)}>Удалить</button>
            </div>
          </div>
        ))}
      </div>
      <p className="dim small">Вознаграждение рефералу = вознаграждение, % × сумма покупки через Robokassa. Реквизиты — куда выплачивать. Магазин зарегистрирован в Robokassa (партнёрский аккаунт).</p>
    </div>
  );
}
